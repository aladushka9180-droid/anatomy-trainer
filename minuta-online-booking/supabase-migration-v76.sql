begin;

set local search_path = public, extensions, pg_catalog;

do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.organizations') is null then v_missing := array_append(v_missing,'organizations'); end if;
  if to_regclass('public.locations') is null then v_missing := array_append(v_missing,'locations'); end if;
  if to_regclass('public.organization_benefit_settings') is null then v_missing := array_append(v_missing,'organization_benefit_settings'); end if;
  if to_regclass('public.benefit_redemptions') is null then v_missing := array_append(v_missing,'benefit_redemptions'); end if;
  if to_regclass('public.client_benefit_instruments') is null then v_missing := array_append(v_missing,'client_benefit_instruments'); end if;
  if to_regclass('public.benefit_ledger') is null then v_missing := array_append(v_missing,'benefit_ledger'); end if;
  if to_regclass('public.payments') is null then v_missing := array_append(v_missing,'payments'); end if;
  if to_regclass('public.booking_page_visits') is null then v_missing := array_append(v_missing,'booking_page_visits'); end if;
  if to_regprocedure('public.register_public_booking_visit(text)') is null then v_missing := array_append(v_missing,'register_public_booking_visit'); end if;
  if to_regprocedure('public.write_minuta_benefit_audit(uuid,text,uuid,jsonb)') is null then v_missing := array_append(v_missing,'write_minuta_benefit_audit'); end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='organization_id') then v_missing := array_append(v_missing,'bookings.organization_id'); end if;
  if cardinality(v_missing)>0 then
    raise exception using errcode='P0001',message='v76_missing_prerequisites:'||array_to_string(v_missing,',');
  end if;
end $$;

create table if not exists public.organization_booking_policy_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_booking_policy_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid,
  service_id uuid references public.services(id) on delete restrict,
  cancel_cutoff_hours integer not null default 12 check(cancel_cutoff_hours between 0 and 168),
  reschedule_cutoff_hours integer not null default 12 check(reschedule_cutoff_hours between 0 and 168),
  max_reschedules integer not null default 2 check(max_reschedules between 0 and 20),
  deposit_mode text not null default 'none' check(deposit_mode in ('none','fixed','percent')),
  deposit_value integer not null default 0,
  payment_timeout_minutes integer not null default 30 check(payment_timeout_minutes between 5 and 1440),
  auto_cancel_unpaid boolean not null default false,
  refund_policy text not null default 'full_before_cutoff' check(refund_policy in ('always_full','full_before_cutoff','nonrefundable')),
  payment_url_template text not null default '' check(char_length(payment_url_template)<=1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  foreign key(location_id,organization_id) references public.locations(id,organization_id) on delete restrict,
  check((deposit_mode='none' and deposit_value=0)
     or (deposit_mode='fixed' and deposit_value between 1 and 1000000)
     or (deposit_mode='percent' and deposit_value between 1 and 100)),
  check(deposit_mode='none' or payment_url_template~*'^https://')
);

