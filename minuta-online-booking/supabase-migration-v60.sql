begin;

create or replace function public.provider_delete_booking(p_booking uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_performer uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  select booking.performer_id
  into v_performer
  from public.bookings booking
  where booking.id = p_booking
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_performer is distinct from auth.uid() then
    raise exception 'booking_access_denied' using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.payments payment
    where payment.booking_id = p_booking
  ) then
    return 'payment_protected';
  end if;

  delete from public.bookings
  where id = p_booking
    and performer_id = auth.uid();

  return 'deleted';
end;
$$;

revoke all on function public.provider_delete_booking(uuid) from public;
grant execute on function public.provider_delete_booking(uuid) to authenticated;

commit;
