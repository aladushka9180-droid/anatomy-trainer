\set ON_ERROR_STOP on

-- v124 lets each provider choose how automatically completed visits are paid.
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.booking_policies') is null
     or to_regclass('public.services') is null
     or to_regclass('public.locations') is null
     or to_regprocedure('public.process_minuta_auto_completed_visits_v106(integer)') is null then
    raise exception using errcode='P0001',message='v124_requires_visit_outcomes_v106';
  end if;
end $$;

alter table public.booking_policies
  add column if not exists auto_complete_payment_method text not null default 'cash';

update public.booking_policies
set auto_complete_payment_method='cash'
where auto_complete_payment_method is null;

alter table public.booking_policies
  alter column auto_complete_payment_method set default 'cash',
  alter column auto_complete_payment_method set not null;
alter table public.booking_policies
  drop constraint if exists booking_policies_auto_complete_payment_method_check;
alter table public.booking_policies
  add constraint booking_policies_auto_complete_payment_method_check
  check (auto_complete_payment_method in ('unpaid','cash','transfer','card')) not valid;
alter table public.booking_policies
  validate constraint booking_policies_auto_complete_payment_method_check;

create or replace function public.process_minuta_auto_completed_visits_v106(p_limit integer default 500)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_candidate record;
  v_processed integer:=0;
  v_rows integer;
  v_minutes integer;
  v_value integer;
  v_payment text;
begin
  if p_limit is null or p_limit<1 or p_limit>5000 then
    raise exception using errcode='22023',message='invalid_auto_completion_limit';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('minuta-auto-complete-v106',106)) then return 0; end if;

  for v_candidate in
    select booking.id,booking.performer_id,booking.duration_minutes,booking.original_price_rub,booking.total_price_rub,
      service.duration_minutes service_duration_minutes,service.price_rub service_price_rub,
      policy.auto_complete_payment_method,
      outcome.visit_status,outcome.payment_method,outcome.amount_rub,outcome.actual_duration_minutes,outcome.completion_source
    from public.bookings booking
    join public.booking_policies policy on policy.performer_id=booking.performer_id and policy.auto_complete_visits
    left join public.services service on service.id=booking.service_id
    left join public.locations location on location.id=booking.location_id
    left join public.booking_outcomes outcome on outcome.booking_id=booking.id
    where booking.status<>'cancelled'
      and booking.booking_date+booking.booking_time+pg_catalog.make_interval(mins=>greatest(coalesce(booking.duration_minutes,service.duration_minutes,60),1))
        <=pg_catalog.timezone(coalesce((select zone.name from pg_catalog.pg_timezone_names zone where zone.name=location.timezone limit 1),'Europe/Samara'),pg_catalog.now())
      and (outcome.booking_id is null or outcome.visit_status='scheduled'
        or (policy.auto_complete_payment_method<>'unpaid' and outcome.visit_status='completed' and outcome.completion_source='auto'
          and (outcome.payment_method='unpaid' or coalesce(outcome.amount_rub,0)<=0)))
    order by booking.booking_date,booking.booking_time,booking.id
    limit p_limit
    for update of booking skip locked
  loop
    v_minutes:=greatest(coalesce(v_candidate.duration_minutes,v_candidate.service_duration_minutes,60),1);
    v_value:=case when v_candidate.service_duration_minutes=1
      then greatest(coalesce(v_candidate.original_price_rub,v_candidate.service_price_rub,0),0)*v_minutes
      else greatest(coalesce(v_candidate.total_price_rub,v_candidate.original_price_rub,v_candidate.service_price_rub,0),0) end;
    v_payment:=coalesce(v_candidate.auto_complete_payment_method,'cash');
    insert into public.booking_outcomes(
      booking_id,performer_id,visit_status,payment_method,amount_rub,
      actual_duration_minutes,calculated_amount_rub,completion_source,updated_at
    ) values (
      v_candidate.id,v_candidate.performer_id,'completed',v_payment,case when v_payment='unpaid' then 0 else v_value end,
      case when v_candidate.service_duration_minutes=1 then v_minutes else null end,
      v_value,'auto',pg_catalog.now()
    )
    on conflict(booking_id) do update set
      performer_id=excluded.performer_id,visit_status='completed',payment_method=excluded.payment_method,amount_rub=excluded.amount_rub,
      actual_duration_minutes=case when excluded.actual_duration_minutes is not null then excluded.actual_duration_minutes else public.booking_outcomes.actual_duration_minutes end,
      calculated_amount_rub=excluded.calculated_amount_rub,completion_source='auto',updated_at=excluded.updated_at
    where public.booking_outcomes.visit_status='scheduled'
       or (excluded.payment_method<>'unpaid' and public.booking_outcomes.visit_status='completed' and public.booking_outcomes.completion_source='auto'
         and (public.booking_outcomes.payment_method='unpaid' or coalesce(public.booking_outcomes.amount_rub,0)<=0));
    get diagnostics v_rows=row_count;
    v_processed:=v_processed+v_rows;
  end loop;
  return v_processed;
end;
$$;
revoke all on function public.process_minuta_auto_completed_visits_v106(integer) from public,anon,authenticated,service_role;

do $$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef('public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure) into definition;
  if not exists(
       select 1 from information_schema.columns
       where table_schema='public' and table_name='booking_policies'
         and column_name='auto_complete_payment_method' and data_type='text' and is_nullable='NO'
     )
     or not exists(
       select 1 from pg_constraint
       where conrelid='public.booking_policies'::regclass
         and conname='booking_policies_auto_complete_payment_method_check' and convalidated
     )
     or position('auto_complete_payment_method' in definition)=0
     or has_function_privilege('authenticated','public.process_minuta_auto_completed_visits_v106(integer)','EXECUTE') then
    raise exception using errcode='P0001',message='v124_install_guard_failed';
  end if;
end $$;

select public.process_minuta_auto_completed_visits_v106(5000);
notify pgrst,'reload schema';
commit;
