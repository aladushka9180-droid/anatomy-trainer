-- Restore captured v79 API and original webhook condition; no user rows deleted.
begin;
do $guard$
declare definition text; no_condition boolean; boundary integer; actual text;
begin
 select md5(replace(p.prosrc,E'\r','')) into actual from pg_proc p
 where p.oid=to_regprocedure('public.manage_minuta_booking_series(uuid,text,text,date,time without time zone)');
 if actual is distinct from '32bed604d520bb6d03568ffbd50f78c1'
  and actual is distinct from md5(E'\n select public.manage_minuta_booking_series_v123_core(p_booking,p_action,p_scope,p_date,p_time,null,null);\n') then
  raise exception using errcode='55000',message='v123_rollback_series_drift';
 end if;
 select pg_get_triggerdef(t.oid),t.tgqual is null into definition,no_condition from pg_trigger t
 where t.tgrelid='public.bookings'::regclass and t.tgname='new_booking_telegram'
  and t.tgfoid=to_regprocedure('supabase_functions.http_request()') and t.tgtype=5 and t.tgenabled='O';
 if definition is null then raise exception using errcode='55000',message='v123_rollback_webhook_drift'; end if;
 boundary:=position(' EXECUTE FUNCTION ' in definition);
 if boundary=0 then raise exception using errcode='55000',message='v123_rollback_webhook_format_drift'; end if;
 if not no_condition then
  if right(left(definition,boundary-1),length(' WHEN ((new.client_phone <> ''0000000000''::text))'))<>' WHEN ((new.client_phone <> ''0000000000''::text))' then
   raise exception using errcode='55000',message='v123_rollback_webhook_condition_drift';
  end if;
  definition:=left(definition,boundary-1-length(' WHEN ((new.client_phone <> ''0000000000''::text))'))||substr(definition,boundary);
  execute 'drop trigger new_booking_telegram on public.bookings';
  execute definition;
 end if;