create unique index if not exists booking_policy_rule_scope_unique_idx
  on public.organization_booking_policy_rules(
    organization_id,
    coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(service_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );
create index if not exists booking_policy_rule_resolution_idx
  on public.organization_booking_policy_rules(organization_id,location_id,service_id);

create table if not exists public.organization_booking_policy_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(char_length(action) between 1 and 80),
  rule_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists booking_policy_audit_scope_idx
  on public.organization_booking_policy_audit_log(organization_id,created_at desc,id desc);

insert into public.organization_booking_policy_settings(organization_id)
select organization.id from public.organizations organization
on conflict(organization_id) do nothing;

-- The existing performer policy becomes the organization default. The feature
-- remains disabled, so this migration cannot silently alter live booking rules.
insert into public.organization_booking_policy_rules(
  organization_id,cancel_cutoff_hours,reschedule_cutoff_hours,max_reschedules,
  deposit_mode,deposit_value,payment_timeout_minutes,auto_cancel_unpaid,
  refund_policy,payment_url_template,created_by
)
select organization.id,
  coalesce(policy.cancel_cutoff_hours,12),coalesce(policy.reschedule_cutoff_hours,12),
  coalesce(policy.max_reschedules,2),
  case when coalesce(policy.deposit_enabled,false) and coalesce(policy.deposit_amount_rub,0)>0
       and coalesce(policy.payment_url_template,'')~*'^https://' then 'fixed' else 'none' end,
  case when coalesce(policy.deposit_enabled,false) and coalesce(policy.deposit_amount_rub,0)>0
       and coalesce(policy.payment_url_template,'')~*'^https://' then policy.deposit_amount_rub else 0 end,
  30,false,'full_before_cutoff',
  case when coalesce(policy.payment_url_template,'')~*'^https://' then policy.payment_url_template else '' end,
  organization.created_by
from public.organizations organization
left join public.booking_policies policy on policy.performer_id=organization.legacy_performer_id
where not exists(select 1 from public.organization_booking_policy_rules rule
  where rule.organization_id=organization.id and rule.location_id is null and rule.service_id is null);

alter table public.bookings
  add column if not exists booking_policy_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists payment_due_at timestamptz,
  add column if not exists expired_unpaid_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists refund_status text not null default 'not_required';

alter table public.bookings drop constraint if exists bookings_cancellation_reason_check;
alter table public.bookings add constraint bookings_cancellation_reason_check
  check(cancellation_reason is null or cancellation_reason in ('client','provider','payment_expired'));
alter table public.bookings drop constraint if exists bookings_refund_status_check;
alter table public.bookings add constraint bookings_refund_status_check
  check(refund_status in ('not_required','pending','refunded','denied'));
alter table public.bookings drop constraint if exists bookings_policy_snapshot_object_check;
alter table public.bookings add constraint bookings_policy_snapshot_object_check
  check(jsonb_typeof(booking_policy_snapshot)='object');
create index if not exists bookings_unpaid_expiry_idx on public.bookings(payment_due_at)
  where status<>'cancelled' and payment_status='pending' and expired_unpaid_at is null;

update public.bookings booking
set booking_policy_snapshot=jsonb_build_object(
  'source','legacy-v41','cancel_cutoff_hours',coalesce(policy.cancel_cutoff_hours,12),
  'reschedule_cutoff_hours',coalesce(policy.reschedule_cutoff_hours,12),
  'max_reschedules',coalesce(policy.max_reschedules,2),
  'deposit_mode',case when booking.deposit_amount_rub>0 then 'fixed' else 'none' end,
  'deposit_value',booking.deposit_amount_rub,
  'refund_policy','full_before_cutoff','auto_cancel_unpaid',false
)
from public.booking_policies policy
where policy.performer_id=booking.performer_id and booking.booking_policy_snapshot='{}'::jsonb;

update public.bookings booking
set booking_policy_snapshot=jsonb_build_object(
  'source','legacy-default','cancel_cutoff_hours',12,'reschedule_cutoff_hours',12,
  'max_reschedules',2,'deposit_mode',case when booking.deposit_amount_rub>0 then 'fixed' else 'none' end,
  'deposit_value',booking.deposit_amount_rub,'refund_policy','full_before_cutoff','auto_cancel_unpaid',false
)
where booking.booking_policy_snapshot='{}'::jsonb;

alter table public.organization_booking_policy_settings enable row level security;
alter table public.organization_booking_policy_rules enable row level security;
alter table public.organization_booking_policy_audit_log enable row level security;

drop policy if exists booking_policy_manager_read on public.organization_booking_policy_settings;
create policy booking_policy_manager_read on public.organization_booking_policy_settings for select to authenticated
  using(public.has_organization_role(organization_id,array['owner','admin']::text[]));
drop policy if exists booking_policy_manager_read on public.organization_booking_policy_rules;
create policy booking_policy_manager_read on public.organization_booking_policy_rules for select to authenticated
  using(public.has_organization_role(organization_id,array['owner','admin']::text[]));
drop policy if exists booking_policy_manager_read on public.organization_booking_policy_audit_log;
create policy booking_policy_manager_read on public.organization_booking_policy_audit_log for select to authenticated
  using(public.has_organization_role(organization_id,array['owner','admin']::text[]));

revoke all on public.organization_booking_policy_settings,public.organization_booking_policy_rules,
  public.organization_booking_policy_audit_log from public,anon,authenticated;
grant select on public.organization_booking_policy_settings,public.organization_booking_policy_rules,
  public.organization_booking_policy_audit_log to authenticated;
grant all on public.organization_booking_policy_settings,public.organization_booking_policy_rules,
  public.organization_booking_policy_audit_log to service_role;

drop trigger if exists organization_booking_policy_settings_touch on public.organization_booking_policy_settings;
create trigger organization_booking_policy_settings_touch before update on public.organization_booking_policy_settings
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists organization_booking_policy_rules_touch on public.organization_booking_policy_rules;
create trigger organization_booking_policy_rules_touch before update on public.organization_booking_policy_rules
for each row execute function public.touch_minuta_organization_updated_at();

create or replace function public.get_minuta_booking_policy_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role not in ('owner','admin') then raise exception using errcode='42501',message='booking_policy_management_denied'; end if;
  return v_role;
end $$;
revoke all on function public.get_minuta_booking_policy_role(uuid) from public,anon,authenticated,service_role;

create or replace function public.write_minuta_booking_policy_audit(p_organization uuid,p_action text,p_rule uuid,p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to '' as $$
  insert into public.organization_booking_policy_audit_log(organization_id,actor_id,action,rule_id,details)
  values(p_organization,auth.uid(),p_action,p_rule,coalesce(p_details,'{}'::jsonb));
$$;
revoke all on function public.write_minuta_booking_policy_audit(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.resolve_minuta_booking_policy(p_organization uuid,p_location uuid,p_service uuid)
returns jsonb language sql stable security definer set search_path to '' as $$
  select coalesce((select jsonb_build_object(
    'id',rule.id,'organization_id',rule.organization_id,'location_id',rule.location_id,'service_id',rule.service_id,
    'cancel_cutoff_hours',rule.cancel_cutoff_hours,'reschedule_cutoff_hours',rule.reschedule_cutoff_hours,
    'max_reschedules',rule.max_reschedules,'deposit_mode',rule.deposit_mode,'deposit_value',rule.deposit_value,
    'payment_timeout_minutes',rule.payment_timeout_minutes,'auto_cancel_unpaid',rule.auto_cancel_unpaid,
    'refund_policy',rule.refund_policy,'payment_url_template',rule.payment_url_template
  ) from public.organization_booking_policy_rules rule
  where rule.organization_id=p_organization
    and (rule.location_id is null or rule.location_id=p_location)
    and (rule.service_id is null or rule.service_id=p_service)
  order by (rule.location_id is not null)::int+(rule.service_id is not null)::int desc,
    (rule.service_id is not null)::int desc,rule.updated_at desc,rule.id limit 1),'{}'::jsonb);
$$;
revoke all on function public.resolve_minuta_booking_policy(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.resolve_minuta_booking_policy(uuid,uuid,uuid) to service_role;

create or replace function public.set_minuta_booking_policies_enabled(p_organization uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_booking_policy_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_enabled is null then raise exception using errcode='22023',message='invalid_booking_policy_enabled'; end if;
  if p_enabled and not exists(select 1 from public.organization_booking_policy_rules rule where rule.organization_id=p_organization and rule.location_id is null and rule.service_id is null) then
    raise exception using errcode='55000',message='organization_default_policy_required';
  end if;
  insert into public.organization_booking_policy_settings(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_booking_policy_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_booking_policy_settings.enabled_by,auth.uid()) end;
  perform public.write_minuta_booking_policy_audit(p_organization,'booking_policies_enabled_changed',null,jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end $$;
revoke all on function public.set_minuta_booking_policies_enabled(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_booking_policies_enabled(uuid,boolean) to authenticated;

create or replace function public.upsert_minuta_booking_policy_rule(
  p_organization uuid,p_rule uuid,p_location uuid,p_service uuid,
  p_cancel_cutoff_hours integer,p_reschedule_cutoff_hours integer,p_max_reschedules integer,
  p_deposit_mode text,p_deposit_value integer,p_payment_timeout_minutes integer,
  p_auto_cancel_unpaid boolean,p_refund_policy text,p_payment_url_template text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;v_rule uuid;v_url text:=trim(coalesce(p_payment_url_template,''));v_old jsonb;v_new jsonb;
begin
  v_role:=public.get_minuta_booking_policy_role(p_organization);
  if p_location is not null and not exists(select 1 from public.locations where id=p_location and organization_id=p_organization) then
    raise exception using errcode='23514',message='booking_policy_location_scope_mismatch';
  end if;
  if p_service is not null and not exists(select 1 from public.services service join public.organization_memberships membership
      on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable
      where service.id=p_service) and not exists(select 1 from public.organization_booking_policy_rules existing_rule
        where existing_rule.id=p_rule and existing_rule.organization_id=p_organization and existing_rule.service_id=p_service) then
    raise exception using errcode='23514',message='booking_policy_service_scope_mismatch';
  end if;
  if p_cancel_cutoff_hours not between 0 and 168 or p_reschedule_cutoff_hours not between 0 and 168
     or p_max_reschedules not between 0 and 20 or p_payment_timeout_minutes not between 5 and 1440
     or p_deposit_mode not in ('none','fixed','percent') or p_refund_policy not in ('always_full','full_before_cutoff','nonrefundable')
     or (p_deposit_mode='none' and p_deposit_value<>0)
     or (p_deposit_mode='fixed' and p_deposit_value not between 1 and 1000000)
     or (p_deposit_mode='percent' and p_deposit_value not between 1 and 100)
     or (p_deposit_mode<>'none' and v_url!~*'^https://') then
    raise exception using errcode='22023',message='invalid_booking_policy_rule';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||coalesce(p_location::text,'*')||':'||coalesce(p_service::text,'*'),7400));
  if p_rule is null then
    select id into v_rule from public.organization_booking_policy_rules
    where organization_id=p_organization and location_id is not distinct from p_location
      and service_id is not distinct from p_service for update;
    if v_rule is not null then select to_jsonb(rule)-'payment_url_template'-'created_by' into v_old
      from public.organization_booking_policy_rules rule where rule.id=v_rule; end if;
    if v_rule is null then
      insert into public.organization_booking_policy_rules(organization_id,location_id,service_id,cancel_cutoff_hours,
        reschedule_cutoff_hours,max_reschedules,deposit_mode,deposit_value,payment_timeout_minutes,auto_cancel_unpaid,
        refund_policy,payment_url_template,created_by)
      values(p_organization,p_location,p_service,p_cancel_cutoff_hours,p_reschedule_cutoff_hours,p_max_reschedules,
        p_deposit_mode,p_deposit_value,p_payment_timeout_minutes,coalesce(p_auto_cancel_unpaid,false),p_refund_policy,v_url,auth.uid())
      returning id into v_rule;
    else
      update public.organization_booking_policy_rules set cancel_cutoff_hours=p_cancel_cutoff_hours,
        reschedule_cutoff_hours=p_reschedule_cutoff_hours,max_reschedules=p_max_reschedules,
        deposit_mode=p_deposit_mode,deposit_value=p_deposit_value,payment_timeout_minutes=p_payment_timeout_minutes,
        auto_cancel_unpaid=coalesce(p_auto_cancel_unpaid,false),refund_policy=p_refund_policy,payment_url_template=v_url
      where id=v_rule;
    end if;
  else
    select to_jsonb(rule)-'payment_url_template'-'created_by' into v_old
      from public.organization_booking_policy_rules rule where rule.id=p_rule and rule.organization_id=p_organization for update;
    update public.organization_booking_policy_rules set location_id=p_location,service_id=p_service,
      cancel_cutoff_hours=p_cancel_cutoff_hours,reschedule_cutoff_hours=p_reschedule_cutoff_hours,
      max_reschedules=p_max_reschedules,deposit_mode=p_deposit_mode,deposit_value=p_deposit_value,
      payment_timeout_minutes=p_payment_timeout_minutes,auto_cancel_unpaid=coalesce(p_auto_cancel_unpaid,false),
      refund_policy=p_refund_policy,payment_url_template=v_url
    where id=p_rule and organization_id=p_organization returning id into v_rule;
    if v_rule is null then raise exception using errcode='P0002',message='booking_policy_rule_not_found'; end if;
  end if;
  select to_jsonb(rule)-'payment_url_template'-'created_by' into v_new
    from public.organization_booking_policy_rules rule where rule.id=v_rule;
  perform public.write_minuta_booking_policy_audit(p_organization,'booking_policy_rule_saved',v_rule,
    jsonb_build_object('old',v_old,'new',v_new));
  return jsonb_build_object('id',v_rule,'organization_id',p_organization);
end $$;
revoke all on function public.upsert_minuta_booking_policy_rule(uuid,uuid,uuid,uuid,integer,integer,integer,text,integer,integer,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_booking_policy_rule(uuid,uuid,uuid,uuid,integer,integer,integer,text,integer,integer,boolean,text,text) to authenticated;

create or replace function public.delete_minuta_booking_policy_rule(p_organization uuid,p_rule uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_deleted uuid;v_old jsonb;
begin
  perform public.get_minuta_booking_policy_role(p_organization);
  select to_jsonb(rule)-'payment_url_template'-'created_by' into v_old
    from public.organization_booking_policy_rules rule where rule.id=p_rule and rule.organization_id=p_organization for update;
  delete from public.organization_booking_policy_rules where id=p_rule and organization_id=p_organization
    and not(location_id is null and service_id is null) returning id into v_deleted;
  if v_deleted is null then raise exception using errcode='55000',message='organization_default_policy_cannot_be_deleted'; end if;
  perform public.write_minuta_booking_policy_audit(p_organization,'booking_policy_rule_deleted',v_deleted,jsonb_build_object('old',v_old));
  return jsonb_build_object('id',v_deleted,'organization_id',p_organization);
end $$;
revoke all on function public.delete_minuta_booking_policy_rule(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_minuta_booking_policy_rule(uuid,uuid) to authenticated;

create or replace function public.get_minuta_booking_policy_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_booking_policy_role(p_organization);
  return jsonb_build_object('organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_booking_policy_settings where organization_id=p_organization),false),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'active',location.active)
      order by location.is_primary desc,location.name,location.id) from public.locations location where location.organization_id=p_organization),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object(
      'id',service.id,'name',service.name,'performer_id',service.performer_id,
      'performer_name',profile.display_name,
      'available',coalesce(service.active and membership.active and membership.is_bookable,false))
      order by service.name,profile.display_name,service.id)
      from public.services service
      left join public.organization_memberships membership
        on membership.organization_id=p_organization and membership.user_id=service.performer_id
      left join public.performer_profiles profile on profile.id=service.performer_id
      where membership.organization_id is not null or exists(select 1 from public.organization_booking_policy_rules referenced_rule
        where referenced_rule.organization_id=p_organization and referenced_rule.service_id=service.id)),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(jsonb_build_object('id',rule.id,'location_id',rule.location_id,'service_id',rule.service_id,
      'cancel_cutoff_hours',rule.cancel_cutoff_hours,'reschedule_cutoff_hours',rule.reschedule_cutoff_hours,
      'max_reschedules',rule.max_reschedules,'deposit_mode',rule.deposit_mode,'deposit_value',rule.deposit_value,
      'payment_timeout_minutes',rule.payment_timeout_minutes,'auto_cancel_unpaid',rule.auto_cancel_unpaid,
      'refund_policy',rule.refund_policy,'payment_url_template',rule.payment_url_template) order by
      (rule.location_id is null and rule.service_id is null) desc,rule.created_at,rule.id)
      from public.organization_booking_policy_rules rule where rule.organization_id=p_organization),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'rule_id',entry.rule_id,'created_at',entry.created_at)
      order by entry.created_at desc,entry.id desc) from (select * from public.organization_booking_policy_audit_log
      where organization_id=p_organization order by created_at desc,id desc limit 100) entry),'[]'::jsonb));
