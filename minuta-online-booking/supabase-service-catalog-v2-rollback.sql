-- Deploy the previous UI before rollback. Do not remove referenced catalogs or user rows.
-- Keep the small RPC compatibility fix: cached v1 clients must preserve selected v2-only professions.
begin;
set local lock_timeout='5s';
lock table public.minuta_professions_v160, public.minuta_service_presets_v160 in share row exclusive mode;
update public.minuta_service_presets_v160 set active=false where catalog_version=2 and locale='ru-RU';
update public.minuta_professions_v160 set active=false where catalog_version=2 and locale='ru-RU';
commit;
