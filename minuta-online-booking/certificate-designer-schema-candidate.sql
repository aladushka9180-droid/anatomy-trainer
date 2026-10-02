-- Unnumbered, additive candidate. Release owner must allocate a migration number
-- and complete backup / PostgreSQL / rollback gates before production execution.
-- Private visual certificate registry; no payment, benefit, booking or redemption writes.
begin;

create table if not exists public.certificate_design_templates (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  creator_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100),
  body jsonb not null check (octet_length(body::text) <= 18000000),
  created_at timestamptz not null default clock_timestamp(),
  unique(id,organization_id)
);
create table if not exists public.certificate_design_issues (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  creator_id uuid not null references auth.users(id) on delete restrict,
  template_id uuid not null,
  request_id uuid not null,
  certificate_number text not null check (char_length(certificate_number) between 1 and 40),
  record jsonb not null check (octet_length(record::text) <= 16000),
  issued_on date not null,
  expires_on date not null check (expires_on >= issued_on),
  remind_days integer not null check (remind_days between 0 and 365),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(template_id,organization_id) references public.certificate_design_templates(id,organization_id) on delete restrict,
  unique(organization_id,certificate_number),
  unique(organization_id,creator_id,request_id)
);
create index if not exists certificate_design_history_idx on public.certificate_design_issues(organization_id,created_at desc,id desc);
create index if not exists certificate_design_expiry_idx on public.certificate_design_issues(organization_id,expires_on);
alter table public.certificate_design_issues add column if not exists client_phone text check(client_phone ~ '^7[0-9]{10}$');
alter table public.certificate_design_issues add column if not exists client_account_id uuid references public.client_accounts(id) on delete set null;
alter table public.certificate_design_issues add column if not exists benefit_instrument_id uuid references public.client_benefit_instruments(id) on delete restrict;
-- Keep the exact submitted request even when the server assigns a different number.
alter table public.certificate_design_issues add column if not exists request_record jsonb check(octet_length(request_record::text)<=16000);
create table if not exists public.certificate_design_drafts (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  creator_id uuid not null references auth.users(id) on delete restrict,
  revision uuid not null,
  body jsonb not null check(octet_length(body::text)<=18020000),
  updated_at timestamptz not null default clock_timestamp(),
  issued_id uuid references public.certificate_design_issues(id) on delete restrict
);
create index if not exists certificate_design_drafts_owner_idx on public.certificate_design_drafts(organization_id,creator_id,updated_at desc,id desc) where issued_id is null;
alter table public.certificate_design_drafts enable row level security;
alter table public.certificate_design_drafts force row level security;
revoke all on public.certificate_design_drafts from public,anon,authenticated,service_role;
create index if not exists certificate_design_client_idx on public.certificate_design_issues(organization_id,client_phone,created_at desc,id desc);
create unique index if not exists certificate_design_benefit_once_idx on public.certificate_design_issues(organization_id,benefit_instrument_id) where benefit_instrument_id is not null;
alter table public.certificate_design_templates enable row level security;
alter table public.certificate_design_templates force row level security;
alter table public.certificate_design_issues enable row level security;
alter table public.certificate_design_issues force row level security;
revoke all on public.certificate_design_templates,public.certificate_design_issues from public,anon,authenticated,service_role;
grant select on public.certificate_design_templates,public.certificate_design_issues to authenticated;

create or replace function public.minuta_certificate_can_read(p_organization uuid,p_creator uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.organization_memberships m
    join public.organizations o on o.id=m.organization_id and o.status='active'
    where m.organization_id=p_organization and m.user_id=auth.uid() and m.active
      and (m.role in ('owner','admin') or (m.role='specialist' and p_creator=auth.uid())));
$$;
revoke all on function public.minuta_certificate_can_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.minuta_certificate_can_read(uuid,uuid) to authenticated;
drop policy if exists certificate_design_template_read on public.certificate_design_templates;
create policy certificate_design_template_read on public.certificate_design_templates for select to authenticated
  using(public.minuta_certificate_can_read(organization_id,creator_id));