end $$;
revoke all on function public.get_minuta_booking_policy_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_booking_policy_workspace(uuid) to authenticated;

create or replace function public.apply_minuta_booking_policy_snapshot()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_policy jsonb; v_price integer; v_deposit integer:=0;
begin
  if not coalesce((select enabled from public.organization_booking_policy_settings where organization_id=new.organization_id),false) then
    return new;
  end if;
  v_policy:=public.resolve_minuta_booking_policy(new.organization_id,new.location_id,new.service_id);
  if v_policy='{}'::jsonb then raise exception using errcode='55000',message='booking_policy_missing'; end if;
  select coalesce(new.total_price_rub,service.price_rub) into v_price from public.services service where service.id=new.service_id;
  if v_policy->>'deposit_mode'='fixed' then v_deposit:=least((v_policy->>'deposit_value')::integer,v_price);
  elsif v_policy->>'deposit_mode'='percent' then v_deposit:=least(v_price,ceil(v_price*(v_policy->>'deposit_value')::numeric/100)::integer); end if;
  new.booking_policy_snapshot:=v_policy-'payment_url_template'||jsonb_build_object('captured_at',now());
  new.deposit_amount_rub:=v_deposit;
  new.payment_status:=case when v_deposit>0 then 'pending' else 'not_required' end;
  new.payment_url:=case when v_deposit>0 then replace(replace(v_policy->>'payment_url_template','{code}',new.booking_code),'{amount}',v_deposit::text) else '' end;
  new.payment_due_at:=case when v_deposit>0 and coalesce((v_policy->>'auto_cancel_unpaid')::boolean,false)
    then now()+make_interval(mins=>(v_policy->>'payment_timeout_minutes')::integer) end;
  new.refund_status:='not_required';
  return new;
