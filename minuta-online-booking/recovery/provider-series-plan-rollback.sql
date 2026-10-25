-- Disable the additive API. Preserve series, occurrences and retry receipts.
begin;
drop function if exists public.create_provider_series_plan(uuid,uuid,text,text,integer,jsonb,integer,uuid,uuid,uuid,text,integer,text,text,text);
drop function if exists public.get_provider_series_slots(uuid,date,integer,uuid,uuid,uuid);
drop function if exists public.minuta_provider_series_context(uuid,integer,uuid,uuid,uuid);
drop function if exists public.minuta_series_slot_valid(uuid,uuid,uuid,date,time,integer);
notify pgrst,'reload schema';
commit;
