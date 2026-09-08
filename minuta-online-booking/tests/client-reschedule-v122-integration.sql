\set ON_ERROR_STOP on
begin;
-- Exercise the real v122 wrapper/receipt/ACL contract. Stub only the pre-existing
-- v76 slot mutation boundary inside this rolled-back transaction. No fixtures,
-- notifications or mutations escape the transaction. v76/v101 remain covered
-- separately by their policy/buffer regression checks.
do $$ begin
  perform set_config('minuta.v122.token',(select manage_token::text from public.bookings
    where manage_token is not null and status<>'cancelled' order by id limit 1),true);
  if nullif(current_setting('minuta.v122.token',true),'') is null then
    raise exception 'v122_test_requires_one_isolated_managed_booking';
  end if;
end $$;
select set_config('minuta.v122.calls','0',true);
create or replace function public.reschedule_booking_v2(p_token uuid,p_date date,p_time time without time zone)
returns text language plpgsql security definer set search_path to '' as $$
begin
  perform set_config('minuta.v122.calls',(current_setting('minuta.v122.calls')::integer+1)::text,true);
  return 'V122-SYNTHETIC-RECEIPT';
end $$;
select set_config('minuta.v122.date',(select (booking_date+1)::text from public.bookings where manage_token=current_setting('minuta.v122.token')::uuid),true);
set local role anon;
select set_config('minuta.v122.first',public.reschedule_booking_v2(current_setting('minuta.v122.token')::uuid,
  current_setting('minuta.v122.date')::date,'11:00'::time,'00000000-0000-4000-8000-000000122001'),true);
select set_config('minuta.v122.second',public.reschedule_booking_v2(current_setting('minuta.v122.token')::uuid,
  current_setting('minuta.v122.date')::date,'11:00'::time,'00000000-0000-4000-8000-000000122001'),true);
do $$ begin
  if current_setting('minuta.v122.first')<>'V122-SYNTHETIC-RECEIPT'
    or current_setting('minuta.v122.second')<>current_setting('minuta.v122.first')
    or current_setting('minuta.v122.calls')::integer<>1 then raise exception 'v122_replay_invoked_mutation_twice'; end if;
  begin
    perform public.reschedule_booking_v2(current_setting('minuta.v122.token')::uuid,current_setting('minuta.v122.date')::date,'12:00'::time,'00000000-0000-4000-8000-000000122001');
    raise exception 'v122_conflict_accepted';
  exception when sqlstate 'P0001' then if sqlerrm<>'request_conflict' then raise; end if; end;
  begin
    perform public.reschedule_booking_v2('00000000-0000-4000-8000-000000122099',current_setting('minuta.v122.date')::date,'11:00'::time,'00000000-0000-4000-8000-000000122001');
    raise exception 'v122_wrong_token_accepted';
  exception when sqlstate 'P0001' then if sqlerrm<>'booking_unavailable' then raise; end if; end;
  begin
    perform 1 from public.client_reschedule_requests;
    raise exception 'v122_receipts_publicly_readable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.client_reschedule_requests where request_id='00000000-0000-4000-8000-000000122001')<>1
    then raise exception 'v122_receipt_count_invalid'; end if;
end $$;
rollback;