drop policy if exists certificate_design_issue_read on public.certificate_design_issues;
create policy certificate_design_issue_read on public.certificate_design_issues for select to authenticated
  using(public.minuta_certificate_can_read(organization_id,creator_id));

create or replace function public.minuta_certificate_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select m.role into v_role from public.organization_memberships m
    join public.organizations o on o.id=m.organization_id and o.status='active'
    where m.organization_id=p_organization and m.user_id=auth.uid() and m.active;
  if v_role is null or v_role not in ('owner','admin','specialist') then
    raise exception using errcode='42501',message='certificate_access_denied';
  end if;
  return v_role;
end $$;
create or replace function public.minuta_certificate_today(p_organization uuid)
returns date language plpgsql stable security definer set search_path='' as $$
declare v_timezone text;
begin
  select l.timezone into v_timezone from public.locations l where l.organization_id=p_organization and l.active
    order by l.is_primary desc,l.id limit 1;
  if v_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names z where z.name=v_timezone) then
    raise exception using errcode='22023',message='certificate_timezone_unavailable';
  end if;
  return (current_timestamp at time zone v_timezone)::date;
end $$;
create or replace function public.minuta_certificate_valid_layout(p_layout jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare v_key text; v_field jsonb;
begin
  if jsonb_typeof(p_layout) is distinct from 'object' or octet_length(p_layout::text)>1200 then return false; end if;
  foreach v_key in array array['procedure','date','number'] loop
    v_field:=p_layout->v_key;
    if jsonb_typeof(v_field) is distinct from 'object'
      or jsonb_typeof(v_field->'x') is distinct from 'number' or jsonb_typeof(v_field->'y') is distinct from 'number'
      or jsonb_typeof(v_field->'width') is distinct from 'number' or jsonb_typeof(v_field->'size') is distinct from 'number'
      or jsonb_typeof(v_field->'italic') is distinct from 'boolean' then return false; end if;
    if (v_field->>'x')::numeric not between .025 and .975 or (v_field->>'y')::numeric not between .025 and .975
      or (v_field->>'width')::numeric not between .05 and 1 or (v_field->>'size')::numeric not between .005 and .1
      or (v_field->>'width')::numeric > 2*(v_field->>'x')::numeric
      or (v_field->>'width')::numeric > 2*(1-(v_field->>'x')::numeric) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.save_minuta_certificate_design(p_organization uuid,p_template jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text; v_id uuid; v_existing public.certificate_design_templates%rowtype; v_font record;
begin
  v_role:=public.minuta_certificate_role(p_organization);
  if jsonb_typeof(p_template) is distinct from 'object' or octet_length(p_template::text)>18000000
    or coalesce(char_length(p_template->>'name'),0) not between 1 and 100
    or coalesce(p_template->>'image_data','') !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
    or char_length(p_template->>'image_data')>11200000
    or not public.minuta_certificate_valid_layout(p_template->'layout')
    or jsonb_typeof(p_template->'font_files') is distinct from 'object' then
    raise exception using errcode='22023',message='invalid_certificate_template';
  end if;
  for v_font in select * from jsonb_each_text(p_template->'font_files') loop
    if v_font.key not in ('Gabriola','History Pro 02') or char_length(v_font.value)>2800000
      or v_font.value !~ '^data:(font/[A-Za-z0-9.+-]+|application/(octet-stream|font-woff|x-font-ttf|x-font-opentype|vnd.ms-opentype));base64,[A-Za-z0-9+/=]+$' then
      raise exception using errcode='22023',message='invalid_certificate_font';
    end if;
  end loop;
  v_id:=(p_template->>'id')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id::text,0));
  select * into v_existing from public.certificate_design_templates where id=v_id;
  if found then
    if v_existing.organization_id<>p_organization or v_existing.creator_id<>auth.uid() or v_existing.body<>p_template then
      raise exception using errcode='22023',message='certificate_request_conflict';
    end if;
  else
    insert into public.certificate_design_templates(id,organization_id,creator_id,name,body)
      values(v_id,p_organization,auth.uid(),p_template->>'name',p_template);
  end if;
  return jsonb_build_object('organization_id',p_organization,'id',v_id);
