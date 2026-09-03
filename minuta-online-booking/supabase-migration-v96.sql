\set ON_ERROR_STOP on

-- A cancelled CREATE INDEX CONCURRENTLY leaves a fixed-name invalid shell.
-- Remove only that known invalid shell so the same migration can be retried.
select format('drop index concurrently if exists %I.%I',namespace_row.nspname,index_class.relname)
from pg_class index_class
join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
join pg_index index_row on index_row.indexrelid=index_class.oid
where namespace_row.nspname='public'
  and index_class.relname in (
    'bookings_performer_date_time_v94_idx',
    'booking_events_scope_previous_date_v96_idx'
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
      and case index_class.relname
        when 'bookings_performer_date_time_v94_idx' then
          regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <>
            'createindexbookings_performer_date_time_v94_idxonpublic.bookingsusingbtree(performer_id,booking_date,booking_time)'
        when 'booking_events_scope_previous_date_v96_idx' then
          regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <>
            'createindexbooking_events_scope_previous_date_v96_idxonpublic.booking_eventsusingbtree(organization_id,previous_booking_date,occurred_atdesc,iddesc)where(previous_booking_dateisnotnull)'
        else false
      end
  ) then
    raise exception using errcode='P0001',message='v96_incompatible_existing_index';
  end if;
end $$;

begin;

set local lock_timeout = '5s';
set local statement_timeout = '10min';
set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_events') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.payroll_periods') is null
     or to_regclass('public.payroll_items') is null
     or to_regclass('public.payroll_adjustments') is null
     or to_regprocedure('public.minuta_booking_value_v93(jsonb,uuid)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='total_price_rub'
     )
     or (select count(*) from information_schema.columns
         where table_schema='public' and table_name='bookings'
           and column_name in ('booking_source','created_by_user_id','created_by_role')) <> 3 then
    raise exception using errcode='P0001',message='v96_requires_v92_v93';
  end if;
end $$;

-- A deleted auth user must not make their historical bookings undeletable.
alter table public.bookings
  drop constraint if exists bookings_creation_attribution_check;
alter table public.bookings
  add constraint bookings_creation_attribution_check
  check (
    (booking_source is null and created_by_user_id is null and created_by_role is null)
    or (booking_source='client_online' and created_by_user_id is null and created_by_role is null)
    or (booking_source='provider_manual' and created_by_role='specialist')
    or (booking_source='admin_manual' and created_by_role in ('owner','admin'))
  ) not valid;

commit;

set lock_timeout = '5s';
set statement_timeout = '30min';
alter table public.bookings
  validate constraint bookings_creation_attribution_check;
reset lock_timeout;
reset statement_timeout;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';
set local search_path = public, extensions, pg_catalog;

create or replace function public.protect_minuta_booking_creation_attribution_v92()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.booking_source is not distinct from old.booking_source
     and new.created_by_role is not distinct from old.created_by_role
     and old.created_by_user_id is not null
     and new.created_by_user_id is null
     and not exists(select 1 from auth.users where id=old.created_by_user_id) then
    return new;
  end if;
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

-- total_price_rub is the authoritative total for composite and repriced visits.
create or replace function public.minuta_booking_value_v93(p_row jsonb,p_booking uuid)
returns integer
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_service uuid;
  v_service_duration integer;
  v_service_price integer;
  v_duration integer:=greatest(coalesce((p_row->>'duration_minutes')::integer,0),0);
  v_rate integer:=greatest(coalesce((p_row->>'original_price_rub')::integer,0),0);
begin
  if p_row ? 'total_price_rub' and p_row->>'total_price_rub' is not null then
    return greatest((p_row->>'total_price_rub')::integer,0);
  end if;
  begin
    v_service:=(p_row->>'service_id')::uuid;
  exception when others then
    v_service:=null;
  end;
  select service.duration_minutes,service.price_rub
  into v_service_duration,v_service_price
  from public.services service
  where service.id=v_service;
  if coalesce(v_service_duration,0)=1 then
    return greatest(coalesce(nullif(v_rate,0),v_service_price,0),0)*greatest(v_duration,1);
  end if;
  return greatest(coalesce(nullif(v_rate,0),v_service_price,0),0);
end;
$$;
revoke all on function public.minuta_booking_value_v93(jsonb,uuid)
  from public,anon,authenticated,service_role;

-- Organization-explicit overload avoids ambiguity for owners and admins who
-- manage more than one branch network.
create or replace function public.get_minuta_team_analytics(
  p_organization uuid,
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_user uuid:=auth.uid();
  v_role text;
  v_payroll_period uuid;
  v_payroll_period_count integer;
  v_performers jsonb;
begin
  if v_user is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if p_organization is null or p_start is null or p_end is null
     or p_end<p_start or p_end-p_start>3660 then
    raise exception using errcode='22023',message='invalid_analytics_range';
  end if;

  select membership.role
  into v_role
  from public.organization_memberships membership
  join public.organizations organization
    on organization.id=membership.organization_id
   and organization.status='active'
  where membership.organization_id=p_organization
    and membership.user_id=v_user
    and membership.active;

  if v_role is null or v_role not in ('owner','admin') then
    return jsonb_build_object('can_view_team',false,'performers','[]'::jsonb);
  end if;

  select count(*),min(period.id::text)::uuid
  into v_payroll_period_count,v_payroll_period
  from public.payroll_periods period
  where period.organization_id=p_organization
    and period.location_id is null
    and period.starts_on=p_start
    and period.ends_on=p_end
    and period.status in ('approved','paid');
  if v_payroll_period_count<>1 then v_payroll_period:=null; end if;

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
    where booking.organization_id=p_organization
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
    where membership.organization_id=p_organization
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
    'organization_id',p_organization,
    'period',jsonb_build_object('start',p_start,'end',p_end),
    'payroll_period_id',v_payroll_period,
    'performers',v_performers
  );
end;
$$;
revoke all on function public.get_minuta_team_analytics(uuid,date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_team_analytics(uuid,date,date)
  to authenticated;

do $$
begin
  if exists (
    select 1
    from pg_class index_class
    join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
    join pg_index index_row on index_row.indexrelid=index_class.oid
    where namespace_row.nspname='public'
      and index_class.relname in (
        'bookings_performer_date_time_v94_idx',
        'booking_events_scope_previous_date_v96_idx'
      )
      and (
        not index_row.indisvalid
        or not index_row.indisready
        or case index_class.relname
          when 'bookings_performer_date_time_v94_idx' then
            regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <>
              'createindexbookings_performer_date_time_v94_idxonpublic.bookingsusingbtree(performer_id,booking_date,booking_time)'
          when 'booking_events_scope_previous_date_v96_idx' then
            regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <>
              'createindexbooking_events_scope_previous_date_v96_idxonpublic.booking_eventsusingbtree(organization_id,previous_booking_date,occurred_atdesc,iddesc)where(previous_booking_dateisnotnull)'
          else false
        end
      )
  ) then
    raise exception using errcode='P0001',message='v96_incompatible_existing_index';
  end if;
end $$;

commit;

-- MINUTA_CONCURRENT_INDEXES_BEGIN
-- These indexes are deliberately outside a transaction so production writes
-- are not blocked while a ten-year table is scanned.
set lock_timeout = '5s';
set statement_timeout = '30min';
create index concurrently if not exists bookings_performer_date_time_v94_idx
  on public.bookings (performer_id,booking_date,booking_time);
create index concurrently if not exists booking_events_scope_previous_date_v96_idx
  on public.booking_events (organization_id,previous_booking_date,occurred_at desc,id desc)
  where previous_booking_date is not null;
reset lock_timeout;
reset statement_timeout;
