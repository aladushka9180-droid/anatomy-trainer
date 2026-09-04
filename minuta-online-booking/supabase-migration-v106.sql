\set ON_ERROR_STOP on

-- v106 makes visit outcome writes atomic and completes elapsed visits on the server.
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.booking_policies') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.services') is null
     or to_regclass('public.locations') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_policies' and column_name='auto_complete_visits')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_outcomes' and column_name='completion_source')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_outcomes' and column_name='actual_duration_minutes')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_outcomes' and column_name='calculated_amount_rub') then
    raise exception using errcode='P0001',message='v106_requires_booking_outcomes_v57_and_organizations_v65';
  end if;
end $$;

create or replace function public.save_minuta_booking_outcome_v106(
  p_booking uuid,
  p_visit_status text,
  p_payment_method text,
  p_amount_rub integer,
  p_actual_duration_minutes integer default null,
  p_completion_source text default 'manual'
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_user uuid:=auth.uid();
  v_booking public.bookings%rowtype;
  v_role text;
  v_service_duration integer;
  v_rate integer;
  v_actual integer;
  v_calculated integer;
  v_amount integer;
  v_payment text;
  v_result jsonb;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_booking is null or p_visit_status not in ('scheduled','completed','no_show')
     or p_payment_method not in ('unpaid','cash','card','transfer')
     or p_amount_rub is null or p_amount_rub<0 or p_amount_rub>1000000
     or p_completion_source not in ('manual','auto') then
    raise exception using errcode='22023',message='invalid_booking_outcome';
  end if;

  select booking.* into v_booking from public.bookings booking where booking.id=p_booking for update;
  if v_booking.id is null then raise exception using errcode='P0001',message='booking_not_found'; end if;
  if v_booking.status='cancelled' then raise exception using errcode='P0001',message='booking_cancelled'; end if;

  if v_booking.organization_id is null then
    if v_booking.performer_id<>v_user then raise exception using errcode='42501',message='booking_outcome_access_denied'; end if;
  else
    select membership.role into v_role from public.organization_memberships membership
    where membership.organization_id=v_booking.organization_id and membership.user_id=v_user and membership.active limit 1;
    if v_role not in ('owner','admin') and not (v_role='specialist' and v_booking.performer_id=v_user) then
      raise exception using errcode='42501',message='booking_outcome_access_denied';
    end if;
  end if;

  select service.duration_minutes,service.price_rub into v_service_duration,v_rate
  from public.services service where service.id=v_booking.service_id;
  v_actual:=case when p_visit_status='completed' and v_service_duration=1 then p_actual_duration_minutes else null end;
  if p_visit_status='completed' and v_service_duration=1 and (v_actual is null or v_actual<1 or v_actual>1440) then
    raise exception using errcode='22023',message='actual_duration_required';
  end if;
  v_rate:=greatest(coalesce(v_booking.original_price_rub,v_rate,0),0);
  v_calculated:=case
    when p_visit_status<>'completed' then null
    when v_service_duration=1 then v_rate*v_actual
    else greatest(coalesce(v_booking.total_price_rub,v_booking.original_price_rub,v_rate,0),0)
  end;
  v_payment:=case when p_visit_status='completed' then p_payment_method else 'unpaid' end;
  v_amount:=case when p_visit_status='completed' and v_payment<>'unpaid' then p_amount_rub else 0 end;

  insert into public.booking_outcomes(
    booking_id,performer_id,visit_status,payment_method,amount_rub,
    actual_duration_minutes,calculated_amount_rub,completion_source,updated_at
  ) values (
    v_booking.id,v_booking.performer_id,p_visit_status,v_payment,v_amount,
    v_actual,v_calculated,p_completion_source,pg_catalog.now()
  )
  on conflict(booking_id) do update set
    performer_id=excluded.performer_id,
    visit_status=excluded.visit_status,
    payment_method=excluded.payment_method,
    amount_rub=excluded.amount_rub,
    actual_duration_minutes=excluded.actual_duration_minutes,
    calculated_amount_rub=excluded.calculated_amount_rub,
    completion_source=excluded.completion_source,
    updated_at=excluded.updated_at;

  select pg_catalog.to_jsonb(outcome) into v_result from public.booking_outcomes outcome where outcome.booking_id=v_booking.id;
  return v_result;
end;
$$;
revoke all on function public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text) to authenticated;

