select json_build_object(
  'bookings',(select count(*) from public.bookings),
  'organizations',(select count(*) from public.organizations),
  'locations',(select count(*) from public.locations),
  'services',(select count(*) from public.services),
  'memberships',(select count(*) from public.organization_memberships)
);
