-- v131: idempotent authenticated provider booking without changing the legacy API.
-- Apply only through the backed-up isolated-test/rollback/reapply release gate.
begin;

do $guard$
declare
  actual text;
begin
  select md5(replace(proc.prosrc, E'\r', ''))
  into actual
  from pg_proc proc
  where proc.oid = to_regprocedure(
    'public.provider_book_appointment(uuid,date,time without time zone,text,text)'
  );
  if actual is distinct from '653390c7c91458eef408e82593f38249' then
    raise exception using errcode = '55000', message = 'v131_provider_booking_baseline_drift';
  end if;

  select md5(replace(proc.prosrc, E'\r', ''))
  into actual
  from pg_proc proc
  where proc.oid = to_regprocedure(
    'public.book_appointment(uuid,uuid,date,time without time zone,text,text)'
  );
  if actual is distinct from 'abadc0c81de68738ba6382cd03dda62d' then
    raise exception using errcode = '55000', message = 'v131_idempotent_booking_baseline_drift';
  end if;

  if not exists (
    select 1
    from pg_indexes index_definition
    where index_definition.schemaname = 'public'
      and index_definition.tablename = 'bookings'
      and index_definition.indexname = 'idx_bookings_request_id'
      and index_definition.indexdef ilike 'create unique index%on public.bookings%request_id%'
  ) then
    raise exception using errcode = '55000', message = 'v131_booking_request_identity_missing';
  end if;
end
$guard$;

create or replace function public.provider_book_appointment(
  p_request_id uuid,
  p_service uuid,
  p_date date,
  p_time time without time zone,
  p_client_name text,
  p_client_phone text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_performer uuid;
  v_code text;
  v_token uuid;
  v_booking public.bookings%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'provider_request_id_required';
  end if;

  select service.performer_id
  into v_performer
  from public.services service
  where service.id = p_service
    and service.performer_id = v_actor;
  if v_performer is null then
    raise exception using errcode = '42501', message = 'provider_service_access_denied';
  end if;

  select result.booking_code, result.manage_token
  into v_code, v_token
  from public.book_appointment(
    p_request_id,
    p_service,
    p_date,
    p_time,
    p_client_name,
    p_client_phone
  ) result;

  select booking.*
  into v_booking
  from public.bookings booking
  where booking.request_id = p_request_id;

  if not found
     or v_booking.performer_id is distinct from v_actor
     or v_booking.service_id is distinct from p_service
     or v_booking.booking_code is distinct from v_code then
    raise exception using errcode = '55000', message = 'provider_booking_acknowledgement_mismatch';
  end if;

  return jsonb_build_object(
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'request_id', p_request_id
  );
end;
$$;

revoke all on function public.provider_book_appointment(
  uuid, uuid, date, time without time zone, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.provider_book_appointment(
  uuid, uuid, date, time without time zone, text, text
) to authenticated;

notify pgrst, 'reload schema';
commit;
