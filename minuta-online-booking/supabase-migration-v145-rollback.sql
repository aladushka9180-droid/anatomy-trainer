\set ON_ERROR_STOP on

-- Test/recovery rollback only. Existing visits and the v98 compatibility RPC
-- are retained; only the new atomic paid-visit overload is removed.
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';

drop function if exists public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text,integer,text,integer
);

notify pgrst,'reload schema';
commit;
