CREATE OR REPLACE FUNCTION public.has_organization_role(p_organization uuid, p_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.organization_memberships membership
    join public.organizations organization
      on organization.id = membership.organization_id
     and organization.status = 'active'
    where membership.organization_id = p_organization
      and membership.user_id = auth.uid()
      and membership.active
      and membership.role = any (p_roles)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.minuta_financial_sha256_v129(p_value jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$function$
;