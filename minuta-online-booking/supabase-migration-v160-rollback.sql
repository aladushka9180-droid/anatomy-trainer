-- Roll back v160 only before any provider has saved profession choices or a request.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.minuta_professions_v160') is null
     or to_regclass('public.minuta_service_presets_v160') is null
     or to_regclass('public.minuta_performer_professions_v160') is null
     or to_regclass('public.minuta_service_preset_requests_v160') is null
     or to_regprocedure('public.minuta_normalize_service_name_v160(text)') is null
     or to_regprocedure('public.prevent_duplicate_service_name_v160()') is null
     or to_regprocedure('public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)') is null
     or to_regprocedure('public.get_provider_service_preset_catalog_v160(integer)') is null
     or to_regprocedure('public.get_provider_service_preset_state_v160()') is null
     or not exists(select 1 from pg_trigger where tgname='services_prevent_duplicate_name_v160' and not tgisinternal)
     or to_regclass('public.services_normalized_name_v160_idx') is null then
    raise exception using errcode='55000',message='v160_rollback_requires_exact_schema';
  end if;
  if exists(select 1 from public.minuta_service_preset_requests_v160)
     or exists(select 1 from public.minuta_performer_professions_v160) then
    raise exception using errcode='55000',message='v160_rollback_blocked_provider_state_exists';
  end if;
end
$guard$;

drop function public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb);
drop function public.get_provider_service_preset_state_v160();
drop function public.get_provider_service_preset_catalog_v160(integer);
drop trigger services_prevent_duplicate_name_v160 on public.services;
drop function public.prevent_duplicate_service_name_v160();
drop index public.services_normalized_name_v160_idx;
drop table public.minuta_service_preset_requests_v160;
drop table public.minuta_performer_professions_v160;
drop table public.minuta_service_presets_v160;
drop table public.minuta_professions_v160;
drop function public.minuta_normalize_service_name_v160(text);

commit;
