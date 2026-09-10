\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.integration_connections_v142') is not null and (
    exists(select 1 from public.integration_connections_v142)
    or exists(select 1 from public.integration_api_keys_v142)
    or exists(select 1 from public.integration_calendar_events_v142)
    or exists(select 1 from public.integration_request_receipts_v142)
    or exists(select 1 from public.integration_webhook_subscriptions_v142)
    or exists(select 1 from public.integration_webhook_outbox_v142)
  ) then
    raise exception using errcode='55000',message='v142_rollback_blocked_integration_data_exists',
      hint='Disable integrations and export or explicitly remove their v142 data before schema rollback.';
  end if;
end
$guard$;

drop trigger if exists bookings_integration_webhook_v142 on public.bookings;
drop trigger if exists aa_bookings_touch_integration_revision_v142 on public.bookings;
drop function if exists public.settle_minuta_integration_webhook_v142(uuid,uuid,text,integer,text);
drop function if exists public.lease_minuta_integration_webhooks_v142(integer,uuid);
drop function if exists public.enqueue_minuta_integration_booking_webhooks_v142();
drop function if exists public.touch_minuta_integration_booking_revision_v142();
drop function if exists public.delete_minuta_integration_calendar_event_v142(uuid,text,text,text,text);
drop function if exists public.upsert_minuta_integration_calendar_event_v142(uuid,text,text,text,uuid,uuid,timestamptz,timestamptz,text,text);
drop function if exists public.get_minuta_integration_calendar_v142(uuid,timestamptz,timestamptz,integer,timestamptz,uuid);
drop function if exists public.minuta_integration_calendar_snapshot_v142(uuid,text);
drop function if exists public.ensure_minuta_integration_block_service_v142(uuid);
drop function if exists public.consume_minuta_integration_rate_limit_v142(uuid,uuid,text);
drop function if exists public.authenticate_minuta_integration_key_v142(uuid,text,text,text);
drop function if exists public.put_minuta_integration_webhook_v142(uuid,uuid,text,text,text[],boolean);
drop function if exists public.revoke_minuta_integration_api_key_v142(uuid);
drop function if exists public.put_minuta_integration_api_key_v142(uuid,uuid,text,text,text[],timestamptz);
drop function if exists public.configure_minuta_integration_connection_v142(uuid,uuid,text,text,text,boolean);
drop function if exists public.require_minuta_integration_owner_v142(uuid);

drop table if exists public.integration_webhook_outbox_v142;
drop table if exists public.integration_webhook_subscriptions_v142;
drop table if exists public.integration_request_receipts_v142;
drop table if exists public.integration_calendar_events_v142;
drop table if exists public.integration_booking_revisions_v142;
drop table if exists public.integration_rate_limits_v142;
drop table if exists public.integration_api_keys_v142;
drop table if exists public.integration_connections_v142;

notify pgrst,'reload schema';
commit;
