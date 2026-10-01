-- Server-only entry point for a single-location multi-performer visit.
-- Requires v188. Cross-location v176 remains closed to service_role.
begin;

do $$
begin
  if to_regprocedure('public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)') is null then
    raise exception 'multi_resource_v176_required';
  end if;
end
$$;

create or replace function public.book_minuta_same_location_route_v189(
  p_request_id uuid,
  p_client_name text,
  p_client_phone text,
  p_items jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_organization text;
  v_location text;
begin
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) not between 2 and 6 then
    raise exception using errcode='22023',message='same_location_route_size_invalid';
  end if;
  v_organization:=lower(trim(p_items->0->>'organization_slug'));
  v_location:=p_items->0->>'location_id';
  if v_organization is null or v_organization=''
     or v_location is null or v_location=''
     or exists (
       select 1 from jsonb_array_elements(p_items) item
       where lower(trim(item->>'organization_slug')) is distinct from v_organization
          or item->>'location_id' is distinct from v_location
     ) then
    raise exception using errcode='22023',message='same_location_route_scope_invalid';
  end if;
  return public.book_minuta_multi_resource_route_v176(
    p_request_id,p_client_name,p_client_phone,p_items,'[]'::jsonb
  );
end
$$;

revoke all on function public.book_minuta_same_location_route_v189(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.book_minuta_same_location_route_v189(uuid,text,text,jsonb)
  to service_role;
comment on function public.book_minuta_same_location_route_v189(uuid,text,text,jsonb)
  is 'minuta:v189:same-location-multi-resource:service-role-only';

notify pgrst,'reload schema';
commit;
