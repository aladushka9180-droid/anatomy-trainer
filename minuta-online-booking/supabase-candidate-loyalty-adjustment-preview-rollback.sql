begin;
set local search_path=public,extensions,pg_catalog;
revoke all on function public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)
  from public,anon,authenticated,service_role;
drop function public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid);
drop function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer);
notify pgrst,'reload schema';
commit;
