-- Operational rollback: restore the old deletion behavior without destroying archives.
-- Keep additive columns/checks: restoring the old identity checks after a successful
-- deletion would lose retained history or fail. This is intentionally not a data restore.
begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
do $guard$ begin
  if not exists(select 1 from pg_proc where oid='public.provider_delete_booking(uuid)'::regprocedure
    and md5(regexp_replace(prosrc,'[[:space:]]','','g')) in ('a253f555e7ddfa9ac60ce2f629c43865','71c0034ac328ad54c677cce8483ccc05')) then
    raise exception 'booking_delete_dialog_unexpected_rpc';
  end if;
end $guard$;
create or replace function public.provider_delete_booking(p_booking uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_performer uuid;
  v_has_review boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select booking.performer_id
  into v_performer
  from public.bookings booking
  where booking.id = p_booking
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_performer is distinct from v_actor then
    raise exception using errcode = '42501', message = 'booking_access_denied';
  end if;

  if to_regclass('public.booking_reviews') is not null then
    execute $sql$
      select exists (
        select 1
        from public.booking_reviews review
        where review.booking_id = $1
      )
    $sql$
    into v_has_review
    using p_booking;
  end if;

  if v_has_review then
    return 'review_protected';
  end if;

  if to_regclass('public.payments') is not null then
    if to_regclass('public.payment_events') is not null then
      execute $sql$
        delete from public.payment_events event
        where event.payment_id in (
          select payment.id
          from public.payments payment
          where payment.booking_id = $1
        )
      $sql$
      using p_booking;
    end if;

    execute $sql$
      delete from public.payments payment
      where payment.booking_id = $1
    $sql$
    using p_booking;
  end if;

  delete from public.bookings booking
  where booking.id = p_booking
    and booking.performer_id = v_actor;

  if not found then
    raise exception using errcode = 'P0001', message = 'booking_delete_failed';
  end if;

  return 'deleted';
end;
$$;

revoke all on function public.provider_delete_booking(uuid) from public, anon, authenticated, service_role;
grant execute on function public.provider_delete_booking(uuid) to authenticated;

comment on function public.provider_delete_booking(uuid) is null;
commit;
