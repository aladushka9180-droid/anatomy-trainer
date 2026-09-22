-- Atomic optional client comment for ordinary PrimeTime appointments.
-- Apply only after backup, restore rehearsal, rollback proof and direct approval.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is null
     or to_regclass('public.bookings') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='provider_note'
     ) then
    raise exception using errcode='55000',message='v170_comment_prerequisites_missing';
  end if;
end;
$guard$;

create or replace function public.book_minuta_appointment_v3(
  p_request_id uuid,
  p_slug text,
  p_location uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text,
  p_expected_price_rub integer,
  p_expected_duration_minutes integer,
  p_comment text
)
returns table(
  result_code text,
  booking_code text,
  manage_token uuid,
  request_id uuid,
  service_id uuid,
  booking_date date,
  booking_time time without time zone,
  duration_minutes integer,
  original_price_rub integer,
  total_price_rub integer,
  status text,
  current_price_rub integer,
  current_duration_minutes integer
)
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_comment text := btrim(regexp_replace(coalesce(p_comment,''),'[[:cntrl:]]+',' ','g'));
  v_existing boolean;
  v_result record;
begin
  if p_request_id is null or char_length(v_comment)>500 then
    raise exception using errcode='22023',message='invalid_booking_comment';
  end if;

  -- v2 uses this lock too. Take it before checking for an existing request so
  -- concurrent retries cannot overwrite the note attached by the first call.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-request:'||p_request_id::text,0)
  );
  select exists(select 1 from public.bookings as b where b.request_id=p_request_id)
  into v_existing;

  select * into v_result
  from public.book_minuta_appointment_v2(
    p_request_id,p_slug,p_location,p_service,p_date,p_time,
    p_client_name,p_client_phone,p_expected_price_rub,p_expected_duration_minutes
  );
  if not found then
    raise exception using errcode='55000',message='atomic_booking_acknowledgement_invalid';
  end if;

  if v_result.result_code='ok' and not v_existing then
    update public.bookings as b
    set provider_note=v_comment
    where b.request_id=p_request_id and b.booking_code=v_result.booking_code;
    if not found then
      raise exception using errcode='55000',message='atomic_booking_comment_missing';
    end if;
  end if;

  return query select
    v_result.result_code,v_result.booking_code,v_result.manage_token,
    v_result.request_id,v_result.service_id,v_result.booking_date,
    v_result.booking_time,v_result.duration_minutes,
    v_result.original_price_rub,v_result.total_price_rub,v_result.status,
    v_result.current_price_rub,v_result.current_duration_minutes;
end;
$$;

alter function public.book_minuta_appointment_v3(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text
) owner to postgres;
revoke all on function public.book_minuta_appointment_v3(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text
) from public,anon,authenticated,service_role;
grant execute on function public.book_minuta_appointment_v3(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text
) to anon,authenticated;

commit;
