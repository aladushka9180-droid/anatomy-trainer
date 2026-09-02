begin;

set local search_path = public, extensions, pg_catalog;

-- v83 detects clients who have not returned, but never sends anything until an
-- owner explicitly enables the module and records the client's marketing consent.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.client_accounts') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception using errcode='P0001', message='v83_requires_v65_and_client_accounts';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bookings' and column_name='organization_id'
  ) then
    raise exception using errcode='P0001', message='v83_requires_tenant_scoped_bookings';
  end if;
end;
$$;

create table if not exists public.organization_retention_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  inactivity_days integer not null default 45 check (inactivity_days between 7 and 730),
  cooldown_days integer not null default 90 check (cooldown_days between 7 and 730),
  message_template text not null default 'Здравствуйте, {имя}! Давно вас не было в {организация}. Будем рады видеть снова: {ссылка}'
    check (char_length(message_template) between 20 and 1000),
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.client_marketing_consents (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  status text not null check (status in ('granted','revoked')),
  source text not null default 'operator' check (source in ('operator','client','import')),
  note text check (note is null or char_length(note) <= 500),
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (organization_id,client_account_id)
);

create table if not exists public.retention_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  performer_id uuid references public.performer_profiles(id) on delete set null,
  last_booking_id uuid references public.bookings(id) on delete set null,
  channel text not null default 'whatsapp' check (channel in ('whatsapp','telegram','other')),
  status text not null default 'prepared' check (status in ('prepared','sent','cancelled','failed')),
  message_snapshot text not null check (char_length(message_snapshot) between 1 and 1000),
  prepared_by uuid references auth.users(id) on delete set null,
  prepared_at timestamptz not null default now(),
  sent_by uuid references auth.users(id) on delete set null,
  sent_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 500),
  check ((status='sent')=(sent_at is not null))
);

create index if not exists retention_deliveries_scope_idx
  on public.retention_deliveries (organization_id,prepared_at desc,id);
create index if not exists retention_deliveries_client_idx
  on public.retention_deliveries (organization_id,client_account_id,sent_at desc)
  where status='sent';

create table if not exists public.retention_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists retention_audit_scope_idx
  on public.retention_audit_log (organization_id,created_at desc,id desc);

alter table public.organization_retention_settings enable row level security;
alter table public.client_marketing_consents enable row level security;
alter table public.retention_deliveries enable row level security;
alter table public.retention_audit_log enable row level security;

