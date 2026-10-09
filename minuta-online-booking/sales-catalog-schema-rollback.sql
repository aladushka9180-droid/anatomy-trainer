-- Destructive contraction is refused after any imported metadata, favorites,
-- bundles, request or sale exists. Operational rollback is the supported path then.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
do $rollback_guard$
declare t text;p record;backup public.sales_catalog_candidate_state%rowtype;installed regprocedure;
begin
  -- Serialize with every writer at the state gate before checking emptiness.
  lock table public.sales_catalog_candidate_state in access exclusive mode;
  foreach t in array array['sales_catalog_items_candidate','sales_catalog_bundles_candidate','sales_catalog_favorites_candidate',
    'sales_catalog_requests_candidate','sales_carts_candidate','sales_cart_lines_candidate'] loop
    execute format('lock table public.%I in access exclusive mode',t);
    if exists(select 1 from pg_class where oid=('public.'||t)::regclass) then
      execute format('select exists(select 1 from public.%I)',t) into p;
      if p.exists then raise exception using errcode='55000',message='sales_catalog_rollback_has_dependent_data';end if;
    end if;
  end loop;
  for p in select pr.oid,pr.prosrc from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
    where n.nspname='public' and pr.proname=any(array['require_minuta_sales_candidate','protect_minuta_sales_candidate',
      'normalize_minuta_sales_import_candidate','persist_minuta_sales_import_candidate','save_minuta_sales_item_candidate','expand_minuta_sales_lines_candidate','get_minuta_sales_catalog_candidate',
      'get_minuta_sales_cart_candidate','get_minuta_sales_repeat_candidate','get_minuta_sales_history_candidate',
      'sell_minuta_inventory_cart_candidate','preview_minuta_sales_import_candidate','commit_minuta_sales_import_candidate',
      'save_minuta_sales_bundle_candidate','set_minuta_sales_favorite_candidate']) loop
    if obj_description(p.oid,'pg_proc') is distinct from 'sales-catalog-candidate:md5='||md5(p.prosrc) then
      raise exception using errcode='55000',message='sales_catalog_candidate_function_drift';end if;
  end loop;
  installed:='public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure;
  select * into backup from public.sales_catalog_candidate_state where singleton;
  if (select proacl::text from pg_proc where oid=installed) is distinct from backup.legacy_refund_acl
    or obj_description(installed,'pg_proc') is distinct from 'sales-catalog-candidate-refund:md5='||(select md5(prosrc) from pg_proc where oid=installed) then
    raise exception using errcode='55000',message='sales_catalog_refund_drift';end if;
  execute backup.legacy_refund_definition;
  execute format('comment on function %s is %L',installed,backup.legacy_refund_comment);
end $rollback_guard$;
drop table public.sales_cart_lines_candidate;
drop table public.sales_carts_candidate;
drop table public.sales_catalog_requests_candidate;
drop table public.sales_catalog_favorites_candidate;
drop table public.sales_catalog_bundles_candidate;
drop table public.sales_catalog_items_candidate;
do $drop_functions$
declare p record;
begin
  for p in select pr.oid::regprocedure signature from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
    where n.nspname='public' and pr.proname=any(array['require_minuta_sales_candidate','protect_minuta_sales_candidate',
      'normalize_minuta_sales_import_candidate','persist_minuta_sales_import_candidate','save_minuta_sales_item_candidate','expand_minuta_sales_lines_candidate','get_minuta_sales_catalog_candidate',
      'get_minuta_sales_cart_candidate','get_minuta_sales_repeat_candidate','get_minuta_sales_history_candidate',
      'sell_minuta_inventory_cart_candidate','preview_minuta_sales_import_candidate','commit_minuta_sales_import_candidate',
      'save_minuta_sales_bundle_candidate','set_minuta_sales_favorite_candidate']) loop
    execute format('drop function %s',p.signature);
  end loop;
end $drop_functions$;
drop table public.sales_catalog_candidate_state;
commit;
