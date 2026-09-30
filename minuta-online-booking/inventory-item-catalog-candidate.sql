begin;

set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.inventory_items') is null
     or to_regprocedure('public.get_minuta_inventory_workspace_v130(uuid)') is null
     or to_regprocedure('public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean)') is null then
    raise exception using errcode='P0001',message='inventory_catalog_requires_v82_and_v130';
  end if;
end $$;

alter table public.inventory_items add column if not exists category text;
alter table public.inventory_items add column if not exists icon text;

do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.inventory_items'::regclass and conname='inventory_items_category_optional_check') then
    alter table public.inventory_items add constraint inventory_items_category_optional_check
      check(category is null or (char_length(category) between 1 and 60 and category=btrim(category)));
  end if;
  if not exists(select 1 from pg_constraint where conrelid='public.inventory_items'::regclass and conname='inventory_items_icon_optional_check') then
    alter table public.inventory_items add constraint inventory_items_icon_optional_check
      check(icon is null or icon in ('bottle','box','tools','care'));
  end if;
end $$;

create or replace function public.get_minuta_inventory_workspace_catalog(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_base jsonb; v_items jsonb;
begin
  v_base:=public.get_minuta_inventory_workspace_v130(p_organization);
  select coalesce(jsonb_agg(entry.item_data || jsonb_build_object('category',item.category,'icon',item.icon) order by entry.position),'[]'::jsonb)
    into v_items
    from jsonb_array_elements(v_base->'items') with ordinality as entry(item_data,position)
    join public.inventory_items item on item.id=(entry.item_data->>'id')::uuid and item.organization_id=p_organization;
  return v_base||jsonb_build_object('catalog_version',1,'items',v_items);
end $$;
revoke all on function public.get_minuta_inventory_workspace_catalog(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_inventory_workspace_catalog(uuid) to authenticated;

create or replace function public.upsert_minuta_inventory_item_catalog(
  p_organization uuid,p_item uuid,p_name text,p_sku text,p_unit text,p_low_stock numeric,p_active boolean,
  p_category text,p_icon text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_category text; v_icon text; v_saved jsonb;
begin
  v_category:=nullif(btrim(p_category),'');
  v_icon:=nullif(btrim(p_icon),'');
  if char_length(v_category)>60 or (v_icon is not null and v_icon not in ('bottle','box','tools','care')) then
    raise exception using errcode='22023',message='invalid_inventory_catalog_metadata';
  end if;
  v_saved:=public.upsert_minuta_inventory_item(p_organization,p_item,p_name,p_sku,p_unit,p_low_stock,p_active);
  update public.inventory_items set category=v_category,icon=v_icon
    where id=(v_saved->>'id')::uuid and organization_id=p_organization;
  return v_saved||jsonb_build_object('category',v_category,'icon',v_icon);
end $$;
revoke all on function public.upsert_minuta_inventory_item_catalog(uuid,uuid,text,text,text,numeric,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_inventory_item_catalog(uuid,uuid,text,text,text,numeric,boolean,text,text) to authenticated;

do $$ begin
  if has_function_privilege('anon','public.get_minuta_inventory_workspace_catalog(uuid)','EXECUTE')
     or has_function_privilege('anon','public.upsert_minuta_inventory_item_catalog(uuid,uuid,text,text,text,numeric,boolean,text,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_minuta_inventory_workspace_catalog(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.upsert_minuta_inventory_item_catalog(uuid,uuid,text,text,text,numeric,boolean,text,text)','EXECUTE') then
    raise exception using errcode='P0001',message='inventory_catalog_grants_invalid';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