end $$;
revoke all on function public.apply_minuta_booking_policy_snapshot() from public,anon,authenticated,service_role;
drop trigger if exists zz_bookings_apply_v76_policy on public.bookings;
create trigger zz_bookings_apply_v76_policy before insert on public.bookings
for each row execute function public.apply_minuta_booking_policy_snapshot();

-- v76 updates the already deployed v73 RPC without rewriting the historical
-- migration. Booking-scoped benefit mutations now share the cancellation lock
-- order: booking advisory, instrument advisory, instrument row, booking row.
create or replace function public.apply_minuta_benefit(
  p_organization uuid,p_instrument uuid,p_booking uuid,p_action text,p_amount_rub integer default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_instrument public.client_benefit_instruments%rowtype; v_booking public.bookings%rowtype;
  v_kind text; v_redemption uuid; v_units integer:=0; v_amount integer:=0; v_service_remaining integer;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='benefits_disabled'; end if;
  if p_action not in ('reserve','redeem','release') then raise exception using errcode='22023',message='invalid_benefit_action'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select * into v_instrument from public.client_benefit_instruments where id=p_instrument and organization_id=p_organization for update;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization for update;
  if v_instrument.id is null or v_booking.id is null then raise exception using errcode='P0002',message='benefit_or_booking_not_found'; end if;
  if v_instrument.client_account_id is distinct from v_booking.client_account_id then raise exception using errcode='42501',message='benefit_client_mismatch'; end if;
  v_kind:=v_instrument.product_snapshot->>'kind';
  if p_action='reserve' then
    if v_booking.status='cancelled' or v_instrument.status<>'active'
       or current_date>v_instrument.expires_on or v_booking.booking_date>v_instrument.expires_on then
      raise exception using errcode='55000',message='benefit_not_available';
    end if;
    select id into v_redemption from public.benefit_redemptions where booking_id=p_booking and status in ('reserved','redeemed');
    if v_redemption is not null then
      if exists(select 1 from public.benefit_redemptions where id=v_redemption and instrument_id=p_instrument) then
        return jsonb_build_object('id',v_redemption,'organization_id',p_organization,'status',(select status from public.benefit_redemptions where id=v_redemption));
      end if;
      raise exception using errcode='23505',message='booking_already_has_benefit';
    end if;
    if v_kind='certificate' then
      v_amount:=coalesce(p_amount_rub,least(v_instrument.remaining_amount_rub,coalesce(v_booking.total_price_rub,0)));
      if v_amount<=0 or v_amount>v_instrument.remaining_amount_rub then raise exception using errcode='55000',message='insufficient_certificate_balance'; end if;
      update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub-v_amount where id=p_instrument;
    elsif v_kind='package' then
      select remaining_units into v_service_remaining from public.benefit_instrument_service_balances where instrument_id=p_instrument and service_id=v_booking.service_id for update;
      if coalesce(v_service_remaining,0)<1 then raise exception using errcode='55000',message='package_service_exhausted'; end if;
      v_units:=1;
      update public.benefit_instrument_service_balances set remaining_units=remaining_units-1 where instrument_id=p_instrument and service_id=v_booking.service_id;
      update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=p_instrument;
    else
      if v_instrument.remaining_visits<1 or (jsonb_array_length(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb))>0
         and not exists(select 1 from jsonb_array_elements(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb)) allowed
           where (allowed->>'service_id')::uuid=v_booking.service_id)) then
        raise exception using errcode='55000',message='visit_pass_not_applicable';
      end if;
      v_units:=1;
      update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=p_instrument;
    end if;
    insert into public.benefit_redemptions(organization_id,instrument_id,booking_id,service_id,units,amount_rub,status,acted_by)
    values(p_organization,p_instrument,p_booking,v_booking.service_id,v_units,v_amount,'reserved',auth.uid()) returning id into v_redemption;
    update public.client_benefit_instruments set status=case when remaining_amount_rub=0 and remaining_visits=0 then 'exhausted' else status end where id=p_instrument;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
    select p_organization,p_instrument,v_redemption,'reserved',-v_amount,-v_units,remaining_amount_rub,remaining_visits,auth.uid() from public.client_benefit_instruments where id=p_instrument;
  elsif p_action='redeem' then
    select id into v_redemption from public.benefit_redemptions where instrument_id=p_instrument and booking_id=p_booking and status='reserved' for update;
    if v_redemption is null then raise exception using errcode='P0002',message='benefit_reservation_not_found'; end if;
    if not exists(select 1 from public.booking_outcomes where booking_id=p_booking and visit_status='completed') then raise exception using errcode='55000',message='complete_visit_before_redemption'; end if;
    update public.benefit_redemptions set status='redeemed',redeemed_at=now(),acted_by=auth.uid() where id=v_redemption;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_balance_rub,visits_balance,actor_id)
    values(p_organization,p_instrument,v_redemption,'redeemed',v_instrument.remaining_amount_rub,v_instrument.remaining_visits,auth.uid());
  else
    select id,units,amount_rub into v_redemption,v_units,v_amount from public.benefit_redemptions
    where instrument_id=p_instrument and booking_id=p_booking and status in ('reserved','redeemed') for update;
    if v_redemption is null then raise exception using errcode='P0002',message='benefit_redemption_not_found'; end if;
    if (select status from public.benefit_redemptions where id=v_redemption)='redeemed' and v_role<>'owner' then
      raise exception using errcode='42501',message='owner_required_to_release_redeemed_benefit';
    end if;
    update public.benefit_redemptions set status='released',released_at=now(),acted_by=auth.uid() where id=v_redemption;
    update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub+v_amount,
      remaining_visits=remaining_visits+v_units,status=case when expires_on<current_date then 'expired' when status='frozen' then 'frozen' else 'active' end where id=p_instrument;
    if v_kind='package' then update public.benefit_instrument_service_balances set remaining_units=remaining_units+v_units where instrument_id=p_instrument and service_id=v_booking.service_id; end if;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
    select p_organization,p_instrument,v_redemption,'released',v_amount,v_units,remaining_amount_rub,remaining_visits,auth.uid() from public.client_benefit_instruments where id=p_instrument;
  end if;
  perform public.write_minuta_benefit_audit(p_organization,'benefit_'||p_action,v_redemption,jsonb_build_object('instrument_id',p_instrument,'booking_id',p_booking));
  return jsonb_build_object('id',v_redemption,'organization_id',p_organization,'status',case p_action when 'reserve' then 'reserved' when 'redeem' then 'redeemed' else 'released' end);
