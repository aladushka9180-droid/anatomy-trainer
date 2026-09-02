begin;

set local search_path = public, extensions, pg_catalog;

-- v72 is an additive payroll foundation. It does not replace booking, outcome,
-- schedule or resource RPCs, and stays disabled until an owner enables it.
do $$
begin
  if to_regclass('public.booking_outcomes') is null
     or to_regclass('public.organization_shift_settings') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='booking_outcomes' and column_name='amount_rub'
     ) then
    raise exception using errcode='P0001', message='v72_requires_v71_and_booking_outcome_amount';
  end if;
end;
$$;

create table if not exists public.organization_payroll_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  name text not null check (char_length(name) between 2 and 120),
  effective_from date not null,
  effective_to date,
  base_rate_bps integer not null check (base_rate_bps between 0 and 10000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,organization_id),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists payroll_plans_scope_idx
  on public.payroll_plans (organization_id, performer_id, effective_from desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.payroll_plans'::regclass
      and conname='payroll_plans_no_active_overlap'
  ) then
    alter table public.payroll_plans add constraint payroll_plans_no_active_overlap
      exclude using gist (
        organization_id with =,
        performer_id with =,
        daterange(effective_from,coalesce(effective_to,'infinity'::date),'[]') with &&
      ) where (active);
  end if;
end;
$$;

create table if not exists public.payroll_plan_tiers (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.payroll_plans(id) on delete cascade,
  threshold_rub integer not null check (threshold_rub >= 0 and threshold_rub <= 1000000000),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  created_at timestamptz not null default now(),
  unique (plan_id, threshold_rub)
);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid,
  name text not null check (char_length(name) between 2 and 120),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'draft' check (status in ('draft','approved','paid')),
  calculation_version integer not null default 1 check (calculation_version >= 1),
  source_fingerprint text not null default '',
  total_revenue_rub bigint not null default 0 check (total_revenue_rub >= 0),
  total_payroll_rub bigint not null default 0,
  calculated_at timestamptz,
  calculated_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,organization_id),
  foreign key (location_id,organization_id)
    references public.locations(id,organization_id) on delete restrict,
  check (ends_on >= starts_on and ends_on-starts_on <= 366)
);

create unique index if not exists payroll_periods_idempotency_idx
  on public.payroll_periods (
    organization_id,
    coalesce(location_id,'00000000-0000-0000-0000-000000000000'::uuid),
    starts_on,
    ends_on
  );

create table if not exists public.payroll_period_plan_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source_plan_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  plan_name text not null,
  effective_from date not null,
  effective_to date,
  base_rate_bps integer not null check (base_rate_bps between 0 and 10000),
  tiers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (period_id,source_plan_id),
  foreign key (period_id,organization_id) references public.payroll_periods(id,organization_id) on delete restrict,
  foreign key (source_plan_id,organization_id) references public.payroll_plans(id,organization_id) on delete restrict
);

create table if not exists public.payroll_items (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  source_plan_id uuid not null,
  booking_date date not null,
  service_name text not null,
  amount_rub integer not null check (amount_rub >= 0 and amount_rub <= 10000000),
  rate_bps integer not null check (rate_bps between 0 and 10000),
  payroll_rub integer not null check (payroll_rub >= 0 and payroll_rub <= 10000000),
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (period_id,booking_id),
  foreign key (period_id,organization_id) references public.payroll_periods(id,organization_id) on delete restrict,
  foreign key (source_plan_id,organization_id) references public.payroll_plans(id,organization_id) on delete restrict
);

create index if not exists payroll_items_performer_idx
  on public.payroll_items (organization_id,performer_id,booking_date,period_id);

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  amount_rub integer not null check (amount_rub between -10000000 and 10000000 and amount_rub <> 0),
  reason text not null check (char_length(reason) between 3 and 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (period_id,organization_id) references public.payroll_periods(id,organization_id) on delete restrict
);

create index if not exists payroll_adjustments_period_idx
  on public.payroll_adjustments (period_id,performer_id,created_at);

create table if not exists public.payroll_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payroll_audit_scope_idx
  on public.payroll_audit_log (organization_id,created_at desc,id desc);

alter table public.organization_payroll_settings enable row level security;
alter table public.payroll_plans enable row level security;
alter table public.payroll_plan_tiers enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_period_plan_snapshots enable row level security;
alter table public.payroll_items enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_audit_log enable row level security;

