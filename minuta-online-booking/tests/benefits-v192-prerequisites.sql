-- Synthetic prerequisite functions; no user records or secrets.
create or replace function public.has_organization_role(p_organization uuid,p_roles text[])
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_memberships m join public.organizations o
 on o.id=m.organization_id and o.status='active'
 where m.organization_id=p_organization and m.user_id=auth.uid() and m.active and m.role=any(p_roles))
$$;
create or replace function public.minuta_financial_sha256_v129(p_value jsonb)
returns text language sql immutable security definer set search_path='' as $$
 select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;
create or replace function public.get_minuta_benefit_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_role text;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication_required';end if;
 select m.role into v_role from public.organization_memberships m join public.organizations o
 on o.id=m.organization_id and o.status='active'
 where m.organization_id=p_organization and m.user_id=auth.uid() and m.active;
 if v_role is null or v_role not in ('owner','admin') then
  raise exception using errcode='42501',message='benefit_management_denied';
 end if;
 return v_role;
end $$;