end $$;
revoke all on function public.apply_minuta_benefit(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_benefit(uuid,uuid,uuid,text,integer) to authenticated;

-- Cancellation is a single atomic path for clients, providers and the expiry
-- worker. Reserved benefits are returned before the slot is released.
create or replace function public.release_minuta_reserved_benefit_for_booking(p_booking uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_redemption uuid;v_organization uuid;v_instrument uuid;v_service uuid;
  v_units integer;v_amount integer;v_kind text;
begin
  select redemption.id,redemption.organization_id,redemption.instrument_id,redemption.service_id,
    redemption.units,redemption.amount_rub,instrument.product_snapshot->>'kind'
  into v_redemption,v_organization,v_instrument,v_service,v_units,v_amount,v_kind
  from public.benefit_redemptions redemption
  join public.client_benefit_instruments instrument on instrument.id=redemption.instrument_id
  where redemption.booking_id=p_booking and redemption.status='reserved'
  for update of redemption,instrument;
  if v_redemption is null then return false; end if;
  update public.benefit_redemptions set status='released',released_at=now(),acted_by=auth.uid()
    where id=v_redemption;
  update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub+v_amount,
    remaining_visits=remaining_visits+v_units,
    status=case when expires_on<current_date then 'expired' when status='frozen' then 'frozen' else 'active' end
    where id=v_instrument;
  if v_kind='package' then
    update public.benefit_instrument_service_balances set remaining_units=remaining_units+v_units
      where instrument_id=v_instrument and service_id=v_service;
  end if;
  insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,
    amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
  select v_organization,v_instrument,v_redemption,'released',v_amount,v_units,
    remaining_amount_rub,remaining_visits,auth.uid()
  from public.client_benefit_instruments where id=v_instrument;
  perform public.write_minuta_benefit_audit(v_organization,'benefit_release',v_redemption,
    jsonb_build_object('instrument_id',v_instrument,'booking_id',p_booking,'reason','booking_cancelled'));
  return true;
end $$;
revoke all on function public.release_minuta_reserved_benefit_for_booking(uuid) from public,anon,authenticated,service_role;

create or replace function public.cancel_minuta_booking_core(p_booking uuid,p_reason text,p_refund_policy text)
returns text language plpgsql security definer set search_path to '' as $$
declare v_status text;v_payment_status text;v_has_paid boolean;v_start timestamp without time zone;
  v_cutoff integer;v_due timestamptz;v_snapshot_refund text;
begin
  if p_reason not in ('client','provider','payment_expired') then
    raise exception using errcode='22023',message='invalid_cancellation_reason';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  select booking.status,booking.payment_status,booking.booking_date+booking.booking_time,
    coalesce((booking.booking_policy_snapshot->>'cancel_cutoff_hours')::integer,12),booking.payment_due_at,
    coalesce(booking.booking_policy_snapshot->>'refund_policy',p_refund_policy,'full_before_cutoff')
  into v_status,v_payment_status,v_start,v_cutoff,v_due,v_snapshot_refund
  from public.bookings booking where booking.id=p_booking for update;
  if v_status is null then raise exception using errcode='P0002',message='booking_unavailable'; end if;
  if v_status='cancelled' then return 'cancelled'; end if;
  if p_reason='client' and timezone('Europe/Samara',now())>v_start-make_interval(hours=>v_cutoff) then
    raise exception using errcode='P0001',message='cancel_too_late';
  end if;
  if p_reason='payment_expired' and (v_payment_status<>'pending' or v_due is null or v_due>now()) then
    return 'not_expired';
  end if;
  if exists(select 1 from public.benefit_redemptions where booking_id=p_booking and status='redeemed') then
    raise exception using errcode='55000',message='redeemed_benefit_cannot_cancel';
  end if;
  perform public.release_minuta_reserved_benefit_for_booking(p_booking);
  select exists(select 1 from public.payments where booking_id=p_booking and status='paid') into v_has_paid;
  perform set_config('minuta.v76_cancellation_core',p_booking::text,true);
  update public.bookings set status='cancelled',cancellation_reason=p_reason,payment_due_at=null,
    refund_status=case when not v_has_paid and v_payment_status<>'paid' then 'not_required'
      when p_reason='provider' then 'pending'
      when v_snapshot_refund='nonrefundable' then 'denied'
      else 'pending' end
  where id=p_booking;
  perform set_config('minuta.v76_cancellation_core','',true);
  return 'cancelled';
end $$;
revoke all on function public.cancel_minuta_booking_core(uuid,text,text) from public,anon,authenticated,service_role;

create or replace function public.protect_minuta_direct_cancellation()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if old.status<>'cancelled' and new.status='cancelled'
     and coalesce(current_setting('minuta.v76_cancellation_core',true),'')<>old.id::text then
    raise exception using errcode='55000',message='use_provider_set_booking_status_v2';
  end if;
  return new;
end $$;
revoke all on function public.protect_minuta_direct_cancellation() from public,anon,authenticated,service_role;
drop trigger if exists zz_bookings_protect_direct_cancellation_v76 on public.bookings;
create trigger zz_bookings_protect_direct_cancellation_v76 before update of status on public.bookings
for each row execute function public.protect_minuta_direct_cancellation();

-- A late paid/refunded provider event is accepted after local cancellation;
-- the booking is then moved into the refund queue instead of losing the fact
-- that money arrived after the slot had already been released.
create or replace function public.minuta_payment_target_allowed(p_previous text,p_target text)
returns boolean language sql immutable security invoker set search_path to '' as $$
  select case
    when p_previous=p_target then true
    when p_previous='pending' and p_target in ('paid','failed','cancelled') then true
    when p_previous='paid' and p_target='refunded' then true
    when p_previous='cancelled' and p_target in ('paid','refunded') then true
    else false end;
$$;

create or replace function public.reconcile_minuta_cancelled_payment()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op='INSERT' and exists(select 1 from public.bookings where id=new.booking_id and status='cancelled') then
    raise exception using errcode='55000',message='booking_cancelled';
  end if;
  if new.status='paid' then
    update public.bookings set payment_status='paid',refund_status='pending'
      where id=new.booking_id and status='cancelled';
  elsif new.status='refunded' then
    update public.bookings set payment_status='refunded',refund_status='refunded'
      where id=new.booking_id and status='cancelled';
  end if;
  return new;
end $$;
revoke all on function public.reconcile_minuta_cancelled_payment() from public,anon,authenticated,service_role;
drop trigger if exists payments_reconcile_cancelled_booking on public.payments;
create trigger payments_reconcile_cancelled_booking before insert or update of status on public.payments
for each row execute function public.reconcile_minuta_cancelled_payment();

create or replace function public.get_booking_management_v2(p_token uuid)
returns table(
  booking_code text,service_id uuid,performer_id uuid,client_name text,service_name text,
  duration_minutes integer,price_rub integer,performer_name text,booking_date date,
  booking_time time without time zone,status text,cancel_allowed boolean,reschedule_allowed boolean,
  cancel_deadline timestamp without time zone,reschedule_deadline timestamp without time zone,
  reschedules_remaining integer,deposit_amount_rub integer,payment_status text,payment_url text,
  payment_due_at timestamptz,refund_status text
)
language sql stable security definer set search_path to '' as $$
  select booking.booking_code::text,booking.service_id,booking.performer_id,booking.client_name::text,
    service.name::text,booking.duration_minutes::integer,coalesce(booking.total_price_rub,service.price_rub)::integer,
    profile.display_name::text,booking.booking_date,booking.booking_time,booking.status::text,
    booking.status<>'cancelled' and timezone('Europe/Samara',now())<=booking.booking_date+booking.booking_time-
      make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'cancel_cutoff_hours')::integer,12)),
    booking.status<>'cancelled' and booking.reschedule_count<coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)
      and timezone('Europe/Samara',now())<=booking.booking_date+booking.booking_time-
      make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'reschedule_cutoff_hours')::integer,12)),
    booking.booking_date+booking.booking_time-make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'cancel_cutoff_hours')::integer,12)),
    booking.booking_date+booking.booking_time-make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'reschedule_cutoff_hours')::integer,12)),
    greatest(0,coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)-booking.reschedule_count)::integer,
    booking.deposit_amount_rub::integer,booking.payment_status::text,booking.payment_url::text,
    booking.payment_due_at,booking.refund_status::text
  from public.bookings booking join public.services service on service.id=booking.service_id
  join public.performer_profiles profile on profile.id=booking.performer_id
  where booking.manage_token=p_token;
