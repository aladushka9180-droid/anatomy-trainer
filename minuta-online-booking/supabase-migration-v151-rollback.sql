-- Roll back v151 selectable-seller commercial RPCs without touching v147/v148 data or refund behavior.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

drop function if exists public.get_minuta_commerce_workspace_v151(uuid);
drop function if exists public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid);

commit;
