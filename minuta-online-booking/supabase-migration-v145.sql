\set ON_ERROR_STOP on

-- v145 creates a forgotten past visit and its completed financial outcome in
-- one transaction. The seven-argument v98 function remains available for old
-- clients; the provider UI calls this exact nine-argument overload.
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$
begin
  if to_regprocedure('public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text,integer)') is null
     or to_regprocedure('public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text)') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.services') is null then
    raise exception using errcode='P0001',message='v145_requires_historical_bookings_and_outcomes';
  end if;
end $$;

create or replace function public.create_minuta_historical_booking(
  p_organization uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text,
  p_duration_minutes integer,
  p_payment_method text,
  p_amount_rub integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_created jsonb;
  v_outcome jsonb;
  v_booking uuid;
  v_service_duration integer;
  v_payment text:=btrim(coalesce(p_payment_method,''));
  v_amount integer;
  v_calculated integer;
begin
  if v_payment not in ('unpaid','cash','transfer','card')
     or p_amount_rub is null or p_amount_rub not between 0 and 1000000 then
    raise exception using errcode='22023',message='invalid_historical_payment';
  end if;
  v_amount:=case when v_payment='unpaid' then 0 else p_amount_rub end;

  v_created:=public.create_minuta_historical_booking(
    p_organization,p_service,p_date,p_time,p_client_name,p_client_phone,p_duration_minutes
  );
  v_booking:=(v_created->>'booking_id')::uuid;
  v_calculated:=(v_created->>'total_price_rub')::integer;

  select service.duration_minutes
  into v_service_duration
  from public.bookings booking
  join public.services service on service.id=booking.service_id
  where booking.id=v_booking and booking.service_id=p_service;
  if v_booking is null or v_service_duration is null
     or v_calculated is null or v_calculated not between 0 and 10000000 then
    raise exception using errcode='P0001',message='historical_booking_acknowledgement_invalid';
  end if;

  v_outcome:=public.save_minuta_booking_outcome_v106(
    v_booking,'completed',v_payment,v_amount,
    case when v_service_duration=1 then (v_created->>'duration_minutes')::integer else null end,'manual'
  );
  if (v_outcome->>'booking_id')::uuid is distinct from v_booking
     or (v_outcome->>'visit_status') is distinct from 'completed'
     or (v_outcome->>'payment_method') is distinct from v_payment
     or (v_outcome->>'amount_rub')::integer is distinct from v_amount
     or (v_outcome->>'calculated_amount_rub')::integer is distinct from v_calculated then
    raise exception using errcode='P0001',message='historical_outcome_acknowledgement_invalid';
  end if;

  return v_created || jsonb_build_object(
    'visit_status',v_outcome->>'visit_status',
    'payment_method',v_outcome->>'payment_method',
    'amount_rub',(v_outcome->>'amount_rub')::integer,
    'calculated_amount_rub',(v_outcome->>'calculated_amount_rub')::integer
  );
end;
$$;

revoke all on function public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text,integer,text,integer
) from public,anon,authenticated,service_role;
grant execute on function public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text,integer,text,integer
) to authenticated;

do $$
declare
  v_function regprocedure:=to_regprocedure(
    'public.create_minuta_historical_booking(uuid,uuid,date,time without time zone,text,text,integer,text,integer)'
  );
  v_security_definer boolean;
  v_config text[];
begin
  if v_function is null then raise exception 'v145_function_missing'; end if;
  select procedure.prosecdef,procedure.proconfig into v_security_definer,v_config
  from pg_catalog.pg_proc procedure where procedure.oid=v_function::oid;
  if not v_security_definer
     or not ('search_path=""'=any(coalesce(v_config,'{}'::text[])))
     or not has_function_privilege('authenticated',v_function,'execute')
     or has_function_privilege('anon',v_function,'execute')
     or has_function_privilege('service_role',v_function,'execute') then
    raise exception using errcode='P0001',message='v145_function_guard_failed';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
