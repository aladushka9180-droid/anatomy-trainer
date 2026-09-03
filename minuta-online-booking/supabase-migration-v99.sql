\set ON_ERROR_STOP on

begin;
set local search_path=public,extensions,pg_catalog;

do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.organization_imported_clients') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='P0001',message='v99_requires_v65_v95';
  end if;
end $$;

create table if not exists public.booking_history_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  source_file_name text not null check (char_length(source_file_name) between 1 and 160),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  input_count integer not null check (input_count between 1 and 500),
  created_count integer not null default 0 check (created_count between 0 and 500),
  duplicate_count integer not null default 0 check (duplicate_count between 0 and 500),
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_import_batch_id uuid not null references public.client_import_batches(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id,request_id)
);

create table if not exists public.organization_imported_booking_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  performer_id uuid not null references auth.users(id) on delete restrict,
  import_batch_id uuid not null references public.booking_history_import_batches(id) on delete restrict,
  source_fingerprint text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  source_file_name text not null check (char_length(source_file_name) between 1 and 160),
  source_sheet text not null check (char_length(source_sheet) between 1 and 80),
  source_provider_name text check (source_provider_name is null or char_length(source_provider_name)<=120),
  booking_date date not null check (booking_date>=date '2000-01-01'),
  booking_time time without time zone not null,
  duration_minutes integer not null check (duration_minutes between 1 and 480),
  client_name text not null check (char_length(client_name) between 2 and 80),
  normalized_phone text not null check (normalized_phone ~ '^7[0-9]{10}$'),
  display_phone text not null check (char_length(display_phone) between 10 and 24),
  service_name text not null check (char_length(service_name) between 1 and 400),
  source_note text check (source_note is null or char_length(source_note)<=1000),
  price_rub integer not null default 0 check (price_rub between 0 and 10000000),
  imported_at timestamptz not null default now(),
  unique (organization_id,source_fingerprint)
);

alter table public.booking_history_import_batches enable row level security;
alter table public.organization_imported_booking_history enable row level security;

revoke all on table public.booking_history_import_batches from public,anon,authenticated,service_role;
revoke all on table public.organization_imported_booking_history from public,anon,authenticated,service_role;

create index if not exists booking_history_import_batches_scope_v99_idx
  on public.booking_history_import_batches(organization_id,created_at desc,id desc);
create index if not exists imported_booking_history_scope_v99_idx
  on public.organization_imported_booking_history(organization_id,booking_date desc,booking_time desc,id desc);
create index if not exists imported_booking_history_client_v99_idx
  on public.organization_imported_booking_history(organization_id,normalized_phone,booking_date desc,booking_time desc);

