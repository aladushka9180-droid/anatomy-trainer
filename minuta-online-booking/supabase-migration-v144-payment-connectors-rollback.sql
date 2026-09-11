\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if (to_regclass('public.payment_sandbox_ledgers_v144') is not null
      and exists(select 1 from public.payment_sandbox_ledgers_v144 limit 1))
     or (to_regclass('public.integration_provider_events_v144') is not null
      and exists(select 1 from public.integration_provider_events_v144 limit 1)) then
    raise exception using errcode='55000',message='v144_rollback_blocked_payment_or_provider_data_exists';
  end if;
end
$guard$;

drop function if exists public.get_minuta_provider_connector_read_model_v144(uuid,integer);
drop function if exists public.settle_minuta_provider_event_v144(uuid,text,jsonb,text);
drop function if exists public.record_minuta_provider_event_v144(uuid,uuid,text,text,text,jsonb);
drop function if exists public.get_minuta_payment_sandbox_journal_v144(uuid,uuid);
drop function if exists public.apply_minuta_payment_sandbox_v144(uuid,uuid,uuid,text,integer,text,bigint,text);

drop table if exists public.integration_provider_events_v144;
drop table if exists public.payment_sandbox_commands_v144;
drop table if exists public.payment_sandbox_ledgers_v144;

notify pgrst,'reload schema';
commit;
