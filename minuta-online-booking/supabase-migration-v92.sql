\set ON_ERROR_STOP on

begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.performer_profiles') is null
     or to_regclass('public.payroll_periods') is null
     or to_regclass('public.payroll_items') is null
     or to_regclass('public.payroll_adjustments') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.bootstrap_client_identity_session(text,text,text)') is null then
    raise exception using errcode='P0001',message='v92_requires_v54_v65_v68_v72_v91';
  end if;
end $$;

alter table public.bookings
  add column if not exists booking_source text,
  add column if not exists created_by_user_id uuid,
  add column if not exists created_by_role text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass
      and conname='bookings_booking_source_check'
  ) then
    alter table public.bookings
      add constraint bookings_booking_source_check
      check (booking_source is null or booking_source in (
        'client_online','provider_manual','admin_manual'
      )) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass
      and conname='bookings_created_by_role_check'
  ) then
    alter table public.bookings
      add constraint bookings_created_by_role_check
      check (created_by_role is null or created_by_role in (
        'owner','admin','specialist'
      )) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass
      and conname='bookings_creation_attribution_check'
  ) then
    alter table public.bookings
      add constraint bookings_creation_attribution_check
      check (
        (booking_source is null and created_by_user_id is null and created_by_role is null)
        or (booking_source='client_online' and created_by_user_id is null and created_by_role is null)
        or (booking_source='provider_manual' and created_by_user_id is not null and created_by_role='specialist')
        or (booking_source='admin_manual' and created_by_user_id is not null and created_by_role in ('owner','admin'))
      ) not valid;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid='public.bookings'::regclass
      and constraint_row.conname='bookings_created_by_user_id_fkey'
      and not (
        constraint_row.contype='f'
        and constraint_row.confrelid='auth.users'::regclass
        and constraint_row.confdeltype='n'
        and array_length(constraint_row.conkey,1)=1
        and array_length(constraint_row.confkey,1)=1
        and (select attribute.attname from pg_attribute attribute where attribute.attrelid=constraint_row.conrelid and attribute.attnum=constraint_row.conkey[1])='created_by_user_id'
        and (select attribute.attname from pg_attribute attribute where attribute.attrelid=constraint_row.confrelid and attribute.attnum=constraint_row.confkey[1])='id'
      )
  ) then
    raise exception using errcode='P0001',message='v92_incompatible_created_by_user_fk';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.bookings'::regclass
      and conname='bookings_created_by_user_id_fkey'
  ) then
    alter table public.bookings
      add constraint bookings_created_by_user_id_fkey
      foreign key (created_by_user_id) references auth.users(id)
      on delete set null not valid;
  end if;
end $$;

create or replace function public.set_minuta_booking_creation_attribution_v92()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
begin
  -- Never trust attribution supplied by a browser or another caller. The
  -- organization scope has already been established by the v68 BEFORE trigger.
  new.booking_source:=null;
  new.created_by_user_id:=null;
  new.created_by_role:=null;

  if v_actor is not null then
    select membership.role
    into v_role
    from public.organization_memberships membership
    where membership.organization_id=new.organization_id
      and membership.user_id=v_actor
      and membership.active
    limit 1;
  end if;

  if v_role in ('owner','admin') then
    new.booking_source:='admin_manual';
    new.created_by_user_id:=v_actor;
    new.created_by_role:=v_role;
  elsif v_role='specialist' and v_actor=new.performer_id then
    new.booking_source:='provider_manual';
    new.created_by_user_id:=v_actor;
    new.created_by_role:=v_role;
  else
    new.booking_source:='client_online';
  end if;

  return new;
end;
$$;

revoke all on function public.set_minuta_booking_creation_attribution_v92()
  from public,anon,authenticated,service_role;

-- PostgreSQL runs same-event triggers alphabetically. The zz prefix keeps this
-- after bookings_scope_minuta_tenant, which resolves organization_id first.
drop trigger if exists bookings_zz_set_creation_attribution_v92 on public.bookings;
create trigger bookings_zz_set_creation_attribution_v92
before insert on public.bookings
for each row execute function public.set_minuta_booking_creation_attribution_v92();

create or replace function public.protect_minuta_booking_creation_attribution_v92()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.booking_source is distinct from old.booking_source
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_by_role is distinct from old.created_by_role then
    raise exception using errcode='42501',message='booking_creation_attribution_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_minuta_booking_creation_attribution_v92()
  from public,anon,authenticated,service_role;

drop trigger if exists bookings_zz_protect_creation_attribution_v92 on public.bookings;
create trigger bookings_zz_protect_creation_attribution_v92
before update of booking_source,created_by_user_id,created_by_role on public.bookings
for each row execute function public.protect_minuta_booking_creation_attribution_v92();

