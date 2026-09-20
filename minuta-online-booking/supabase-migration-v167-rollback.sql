begin;
set local search_path=public,extensions,pg_catalog;

revoke all on function public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
drop function if exists public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb);

-- Operational rollback is disable-only: ordinary bookings and the route journal
-- remain intact for recovery, audit and an idempotent later re-enable.
revoke all on table public.public_multi_service_routes_v167,public.public_multi_service_route_items_v167
  from public,anon,authenticated,service_role;
grant all on table public.public_multi_service_routes_v167,public.public_multi_service_route_items_v167 to service_role;

notify pgrst,'reload schema';
commit;
