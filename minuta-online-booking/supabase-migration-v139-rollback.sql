\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
drop function if exists public.get_primetime_schedule_v139(jsonb);
drop function if exists public.get_primetime_slot_ranges_v139(text,uuid,uuid,date,date,text);
drop function if exists public.get_primetime_slot_step_v139(uuid,date);
notify pgrst,'reload schema';
commit;
