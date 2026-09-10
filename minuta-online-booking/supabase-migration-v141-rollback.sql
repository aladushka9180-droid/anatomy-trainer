\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
drop function if exists public.update_provider_block_v141(uuid,date,time without time zone,integer,date,time without time zone,integer,text,text);
drop function if exists public.create_provider_block_v141(uuid,uuid,date,time without time zone,integer,uuid,text,text);
drop function if exists public.get_provider_block_slots_v141(uuid,uuid,date,integer,uuid);
drop function if exists public.minuta_block_slot_valid_v141(uuid,uuid,date,time without time zone,integer,uuid);
drop function if exists public.ensure_minuta_block_service_v141();
notify pgrst,'reload schema';
commit;

