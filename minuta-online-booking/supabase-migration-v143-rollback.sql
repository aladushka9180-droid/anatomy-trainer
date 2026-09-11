\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
drop function if exists public.reschedule_minuta_provider_booking_v143(uuid,date,time without time zone,date,time without time zone);
notify pgrst,'reload schema';
commit;