drop policy if exists organization_payroll_settings_member_read on public.organization_payroll_settings;
create policy organization_payroll_settings_member_read on public.organization_payroll_settings
  for select to authenticated using (public.is_organization_member(organization_id));
drop policy if exists payroll_plans_member_read on public.payroll_plans;
create policy payroll_plans_member_read on public.payroll_plans
  for select to authenticated using (
    public.has_organization_role(organization_id,array['owner','admin'])
    or (performer_id=auth.uid() and public.has_organization_role(organization_id,array['specialist']))
  );
drop policy if exists payroll_plan_tiers_member_read on public.payroll_plan_tiers;
create policy payroll_plan_tiers_member_read on public.payroll_plan_tiers
  for select to authenticated using (exists (
    select 1 from public.payroll_plans plan
    where plan.id=payroll_plan_tiers.plan_id and (
      public.has_organization_role(plan.organization_id,array['owner','admin'])
      or (plan.performer_id=auth.uid() and public.has_organization_role(plan.organization_id,array['specialist']))
    )
  ));
drop policy if exists payroll_periods_member_read on public.payroll_periods;
create policy payroll_periods_member_read on public.payroll_periods
  for select to authenticated using (
    public.has_organization_role(organization_id,array['owner','admin'])
    or (public.has_organization_role(organization_id,array['specialist']) and exists (
      select 1 from public.payroll_items item where item.period_id=payroll_periods.id and item.performer_id=auth.uid()
    ))
  );
drop policy if exists payroll_period_snapshots_member_read on public.payroll_period_plan_snapshots;
create policy payroll_period_snapshots_member_read on public.payroll_period_plan_snapshots
  for select to authenticated using (exists (
    select 1 from public.payroll_periods period
    where period.id=payroll_period_plan_snapshots.period_id and (
      public.has_organization_role(period.organization_id,array['owner','admin'])
      or (payroll_period_plan_snapshots.performer_id=auth.uid() and public.has_organization_role(period.organization_id,array['specialist']))
    )
  ));
drop policy if exists payroll_items_member_read on public.payroll_items;
create policy payroll_items_member_read on public.payroll_items
  for select to authenticated using (
    public.has_organization_role(organization_id,array['owner','admin'])
    or (performer_id=auth.uid() and public.has_organization_role(organization_id,array['specialist']))
  );
drop policy if exists payroll_adjustments_member_read on public.payroll_adjustments;
create policy payroll_adjustments_member_read on public.payroll_adjustments
  for select to authenticated using (
    public.has_organization_role(organization_id,array['owner','admin'])
    or (performer_id=auth.uid() and public.has_organization_role(organization_id,array['specialist']))
  );
drop policy if exists payroll_audit_manager_read on public.payroll_audit_log;
create policy payroll_audit_manager_read on public.payroll_audit_log
  for select to authenticated using (public.has_organization_role(organization_id,array['owner','admin']));

revoke all on public.organization_payroll_settings,public.payroll_plans,public.payroll_plan_tiers,
  public.payroll_periods,public.payroll_period_plan_snapshots,public.payroll_items,
  public.payroll_adjustments,public.payroll_audit_log from public,anon,authenticated;
grant select on public.organization_payroll_settings,public.payroll_plans,public.payroll_plan_tiers,
  public.payroll_periods,public.payroll_period_plan_snapshots,public.payroll_items,
  public.payroll_adjustments,public.payroll_audit_log to authenticated;
grant all on public.organization_payroll_settings,public.payroll_plans,public.payroll_plan_tiers,
  public.payroll_periods,public.payroll_period_plan_snapshots,public.payroll_items,
  public.payroll_adjustments,public.payroll_audit_log to service_role;

drop trigger if exists organization_payroll_settings_touch_updated_at on public.organization_payroll_settings;
create trigger organization_payroll_settings_touch_updated_at before update on public.organization_payroll_settings
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists payroll_plans_touch_updated_at on public.payroll_plans;
create trigger payroll_plans_touch_updated_at before update on public.payroll_plans
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists payroll_periods_touch_updated_at on public.payroll_periods;
create trigger payroll_periods_touch_updated_at before update on public.payroll_periods
for each row execute function public.touch_minuta_organization_updated_at();