create or replace function public.get_minuta_team_analytics(p_start date,p_end date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_user uuid:=auth.uid();
  v_organization uuid;
  v_managed_count integer;
  v_payroll_period uuid;
  v_payroll_period_count integer;
  v_performers jsonb;
begin
  if v_user is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>3660 then
    raise exception using errcode='22023',message='invalid_analytics_range';
  end if;

  select count(*),min(membership.organization_id::text)::uuid
  into v_managed_count,v_organization
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id=membership.organization_id
   and organization.status='active'
  where membership.user_id=v_user
    and membership.active
    and membership.role in ('owner','admin');

  if v_managed_count=0 then
    return jsonb_build_object('can_view_team',false,'performers','[]'::jsonb);
  end if;
  if v_managed_count>1 then
    raise exception using errcode='22023',message='organization_context_ambiguous';
  end if;

  select count(*),min(period.id::text)::uuid
  into v_payroll_period_count,v_payroll_period
  from public.payroll_periods period
  where period.organization_id=v_organization
    and period.location_id is null
    and period.starts_on=p_start
    and period.ends_on=p_end
    and period.status in ('approved','paid');

  if v_payroll_period_count<>1 then
    v_payroll_period:=null;
  end if;

  with completed as (
    select
      booking.id,
      booking.performer_id,
      case
        when booking.client_account_id is not null
          then 'account:'||booking.client_account_id::text
        when nullif(public.normalize_client_phone(booking.client_phone),'') is not null
          then 'phone:'||public.normalize_client_phone(booking.client_phone)
        else null
      end as client_key,
      greatest(coalesce(outcome.actual_duration_minutes,booking.duration_minutes,0),0)::bigint as worked_minutes,
      greatest(coalesce(outcome.amount_rub,0),0)::bigint as revenue_rub
    from public.bookings booking
    join public.booking_outcomes outcome on outcome.booking_id=booking.id
    where booking.organization_id=v_organization
      and booking.booking_date between p_start and p_end
      and outcome.visit_status='completed'
  ), metrics as (
    select
      completed.performer_id,
      count(distinct completed.id)::bigint as completed_visits,
      count(distinct completed.client_key)::bigint as unique_clients,
      coalesce(sum(completed.worked_minutes),0)::bigint as worked_minutes,
      coalesce(sum(completed.revenue_rub),0)::bigint as revenue_rub
    from completed
    group by completed.performer_id
  ), team_performers as (
    select membership.user_id as performer_id
    from public.organization_memberships membership
    where membership.organization_id=v_organization
      and membership.active
      and membership.is_bookable
    union
    select completed.performer_id from completed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'performer_id',team.performer_id,
    'performer_name',coalesce(profile.display_name,'Специалист'),
    'completed_visits',coalesce(metrics.completed_visits,0),
    'unique_clients',coalesce(metrics.unique_clients,0),
    'worked_minutes',coalesce(metrics.worked_minutes,0),
    'revenue_rub',coalesce(metrics.revenue_rub,0),
    'payroll_rub',case when v_payroll_period is null then null else
      coalesce((select sum(item.payroll_rub)::bigint
        from public.payroll_items item
        where item.period_id=v_payroll_period and item.performer_id=team.performer_id),0)
      + coalesce((select sum(adjustment.amount_rub)::bigint
        from public.payroll_adjustments adjustment
        where adjustment.period_id=v_payroll_period and adjustment.performer_id=team.performer_id),0)
    end
  ) order by coalesce(metrics.revenue_rub,0) desc,coalesce(profile.display_name,''),team.performer_id),'[]'::jsonb)
  into v_performers
  from team_performers team
  left join public.performer_profiles profile on profile.id=team.performer_id
  left join metrics on metrics.performer_id=team.performer_id;

  return jsonb_build_object(
    'can_view_team',true,
    'organization_id',v_organization,
    'period',jsonb_build_object('start',p_start,'end',p_end),
    'payroll_period_id',v_payroll_period,
    'performers',v_performers
  );
end;
$$;

revoke all on function public.get_minuta_team_analytics(date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_team_analytics(date,date)
  to authenticated;

commit;

set lock_timeout = '5s';
set statement_timeout = '30min';

alter table public.bookings validate constraint bookings_booking_source_check;
alter table public.bookings validate constraint bookings_created_by_role_check;
alter table public.bookings validate constraint bookings_creation_attribution_check;
alter table public.bookings validate constraint bookings_created_by_user_id_fkey;

select format('drop index concurrently if exists %I.%I',namespace_row.nspname,index_class.relname)
from pg_class index_class
join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
join pg_index index_row on index_row.indexrelid=index_class.oid
where namespace_row.nspname='public'
  and index_class.relname in (
    'bookings_source_organization_date_v92_idx',
    'bookings_creator_organization_date_v92_idx'
  )
  and (not index_row.indisvalid or not index_row.indisready)
\gexec

do $$
begin
  if exists (
    select 1
    from pg_class index_class
    join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
    join pg_index index_row on index_row.indexrelid=index_class.oid
    where namespace_row.nspname='public'
      and index_class.relname in (
        'bookings_source_organization_date_v92_idx',
        'bookings_creator_organization_date_v92_idx'
      )
      and index_row.indisvalid
      and index_row.indisready
      and regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <> case index_class.relname
        when 'bookings_source_organization_date_v92_idx'
          then 'createindexbookings_source_organization_date_v92_idxonpublic.bookingsusingbtree(organization_id,booking_source,booking_date)'
        when 'bookings_creator_organization_date_v92_idx'
          then 'createindexbookings_creator_organization_date_v92_idxonpublic.bookingsusingbtree(organization_id,created_by_user_id,booking_date)where(created_by_user_idisnotnull)'
      end
  ) then
    raise exception using errcode='P0001',message='v92_incompatible_existing_index';
  end if;
end $$;

create index concurrently if not exists bookings_source_organization_date_v92_idx
  on public.bookings (organization_id,booking_source,booking_date);

create index concurrently if not exists bookings_creator_organization_date_v92_idx
  on public.bookings (organization_id,created_by_user_id,booking_date)
  where created_by_user_id is not null;

reset lock_timeout;
reset statement_timeout;