end $$;

create or replace function public.get_minuta_certificate_design(p_organization uuid,p_template uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text; v_body jsonb;
begin
  v_role:=public.minuta_certificate_role(p_organization);
  select t.body into v_body from public.certificate_design_templates t
    where t.organization_id=p_organization and t.id=p_template and public.minuta_certificate_can_read(t.organization_id,t.creator_id);
  if v_body is null then raise exception using errcode='42501',message='certificate_template_not_found'; end if;
  return jsonb_build_object('organization_id',p_organization,'template',v_body);
end $$;

create or replace function public.minuta_certificate_next_number(p_organization uuid)
returns text language sql stable security definer set search_path='' as $$
  select (coalesce(max(certificate_number::numeric),0)+1)::text from public.certificate_design_issues
    where organization_id=p_organization and certificate_number ~ '^[0-9]+$';
$$;

create or replace function public.save_minuta_certificate_draft(p_organization uuid,p_id uuid,p_body jsonb,p_expected_revision uuid,p_revision uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_existing public.certificate_design_drafts%rowtype; v_template jsonb; v_field record; v_font record;
begin
  perform public.minuta_certificate_role(p_organization);
  if p_id is null or p_revision is null or jsonb_typeof(p_body) is distinct from 'object' or octet_length(p_body::text)>18020000
    or jsonb_typeof(p_body->'form') is distinct from 'object' or octet_length((p_body->'form')::text)>4000 then
    raise exception using errcode='22023',message='invalid_certificate_draft';
  end if;
  for v_field in select * from jsonb_each(p_body->'form') loop
    if v_field.key not in ('content-mode','custom-text','service','sessions','font','date','number','number-mode','expiry','remind','benefit','format','paper')
      or jsonb_typeof(v_field.value)<>'string' or char_length(v_field.value#>>'{}')>260 then
      raise exception using errcode='22023',message='invalid_certificate_draft';
    end if;
  end loop;
  v_template:=p_body->'template';
  if v_template is not null and v_template<>'null'::jsonb then
    if jsonb_typeof(v_template) is distinct from 'object' or octet_length(v_template::text)>18000000
      or coalesce(char_length(v_template->>'name'),0) not between 1 and 100
      or coalesce(v_template->>'image_data','') !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'
      or char_length(v_template->>'image_data')>11200000 or not public.minuta_certificate_valid_layout(v_template->'layout')
      or jsonb_typeof(v_template->'font_files') is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_certificate_draft';
    end if;
    perform (v_template->>'id')::uuid;
    for v_font in select * from jsonb_each_text(v_template->'font_files') loop
      if v_font.key not in ('Gabriola','History Pro 02') or char_length(v_font.value)>2800000
        or v_font.value !~ '^data:(font/[A-Za-z0-9.+-]+|application/(octet-stream|font-woff|x-font-ttf|x-font-opentype|vnd.ms-opentype));base64,[A-Za-z0-9+/=]+$' then
        raise exception using errcode='22023',message='invalid_certificate_font';
      end if;
    end loop;
  end if;
  if p_body->'client' is not null and p_body->'client'<>'null'::jsonb then
    if not public.can_access_minuta_client_record(p_organization,p_body->'client'->>'phone')
      or coalesce(char_length(p_body->'client'->>'name'),0) not between 1 and 180
      or octet_length((p_body->'client')::text)>1000 then raise exception using errcode='42501',message='invalid_certificate_client'; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('certificate-draft:'||p_id::text,0));
  select * into v_existing from public.certificate_design_drafts where id=p_id for update;
  if found then
    if v_existing.organization_id<>p_organization or v_existing.creator_id<>auth.uid() or v_existing.issued_id is not null then
      raise exception using errcode='42501',message='certificate_draft_unavailable';
    end if;
    if v_existing.revision=p_revision then
      if v_existing.body<>p_body then raise exception using errcode='22023',message='certificate_draft_conflict'; end if;
      return jsonb_build_object('organization_id',p_organization,'id',p_id,'revision',p_revision);
    end if;
    if v_existing.revision is distinct from p_expected_revision then raise exception using errcode='22023',message='certificate_draft_conflict'; end if;
    update public.certificate_design_drafts set body=p_body,revision=p_revision,updated_at=clock_timestamp() where id=p_id;
  else
    if p_expected_revision is not null then raise exception using errcode='22023',message='certificate_draft_conflict'; end if;
    insert into public.certificate_design_drafts(id,organization_id,creator_id,revision,body) values(p_id,p_organization,auth.uid(),p_revision,p_body);
  end if;
  return jsonb_build_object('organization_id',p_organization,'id',p_id,'revision',p_revision);
end $$;

create or replace function public.get_minuta_certificate_draft(p_organization uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_draft public.certificate_design_drafts%rowtype;
begin
  perform public.minuta_certificate_role(p_organization);
  select * into v_draft from public.certificate_design_drafts where id=p_id and organization_id=p_organization and creator_id=auth.uid() and issued_id is null;
  if not found then raise exception using errcode='42501',message='certificate_draft_unavailable'; end if;
  return jsonb_build_object('organization_id',p_organization,'id',v_draft.id,'revision',v_draft.revision,'body',v_draft.body);
end $$;

create or replace function public.get_minuta_certificate_drafts(p_organization uuid,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_rows jsonb; v_cursor jsonb;
begin
  perform public.minuta_certificate_role(p_organization);
  with filtered as (select * from public.certificate_design_drafts where organization_id=p_organization and creator_id=auth.uid() and issued_id is null
    and (p_cursor is null or (updated_at,id)<((p_cursor->>'updated_at')::timestamptz,(p_cursor->>'id')::uuid)) order by updated_at desc,id desc limit 51),
  paged as (select * from filtered order by updated_at desc,id desc limit 50)
  select coalesce((select jsonb_agg(jsonb_build_object('id',id,'revision',revision,'updated_at',updated_at,'text',body->'form'->>'custom-text','service_id',body->'form'->>'service','content_mode',body->'form'->>'content-mode','template_name',body->'template'->>'name') order by updated_at desc,id desc) from paged),'[]'::jsonb),
    case when (select count(*) from filtered)>50 then (select jsonb_build_object('updated_at',updated_at,'id',id) from paged order by updated_at,id limit 1) else null end into v_rows,v_cursor;
  return jsonb_build_object('organization_id',p_organization,'drafts',v_rows,'next_cursor',v_cursor);
end $$;

create or replace function public.get_minuta_certificate_design_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text;
begin
  v_role:=public.minuta_certificate_role(p_organization);
  return jsonb_build_object('organization_id',p_organization,'current_role',v_role,'today',public.minuta_certificate_today(p_organization),'next_number',public.minuta_certificate_next_number(p_organization),
    'templates',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.created_at desc)
      from (select * from public.certificate_design_templates where organization_id=p_organization
        and public.minuta_certificate_can_read(organization_id,creator_id) order by created_at desc limit 50) t),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'duration_minutes',s.duration_minutes) order by s.name,s.id)
      from public.services s join public.organization_memberships m on m.organization_id=p_organization
        and m.user_id=s.performer_id and m.active and m.is_bookable
      where s.active and (v_role in ('owner','admin') or s.performer_id=auth.uid())),'[]'::jsonb));