$$;
revoke all on function public.get_booking_management_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_booking_management_v2(uuid) to anon,authenticated;

create or replace function public.get_reschedule_slots_v5(p_token uuid,p_start date,p_end date)
returns table(booking_date date,booking_time time without time zone)
language plpgsql stable security definer set search_path to '' as $$
declare v_booking uuid;v_organization uuid;v_location uuid;v_service uuid;v_performer uuid;v_duration integer;
  v_start timestamp without time zone;v_count integer;v_cutoff integer;v_limit integer;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception using errcode='22023',message='invalid_calendar_range';
  end if;
  select booking.id,booking.organization_id,booking.location_id,booking.service_id,booking.performer_id,
    booking.duration_minutes,booking.booking_date+booking.booking_time,booking.reschedule_count,
    coalesce((booking.booking_policy_snapshot->>'reschedule_cutoff_hours')::integer,12),
    coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)
  into v_booking,v_organization,v_location,v_service,v_performer,v_duration,v_start,v_count,v_cutoff,v_limit
  from public.bookings booking where booking.manage_token=p_token and booking.status<>'cancelled';
  if v_booking is null then return; end if;
  if timezone('Europe/Samara',now())>v_start-make_interval(hours=>v_cutoff) then raise exception using errcode='P0001',message='reschedule_too_late'; end if;
  if v_count>=v_limit then raise exception using errcode='P0001',message='reschedule_limit_reached'; end if;
  return query select slot.booking_date,slot.booking_time
  from public.get_available_slots(v_service,p_start,p_end,v_booking) slot
  where public.minuta_booking_fits_active_shift(v_organization,v_location,v_performer,slot.booking_date,slot.booking_time,v_duration)
    and not exists(select 1 from public.service_resource_requirements requirement
      join public.resource_groups resource_group on resource_group.id=requirement.group_id and resource_group.organization_id=requirement.organization_id
      where requirement.organization_id=v_organization and requirement.service_id=v_service and requirement.active
        and requirement.quantity>(select count(*) from public.resources resource where resource.organization_id=v_organization
          and resource.location_id=v_location and resource.group_id=requirement.group_id and resource.active and resource_group.active
          and not exists(select 1 from public.booking_resource_allocations allocation where allocation.resource_id=resource.id
            and allocation.booking_id<>v_booking and allocation.booking_status='active'
            and tsrange(allocation.starts_at,allocation.ends_at,'[)')&&tsrange(slot.booking_date+slot.booking_time,
              slot.booking_date+slot.booking_time+make_interval(mins=>v_duration),'[)'))))
  order by slot.booking_date,slot.booking_time;
