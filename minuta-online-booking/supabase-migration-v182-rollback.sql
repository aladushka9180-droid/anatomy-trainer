-- Schema rollback for an isolated test or an unused production contract only.
-- With accepted requests, roll back the UI instead and keep the replay ledger.
begin;

do $$ begin
  if exists(select 1 from public.inventory_catalog_requests_v182) then
    raise exception using errcode='55000',message='v182_catalog_requests_must_be_preserved';
  end if;
end $$;

drop function if exists public.save_minuta_inventory_item_draft_v182(
  uuid,uuid,uuid,text,text,text,text,numeric,boolean
);
drop function if exists public.get_minuta_inventory_workspace_v182(uuid);
drop function if exists public.minuta_inventory_catalog_etag_v182(text,text,text,numeric,boolean);
drop table if exists public.inventory_catalog_requests_v182;

commit;