end $guard$;
create or replace function public.manage_minuta_booking_series(
  p_booking uuid,
  p_action text,
  p_scope text default 'one',
  p_date date default null,
  p_time time without time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_anchor public.bookings%rowtype;
  v_delta interval;
  v_ids uuid[];
  v_target record;
  v_affected jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_booking is null or p_action not in ('cancel', 'reschedule')
     or p_scope not in ('one', 'following', 'all') then
    raise exception using errcode = '22023', message = 'invalid_series_action';
  end if;

  select booking.* into v_anchor
  from public.bookings booking
  where booking.id = p_booking;

  if not found then
    raise exception using errcode = 'P0001', message = 'booking_not_found';
  end if;
  if v_anchor.performer_id <> v_actor then
    raise exception using errcode = '42501', message = 'booking_access_denied';
  end if;
  if v_anchor.series_id is null or v_anchor.series_occurrence is null then
    raise exception using errcode = 'P0001', message = 'booking_not_in_series';
  end if;
  if v_anchor.status = 'cancelled'
     or v_anchor.booking_date < current_date
     or exists (
       select 1 from public.booking_outcomes outcome
       where outcome.booking_id = v_anchor.id
         and outcome.visit_status <> 'scheduled'
     ) then
    raise exception using errcode = 'P0001', message = 'series_booking_not_actionable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_anchor.series_id::text, 7901));

  select
    array_agg(booking.id order by booking.series_occurrence),
    coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', booking.id,
      'occurrence', booking.series_occurrence
    ) order by booking.series_occurrence), '[]'::jsonb)
  into v_ids, v_affected
  from public.bookings booking
  left join public.booking_outcomes outcome on outcome.booking_id = booking.id
  where booking.series_id = v_anchor.series_id
    and booking.performer_id = v_actor
    and booking.status <> 'cancelled'
    and booking.booking_date >= current_date
    and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
    and (
      (p_scope = 'one' and booking.id = v_anchor.id)
      or (p_scope = 'following' and booking.series_occurrence >= v_anchor.series_occurrence)
      or p_scope = 'all'
    );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'series_has_no_actionable_bookings';
  end if;

  -- Ядро отмены v76 берёт такой же lock до блокировки строки. Получаем lock
  -- каждой записи заранее и по порядку, чтобы групповая операция не могла
  -- образовать взаимную блокировку с одиночной отменой.
  for v_target in
    select booking.id
    from public.bookings booking
    where booking.id = any(v_ids)
    order by booking.series_occurrence, booking.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_target.id::text, 7302));
  end loop;

  perform 1
  from public.bookings booking
  where booking.id = any(v_ids)
  order by booking.series_occurrence, booking.id
  for update;

  perform 1
  from public.booking_outcomes outcome
  where outcome.booking_id = any(v_ids)
  order by outcome.booking_id
  for update;

  -- Повторяем выбор после ожидания блокировок: отменённая или завершённая
  -- параллельным запросом запись не должна попасть в групповую операцию.
  select
    array_agg(booking.id order by booking.series_occurrence),
    coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', booking.id,
      'occurrence', booking.series_occurrence
    ) order by booking.series_occurrence), '[]'::jsonb)
  into v_ids, v_affected
  from public.bookings booking
  left join public.booking_outcomes outcome on outcome.booking_id = booking.id
  where booking.series_id = v_anchor.series_id
    and booking.performer_id = v_actor
    and booking.status <> 'cancelled'
    and booking.booking_date >= current_date
    and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
    and (
      (p_scope = 'one' and booking.id = v_anchor.id)
      or (p_scope = 'following' and booking.series_occurrence >= v_anchor.series_occurrence)
      or p_scope = 'all'
    );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'series_has_no_actionable_bookings';
  end if;

  if p_action = 'cancel' then
    for v_target in
      select booking.id
      from public.bookings booking
      where booking.id = any(v_ids)
      order by booking.series_occurrence
    loop
      perform public.cancel_minuta_booking_core(v_target.id, 'provider', 'always_full');
    end loop;
  else
    if p_date is null or p_time is null then
      raise exception using errcode = '22023', message = 'series_reschedule_target_required';
    end if;
    v_delta := (p_date + p_time) - (v_anchor.booking_date + v_anchor.booking_time);

    if exists (
      select 1
      from public.bookings booking
      where booking.id = any(v_ids)
        and (
          ((booking.booking_date + booking.booking_time + v_delta)::date < current_date)
          or ((booking.booking_date + booking.booking_time + v_delta)::date > current_date + 730)
        )
    ) then
      raise exception using errcode = '22023', message = 'series_reschedule_out_of_range';
    end if;

    -- Положительный сдвиг идёт с конца серии, отрицательный — с начала.
    -- Так старые окна следующих элементов освобождаются до переноса соседей.
    for v_target in
      select booking.id
      from public.bookings booking
      where booking.id = any(v_ids)
      order by
        case when v_delta >= interval '0 seconds' then booking.booking_date + booking.booking_time end desc,
        case when v_delta < interval '0 seconds' then booking.booking_date + booking.booking_time end asc,
        booking.id
    loop
      update public.bookings booking
      set booking_date = (booking.booking_date + booking.booking_time + v_delta)::date,
          booking_time = (booking.booking_date + booking.booking_time + v_delta)::time
      where booking.id = v_target.id
        and booking.performer_id = v_actor;
    end loop;
  end if;

  return jsonb_build_object(
    'series_id', v_anchor.series_id,
    'action', p_action,
    'scope', p_scope,
    'affected_count', array_length(v_ids, 1),
    'affected', v_affected
  );
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'series_slot_unavailable';
end;
$$;
revoke all on function public.manage_minuta_booking_series(uuid,text,text,date,time) from public,anon,authenticated,service_role;
grant execute on function public.manage_minuta_booking_series(uuid,text,text,date,time) to authenticated;
drop function if exists public.manage_minuta_booking_series_v123(uuid,text,text,date,time,date,time);
drop function if exists public.manage_minuta_booking_series_v123_core(uuid,text,text,date,time,date,time);
drop function if exists public.create_provider_block_v123(uuid,uuid,uuid,date,time,integer,uuid,text,text);
drop function if exists public.get_provider_block_slots_v123(uuid,uuid,uuid,date,integer);
drop function if exists public.minuta_block_slot_valid_v123(uuid,uuid,uuid,date,time,integer);
notify pgrst,'reload schema';
commit;