drop policy if exists retention_settings_manager_read on public.organization_retention_settings;
create policy retention_settings_manager_read on public.organization_retention_settings
  for select to authenticated using (public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists retention_consents_manager_read on public.client_marketing_consents;
create policy retention_consents_manager_read on public.client_marketing_consents
  for select to authenticated using (public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists retention_deliveries_manager_read on public.retention_deliveries;
create policy retention_deliveries_manager_read on public.retention_deliveries
  for select to authenticated using (public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists retention_audit_manager_read on public.retention_audit_log;
create policy retention_audit_manager_read on public.retention_audit_log
  for select to authenticated using (public.has_organization_role(organization_id,array['owner','admin']));

revoke all on table public.organization_retention_settings, public.client_marketing_consents,
  public.retention_deliveries, public.retention_audit_log from public,anon,authenticated,service_role;
grant select on table public.organization_retention_settings, public.client_marketing_consents,
  public.retention_deliveries, public.retention_audit_log to authenticated;

create or replace function public.require_minuta_retention_manager(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  select membership.role into v_role
  from public.organization_memberships membership
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role not in ('owner','admin') then
    raise exception using errcode='42501',message='retention_manager_required';
  end if;
  return v_role;
end $$;

create or replace function public.write_minuta_retention_audit(
  p_organization uuid,p_action text,p_subject uuid default null,p_details jsonb default '{}'::jsonb
) returns void language plpgsql volatile security definer set search_path to '' as $$
begin
  perform public.require_minuta_retention_manager(p_organization);
  insert into public.retention_audit_log(organization_id,actor_id,action,subject_id,details)
  values(p_organization,auth.uid(),p_action,p_subject,coalesce(p_details,'{}'::jsonb));
end $$;

create or replace function public.render_minuta_retention_message(
  p_template text,p_client_name text,p_organization_name text,p_slug text
) returns text language sql immutable set search_path to '' as $$
  select left(
    replace(replace(replace(replace(
      p_template,
      '{имя}',coalesce(nullif(btrim(p_client_name),''),'клиент')),
      '{организация}',coalesce(nullif(btrim(p_organization_name),''),'нашей студии')),
      '{ссылка}','https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/index.html?org='||coalesce(p_slug,'')),
      '{дней}',''),
    1000
  )
$$;

create or replace function public.get_minuta_retention_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_settings public.organization_retention_settings%rowtype;
begin
  v_role:=public.require_minuta_retention_manager(p_organization);
  select * into v_settings from public.organization_retention_settings where organization_id=p_organization;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce(v_settings.enabled,false),
    'inactivity_days',coalesce(v_settings.inactivity_days,45),
    'cooldown_days',coalesce(v_settings.cooldown_days,90),
    'message_template',coalesce(v_settings.message_template,'Здравствуйте, {имя}! Давно вас не было в {организация}. Будем рады видеть снова: {ссылка}'),
    'clients',coalesce((
      with stats as (
        select booking.client_account_id,
          max(booking.booking_date) filter (where outcome.visit_status='completed') last_visit_on,
          count(*) filter (where outcome.visit_status='completed') completed_visits,
          bool_or(booking.status<>'cancelled' and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now())) has_upcoming
        from public.bookings booking
        left join public.booking_outcomes outcome on outcome.booking_id=booking.id
        where booking.organization_id=p_organization and booking.client_account_id is not null
        group by booking.client_account_id
      )
      select jsonb_agg(jsonb_build_object(
        'client_account_id',stats.client_account_id,
        'client_name',latest.client_name,'client_phone',latest.client_phone,
        'last_visit_on',stats.last_visit_on,'completed_visits',stats.completed_visits,
        'performer_id',latest.performer_id,'last_booking_id',latest.id,
        'consent_status',coalesce(consent.status,'unknown'),
        'last_sent_at',sent.last_sent_at,
        'eligible',coalesce(v_settings.enabled,false)
          and consent.status='granted'
          and stats.last_visit_on is not null and not stats.has_upcoming
          and stats.last_visit_on <= current_date-coalesce(v_settings.inactivity_days,45)
          and (sent.last_sent_at is null or sent.last_sent_at <= now()-make_interval(days=>coalesce(v_settings.cooldown_days,90)))
      ) order by stats.last_visit_on nulls first,latest.client_name)
      from stats
      join lateral (
        select booking.id,booking.client_name,booking.client_phone,booking.performer_id
        from public.bookings booking
        where booking.organization_id=p_organization and booking.client_account_id=stats.client_account_id
        order by booking.booking_date desc,booking.booking_time desc,booking.created_at desc limit 1
      ) latest on true
      left join public.client_marketing_consents consent on consent.organization_id=p_organization and consent.client_account_id=stats.client_account_id
      left join lateral (
        select max(delivery.sent_at) last_sent_at from public.retention_deliveries delivery
        where delivery.organization_id=p_organization and delivery.client_account_id=stats.client_account_id and delivery.status='sent'
      ) sent on true
    ),'[]'::jsonb),
    'deliveries',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',delivery.id,'client_account_id',delivery.client_account_id,'channel',delivery.channel,
        'status',delivery.status,'message_snapshot',delivery.message_snapshot,
        'prepared_at',delivery.prepared_at,'sent_at',delivery.sent_at
      ) order by delivery.prepared_at desc)
      from (select * from public.retention_deliveries where organization_id=p_organization order by prepared_at desc limit 100) delivery
    ),'[]'::jsonb),
    'audit',coalesce((
      select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc)
      from (select * from public.retention_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry
    ),'[]'::jsonb)
  );
end $$;