create or replace function public.get_minuta_payroll_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null then
    raise exception using errcode='42501',message='organization_access_denied';
  end if;
  return v_role;
end;
$$;
revoke all on function public.get_minuta_payroll_role(uuid) from public,anon,authenticated,service_role;

create or replace function public.write_minuta_payroll_audit(
  p_organization uuid,p_action text,p_subject uuid,p_details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path to '' as $$
  insert into public.payroll_audit_log(organization_id,actor_id,action,subject_id,details)
  values(p_organization,auth.uid(),p_action,p_subject,coalesce(p_details,'{}'::jsonb));
$$;
revoke all on function public.write_minuta_payroll_audit(uuid,text,uuid,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.enforce_minuta_payroll_draft_children()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_old_status text; v_new_status text;
begin
  if tg_op in ('UPDATE','DELETE') then
    select status into v_old_status from public.payroll_periods where id=old.period_id;
  end if;
  if tg_op in ('UPDATE','INSERT') then
    select status into v_new_status from public.payroll_periods where id=new.period_id;
  end if;
  if (tg_op in ('UPDATE','DELETE') and v_old_status is distinct from 'draft')
     or (tg_op in ('UPDATE','INSERT') and v_new_status is distinct from 'draft') then
    raise exception using errcode='55000',message='payroll_period_immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists payroll_items_draft_only on public.payroll_items;
create trigger payroll_items_draft_only before insert or update or delete on public.payroll_items
for each row execute function public.enforce_minuta_payroll_draft_children();
drop trigger if exists payroll_adjustments_draft_only on public.payroll_adjustments;
create trigger payroll_adjustments_draft_only before insert or update or delete on public.payroll_adjustments
for each row execute function public.enforce_minuta_payroll_draft_children();
drop trigger if exists payroll_snapshots_draft_only on public.payroll_period_plan_snapshots;
create trigger payroll_snapshots_draft_only before insert or update or delete on public.payroll_period_plan_snapshots
for each row execute function public.enforce_minuta_payroll_draft_children();

create or replace function public.enforce_minuta_payroll_period_immutability()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op='DELETE' then
    if old.status<>'draft' then raise exception using errcode='55000',message='payroll_period_immutable'; end if;
    return old;
  end if;
  if old.status='paid' then
    raise exception using errcode='55000',message='payroll_period_immutable';
  end if;
  if old.status='approved' and (
    new.status<>'paid' or
    (to_jsonb(new)-array['status','paid_at','paid_by','updated_at'])
      is distinct from (to_jsonb(old)-array['status','paid_at','paid_by','updated_at'])
  ) then
    raise exception using errcode='55000',message='payroll_period_immutable';
  end if;
  if old.status='draft' and new.status not in ('draft','approved') then
    raise exception using errcode='55000',message='invalid_payroll_status_transition';
  end if;
  return new;
end;
$$;
drop trigger if exists payroll_periods_immutable on public.payroll_periods;
create trigger payroll_periods_immutable before update or delete on public.payroll_periods
for each row execute function public.enforce_minuta_payroll_period_immutability();

create or replace function public.set_minuta_payroll_enabled(p_organization uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if v_role<>'owner' then
    raise exception using errcode='42501',message='owner_required';
  end if;
  if p_enabled is null then
    raise exception using errcode='22023',message='invalid_payroll_enabled';
  end if;
  insert into public.organization_payroll_settings(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set
    enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_payroll_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_payroll_settings.enabled_by,auth.uid()) end,
    updated_at=now();
  perform public.write_minuta_payroll_audit(p_organization,'payroll_enabled_changed',p_organization,jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end;
$$;
revoke all on function public.set_minuta_payroll_enabled(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_payroll_enabled(uuid,boolean) to authenticated;

create or replace function public.upsert_minuta_payroll_plan(
  p_organization uuid,p_plan uuid,p_performer uuid,p_name text,
  p_effective_from date,p_effective_to date,p_base_rate_bps integer,p_tiers jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_plan uuid; v_tier jsonb;
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if v_role not in ('owner','admin') then raise exception using errcode='42501',message='payroll_manager_role_required'; end if;
  if not coalesce((select enabled from public.organization_payroll_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='payroll_disabled';
  end if;
  if p_performer is null or nullif(trim(p_name),'') is null or p_effective_from is null
     or (p_effective_to is not null and p_effective_to<p_effective_from)
     or p_base_rate_bps is null or p_base_rate_bps not between 0 and 10000
     or jsonb_typeof(coalesce(p_tiers,'[]'::jsonb))<>'array' then
    raise exception using errcode='22023',message='invalid_payroll_plan';
  end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=p_performer and active and is_bookable) then
    raise exception using errcode='23503',message='payroll_performer_not_in_organization';
  end if;
  for v_tier in select value from jsonb_array_elements(coalesce(p_tiers,'[]'::jsonb)) loop
    if not (v_tier?'threshold_rub') or not (v_tier?'rate_bps')
       or (v_tier->>'threshold_rub')::integer not between 0 and 1000000000
       or (v_tier->>'rate_bps')::integer not between 0 and 10000 then
      raise exception using errcode='22023',message='invalid_payroll_tier';
    end if;
  end loop;
  if p_plan is null then
    insert into public.payroll_plans(organization_id,performer_id,name,effective_from,effective_to,base_rate_bps,created_by)
    values(p_organization,p_performer,trim(p_name),p_effective_from,p_effective_to,p_base_rate_bps,auth.uid()) returning id into v_plan;
  else
    update public.payroll_plans set performer_id=p_performer,name=trim(p_name),effective_from=p_effective_from,
      effective_to=p_effective_to,base_rate_bps=p_base_rate_bps,active=true
    where id=p_plan and organization_id=p_organization returning id into v_plan;
    if v_plan is null then raise exception using errcode='P0002',message='payroll_plan_not_found'; end if;
    delete from public.payroll_plan_tiers where plan_id=v_plan;
  end if;
  insert into public.payroll_plan_tiers(plan_id,threshold_rub,rate_bps)
  select v_plan,(tier->>'threshold_rub')::integer,(tier->>'rate_bps')::integer
  from jsonb_array_elements(coalesce(p_tiers,'[]'::jsonb)) tier
  on conflict(plan_id,threshold_rub) do update set rate_bps=excluded.rate_bps;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_plan_saved',v_plan,
    jsonb_build_object('performer_id',p_performer,'effective_from',p_effective_from,'effective_to',p_effective_to));
  return jsonb_build_object('id',v_plan,'organization_id',p_organization,'performer_id',p_performer);
exception when exclusion_violation then
  raise exception using errcode='23P01',message='payroll_plan_overlap';
end;
$$;
revoke all on function public.upsert_minuta_payroll_plan(uuid,uuid,uuid,text,date,date,integer,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_payroll_plan(uuid,uuid,uuid,text,date,date,integer,jsonb) to authenticated;

create or replace function public.calculate_minuta_payroll_period(
  p_organization uuid,p_period uuid,p_location uuid,p_starts_on date,p_ends_on date,p_name text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_period uuid; v_status text; v_revenue bigint; v_payroll bigint;
  v_fingerprint text; v_unmatched integer;
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if v_role not in ('owner','admin') then raise exception using errcode='42501',message='payroll_manager_role_required'; end if;
  if not coalesce((select enabled from public.organization_payroll_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='payroll_disabled';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on<p_starts_on or p_ends_on-p_starts_on>366
     or nullif(trim(p_name),'') is null then
    raise exception using errcode='22023',message='invalid_payroll_period';
  end if;
  if p_location is not null and not exists(select 1 from public.locations where id=p_location and organization_id=p_organization) then
    raise exception using errcode='23503',message='payroll_location_not_in_organization';
  end if;
  -- One organization-wide lock serializes exact retries and partially
  -- overlapping periods, including an all-branches period racing a branch one.
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7200));

  if p_period is null then
    select id,status into v_period,v_status from public.payroll_periods
    where organization_id=p_organization and location_id is not distinct from p_location
      and starts_on=p_starts_on and ends_on=p_ends_on for update;
    if v_period is null then
      if exists(select 1 from public.payroll_periods period
        where period.organization_id=p_organization
          and (period.location_id is null or p_location is null or period.location_id=p_location)
          and period.starts_on<=p_ends_on and period.ends_on>=p_starts_on) then
        raise exception using errcode='23P01',message='payroll_period_overlap';
      end if;
      insert into public.payroll_periods(organization_id,location_id,name,starts_on,ends_on,calculated_by)
      values(p_organization,p_location,trim(p_name),p_starts_on,p_ends_on,auth.uid())
      returning id,status into v_period,v_status;
    end if;
  else
    select id,status into v_period,v_status from public.payroll_periods
    where id=p_period and organization_id=p_organization for update;
    if v_period is null then raise exception using errcode='P0002',message='payroll_period_not_found'; end if;
    if not exists(select 1 from public.payroll_periods where id=v_period and location_id is not distinct from p_location and starts_on=p_starts_on and ends_on=p_ends_on) then
      raise exception using errcode='22023',message='payroll_period_scope_mismatch';
    end if;
    if exists(select 1 from public.payroll_periods period
      where period.organization_id=p_organization and period.id<>v_period
        and (period.location_id is null or p_location is null or period.location_id=p_location)
        and period.starts_on<=p_ends_on and period.ends_on>=p_starts_on) then
      raise exception using errcode='23P01',message='payroll_period_overlap';
    end if;
  end if;
  if v_status<>'draft' then raise exception using errcode='55000',message='payroll_period_immutable'; end if;

  update public.payroll_periods set name=trim(p_name) where id=v_period;
  delete from public.payroll_items where period_id=v_period;
  delete from public.payroll_period_plan_snapshots where period_id=v_period;

  insert into public.payroll_period_plan_snapshots(
    period_id,organization_id,source_plan_id,performer_id,plan_name,effective_from,effective_to,base_rate_bps,tiers
  )
  select v_period,p_organization,plan.id,plan.performer_id,plan.name,plan.effective_from,plan.effective_to,plan.base_rate_bps,
    coalesce((select jsonb_agg(jsonb_build_object('threshold_rub',tier.threshold_rub,'rate_bps',tier.rate_bps)
      order by tier.threshold_rub) from public.payroll_plan_tiers tier where tier.plan_id=plan.id),'[]'::jsonb)
  from public.payroll_plans plan
  where plan.organization_id=p_organization and plan.active
    and plan.effective_from<=p_ends_on and coalesce(plan.effective_to,'infinity'::date)>=p_starts_on;

  with source_base as (
    select booking.id booking_id,booking.performer_id,booking.booking_date,service.name service_name,
      outcome.amount_rub::integer amount_rub,outcome.visit_status,plan.id source_plan_id,plan.base_rate_bps
    from public.booking_outcomes outcome
    join public.bookings booking on booking.id=outcome.booking_id
    join public.services service on service.id=booking.service_id
    join lateral (
      select candidate.id,candidate.base_rate_bps
      from public.payroll_plans candidate
      where candidate.organization_id=p_organization and candidate.performer_id=booking.performer_id and candidate.active
        and booking.booking_date>=candidate.effective_from
        and (candidate.effective_to is null or booking.booking_date<=candidate.effective_to)
      order by candidate.effective_from desc,candidate.id
      limit 1
    ) plan on true
    where booking.organization_id=p_organization
      and booking.booking_date between p_starts_on and p_ends_on
      and (p_location is null or booking.location_id=p_location)
      and outcome.visit_status='completed' and outcome.amount_rub is not null and outcome.amount_rub>=0
  ), with_totals as (
    select source.*,sum(source.amount_rub) over(partition by source.source_plan_id,source.performer_id) plan_revenue_rub
    from source_base source
  ), rated as (
    select source.*,
      coalesce((select tier.rate_bps from public.payroll_plan_tiers tier
        where tier.plan_id=source.source_plan_id
          and tier.threshold_rub<=source.plan_revenue_rub
        order by tier.threshold_rub desc limit 1),source.base_rate_bps) rate_bps
    from with_totals source
  )
  insert into public.payroll_items(
    period_id,organization_id,performer_id,booking_id,source_plan_id,booking_date,service_name,
    amount_rub,rate_bps,payroll_rub,source_snapshot
  )
  select v_period,p_organization,performer_id,booking_id,source_plan_id,booking_date,service_name,
    amount_rub,rate_bps,round(amount_rub*rate_bps/10000.0)::integer,
    jsonb_build_object('booking_id',booking_id,'visit_status',visit_status,'amount_rub',amount_rub,
      'service_name',service_name,'booking_date',booking_date,'source_plan_id',source_plan_id)
  from rated
  order by booking_date,booking_id;

  select count(*) into v_unmatched
  from public.booking_outcomes outcome join public.bookings booking on booking.id=outcome.booking_id
  where booking.organization_id=p_organization and booking.booking_date between p_starts_on and p_ends_on
    and (p_location is null or booking.location_id=p_location)
    and outcome.visit_status='completed' and outcome.amount_rub is not null and outcome.amount_rub>=0
    and not exists(select 1 from public.payroll_plans plan where plan.organization_id=p_organization
      and plan.performer_id=booking.performer_id and plan.active and booking.booking_date>=plan.effective_from
      and (plan.effective_to is null or booking.booking_date<=plan.effective_to));

  if v_unmatched>0 then
    raise exception using errcode='55000',message='payroll_plan_missing_for_completed_booking';
  end if;
  if not exists(select 1 from public.payroll_items where period_id=v_period) then
    raise exception using errcode='55000',message='payroll_requires_completed_bookings';
  end if;

  select coalesce(sum(amount_rub),0),coalesce(sum(payroll_rub),0),
    md5(coalesce(string_agg(booking_id::text||':'||amount_rub::text||':'||rate_bps::text||':'||payroll_rub::text,'|' order by booking_id),'empty'))
  into v_revenue,v_payroll,v_fingerprint from public.payroll_items where period_id=v_period;
  select v_payroll+coalesce(sum(amount_rub),0) into v_payroll from public.payroll_adjustments where period_id=v_period;
  update public.payroll_periods set total_revenue_rub=v_revenue,total_payroll_rub=v_payroll,
    source_fingerprint=v_fingerprint,calculated_at=now(),calculated_by=auth.uid(),
    calculation_version=calculation_version+1 where id=v_period;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_period_calculated',v_period,
    jsonb_build_object('starts_on',p_starts_on,'ends_on',p_ends_on,'location_id',p_location,
      'revenue_rub',v_revenue,'payroll_rub',v_payroll,'unmatched_outcomes',v_unmatched,'source_fingerprint',v_fingerprint));
  return jsonb_build_object('id',v_period,'organization_id',p_organization,'status','draft','total_revenue_rub',v_revenue,
    'total_payroll_rub',v_payroll,'unmatched_outcomes',v_unmatched,'source_fingerprint',v_fingerprint);
end;
$$;
revoke all on function public.calculate_minuta_payroll_period(uuid,uuid,uuid,date,date,text)
  from public,anon,authenticated,service_role;
grant execute on function public.calculate_minuta_payroll_period(uuid,uuid,uuid,date,date,text) to authenticated;

create or replace function public.add_minuta_payroll_adjustment(
  p_organization uuid,p_period uuid,p_performer uuid,p_amount_rub integer,p_reason text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_adjustment uuid; v_total bigint;
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if v_role not in ('owner','admin') then raise exception using errcode='42501',message='payroll_manager_role_required'; end if;
  if not coalesce((select enabled from public.organization_payroll_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='payroll_disabled';
  end if;
  if p_amount_rub is null or p_amount_rub=0 or p_amount_rub not between -10000000 and 10000000 or char_length(trim(coalesce(p_reason,'')))<3 then
    raise exception using errcode='22023',message='invalid_payroll_adjustment';
  end if;
  if not exists(select 1 from public.payroll_periods where id=p_period and organization_id=p_organization and status='draft' for update) then
    raise exception using errcode='55000',message='payroll_period_not_draft';
  end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization and user_id=p_performer and active) then
    raise exception using errcode='23503',message='payroll_performer_not_in_organization';
  end if;
  insert into public.payroll_adjustments(period_id,organization_id,performer_id,amount_rub,reason,created_by)
  values(p_period,p_organization,p_performer,p_amount_rub,trim(p_reason),auth.uid()) returning id into v_adjustment;
  select coalesce((select sum(payroll_rub) from public.payroll_items where period_id=p_period),0)
    +coalesce((select sum(amount_rub) from public.payroll_adjustments where period_id=p_period),0) into v_total;
  update public.payroll_periods set total_payroll_rub=v_total where id=p_period;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_adjustment_added',v_adjustment,
    jsonb_build_object('period_id',p_period,'performer_id',p_performer,'amount_rub',p_amount_rub,'reason',trim(p_reason)));
  return jsonb_build_object('id',v_adjustment,'organization_id',p_organization,'period_id',p_period,'total_payroll_rub',v_total);
end;
$$;
revoke all on function public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text)
  from public,anon,authenticated,service_role;
grant execute on function public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text) to authenticated;

create or replace function public.set_minuta_payroll_period_status(
  p_organization uuid,p_period uuid,p_status text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_current text; v_start date; v_end date; v_location uuid; v_calculated timestamptz;
  v_stored_fingerprint text; v_current_fingerprint text;
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  select status,starts_on,ends_on,location_id,calculated_at,source_fingerprint
  into v_current,v_start,v_end,v_location,v_calculated,v_stored_fingerprint from public.payroll_periods
  where id=p_period and organization_id=p_organization for update;
  if v_current is null then raise exception using errcode='P0002',message='payroll_period_not_found'; end if;
  if (v_current='draft' and p_status='approved') then
    if v_calculated is null then raise exception using errcode='55000',message='payroll_period_not_calculated'; end if;
    select md5(coalesce(string_agg(booking_id::text||':'||amount_rub::text||':'||rate_bps::text||':'||payroll_rub::text,
      '|' order by booking_id),'empty')) into v_current_fingerprint
    from public.payroll_items where period_id=p_period;
    if v_current_fingerprint is distinct from v_stored_fingerprint then
      raise exception using errcode='55000',message='payroll_source_changed_recalculate_required';
    end if;
    if exists(
      select 1 from public.booking_outcomes outcome
      join public.bookings booking on booking.id=outcome.booking_id
      where booking.organization_id=p_organization and booking.booking_date between v_start and v_end
        and (v_location is null or booking.location_id=v_location)
        and outcome.visit_status='completed' and outcome.amount_rub is not null and outcome.amount_rub>=0
        and not exists(select 1 from public.payroll_items item where item.period_id=p_period
          and item.booking_id=booking.id and item.amount_rub=outcome.amount_rub
          and item.performer_id=booking.performer_id and item.booking_date=booking.booking_date)
    ) or exists(
      select 1 from public.payroll_items item
      where item.period_id=p_period and not exists(
        select 1 from public.booking_outcomes outcome join public.bookings booking on booking.id=outcome.booking_id
        where outcome.booking_id=item.booking_id and outcome.visit_status='completed'
          and outcome.amount_rub=item.amount_rub and booking.organization_id=p_organization
          and booking.booking_date between v_start and v_end
          and (v_location is null or booking.location_id=v_location)
          and booking.performer_id=item.performer_id and booking.booking_date=item.booking_date
      )
    ) or exists(
      select 1 from public.payroll_period_plan_snapshots snapshot
      join public.payroll_plans plan on plan.id=snapshot.source_plan_id
      where snapshot.period_id=p_period and (
        plan.active is distinct from true
        or plan.organization_id is distinct from snapshot.organization_id
        or plan.performer_id is distinct from snapshot.performer_id
        or plan.name is distinct from snapshot.plan_name
        or plan.effective_from is distinct from snapshot.effective_from
        or plan.effective_to is distinct from snapshot.effective_to
        or plan.base_rate_bps is distinct from snapshot.base_rate_bps
        or coalesce((select jsonb_agg(jsonb_build_object('threshold_rub',tier.threshold_rub,'rate_bps',tier.rate_bps)
             order by tier.threshold_rub) from public.payroll_plan_tiers tier where tier.plan_id=plan.id),'[]'::jsonb)
           is distinct from snapshot.tiers
      )
    ) then
      raise exception using errcode='55000',message='payroll_source_changed_recalculate_required';
    end if;
    update public.payroll_periods set status='approved',approved_at=now(),approved_by=auth.uid() where id=p_period;
  elsif (v_current='approved' and p_status='paid') then
    update public.payroll_periods set status='paid',paid_at=now(),paid_by=auth.uid() where id=p_period;
  elsif v_current=p_status then
    null;
  else
    raise exception using errcode='55000',message='invalid_payroll_status_transition';
  end if;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_period_status_changed',p_period,
    jsonb_build_object('from',v_current,'to',p_status));
  return jsonb_build_object('id',p_period,'organization_id',p_organization,'status',p_status);
end;
$$;
revoke all on function public.set_minuta_payroll_period_status(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_payroll_period_status(uuid,uuid,text) to authenticated;

create or replace function public.get_minuta_payroll_workspace(
  p_organization uuid,p_start date,p_end date
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_user uuid:=auth.uid();
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then
    raise exception using errcode='22023',message='invalid_payroll_range';
  end if;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,'can_manage',v_role in ('owner','admin'),
    'enabled',coalesce((select enabled from public.organization_payroll_settings where organization_id=p_organization),false),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',membership.user_id,'display_name',profile.display_name,
      'role',membership.role,'is_bookable',membership.is_bookable) order by profile.display_name,membership.user_id)
      from public.organization_memberships membership join public.performer_profiles profile on profile.id=membership.user_id
      where membership.organization_id=p_organization and membership.active
        and (v_role in ('owner','admin') or membership.user_id=v_user)),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'active',location.active)
      order by location.is_primary desc,location.name,location.id) from public.locations location
      where location.organization_id=p_organization),'[]'::jsonb),
    'plans',coalesce((select jsonb_agg(jsonb_build_object('id',plan.id,'performer_id',plan.performer_id,'name',plan.name,
      'effective_from',plan.effective_from,'effective_to',plan.effective_to,'base_rate_bps',plan.base_rate_bps,
      'active',plan.active,'tiers',coalesce((select jsonb_agg(jsonb_build_object('threshold_rub',tier.threshold_rub,
        'rate_bps',tier.rate_bps) order by tier.threshold_rub) from public.payroll_plan_tiers tier where tier.plan_id=plan.id),'[]'::jsonb))
      order by plan.performer_id,plan.effective_from desc,plan.id)
      from public.payroll_plans plan where plan.organization_id=p_organization
        and (v_role in ('owner','admin') or plan.performer_id=v_user)),'[]'::jsonb),
    'periods',coalesce((select jsonb_agg(jsonb_build_object('id',period.id,'name',period.name,'location_id',period.location_id,
      'starts_on',period.starts_on,'ends_on',period.ends_on,'status',period.status,'total_revenue_rub',period.total_revenue_rub,
      'total_payroll_rub',period.total_payroll_rub,'source_fingerprint',period.source_fingerprint,
      'calculated_at',period.calculated_at,'approved_at',period.approved_at,'paid_at',period.paid_at)
      order by period.starts_on desc,period.id)
      from public.payroll_periods period where period.organization_id=p_organization
        and period.starts_on<=p_end and period.ends_on>=p_start
        and (v_role in ('owner','admin') or exists(select 1 from public.payroll_items own_item
          where own_item.period_id=period.id and own_item.performer_id=v_user))),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'period_id',item.period_id,
      'performer_id',item.performer_id,'booking_id',item.booking_id,'amount_rub',item.amount_rub,
      'rate_bps',item.rate_bps,'payroll_rub',item.payroll_rub,'service_name',item.service_name,'booking_date',item.booking_date)
      order by item.booking_date,item.booking_id)
      from public.payroll_items item join public.payroll_periods period on period.id=item.period_id
      where item.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start
        and (v_role in ('owner','admin') or item.performer_id=v_user)),'[]'::jsonb),
    'adjustments',coalesce((select jsonb_agg(jsonb_build_object('id',adjustment.id,'period_id',adjustment.period_id,
      'performer_id',adjustment.performer_id,'amount_rub',adjustment.amount_rub,'reason',adjustment.reason,
      'created_at',adjustment.created_at) order by adjustment.created_at,adjustment.id)
      from public.payroll_adjustments adjustment join public.payroll_periods period on period.id=adjustment.period_id
      where adjustment.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start
        and (v_role in ('owner','admin') or adjustment.performer_id=v_user)),'[]'::jsonb),
    'audit',case when v_role in ('owner','admin') then coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,
      'actor_id',entry.actor_id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,
      'created_at',entry.created_at) order by entry.created_at desc,entry.id desc)
      from (select * from public.payroll_audit_log where organization_id=p_organization
        order by created_at desc,id desc limit 100) entry),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
revoke all on function public.get_minuta_payroll_workspace(uuid,date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_payroll_workspace(uuid,date,date) to authenticated;

commit;
