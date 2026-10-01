-- Stop new same-location traffic without deleting route journals or bookings.
begin;
revoke all on function public.book_minuta_same_location_route_v189(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
comment on function public.book_minuta_same_location_route_v189(uuid,text,text,jsonb)
  is 'minuta:v189:same-location-multi-resource:disabled-by-rollback';
notify pgrst,'reload schema';
commit;
