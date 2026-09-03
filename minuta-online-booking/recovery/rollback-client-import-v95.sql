begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.organization_imported_clients') is not null
     and exists(select 1 from public.organization_imported_clients) then
    raise exception using errcode='P0001',message='v95_rollback_blocked_imported_clients_exist';
  end if;
  if to_regclass('public.client_import_batches') is not null
     and exists(select 1 from public.client_import_batches) then
    raise exception using errcode='P0001',message='v95_rollback_blocked_import_batches_exist';
  end if;
end $$;

drop function if exists public.get_minuta_imported_clients(uuid);
drop function if exists public.import_minuta_clients(uuid,text,jsonb,uuid);
drop table if exists public.organization_imported_clients;
drop table if exists public.client_import_batches;

commit;
