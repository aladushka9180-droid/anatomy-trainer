begin;
drop function if exists public.upsert_minuta_inventory_item_catalog(uuid,uuid,text,text,text,numeric,boolean,text,text);
drop function if exists public.get_minuta_inventory_workspace_catalog(uuid);
-- Category/icon columns and their values remain for a safe reapply.
notify pgrst,'reload schema';
commit;
