-- Schema rollback for an isolated test or an unused production contract only.
-- With accepted requests, roll back the UI instead and keep the replay ledger.
begin;

do $$ begin
  if exists(select 1 from public.inventory_catalog_requests_v186) then
    raise exception using errcode='55000',message='v186_catalog_requests_must_be_preserved';
  end if;
end $$;

drop function if exists public.save_minuta_inventory_item_draft_v186(
  uuid,uuid,uuid,text,text,text,text,numeric,boolean
);
drop function if exists public.get_minuta_inventory_workspace_v186(uuid);
drop function if exists public.minuta_inventory_catalog_etag_v186(text,text,text,numeric,boolean);
drop table if exists public.inventory_catalog_requests_v186;

notify pgrst,'reload schema';
commit;