end $$;
revoke all on function public.get_reschedule_slots_v5(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.get_reschedule_slots_v5(uuid,date,date) to anon,authenticated;

create or replace function public.reschedule_booking_v2(p_token uuid,p_date date,p_time time without time zone)
returns text language plpgsql security definer set search_path to '' as $$
declare v_id uuid;v_service uuid;v_performer uuid;v_code text;v_start timestamp without time zone;
  v_count integer;v_cutoff integer;v_limit integer;
begin
  select booking.id into v_id from public.bookings booking
  where booking.manage_token=p_token and booking.status<>'cancelled';
  if v_id is null then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_id::text,7302));
  select booking.id,booking.service_id,booking.performer_id,booking.booking_code,booking.booking_date+booking.booking_time,
    booking.reschedule_count,coalesce((booking.booking_policy_snapshot->>'reschedule_cutoff_hours')::integer,12),
    coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)
  into v_id,v_service,v_performer,v_code,v_start,v_count,v_cutoff,v_limit
  from public.bookings booking where booking.manage_token=p_token and booking.status<>'cancelled' for update;
  if v_id is null then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  if timezone('Europe/Samara',now())>v_start-make_interval(hours=>v_cutoff) then raise exception using errcode='P0001',message='reschedule_too_late'; end if;
  if v_count>=v_limit then raise exception using errcode='P0001',message='reschedule_limit_reached'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_performer::text||p_date::text,0));
  if not exists(select 1 from public.get_reschedule_slots_v5(p_token,p_date,p_date) slot
    where slot.booking_date=p_date and slot.booking_time=p_time) then raise exception using errcode='P0001',message='slot_unavailable'; end if;
  update public.bookings set booking_date=p_date,booking_time=p_time,status='new',reschedule_count=reschedule_count+1 where id=v_id;
  return v_code;
end $$;
revoke all on function public.reschedule_booking_v2(uuid,date,time without time zone) from public,anon,authenticated,service_role;
grant execute on function public.reschedule_booking_v2(uuid,date,time without time zone) to anon,authenticated;

