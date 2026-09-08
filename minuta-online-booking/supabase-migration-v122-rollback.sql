begin;
drop function if exists public.save_provider_portfolio_item(uuid,timestamptz,jsonb,jsonb);
-- A rollback may not destroy identities already used by client recovery.
do $$ begin
  if exists(select 1 from public.client_reschedule_requests) then
    raise exception 'v122_rollback_blocked_by_reschedule_receipts';
  end if;
end $$;
drop function if exists public.reschedule_booking_v2(uuid,date,time without time zone,uuid);
drop table if exists public.client_reschedule_requests;
notify pgrst,'reload schema';
commit;