end $$;

create or replace function public.record_minuta_certificate_issue(p_organization uuid,p_record jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text; v_existing public.certificate_design_issues%rowtype; v_template uuid; v_id uuid; v_service public.services%rowtype;
  v_sessions integer; v_issued date; v_expiry date; v_remind integer; v_number text;
  v_phone text; v_account uuid; v_benefit uuid; v_constraint text; v_mode text;
  v_number_mode text; v_record jsonb; v_draft uuid; v_draft_revision uuid;
begin
  v_role:=public.minuta_certificate_role(p_organization);
  if p_request_id is null then raise exception using errcode='22023',message='certificate_request_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization::text||auth.uid()::text||p_request_id::text,0));
  select * into v_existing from public.certificate_design_issues
    where organization_id=p_organization and creator_id=auth.uid() and request_id=p_request_id;
  if found then
    if coalesce(v_existing.request_record,v_existing.record)<>p_record then raise exception using errcode='22023',message='certificate_request_conflict'; end if;
    return jsonb_build_object('organization_id',p_organization,'record',v_existing.record||jsonb_build_object('id',v_existing.id));
  end if;
  if jsonb_typeof(p_record) is distinct from 'object' or octet_length(p_record::text)>16000
    or jsonb_typeof(p_record->'procedure') is distinct from 'string'
    or coalesce(char_length(btrim(p_record->>'procedure',E' \t\r\n')),0) not between 1 and 260
    or char_length(p_record->>'procedure')>260
    or not public.minuta_certificate_valid_layout(p_record->'layout') then raise exception using errcode='22023',message='invalid_certificate'; end if;
  v_template:=(p_record->>'template_id')::uuid; v_sessions:=(p_record->>'sessions')::integer;
  v_mode:=coalesce(p_record->>'content_mode','catalog');
  if v_mode not in ('catalog','custom') then raise exception using errcode='22023',message='invalid_certificate'; end if;
  v_issued:=(p_record->>'issued_on')::date; v_expiry:=(p_record->>'expires_on')::date;
  v_remind:=(p_record->>'remind_days')::integer; v_number:=btrim(p_record->>'number');
  v_number_mode:=coalesce(p_record->>'number_mode','manual');
  if v_number_mode not in ('auto','manual') then raise exception using errcode='22023',message='invalid_certificate'; end if;
  if v_issued is null or v_expiry is null or v_expiry<v_issued or v_expiry>v_issued+interval '10 years'
    or (v_mode='catalog' and (v_sessions is null or v_sessions not between 1 and 1000)) or v_remind is null or v_remind not between 0 and 365
    or coalesce(char_length(v_number),0) not between 1 and 40 or v_number<>p_record->>'number'
    or p_record->>'font_family' is null or p_record->>'font_family' not in ('Times New Roman','Gabriola','History Pro 02') then
    raise exception using errcode='22023',message='invalid_certificate';
  end if;
  if not exists(select 1 from public.certificate_design_templates t where t.id=v_template and t.organization_id=p_organization
    and public.minuta_certificate_can_read(t.organization_id,t.creator_id)
    and (p_record->>'font_family'='Times New Roman' or coalesce(t.body->'font_files'->>(p_record->>'font_family'),'')<>'')) then
    raise exception using errcode='42501',message='certificate_template_not_found';
  end if;
  if v_mode='custom' then
    if p_record->>'service_id' is not null or p_record->>'service_name' is not null
      or p_record->>'duration_minutes' is not null or p_record->>'sessions' is not null then
      raise exception using errcode='22023',message='invalid_certificate_service';
    end if;
    if nullif(p_record->>'benefit_instrument_id','') is not null then
      raise exception using errcode='22023',message='invalid_certificate_benefit';
    end if;
  else
  select s.* into v_service from public.services s join public.organization_memberships m
    on m.organization_id=p_organization and m.user_id=s.performer_id and m.active and m.is_bookable
    where s.id=(p_record->>'service_id')::uuid and s.active and (v_role in ('owner','admin') or s.performer_id=auth.uid());
  if not found or v_service.name is distinct from p_record->>'service_name'
    or v_service.duration_minutes is distinct from (p_record->>'duration_minutes')::integer then
    raise exception using errcode='22023',message='invalid_certificate_service';
  end if;
  end if;
  v_phone:=nullif(p_record->>'client_phone','');v_account:=nullif(p_record->>'client_account_id','')::uuid;
  v_benefit:=nullif(p_record->>'benefit_instrument_id','')::uuid;
  if v_phone is not null then
    if not public.can_access_minuta_client_record(p_organization,v_phone)
      or coalesce(char_length(p_record->>'client_name'),0) not between 1 and 180
      or (v_account is not null and not exists(select 1 from public.client_accounts c where c.id=v_account and c.normalized_phone=v_phone)) then
      raise exception using errcode='42501',message='invalid_certificate_client';
    end if;
  elsif v_account is not null or v_benefit is not null or p_record->>'client_name' is not null then
    raise exception using errcode='22023',message='invalid_certificate_client';
  end if;
  if v_benefit is not null and not exists(select 1 from public.client_benefit_instruments b
    where b.id=v_benefit and b.organization_id=p_organization and b.client_account_id=v_account
      and b.status='active' and b.expires_on>=public.minuta_certificate_today(p_organization) and b.remaining_visits>0
      and b.product_snapshot->>'kind'='visit_pass' and (b.product_snapshot->>'visits_count')::integer=v_sessions
      and (jsonb_array_length(coalesce(b.product_snapshot->'services','[]'::jsonb))=0 or exists(
        select 1 from jsonb_array_elements(b.product_snapshot->'services') s where s->>'service_id'=v_service.id::text))) then
    raise exception using errcode='22023',message='invalid_certificate_benefit';
  end if;
  v_draft:=nullif(p_record->>'draft_id','')::uuid; v_draft_revision:=nullif(p_record->>'draft_revision','')::uuid;
  if (v_draft is null)<>(v_draft_revision is null) then raise exception using errcode='22023',message='invalid_certificate_draft'; end if;
  if v_draft is not null then
    perform 1 from public.certificate_design_drafts d where d.id=v_draft and d.organization_id=p_organization and d.creator_id=auth.uid() and d.revision=v_draft_revision and d.issued_id is null for update;
    if not found then raise exception using errcode='22023',message='certificate_draft_conflict'; end if;
  end if;
  -- Both manual and automatic issuance take this lock. Failed/draft requests consume no number.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('certificate-number:'||p_organization::text,0));
  if v_number_mode='auto' then v_number:=public.minuta_certificate_next_number(p_organization); end if;
  if char_length(v_number)>40 then raise exception using errcode='22023',message='certificate_number_exhausted'; end if;
  v_record:=p_record||jsonb_build_object('number',v_number);
  begin
    insert into public.certificate_design_issues(organization_id,creator_id,template_id,request_id,certificate_number,record,request_record,issued_on,expires_on,remind_days,client_phone,client_account_id,benefit_instrument_id)
      values(p_organization,auth.uid(),v_template,p_request_id,v_number,v_record,p_record,v_issued,v_expiry,v_remind,v_phone,v_account,v_benefit) returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint=constraint_name;
    if v_constraint='certificate_design_benefit_once_idx' then raise exception using errcode='23505',message='certificate_benefit_already_linked'; end if;
    raise exception using errcode='23505',message='certificate_number_exists';
  end;
  if v_draft is not null then update public.certificate_design_drafts set issued_id=v_id where id=v_draft; end if;
  return jsonb_build_object('organization_id',p_organization,'record',v_record||jsonb_build_object('id',v_id));
