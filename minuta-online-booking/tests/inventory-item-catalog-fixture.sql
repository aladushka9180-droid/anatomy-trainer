-- Synthetic predecessor contract for the isolated O24 PostgreSQL 17 job.
-- The release gate must also run against a restored current schema.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
create table auth.users(id uuid primary key,instance_id uuid,aud text,role text,email text,
  email_confirmed_at timestamptz,raw_app_meta_data jsonb,raw_user_meta_data jsonb,
  created_at timestamptz,updated_at timestamptz);
create table public.performer_profiles(id uuid primary key references auth.users(id),display_name text);
create table public.organizations(id uuid primary key,name text,created_by uuid references auth.users(id),status text);
create table public.locations(id uuid primary key,organization_id uuid references public.organizations(id),
  name text,timezone text,is_primary boolean,active boolean);
create table public.organization_memberships(organization_id uuid references public.organizations(id),
  user_id uuid references auth.users(id),role text,is_bookable boolean,active boolean);
create table public.organization_inventory_settings(organization_id uuid primary key references public.organizations(id),
  enabled boolean,auto_deduct_completed_visits boolean);
create table public.inventory_items(id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),name text not null,sku text not null default '',
  unit text not null,low_stock_threshold numeric(14,3) not null default 0,active boolean not null default true,
  created_by uuid references auth.users(id));
create table public.inventory_audit_log(id bigint generated always as identity primary key,
  organization_id uuid not null,actor_id uuid,action text,subject_id uuid,details jsonb);

create function public.get_minuta_inventory_role(p_organization uuid) returns text
language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  select membership.role into v_role from public.organization_memberships membership
    join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
    where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if coalesce(v_role,'') not in ('owner','admin') then
    raise exception using errcode='42501',message='inventory_management_denied';
  end if;
  return v_role;
end $$;

create function public.upsert_minuta_inventory_item(p_organization uuid,p_item uuid,p_name text,p_sku text,
  p_unit text,p_low_stock numeric,p_active boolean) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_id uuid;
begin
  perform public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120
    or coalesce(p_unit,'') not in ('piece','ml','g','kg','l','pack') or coalesce(p_low_stock,-1)<0 then
    raise exception using errcode='22023',message='invalid_inventory_item';
  end if;
  if p_item is null then
    insert into public.inventory_items(organization_id,name,sku,unit,low_stock_threshold,active,created_by)
      values(p_organization,trim(p_name),trim(coalesce(p_sku,'')),p_unit,p_low_stock,coalesce(p_active,true),auth.uid())
      returning id into v_id;
  else
    update public.inventory_items set name=trim(p_name),sku=trim(coalesce(p_sku,'')),unit=p_unit,
      low_stock_threshold=p_low_stock,active=coalesce(p_active,true)
      where id=p_item and organization_id=p_organization returning id into v_id;
    if v_id is null then raise exception using errcode='P0002',message='inventory_item_not_found'; end if;
  end if;
  insert into public.inventory_audit_log(organization_id,actor_id,action,subject_id,details)
    values(p_organization,auth.uid(),'inventory_item_saved',v_id,'{}'::jsonb);
  return jsonb_build_object('organization_id',p_organization,'id',v_id);
end $$;

create function public.get_minuta_inventory_workspace_v130(p_organization uuid) returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  return jsonb_build_object('organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'transfer_version',130,'transfer_documents','[]'::jsonb,
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name,'sku',item.sku,
      'unit',item.unit,'low_stock_threshold',item.low_stock_threshold,'active',item.active)
      order by item.active desc,item.name,item.id)
      from public.inventory_items item where item.organization_id=p_organization),'[]'::jsonb));
end $$;

revoke all on function public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_inventory_workspace_v130(uuid) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean) to authenticated;
grant execute on function public.get_minuta_inventory_workspace_v130(uuid) to authenticated;
grant usage on schema public,auth to authenticated;
grant select on public.inventory_items to authenticated;
grant select on public.organization_memberships to authenticated;
alter table public.inventory_items enable row level security;
create policy inventory_item_org_read on public.inventory_items for select to authenticated using (
  exists(select 1 from public.organization_memberships membership
    where membership.organization_id=inventory_items.organization_id
      and membership.user_id=auth.uid() and membership.active));
