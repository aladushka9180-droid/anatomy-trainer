-- Candidate only. Apply to isolated PostgreSQL first; production requires a separate release gate.
begin;

set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regprocedure('public.get_minuta_inventory_workspace_v130(uuid)') is null
     or to_regprocedure('public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean)') is null
     or to_regclass('public.inventory_items') is null then
    raise exception using errcode='P0001',message='v181_requires_inventory_v130';
  end if;
end $$;

create table if not exists public.inventory_catalog_requests_v181 (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id,request_id)
);
alter table public.inventory_catalog_requests_v181 enable row level security;
revoke all on public.inventory_catalog_requests_v181 from public,anon,authenticated;
grant all on public.inventory_catalog_requests_v181 to service_role;

create or replace function public.get_minuta_inventory_workspace_v181(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_base jsonb;
begin
  v_base:=public.get_minuta_inventory_workspace_v130(p_organization);
  return jsonb_set(v_base,'{items}',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',item.id,'name',item.name,'sku',item.sku,'unit',item.unit,
      'low_stock_threshold',item.low_stock_threshold,'active',item.active,
      'updated_at',item.updated_at
    ) order by item.active desc,item.name,item.id)
    from public.inventory_items item where item.organization_id=p_organization
  ),'[]'::jsonb));
end $$;
revoke all on function public.get_minuta_inventory_workspace_v181(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_inventory_workspace_v181(uuid) to authenticated;

create or replace function public.save_minuta_inventory_item_draft_v181(
  p_organization uuid,p_request_id uuid,p_item uuid,p_expected_updated_at timestamptz,
  p_name text,p_sku text,p_unit text,p_low_stock numeric,p_active boolean
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_hash text; v_prior public.inventory_catalog_requests_v181%rowtype;
  v_current timestamptz; v_saved jsonb; v_result jsonb;
begin
  perform public.get_minuta_inventory_role(p_organization);
  if p_request_id is null then raise exception using errcode='22023',message='inventory_catalog_request_required'; end if;
  if p_item is null and p_expected_updated_at is not null then
    raise exception using errcode='22023',message='inventory_catalog_expected_version_invalid';
  end if;
  v_hash:=md5(jsonb_build_array(p_item,p_expected_updated_at,btrim(coalesce(p_name,'')),
    btrim(coalesce(p_sku,'')),p_unit,p_low_stock,p_active)::text);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,181));
  select * into v_prior from public.inventory_catalog_requests_v181
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_prior.actor_id is distinct from auth.uid() or v_prior.payload_hash<>v_hash then
      raise exception using errcode='23505',message='inventory_catalog_request_mismatch';
    end if;
    select item.updated_at into v_current from public.inventory_items item
      where item.organization_id=p_organization and item.id=(v_prior.result->>'id')::uuid;
    if not found then
      return jsonb_build_object('saved',false,'reason','inventory_item_deleted',
        'organization_id',p_organization,'id',v_prior.result->>'id');
    end if;
    if v_current is distinct from (v_prior.result->>'updated_at')::timestamptz then
      return jsonb_build_object('saved',false,'reason','inventory_item_changed_after_save',
        'organization_id',p_organization,'id',v_prior.result->>'id');
    end if;
    return v_prior.result;
  end if;
  if p_item is not null then
    select item.updated_at into v_current from public.inventory_items item
      where item.id=p_item and item.organization_id=p_organization for update;
    if not found then raise exception using errcode='P0002',message='inventory_item_not_found'; end if;
    if p_expected_updated_at is null or v_current is distinct from p_expected_updated_at then
      raise exception using errcode='40001',message='inventory_catalog_version_conflict';
    end if;
  end if;
  v_saved:=public.upsert_minuta_inventory_item(p_organization,p_item,p_name,p_sku,p_unit,p_low_stock,p_active);
  select jsonb_build_object('organization_id',p_organization,'id',item.id,
    'updated_at',item.updated_at,'saved',true) into v_result
    from public.inventory_items item
    where item.organization_id=p_organization and item.id=(v_saved->>'id')::uuid;
  insert into public.inventory_catalog_requests_v181(organization_id,request_id,actor_id,payload_hash,result)
    values(p_organization,p_request_id,auth.uid(),v_hash,v_result);
  return v_result;
end $$;
revoke all on function public.save_minuta_inventory_item_draft_v181(uuid,uuid,uuid,timestamptz,text,text,text,numeric,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_inventory_item_draft_v181(uuid,uuid,uuid,timestamptz,text,text,text,numeric,boolean)
  to authenticated;

commit;
