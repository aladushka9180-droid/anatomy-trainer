-- Reversible traffic rollback. Preserve route/evidence journals and bookings.
-- A new route cannot be called by browser roles after this transaction.
begin;
revoke all on function public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;
comment on function public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)
  is 'minuta:v176:multi-resource-route:disabled-by-rollback; journals preserved';
notify pgrst,'reload schema';
commit;