create or replace function public.process_minuta_auto_completed_visits_v106(p_limit integer default 500)
returns integer language plpgsql security definer set search_path to '' as $$
declare
  v_candidate record;
  v_processed integer:=0;
  v_rows integer;
  v_minutes integer;
  v_value integer;
begin
  if p_limit is null or p_limit<1 or p_limit>5000 then
    raise exception using errcode='22023',message='invalid_auto_completion_limit';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('minuta-auto-complete-v106',106)) then return 0; end if;

  for v_candidate in
    select booking.id,booking.performer_id,booking.duration_minutes,booking.original_price_rub,booking.total_price_rub,
      service.duration_minutes service_duration_minutes,service.price_rub service_price_rub,
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
        or (outcome.visit_status='completed' and outcome.completion_source='auto' and (outcome.payment_method='unpaid' or coalesce(outcome.amount_rub,0)<=0)))
    order by booking.booking_date,booking.booking_time,booking.id
    limit p_limit
    for update of booking skip locked
  loop
    v_minutes:=greatest(coalesce(v_candidate.duration_minutes,v_candidate.service_duration_minutes,60),1);
    v_value:=case when v_candidate.service_duration_minutes=1
      then greatest(coalesce(v_candidate.original_price_rub,v_candidate.service_price_rub,0),0)*v_minutes
      else greatest(coalesce(v_candidate.total_price_rub,v_candidate.original_price_rub,v_candidate.service_price_rub,0),0) end;
    insert into public.booking_outcomes(
      booking_id,performer_id,visit_status,payment_method,amount_rub,
      actual_duration_minutes,calculated_amount_rub,completion_source,updated_at
    ) values (
      v_candidate.id,v_candidate.performer_id,'completed','cash',v_value,
      case when v_candidate.service_duration_minutes=1 then v_minutes else null end,
      v_value,'auto',pg_catalog.now()
    )
    on conflict(booking_id) do update set
      performer_id=excluded.performer_id,visit_status='completed',payment_method='cash',amount_rub=excluded.amount_rub,
      actual_duration_minutes=case when excluded.actual_duration_minutes is not null then excluded.actual_duration_minutes else public.booking_outcomes.actual_duration_minutes end,
      calculated_amount_rub=excluded.calculated_amount_rub,completion_source='auto',updated_at=excluded.updated_at
    where public.booking_outcomes.visit_status='scheduled'
       or (public.booking_outcomes.visit_status='completed' and public.booking_outcomes.completion_source='auto'
         and (public.booking_outcomes.payment_method='unpaid' or coalesce(public.booking_outcomes.amount_rub,0)<=0));
    get diagnostics v_rows=row_count;
    v_processed:=v_processed+v_rows;
  end loop;
  return v_processed;
end;
$$;
revoke all on function public.process_minuta_auto_completed_visits_v106(integer) from public,anon,authenticated,service_role;

do $$
begin
  if to_regprocedure('public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text)') is null
     or not has_function_privilege('authenticated','public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text)','EXECUTE')
     or has_function_privilege('anon','public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text)','EXECUTE')
     or to_regprocedure('public.process_minuta_auto_completed_visits_v106(integer)') is null
     or has_function_privilege('authenticated','public.process_minuta_auto_completed_visits_v106(integer)','EXECUTE') then
    raise exception using errcode='P0001',message='v106_function_acl_guard_failed';
  end if;
end $$;

select public.process_minuta_auto_completed_visits_v106(5000);
notify pgrst,'reload schema';
commit;
