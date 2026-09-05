\set ON_ERROR_STOP on
do $transaction$ begin
  if current_setting('session_replication_role')<>'replica'
     or to_regclass('pg_temp.crm_preserved_auth_triggers') is null then
    raise exception 'test_restore_transaction_context_missing';
  end if;
end $transaction$;
-- pg_dump --no-privileges does NOT retain the anonymizer's REVOKEs. Seal the
-- schema before COMMIT; subsequent named CRM migrations grant only their RPCs.
revoke all on schema public from public,anon,authenticated,service_role;
revoke all on all tables in schema public from public,anon,authenticated,service_role;
revoke all on all sequences in schema public from public,anon,authenticated,service_role;
revoke all on all routines in schema public from public,anon,authenticated,service_role;
alter default privileges in schema public revoke all on functions from public;
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;
grant usage on schema public to authenticated,service_role;
do $verified$
begin
  -- Preserve signup semantics as well as OIDs. CREATE OR REPLACE alone does
  -- not prove compatibility: a changed handler must fail and be reviewed.
  if (select count(*) from crm_preserved_auth_triggers)<>
     (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where c.relnamespace='auth'::regnamespace and not t.tgisinternal) then
    raise exception 'auth_trigger_set_changed_during_restore';
  end if;
  if exists (
    select 1 from crm_preserved_auth_triggers saved
    left join pg_trigger current on current.oid=saved.oid
    left join pg_proc p on p.oid=current.tgfoid
    where current.oid is null or current.tgname<>saved.tgname
      or current.tgfoid<>saved.tgfoid or current.tgenabled<>saved.tgenabled
      or pg_get_triggerdef(current.oid) is distinct from saved.definition
      or pg_get_functiondef(p.oid) is distinct from saved.function_definition
      or p.proconfig is distinct from saved.proconfig
      or p.prosecdef is distinct from saved.prosecdef
      or p.proowner is distinct from saved.proowner
  ) then raise exception 'auth_trigger_changed_during_restore'; end if;
  if (select count(*) from crm_preserved_event_triggers)<>(select count(*) from pg_event_trigger)
  or exists (
    select 1 from crm_preserved_event_triggers saved
    left join pg_event_trigger current on current.oid=saved.oid
    left join pg_proc p on p.oid=current.evtfoid
    where current.oid is null or current.evtfoid<>saved.evtfoid
      or current.evtenabled<>saved.evtenabled
      or current.evtname is distinct from saved.evtname
      or current.evtevent is distinct from saved.evtevent
      or current.evttags is distinct from saved.evttags
      or current.evtowner is distinct from saved.evtowner
      or p.proowner is distinct from saved.proowner
      or pg_get_functiondef(p.oid) is distinct from saved.definition
  ) then raise exception 'event_trigger_changed_during_restore'; end if;
  if exists(select 1 from public.organizations where public_booking_enabled)
     or exists(select 1 from public.client_device_sessions)
     or exists(select 1 from public.client_telegram_subscriptions)
     or exists(select 1 from public.notification_recipient_endpoints)
     or exists(select 1 from public.notification_outbox)
     or exists(select 1 from public.organization_notification_settings where enabled)
     or exists(select 1 from public.organization_notification_channels where enabled)
     or exists(select 1 from vault.secrets)
     or exists(select 1 from net.http_request_queue)
     or exists(select 1 from cron.job) then
    raise exception 'restored_snapshot_is_not_isolated';
  end if;
  -- Same phone contract as the anonymizer, including blocked-slot sentinel.
  -- Format alone does not prove anonymization; the verified artifact is required.
  if exists(select 1 from public.bookings
            where client_phone is null
               or (client_phone<>'0000000000' and client_phone !~ '^7[0-9]{10}$')
               or payment_url is distinct from '' or provider_note is distinct from '')
     or exists(select 1 from public.client_accounts
               where normalized_phone is null or normalized_phone !~ '^7[0-9]{10}$')
     or exists(select 1 from public.booking_series
               where client_phone is null
                  or (client_phone<>'0000000000' and client_phone !~ '^7[0-9]{10}$')) then
    raise exception 'restored_snapshot_anonymization_invariant_failed';
  end if;
end
$verified$;
update minuta_restore_guard.target set allow_destructive_restore=false
where project_ref='umazhvvxutnsyuphbhda';
set local session_replication_role=origin;