create or replace function public.import_minuta_booking_history(
  p_organization uuid,
  p_rows jsonb,
  p_request_id uuid,
  p_source_file text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_count integer;
  v_source_file text:=regexp_replace(btrim(coalesce(p_source_file,'')),'^.*[\\/]','','g');
  v_payload_hash text;
  v_batch public.booking_history_import_batches%rowtype;
  v_client_batch uuid;
  v_row jsonb;
  v_phone text;
  v_name text;
  v_display_phone text;
  v_service text;
  v_provider text;
  v_note text;
  v_sheet text;
  v_date date;
  v_time time without time zone;
  v_duration integer;
  v_price integer;
  v_fingerprint text;
  v_created integer:=0;
  v_history_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_actor and membership.active;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception using errcode='42501',message='booking_history_import_denied';
  end if;
  if p_request_id is null or jsonb_typeof(p_rows)<>'array' or char_length(v_source_file) not between 1 and 160 then
    raise exception using errcode='22023',message='invalid_booking_history_import';
  end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count not between 1 and 500 then raise exception using errcode='22023',message='invalid_booking_history_import_count'; end if;
  v_payload_hash:=encode(extensions.digest(convert_to(p_rows::text,'UTF8'),'sha256'),'hex');
  select * into v_batch from public.booking_history_import_batches
  where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_batch.payload_hash<>v_payload_hash then raise exception using errcode='22023',message='booking_history_request_reused'; end if;
    return jsonb_build_object('batch_id',v_batch.id,'input_count',v_batch.input_count,'created_count',v_batch.created_count,'duplicate_count',v_batch.duplicate_count,'idempotent',true);
  end if;
  insert into public.client_import_batches(
    organization_id,request_id,source_system,payload_hash,input_count,created_count,updated_count,actor_id
  ) values(
    p_organization,pg_catalog.gen_random_uuid(),'other',v_payload_hash,v_count,0,0,v_actor
  ) returning id into v_client_batch;
  insert into public.booking_history_import_batches(
    organization_id,request_id,source_file_name,payload_hash,input_count,actor_id,client_import_batch_id
  ) values(
    p_organization,p_request_id,v_source_file,v_payload_hash,v_count,v_actor,v_client_batch
  ) returning * into v_batch;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_phone:=public.normalize_client_phone(v_row->>'phone');
    v_name:=btrim(coalesce(v_row->>'client_name',''));
    v_display_phone:=btrim(coalesce(nullif(v_row->>'display_phone',''),v_row->>'phone',''));
    v_service:=btrim(coalesce(v_row->>'service_name',''));
    v_provider:=nullif(btrim(coalesce(v_row->>'source_provider_name','')),'');
    v_note:=nullif(btrim(coalesce(v_row->>'source_note','')),'');
    v_sheet:=btrim(coalesce(v_row->>'source_sheet',''));
    begin v_date:=(v_row->>'booking_date')::date; exception when others then raise exception using errcode='22023',message='invalid_booking_history_date'; end;
    begin v_time:=(v_row->>'booking_time')::time; exception when others then raise exception using errcode='22023',message='invalid_booking_history_time'; end;
    begin v_duration:=(v_row->>'duration_minutes')::integer; exception when others then raise exception using errcode='22023',message='invalid_booking_history_duration'; end;
    begin v_price:=coalesce((v_row->>'price_rub')::integer,0); exception when others then raise exception using errcode='22023',message='invalid_booking_history_price'; end;
    if v_phone!~'^7[0-9]{10}$' or char_length(v_name) not between 2 and 80
       or char_length(v_display_phone) not between 10 and 24 or char_length(v_service) not between 1 and 400
       or char_length(v_sheet) not between 1 and 80 or char_length(coalesce(v_provider,''))>120
       or char_length(coalesce(v_note,''))>1000 or v_date<date '2000-01-01' or v_date>current_date
       or extract(second from v_time)<>0 or v_duration not between 1 and 480
       or extract(epoch from v_time)+v_duration*60>=86400
       or v_price not between 0 and 10000000 then
      raise exception using errcode='22023',message='invalid_booking_history_row';
    end if;
    v_fingerprint:=encode(extensions.digest(convert_to(
      concat_ws('|',v_date::text,v_time::text,v_duration::text,v_phone,lower(v_service),lower(coalesce(v_provider,''))),
      'UTF8'),'sha256'),'hex');
    v_history_id:=null;
    insert into public.organization_imported_booking_history(
      organization_id,performer_id,import_batch_id,source_fingerprint,source_file_name,source_sheet,
      source_provider_name,booking_date,booking_time,duration_minutes,client_name,normalized_phone,
      display_phone,service_name,source_note,price_rub
    ) values(
      p_organization,v_actor,v_batch.id,v_fingerprint,v_source_file,v_sheet,v_provider,v_date,v_time,
      v_duration,v_name,v_phone,v_display_phone,v_service,v_note,v_price
    ) on conflict (organization_id,source_fingerprint) do nothing returning id into v_history_id;
    if v_history_id is not null then v_created:=v_created+1; end if;
  end loop;

  with affected as (
    select distinct public.normalize_client_phone(value->>'phone') as phone
    from jsonb_array_elements(p_rows)
  ), aggregated as (
    select distinct on (history.normalized_phone)
      history.normalized_phone,history.display_phone,history.client_name,
      count(*) over(partition by history.normalized_phone)::integer as visits,
      least(2000000000::bigint,sum(history.price_rub) over(partition by history.normalized_phone))::integer as spent,
      max(history.booking_date) over(partition by history.normalized_phone) as last_visit
    from public.organization_imported_booking_history history
    join affected on affected.phone=history.normalized_phone
    where history.organization_id=p_organization
    order by history.normalized_phone,history.booking_date desc,history.booking_time desc,history.id desc
  )
  insert into public.organization_imported_clients(
    organization_id,normalized_phone,display_phone,client_name,source_system,
    imported_visit_count,imported_total_spent_rub,imported_last_visit_on,last_import_batch_id,updated_at
  )
  select p_organization,normalized_phone,display_phone,client_name,'other',visits,spent,last_visit,v_client_batch,now()
  from aggregated
  on conflict (organization_id,normalized_phone) do update set
    display_phone=excluded.display_phone,
    client_name=excluded.client_name,
    imported_visit_count=greatest(public.organization_imported_clients.imported_visit_count,excluded.imported_visit_count),
    imported_total_spent_rub=greatest(public.organization_imported_clients.imported_total_spent_rub,excluded.imported_total_spent_rub),
    imported_last_visit_on=greatest(public.organization_imported_clients.imported_last_visit_on,excluded.imported_last_visit_on),
    last_import_batch_id=excluded.last_import_batch_id,
    updated_at=now();

  update public.booking_history_import_batches
  set created_count=v_created,duplicate_count=v_count-v_created
  where id=v_batch.id;
  return jsonb_build_object('batch_id',v_batch.id,'input_count',v_count,'created_count',v_created,'duplicate_count',v_count-v_created,'idempotent',false);
end;
$$;

create or replace function public.get_minuta_imported_booking_history(
  p_organization uuid,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_role text; v_actor uuid:=auth.uid();
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_limit is null or p_limit<1 or p_limit>1000 or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception using errcode='22023',message='invalid_booking_history_page';
  end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_actor and membership.active;
  if v_role is null then raise exception using errcode='42501',message='booking_history_membership_required'; end if;
  return jsonb_build_object(
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',entry.id,'organization_id',entry.organization_id,'performer_id',entry.performer_id,
      'booking_date',entry.booking_date,'booking_time',entry.booking_time,'duration_minutes',entry.duration_minutes,
      'client_name',entry.client_name,'phone',entry.normalized_phone,'display_phone',entry.display_phone,
      'service_name',entry.service_name,'source_note',entry.source_note,'source_provider_name',entry.source_provider_name,
      'price_rub',entry.price_rub,'source_sheet',entry.source_sheet,'imported_at',entry.imported_at
    ) order by entry.booking_date desc,entry.booking_time desc,entry.id desc) from (
      select * from public.organization_imported_booking_history
      where organization_id=p_organization and (v_role in ('owner','admin') or performer_id=v_actor)
      order by booking_date desc,booking_time desc,id desc limit p_limit offset p_offset
    ) entry),'[]'::jsonb),
    'has_more',exists(select 1 from public.organization_imported_booking_history
      where organization_id=p_organization and (v_role in ('owner','admin') or performer_id=v_actor)
      order by booking_date desc,booking_time desc,id desc offset p_offset+p_limit limit 1),
    'summary',(select jsonb_build_object(
      'visit_count',count(*),'unique_clients',count(distinct normalized_phone),
      'total_price_rub',coalesce(sum(price_rub),0),'first_visit_on',min(booking_date),'last_visit_on',max(booking_date)
    ) from public.organization_imported_booking_history
      where organization_id=p_organization and (v_role in ('owner','admin') or performer_id=v_actor))
  );
end;
$$;

revoke all on function public.import_minuta_booking_history(uuid,jsonb,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_imported_booking_history(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.import_minuta_booking_history(uuid,jsonb,uuid,text) to authenticated;
grant execute on function public.get_minuta_imported_booking_history(uuid,integer,integer) to authenticated;

commit;