end $$;

create or replace function public.get_minuta_certificate_clients(p_organization uuid,p_query text default '')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text;v_clients jsonb;
begin
  v_role:=public.minuta_certificate_role(p_organization);
  if p_query is null or char_length(p_query)>100 then raise exception using errcode='22023',message='invalid_certificate_search';end if;
  with source as (
    select public.normalize_client_phone(b.client_phone) phone,b.client_name name,b.client_account_id account_id,b.created_at stamp
      from public.bookings b where b.organization_id=p_organization and (v_role in ('owner','admin') or b.performer_id=auth.uid())
    union all select c.normalized_phone,c.client_name,null::uuid,c.updated_at from public.organization_imported_clients c
      where c.organization_id=p_organization and v_role in ('owner','admin')
  ), clients as (select distinct on(phone) phone,name,account_id from source where phone ~ '^7[0-9]{10}$' and coalesce(name,'')<>'' order by phone,stamp desc,account_id nulls last)
  select coalesce(jsonb_agg(to_jsonb(c) order by c.name,c.phone),'[]'::jsonb) into v_clients from (
    select * from clients where strpos(lower(name||' '||phone),lower(btrim(p_query)))>0 order by name,phone limit 25) c;
  return jsonb_build_object('organization_id',p_organization,'clients',v_clients);