-- Booking mutations must share one lock order: booking -> organization -> row.
-- This closes the v71 substitution vs cancellation/reschedule deadlock.
create or replace function public.substitute_minuta_booking(p_organization uuid,p_booking uuid,p_new_service uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_role text; v_booking public.bookings%rowtype; v_performer uuid; v_primary_duration integer;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  if v_role not in ('owner','admin') then raise exception using errcode='42501', message='booking_substitution_denied'; end if;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization and status<>'cancelled' for update;
  if v_booking.id is null then raise exception using errcode='P0001', message='booking_not_found'; end if;
  if v_booking.booking_date < current_date or exists(select 1 from public.booking_outcomes outcome where outcome.booking_id=p_booking and outcome.visit_status<>'scheduled') then
    raise exception using errcode='P0001', message='completed_booking_substitution_denied';
  end if;
  if exists(select 1 from public.booking_session_items item where item.booking_id=p_booking and item.item_kind='addon') then
    raise exception using errcode='55000', message='booking_substitution_addons_require_manual_remap';
  end if;
  select coalesce((select item.duration_minutes from public.booking_session_items item
    where item.booking_id=p_booking and item.item_kind='primary' order by item.position,item.id limit 1),
    (select service.duration_minutes from public.services service where service.id=v_booking.service_id))
    into v_primary_duration;
  select service.performer_id into v_performer from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable where service.id=p_new_service and service.active and service.duration_minutes=v_primary_duration;
  if v_performer is null then raise exception using errcode='42501', message='foreign_service_denied'; end if;
  update public.booking_session_items item set performer_id=v_performer,
    service_id=case when item.item_kind='primary' then p_new_service else item.service_id end,
    title=case when item.item_kind='primary' then (select name from public.services where id=p_new_service) else item.title end
    where item.booking_id=p_booking;
  insert into public.booking_session_revisions(booking_id,performer_id,items,total_price_rub,total_duration_minutes)
  select p_booking,v_performer,jsonb_agg(jsonb_build_object('kind',item.item_kind,'service_id',item.service_id,'title',item.title,'duration_minutes',item.duration_minutes,'price_rub',item.price_rub,'extends_duration',item.extends_duration) order by item.position),sum(item.price_rub)::integer,
    (sum(item.duration_minutes) filter(where item.item_kind='primary')+coalesce(sum(item.duration_minutes) filter(where item.item_kind='addon' and item.extends_duration),0))::integer
  from public.booking_session_items item where item.booking_id=p_booking having count(*)>0;
  delete from public.notification_marks where booking_id=p_booking;
  update public.notification_outbox set status='failed',last_error_code='booking_substituted',last_error='Доставка отменена: специалист записи изменён',locked_at=null,lock_token=null
    where booking_id=p_booking and status in ('pending','sending');
  update public.bookings set service_id=p_new_service,performer_id=v_performer where id=p_booking;
  perform public.write_minuta_schedule_audit(p_organization,'booking_substituted',p_booking,jsonb_build_object('old_performer_id',v_booking.performer_id,'new_performer_id',v_performer,'old_service_id',v_booking.service_id,'new_service_id',p_new_service));
  return true;
end;
$$;

create or replace function public.cancel_booking_v2(p_token uuid)
returns text language plpgsql security definer set search_path to '' as $$
declare v_id uuid;v_refund text;
begin
  select booking.id,coalesce(booking.booking_policy_snapshot->>'refund_policy','full_before_cutoff')
  into v_id,v_refund from public.bookings booking
  where booking.manage_token=p_token and booking.status<>'cancelled';
  if v_id is null then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  return public.cancel_minuta_booking_core(v_id,'client',v_refund);
end $$;
revoke all on function public.cancel_booking_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_booking_v2(uuid) to anon,authenticated;

create or replace function public.provider_set_booking_status_v2(p_booking uuid,p_status text)
returns text language plpgsql security definer set search_path to '' as $$
declare v_id uuid;v_status text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_status not in ('confirmed','cancelled') then raise exception using errcode='22023',message='invalid_booking_status'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  select booking.id,booking.status into v_id,v_status from public.bookings booking
    where booking.id=p_booking and booking.performer_id=auth.uid() for update;
  if v_id is null then raise exception using errcode='42501',message='booking_status_denied'; end if;
  if p_status='cancelled' then return public.cancel_minuta_booking_core(v_id,'provider','always_full'); end if;
  if v_status='cancelled' then raise exception using errcode='55000',message='booking_unavailable'; end if;
  update public.bookings set status='confirmed' where id=v_id;
  return 'confirmed';
end $$;
revoke all on function public.provider_set_booking_status_v2(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.provider_set_booking_status_v2(uuid,text) to authenticated;

-- Keep old cached clients safe: legacy mutation names now delegate to the
-- snapshot-aware implementations instead of consulting mutable v41 settings.
create or replace function public.reschedule_booking(p_token uuid,p_date date,p_time time without time zone)
returns text language sql security definer set search_path to '' as $$
  select public.reschedule_booking_v2(p_token,p_date,p_time);
$$;
revoke all on function public.reschedule_booking(uuid,date,time without time zone) from public,anon,authenticated,service_role;
grant execute on function public.reschedule_booking(uuid,date,time without time zone) to anon,authenticated;

create or replace function public.cancel_booking(p_token uuid)
returns text language sql security definer set search_path to '' as $$
  select public.cancel_booking_v2(p_token);
$$;
revoke all on function public.cancel_booking(uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_booking(uuid) to anon,authenticated;

create or replace function public.get_client_bookings_v3(p_session_token text)
returns table(
  booking_code text,manage_token uuid,client_name text,service_id uuid,service_name text,service_active boolean,
  duration_minutes integer,price_rub integer,performer_name text,booking_date date,booking_time time without time zone,
  status text,cancel_allowed boolean,reschedule_allowed boolean,reschedules_remaining integer,
  deposit_amount_rub integer,payment_status text,payment_url text,review_eligible boolean,
  review_rating integer,review_text text,review_created_at timestamptz,payment_due_at timestamptz,refund_status text
)
language plpgsql stable security definer set search_path to '' as $$
declare v_account_id uuid;
begin
  select resolved.client_account_id into v_account_id from public.resolve_client_session(p_session_token) resolved;
  if v_account_id is null then return; end if;
  return query select booking.booking_code::text,booking.manage_token,booking.client_name::text,service.id,
    service.name::text,service.active,booking.duration_minutes::integer,coalesce(booking.total_price_rub,service.price_rub)::integer,
    profile.display_name::text,booking.booking_date,booking.booking_time,
    case when outcome.visit_status='completed' then 'completed' when outcome.visit_status='no_show' then 'no_show' else booking.status end::text,
    booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled')='scheduled'
      and timezone('Europe/Samara',now())<=booking.booking_date+booking.booking_time-
        make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'cancel_cutoff_hours')::integer,12)),
    booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled')='scheduled'
      and booking.reschedule_count<coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)
      and timezone('Europe/Samara',now())<=booking.booking_date+booking.booking_time-
        make_interval(hours=>coalesce((booking.booking_policy_snapshot->>'reschedule_cutoff_hours')::integer,12)),
    greatest(0,coalesce((booking.booking_policy_snapshot->>'max_reschedules')::integer,2)-booking.reschedule_count)::integer,
    booking.deposit_amount_rub::integer,booking.payment_status::text,booking.payment_url::text,
    (booking.status<>'cancelled' and outcome.visit_status='completed'),review.rating::integer,review.review_text::text,
    review.created_at,booking.payment_due_at,booking.refund_status::text
  from public.bookings booking join public.services service on service.id=booking.service_id
  join public.performer_profiles profile on profile.id=booking.performer_id
  left join public.booking_outcomes outcome on outcome.booking_id=booking.id
  left join public.booking_reviews review on review.booking_id=booking.id
  where booking.client_account_id=v_account_id
  order by case when booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled') not in ('completed','no_show')
    and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now()) then 0 else 1 end,
    case when booking.status<>'cancelled' and coalesce(outcome.visit_status,'scheduled') not in ('completed','no_show')
      and booking.booking_date+booking.booking_time>=timezone('Europe/Samara',now()) then booking.booking_date+booking.booking_time end,
    booking.booking_date desc,booking.booking_time desc;
end $$;
revoke all on function public.get_client_bookings_v3(text) from public,anon,authenticated,service_role;
grant execute on function public.get_client_bookings_v3(text) to anon,authenticated;

create or replace function public.expire_minuta_unpaid_booking(p_booking uuid)
returns boolean language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  select booking.id into v_id from public.bookings booking
  where booking.id=p_booking and booking.status<>'cancelled' and booking.payment_status='pending'
    and booking.payment_due_at<=now() and booking.expired_unpaid_at is null
    and not exists(select 1 from public.benefit_redemptions redemption
      where redemption.booking_id=booking.id and redemption.status='redeemed')
  ;
  if v_id is null then return false; end if;
  if public.cancel_minuta_booking_core(v_id,'payment_expired','full_before_cutoff')<>'cancelled' then return false; end if;
  update public.bookings set expired_unpaid_at=now()
    where id=v_id and cancellation_reason='payment_expired' and expired_unpaid_at is null;
  return found;
end $$;
revoke all on function public.expire_minuta_unpaid_booking(uuid) from public,anon,authenticated,service_role;

create or replace function public.expire_minuta_unpaid_bookings(p_limit integer default 500)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_count integer:=0;v_booking record;
begin
  if current_user not in ('postgres','service_role','supabase_admin') then
    raise exception using errcode='42501',message='service_role_required';
  end if;
  for v_booking in select booking.id from public.bookings booking
    where booking.status<>'cancelled' and booking.payment_status='pending' and booking.payment_due_at<=now()
      and booking.expired_unpaid_at is null
      and not exists(select 1 from public.benefit_redemptions redemption where redemption.booking_id=booking.id and redemption.status='redeemed')
    order by booking.payment_due_at,booking.id
    limit greatest(1,least(coalesce(p_limit,500),5000))
  loop
    begin
      if public.expire_minuta_unpaid_booking(v_booking.id) then v_count:=v_count+1; end if;
    exception when others then
      raise warning 'minuta unpaid booking % was skipped: %',v_booking.id,sqlstate;
    end;
  end loop;
  return v_count;
end $$;
revoke all on function public.expire_minuta_unpaid_bookings(integer) from public,anon,authenticated;
grant execute on function public.expire_minuta_unpaid_bookings(integer) to service_role;

commit;