create or replace function public.save_minuta_retention_settings(
  p_organization uuid,p_enabled boolean,p_inactivity_days integer,p_cooldown_days integer,p_message_template text
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.require_minuta_retention_manager(p_organization);
  if p_enabled and v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_inactivity_days not between 7 and 730 or p_cooldown_days not between 7 and 730
     or char_length(btrim(coalesce(p_message_template,''))) not between 20 and 1000
     or position('{ссылка}' in p_message_template)=0 then
    raise exception using errcode='22023',message='invalid_retention_settings';
  end if;
  insert into public.organization_retention_settings(organization_id,enabled,inactivity_days,cooldown_days,message_template,enabled_at,enabled_by,updated_at)
  values(p_organization,p_enabled,p_inactivity_days,p_cooldown_days,btrim(p_message_template),case when p_enabled then now() end,case when p_enabled then auth.uid() end,now())
  on conflict(organization_id) do update set enabled=excluded.enabled,inactivity_days=excluded.inactivity_days,cooldown_days=excluded.cooldown_days,
    message_template=excluded.message_template,enabled_at=case when excluded.enabled and not organization_retention_settings.enabled then now() else organization_retention_settings.enabled_at end,
    enabled_by=case when excluded.enabled and not organization_retention_settings.enabled then auth.uid() else organization_retention_settings.enabled_by end,updated_at=now();
  perform public.write_minuta_retention_audit(p_organization,'retention_settings_saved',null,jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end $$;

create or replace function public.set_minuta_marketing_consent(
  p_organization uuid,p_client_account uuid,p_status text,p_note text default null
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
begin
  perform public.require_minuta_retention_manager(p_organization);
  if p_status not in ('granted','revoked') or not exists (
    select 1 from public.bookings booking where booking.organization_id=p_organization and booking.client_account_id=p_client_account
  ) then raise exception using errcode='22023',message='invalid_marketing_consent'; end if;
  insert into public.client_marketing_consents(organization_id,client_account_id,status,note,changed_by,changed_at)
  values(p_organization,p_client_account,p_status,nullif(left(btrim(coalesce(p_note,'')),500),''),auth.uid(),now())
  on conflict(organization_id,client_account_id) do update set status=excluded.status,note=excluded.note,changed_by=auth.uid(),changed_at=now();
  perform public.write_minuta_retention_audit(p_organization,'marketing_consent_'||p_status,p_client_account);
  return jsonb_build_object('organization_id',p_organization,'client_account_id',p_client_account,'status',p_status);
end $$;

create or replace function public.prepare_minuta_retention_delivery(
  p_organization uuid,p_client_account uuid,p_channel text default 'whatsapp'
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_settings public.organization_retention_settings%rowtype; v_org public.organizations%rowtype;
  v_client record; v_last_sent timestamptz; v_id uuid; v_message text;
begin
  perform public.require_minuta_retention_manager(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_client_account::text,83));
  select * into v_settings from public.organization_retention_settings where organization_id=p_organization;
  if not coalesce(v_settings.enabled,false) then raise exception using errcode='P0001',message='retention_disabled'; end if;
  if p_channel not in ('whatsapp','telegram','other') then raise exception using errcode='22023',message='invalid_retention_channel'; end if;
  if not exists(select 1 from public.client_marketing_consents where organization_id=p_organization and client_account_id=p_client_account and status='granted') then
    raise exception using errcode='P0001',message='marketing_consent_required';
  end if;
  select booking.id,booking.client_name,booking.client_phone,booking.performer_id,booking.booking_date last_visit_on into v_client
  from public.bookings booking
  join public.booking_outcomes outcome on outcome.booking_id=booking.id and outcome.visit_status='completed'
  where booking.organization_id=p_organization and booking.client_account_id=p_client_account
  order by booking.booking_date desc,booking.booking_time desc limit 1;
  if v_client.id is null or v_client.last_visit_on>current_date-v_settings.inactivity_days
     or exists(select 1 from public.bookings booking where booking.organization_id=p_organization and booking.client_account_id=p_client_account
       and booking.status<>'cancelled' and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now())) then
    raise exception using errcode='P0001',message='client_not_inactive';
  end if;
  select max(sent_at) into v_last_sent from public.retention_deliveries where organization_id=p_organization and client_account_id=p_client_account and status='sent';
  if v_last_sent>now()-make_interval(days=>v_settings.cooldown_days) then raise exception using errcode='P0001',message='retention_cooldown_active'; end if;
  if exists(select 1 from public.retention_deliveries where organization_id=p_organization and client_account_id=p_client_account and status='prepared') then
    raise exception using errcode='P0001',message='retention_already_prepared';
  end if;
  select * into v_org from public.organizations where id=p_organization;
  v_message:=public.render_minuta_retention_message(v_settings.message_template,v_client.client_name,v_org.name,v_org.public_slug);
  insert into public.retention_deliveries(organization_id,client_account_id,performer_id,last_booking_id,channel,message_snapshot,prepared_by)
  values(p_organization,p_client_account,v_client.performer_id,v_client.id,p_channel,v_message,auth.uid()) returning id into v_id;
  perform public.write_minuta_retention_audit(p_organization,'retention_delivery_prepared',v_id,jsonb_build_object('client_account_id',p_client_account,'channel',p_channel));
  return jsonb_build_object('id',v_id,'organization_id',p_organization,'client_phone',v_client.client_phone,'message',v_message,'status','prepared');
end $$;

create or replace function public.finish_minuta_retention_delivery(
  p_organization uuid,p_delivery uuid,p_action text
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_client uuid;
begin
  perform public.require_minuta_retention_manager(p_organization);
  if p_action not in ('sent','cancelled','failed') then raise exception using errcode='22023',message='invalid_retention_action'; end if;
  update public.retention_deliveries set status=p_action,
    sent_at=case when p_action='sent' then now() else null end,
    sent_by=case when p_action='sent' then auth.uid() else null end,
    cancelled_at=case when p_action='cancelled' then now() else null end
  where id=p_delivery and organization_id=p_organization and status='prepared'
  returning client_account_id into v_client;
  if v_client is null then raise exception using errcode='P0001',message='retention_delivery_not_prepared'; end if;
  perform public.write_minuta_retention_audit(p_organization,'retention_delivery_'||p_action,p_delivery,jsonb_build_object('client_account_id',v_client));
  return jsonb_build_object('id',p_delivery,'organization_id',p_organization,'status',p_action);
end $$;

revoke all on function public.require_minuta_retention_manager(uuid) from public,anon,authenticated,service_role;
revoke all on function public.write_minuta_retention_audit(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.render_minuta_retention_message(text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_retention_workspace(uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_minuta_retention_settings(uuid,boolean,integer,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_marketing_consent(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.prepare_minuta_retention_delivery(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.finish_minuta_retention_delivery(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_retention_workspace(uuid) to authenticated;
grant execute on function public.save_minuta_retention_settings(uuid,boolean,integer,integer,text) to authenticated;
grant execute on function public.set_minuta_marketing_consent(uuid,uuid,text,text) to authenticated;
grant execute on function public.prepare_minuta_retention_delivery(uuid,uuid,text) to authenticated;
grant execute on function public.finish_minuta_retention_delivery(uuid,uuid,text) to authenticated;

commit;