end $$;

create or replace function public.get_minuta_certificate_client_options(p_organization uuid,p_phone text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_account uuid;v_rows jsonb;
begin
  perform public.minuta_certificate_role(p_organization);
  if not public.can_access_minuta_client_record(p_organization,p_phone) then raise exception using errcode='42501',message='invalid_certificate_client';end if;
  select id into v_account from public.client_accounts where normalized_phone=p_phone;
  select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.product_snapshot->>'name','visits_count',(b.product_snapshot->>'visits_count')::integer,
    'remaining_visits',b.remaining_visits,'services',coalesce(b.product_snapshot->'services','[]'::jsonb)) order by b.issued_at desc,b.id),'[]'::jsonb)
    into v_rows from public.client_benefit_instruments b where b.organization_id=p_organization and b.client_account_id=v_account
      and b.status='active' and b.expires_on>=public.minuta_certificate_today(p_organization) and b.remaining_visits>0
      and b.product_snapshot->>'kind'='visit_pass'
      and not exists(select 1 from public.certificate_design_issues i where i.organization_id=p_organization and i.benefit_instrument_id=b.id);
  return jsonb_build_object('organization_id',p_organization,'client_phone',p_phone,'client_account_id',v_account,'instruments',v_rows);
end $$;

create or replace function public.get_minuta_client_certificates(p_organization uuid,p_phone text,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_account uuid;v_rows jsonb;v_cursor jsonb;
begin
  perform public.minuta_certificate_role(p_organization);
  if not public.can_access_minuta_client_record(p_organization,p_phone) then raise exception using errcode='42501',message='invalid_certificate_client';end if;
  select id into v_account from public.client_accounts where normalized_phone=p_phone;
  with source as (select i.*,b.remaining_visits,b.status benefit_status from public.certificate_design_issues i
    left join public.client_benefit_instruments b on b.id=i.benefit_instrument_id and b.organization_id=i.organization_id and b.client_account_id=i.client_account_id
    where i.organization_id=p_organization and (i.client_phone=p_phone or i.client_account_id=v_account)
      and public.minuta_certificate_can_read(i.organization_id,i.creator_id)
      and (p_cursor is null or (i.created_at,i.id)<((p_cursor->>'created_at')::timestamptz,(p_cursor->>'id')::uuid))
    order by i.created_at desc,i.id desc limit 51), paged as(select * from source order by created_at desc,id desc limit 50)
  select coalesce((select jsonb_agg(p.record||jsonb_build_object('id',p.id,'remaining_visits',p.remaining_visits,'benefit_status',p.benefit_status) order by p.created_at desc,p.id desc) from paged p),'[]'::jsonb),
    case when(select count(*) from source)>50 then(select jsonb_build_object('created_at',created_at,'id',id) from paged order by created_at,id limit 1)end into v_rows,v_cursor;
  return jsonb_build_object('organization_id',p_organization,'client_phone',p_phone,'today',public.minuta_certificate_today(p_organization),'records',v_rows,'next_cursor',v_cursor);
end $$;

create or replace function public.get_minuta_certificate_issue_history(p_organization uuid,p_query text default '',p_status text default 'all',p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text; v_today date; v_rows jsonb; v_cursor jsonb; v_count integer;
begin
  v_role:=public.minuta_certificate_role(p_organization); v_today:=public.minuta_certificate_today(p_organization);
  if p_query is null or char_length(p_query)>180 or p_status is null or p_status not in ('all','active','expiring','expired') then
    raise exception using errcode='22023',message='invalid_certificate_search';
  end if;
  with filtered as (
    select i.* from public.certificate_design_issues i where i.organization_id=p_organization
      and public.minuta_certificate_can_read(i.organization_id,i.creator_id)
      and strpos(lower(i.certificate_number||' '||(i.record->>'procedure')),lower(btrim(p_query)))>0
      and (p_status='all' or (p_status='expired' and i.expires_on<v_today)
        or (p_status='expiring' and i.expires_on between v_today and v_today+i.remind_days)
        or (p_status='active' and i.expires_on>v_today+i.remind_days))
      and (p_cursor is null or (i.created_at,i.id)<((p_cursor->>'created_at')::timestamptz,(p_cursor->>'id')::uuid))
    order by i.created_at desc,i.id desc limit 51
  ), paged as (select * from filtered order by created_at desc,id desc limit 50)
  select coalesce((select jsonb_agg(p.record||jsonb_build_object('id',p.id) order by p.created_at desc,p.id desc) from paged p),'[]'::jsonb),
    case when (select count(*) from filtered)>50 then (select jsonb_build_object('created_at',created_at,'id',id) from paged order by created_at,id limit 1) else null end
    into v_rows,v_cursor;
  select count(*) into v_count from public.certificate_design_issues i where i.organization_id=p_organization
    and public.minuta_certificate_can_read(i.organization_id,i.creator_id) and i.expires_on between v_today and v_today+i.remind_days;
  return jsonb_build_object('organization_id',p_organization,'today',v_today,'records',v_rows,'next_cursor',v_cursor,'expiring_count',v_count);
end $$;

revoke all on function public.minuta_certificate_role(uuid),public.minuta_certificate_today(uuid),public.minuta_certificate_valid_layout(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.minuta_certificate_next_number(uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_minuta_certificate_draft(uuid,uuid,jsonb,uuid,uuid),public.get_minuta_certificate_draft(uuid,uuid),public.get_minuta_certificate_drafts(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_certificate_draft(uuid,uuid,jsonb,uuid,uuid),public.get_minuta_certificate_draft(uuid,uuid),public.get_minuta_certificate_drafts(uuid,jsonb) to authenticated;
revoke all on function public.save_minuta_certificate_design(uuid,jsonb),public.get_minuta_certificate_design(uuid,uuid),
  public.get_minuta_certificate_design_workspace(uuid),public.record_minuta_certificate_issue(uuid,jsonb,uuid),
  public.get_minuta_certificate_issue_history(uuid,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_certificate_clients(uuid,text),public.get_minuta_certificate_client_options(uuid,text),public.get_minuta_client_certificates(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_certificate_design(uuid,jsonb),public.get_minuta_certificate_design(uuid,uuid),
  public.get_minuta_certificate_design_workspace(uuid),public.record_minuta_certificate_issue(uuid,jsonb,uuid),
  public.get_minuta_certificate_issue_history(uuid,text,text,jsonb) to authenticated;
grant execute on function public.get_minuta_certificate_clients(uuid,text),public.get_minuta_certificate_client_options(uuid,text),public.get_minuta_client_certificates(uuid,text,jsonb) to authenticated;
commit;
