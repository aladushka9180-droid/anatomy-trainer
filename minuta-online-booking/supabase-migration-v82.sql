begin;

set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.locations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.services') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='organization_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='location_id') then
    raise exception using errcode='P0001',message='v82_requires_organization_scoped_bookings_and_outcomes';
  end if;
end $$;

create table if not exists public.organization_inventory_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  auto_deduct_completed_visits boolean not null default true,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check(char_length(name) between 2 and 120),
  sku text not null default '' check(char_length(sku) <= 80),
  unit text not null check(unit in ('piece','ml','g','kg','l','pack')),
  low_stock_threshold numeric(14,3) not null default 0 check(low_stock_threshold >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id)
);

create unique index if not exists inventory_items_sku_scope_idx
  on public.inventory_items(organization_id,lower(sku)) where sku<>'';
create index if not exists inventory_items_scope_idx
  on public.inventory_items(organization_id,active,name,id);

create table if not exists public.inventory_warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  location_id uuid not null,
  name text not null check(char_length(name) between 2 and 120),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,location_id),
  foreign key(location_id,organization_id) references public.locations(id,organization_id) on delete restrict
);

create table if not exists public.inventory_service_usage (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  inventory_item_id uuid not null,
  quantity numeric(14,3) not null check(quantity > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,service_id,inventory_item_id),
  foreign key(inventory_item_id,organization_id) references public.inventory_items(id,organization_id) on delete restrict
);

create table if not exists public.inventory_stock_balances (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  warehouse_id uuid not null,
  inventory_item_id uuid not null,
  quantity numeric(14,3) not null default 0 check(quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key(organization_id,warehouse_id,inventory_item_id),
  foreign key(warehouse_id,organization_id) references public.inventory_warehouses(id,organization_id) on delete restrict,
  foreign key(inventory_item_id,organization_id) references public.inventory_items(id,organization_id) on delete restrict
);

create table if not exists public.inventory_movements (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  warehouse_id uuid not null,
  inventory_item_id uuid not null,
  booking_id uuid references public.bookings(id) on delete restrict,
  movement_type text not null check(movement_type in ('receipt','write_off','inventory','service_use')),
  quantity_delta numeric(14,3) not null,
  quantity_after numeric(14,3) not null check(quantity_after >= 0),
  request_id uuid not null,
  reason text not null default '' check(char_length(reason) <= 500),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(warehouse_id,organization_id) references public.inventory_warehouses(id,organization_id) on delete restrict,
  foreign key(inventory_item_id,organization_id) references public.inventory_items(id,organization_id) on delete restrict,
  unique(organization_id,request_id),
  check(quantity_delta <> 0 or movement_type='inventory')
);

create unique index if not exists inventory_service_use_once_idx
  on public.inventory_movements(booking_id,inventory_item_id) where movement_type='service_use';
create index if not exists inventory_movements_scope_idx
  on public.inventory_movements(organization_id,created_at desc,id desc);

create table if not exists public.inventory_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(char_length(action) between 1 and 80),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists inventory_audit_scope_idx
  on public.inventory_audit_log(organization_id,created_at desc,id desc);

create or replace function public.enforce_minuta_inventory_scope()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_table_name='inventory_service_usage' then
    if not exists(
      select 1 from public.services service
      join public.organization_memberships membership
        on membership.organization_id=new.organization_id and membership.user_id=service.performer_id
       and membership.active and membership.is_bookable
      where service.id=new.service_id
    ) then raise exception using errcode='23514',message='inventory_service_scope_mismatch'; end if;
  elsif tg_table_name='inventory_movements' and new.booking_id is not null then
    if not exists(select 1 from public.bookings booking where booking.id=new.booking_id and booking.organization_id=new.organization_id and booking.location_id=(select warehouse.location_id from public.inventory_warehouses warehouse where warehouse.id=new.warehouse_id)) then
      raise exception using errcode='23514',message='inventory_booking_scope_mismatch';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists inventory_service_usage_scope on public.inventory_service_usage;
create trigger inventory_service_usage_scope before insert or update on public.inventory_service_usage
for each row execute function public.enforce_minuta_inventory_scope();
drop trigger if exists inventory_movements_scope on public.inventory_movements;
create trigger inventory_movements_scope before insert on public.inventory_movements
for each row execute function public.enforce_minuta_inventory_scope();

alter table public.organization_inventory_settings enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_warehouses enable row level security;
alter table public.inventory_service_usage enable row level security;
alter table public.inventory_stock_balances enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_audit_log enable row level security;

do $$ declare v_table text;
begin
  foreach v_table in array array['organization_inventory_settings','inventory_items','inventory_warehouses','inventory_service_usage','inventory_stock_balances','inventory_movements','inventory_audit_log'] loop
    execute format('drop policy if exists inventory_manager_read on public.%I',v_table);
    execute format('create policy inventory_manager_read on public.%I for select to authenticated using (public.has_organization_role(organization_id,array[''owner'',''admin'']))',v_table);
  end loop;
end $$;

revoke all on public.organization_inventory_settings,public.inventory_items,public.inventory_warehouses,
  public.inventory_service_usage,public.inventory_stock_balances,public.inventory_movements,public.inventory_audit_log
  from public,anon,authenticated;
grant select on public.organization_inventory_settings,public.inventory_items,public.inventory_warehouses,
  public.inventory_service_usage,public.inventory_stock_balances,public.inventory_movements,public.inventory_audit_log
  to authenticated;
grant all on public.organization_inventory_settings,public.inventory_items,public.inventory_warehouses,
  public.inventory_service_usage,public.inventory_stock_balances,public.inventory_movements,public.inventory_audit_log
  to service_role;

drop trigger if exists organization_inventory_settings_touch on public.organization_inventory_settings;
create trigger organization_inventory_settings_touch before update on public.organization_inventory_settings
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists inventory_items_touch on public.inventory_items;
create trigger inventory_items_touch before update on public.inventory_items
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists inventory_warehouses_touch on public.inventory_warehouses;
create trigger inventory_warehouses_touch before update on public.inventory_warehouses
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists inventory_service_usage_touch on public.inventory_service_usage;
create trigger inventory_service_usage_touch before update on public.inventory_service_usage
for each row execute function public.touch_minuta_organization_updated_at();

create or replace function public.get_minuta_inventory_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if coalesce(v_role,'') not in ('owner','admin') then raise exception using errcode='42501',message='inventory_management_denied'; end if;
  return v_role;
end $$;
revoke all on function public.get_minuta_inventory_role(uuid) from public,anon,authenticated,service_role;

create or replace function public.write_minuta_inventory_audit(p_organization uuid,p_action text,p_subject uuid,p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to '' as $$
  insert into public.inventory_audit_log(organization_id,actor_id,action,subject_id,details)
  values(p_organization,auth.uid(),p_action,p_subject,coalesce(p_details,'{}'::jsonb));
$$;
revoke all on function public.write_minuta_inventory_audit(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.protect_minuta_inventory_ledger()
returns trigger language plpgsql set search_path to '' as $$
begin raise exception using errcode='55000',message='inventory_ledger_immutable'; end $$;
revoke all on function public.protect_minuta_inventory_ledger() from public,anon,authenticated,service_role;
drop trigger if exists inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
for each row execute function public.protect_minuta_inventory_ledger();
drop trigger if exists inventory_audit_immutable on public.inventory_audit_log;
create trigger inventory_audit_immutable before update or delete on public.inventory_audit_log
for each row execute function public.protect_minuta_inventory_ledger();

create or replace function public.set_minuta_inventory_settings(p_organization uuid,p_enabled boolean,p_auto_deduct boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='inventory_owner_required'; end if;
  insert into public.organization_inventory_settings(organization_id,enabled,auto_deduct_completed_visits,enabled_at,enabled_by)
  values(p_organization,coalesce(p_enabled,false),coalesce(p_auto_deduct,true),case when p_enabled then now() else null end,case when p_enabled then auth.uid() else null end)
  on conflict(organization_id) do update set enabled=excluded.enabled,auto_deduct_completed_visits=excluded.auto_deduct_completed_visits,
    enabled_at=case when excluded.enabled then coalesce(public.organization_inventory_settings.enabled_at,now()) else null end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_inventory_settings.enabled_by,auth.uid()) else null end;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_settings_changed',p_organization,jsonb_build_object('enabled',coalesce(p_enabled,false),'auto_deduct',coalesce(p_auto_deduct,true)));
  return jsonb_build_object('organization_id',p_organization,'enabled',coalesce(p_enabled,false),'auto_deduct_completed_visits',coalesce(p_auto_deduct,true));
end $$;
revoke all on function public.set_minuta_inventory_settings(uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_inventory_settings(uuid,boolean,boolean) to authenticated;

create or replace function public.upsert_minuta_inventory_item(p_organization uuid,p_item uuid,p_name text,p_sku text,p_unit text,p_low_stock numeric,p_active boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_id uuid;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='inventory_disabled'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120 or coalesce(p_unit,'') not in ('piece','ml','g','kg','l','pack') or coalesce(p_low_stock,-1)<0 then raise exception using errcode='22023',message='invalid_inventory_item'; end if;
  if p_item is null then
    insert into public.inventory_items(organization_id,name,sku,unit,low_stock_threshold,active,created_by)
    values(p_organization,trim(p_name),trim(coalesce(p_sku,'')),p_unit,p_low_stock,coalesce(p_active,true),auth.uid()) returning id into v_id;
  else
    if exists(select 1 from public.inventory_items item where item.id=p_item and item.organization_id=p_organization and item.unit<>p_unit)
       and exists(select 1 from public.inventory_movements movement where movement.organization_id=p_organization and movement.inventory_item_id=p_item) then
      raise exception using errcode='55000',message='inventory_unit_locked_by_ledger';
    end if;
    update public.inventory_items set name=trim(p_name),sku=trim(coalesce(p_sku,'')),unit=p_unit,low_stock_threshold=p_low_stock,active=coalesce(p_active,true)
    where id=p_item and organization_id=p_organization returning id into v_id;
    if v_id is null then raise exception using errcode='P0002',message='inventory_item_not_found'; end if;
  end if;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_item_saved',v_id,jsonb_build_object('active',coalesce(p_active,true),'unit',p_unit));
  return jsonb_build_object('organization_id',p_organization,'id',v_id);
end $$;
revoke all on function public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean) to authenticated;

create or replace function public.upsert_minuta_inventory_warehouse(p_organization uuid,p_warehouse uuid,p_location uuid,p_name text,p_active boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_id uuid;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='inventory_disabled'; end if;
  if coalesce(p_quantity,0)>0 and not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization and active) then raise exception using errcode='55000',message='inventory_target_inactive'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120 or not exists(select 1 from public.locations where id=p_location and organization_id=p_organization) then raise exception using errcode='22023',message='invalid_inventory_warehouse'; end if;
  if p_warehouse is null then
    insert into public.inventory_warehouses(organization_id,location_id,name,active,created_by)
    values(p_organization,p_location,trim(p_name),coalesce(p_active,true),auth.uid()) returning id into v_id;
  else
    if exists(select 1 from public.inventory_warehouses warehouse where warehouse.id=p_warehouse and warehouse.organization_id=p_organization and warehouse.location_id<>p_location)
       and exists(select 1 from public.inventory_movements movement where movement.organization_id=p_organization and movement.warehouse_id=p_warehouse) then
      raise exception using errcode='55000',message='inventory_warehouse_location_locked_by_ledger';
    end if;
    update public.inventory_warehouses set location_id=p_location,name=trim(p_name),active=coalesce(p_active,true)
    where id=p_warehouse and organization_id=p_organization returning id into v_id;
    if v_id is null then raise exception using errcode='P0002',message='inventory_warehouse_not_found'; end if;
  end if;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_warehouse_saved',v_id,jsonb_build_object('location_id',p_location,'active',coalesce(p_active,true)));
  return jsonb_build_object('organization_id',p_organization,'id',v_id);
end $$;
revoke all on function public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_inventory_warehouse(uuid,uuid,uuid,text,boolean) to authenticated;

create or replace function public.set_minuta_inventory_service_usage(p_organization uuid,p_service uuid,p_item uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='inventory_disabled'; end if;
  if coalesce(p_quantity,0)<=0 then
    delete from public.inventory_service_usage where organization_id=p_organization and service_id=p_service and inventory_item_id=p_item;
  else
    insert into public.inventory_service_usage(organization_id,service_id,inventory_item_id,quantity,created_by)
    values(p_organization,p_service,p_item,p_quantity,auth.uid())
    on conflict(organization_id,service_id,inventory_item_id) do update set quantity=excluded.quantity;
  end if;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_usage_saved',p_item,jsonb_build_object('service_id',p_service,'quantity',greatest(coalesce(p_quantity,0),0)));
  return jsonb_build_object('organization_id',p_organization,'service_id',p_service,'inventory_item_id',p_item);
end $$;
revoke all on function public.set_minuta_inventory_service_usage(uuid,uuid,uuid,numeric) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_inventory_service_usage(uuid,uuid,uuid,numeric) to authenticated;

create or replace function public.apply_minuta_stock_movement(p_organization uuid,p_warehouse uuid,p_item uuid,p_kind text,p_quantity numeric,p_counted_quantity numeric,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_before numeric(14,3); v_delta numeric(14,3); v_after numeric(14,3); v_existing public.inventory_movements%rowtype; v_movement bigint;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='inventory_disabled'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='inventory_request_id_required'; end if;
  if coalesce(p_kind,'') not in ('receipt','write_off','inventory') then raise exception using errcode='22023',message='invalid_inventory_movement'; end if;
  if not exists(select 1 from public.inventory_warehouses where id=p_warehouse and organization_id=p_organization and active)
     or not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization and active) then raise exception using errcode='55000',message='inventory_target_inactive'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8200));
  select * into v_existing from public.inventory_movements where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.warehouse_id<>p_warehouse or v_existing.inventory_item_id<>p_item or v_existing.movement_type<>p_kind
       or (p_kind='receipt' and v_existing.quantity_delta<>p_quantity)
       or (p_kind='write_off' and v_existing.quantity_delta<>-p_quantity)
       or (p_kind='inventory' and v_existing.quantity_after<>p_counted_quantity) then raise exception using errcode='23505',message='inventory_request_conflict'; end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'quantity_after',v_existing.quantity_after);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text||':'||p_item::text,8201));
  insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity) values(p_organization,p_warehouse,p_item,0) on conflict do nothing;
  select quantity into v_before from public.inventory_stock_balances where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item for update;
  if p_kind='inventory' then
    if coalesce(p_counted_quantity,-1)<0 then raise exception using errcode='22023',message='invalid_inventory_count'; end if;
    v_after:=p_counted_quantity; v_delta:=v_after-v_before;
  else
    if coalesce(p_quantity,0)<=0 then raise exception using errcode='22023',message='invalid_inventory_quantity'; end if;
    v_delta:=case when p_kind='receipt' then p_quantity else -p_quantity end; v_after:=v_before+v_delta;
  end if;
  if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock'; end if;
  if p_kind in ('write_off','inventory') and char_length(trim(coalesce(p_reason,'')))<2 then raise exception using errcode='22023',message='inventory_reason_required'; end if;
  update public.inventory_stock_balances set quantity=v_after,updated_at=now() where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item;
  insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,request_id,reason,actor_id)
  values(p_organization,p_warehouse,p_item,p_kind,v_delta,v_after,p_request_id,trim(coalesce(p_reason,'')),auth.uid()) returning id into v_movement;
  perform public.write_minuta_inventory_audit(p_organization,'inventory_movement_recorded',p_item,jsonb_build_object('movement_id',v_movement,'warehouse_id',p_warehouse,'kind',p_kind));
  return jsonb_build_object('organization_id',p_organization,'id',v_movement,'quantity_after',v_after);
end $$;
revoke all on function public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid) to authenticated;

create or replace function public.consume_minuta_inventory_for_booking(p_booking uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_booking public.bookings%rowtype; v_warehouse uuid; v_usage record; v_before numeric(14,3); v_after numeric(14,3); v_existing integer;
begin
  select * into v_booking from public.bookings booking where booking.id=p_booking for update;
  if v_booking.id is null or v_booking.organization_id is null or v_booking.location_id is null then return; end if;
  if not exists(select 1 from public.booking_outcomes outcome where outcome.booking_id=p_booking and outcome.visit_status='completed') then return; end if;
  if not coalesce((select enabled and auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=v_booking.organization_id),false) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,8202));
  select count(*) into v_existing from public.inventory_movements movement where movement.booking_id=p_booking and movement.movement_type='service_use';
  if v_existing>0 then return; end if;
  if not exists(select 1 from public.inventory_service_usage usage where usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id) then return; end if;
  select warehouse.id into v_warehouse from public.inventory_warehouses warehouse
  where warehouse.organization_id=v_booking.organization_id and warehouse.location_id=v_booking.location_id and warehouse.active for update;
  if v_warehouse is null then raise exception using errcode='55000',message='inventory_warehouse_missing_for_location'; end if;
  for v_usage in
    select usage.inventory_item_id,usage.quantity from public.inventory_service_usage usage
    join public.inventory_items item on item.id=usage.inventory_item_id and item.organization_id=usage.organization_id and item.active
    where usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id order by usage.inventory_item_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_warehouse::text||':'||v_usage.inventory_item_id::text,8201));
    insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity) values(v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,0) on conflict do nothing;
    select quantity into v_before from public.inventory_stock_balances where organization_id=v_booking.organization_id and warehouse_id=v_warehouse and inventory_item_id=v_usage.inventory_item_id for update;
    v_after:=v_before-v_usage.quantity;
    if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock_for_completed_visit'; end if;
    update public.inventory_stock_balances set quantity=v_after,updated_at=now() where organization_id=v_booking.organization_id and warehouse_id=v_warehouse and inventory_item_id=v_usage.inventory_item_id;
    insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,booking_id,movement_type,quantity_delta,quantity_after,request_id,reason,actor_id)
    values(v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,p_booking,'service_use',-v_usage.quantity,v_after,gen_random_uuid(),'Автоматическое списание по завершённому визиту',auth.uid());
  end loop;
  perform public.write_minuta_inventory_audit(v_booking.organization_id,'inventory_booking_consumed',p_booking,jsonb_build_object('warehouse_id',v_warehouse,'service_id',v_booking.service_id));
end $$;
revoke all on function public.consume_minuta_inventory_for_booking(uuid) from public,anon,authenticated,service_role;

create or replace function public.sync_minuta_inventory_on_outcome()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.visit_status='completed' and (tg_op='INSERT' or old.visit_status is distinct from 'completed') then perform public.consume_minuta_inventory_for_booking(new.booking_id); end if;
  return new;
end $$;
revoke all on function public.sync_minuta_inventory_on_outcome() from public,anon,authenticated,service_role;
drop trigger if exists booking_outcomes_sync_inventory on public.booking_outcomes;
create trigger booking_outcomes_sync_inventory after insert or update of visit_status on public.booking_outcomes
for each row execute function public.sync_minuta_inventory_on_outcome();

create or replace function public.get_minuta_inventory_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false),
    'auto_deduct_completed_visits',coalesce((select auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=p_organization),true),
    'locations',coalesce((select jsonb_agg(jsonb_build_object('id',location.id,'name',location.name,'active',location.active) order by location.is_primary desc,location.name,location.id) from public.locations location where location.organization_id=p_organization),'[]'::jsonb),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'active',service.active) order by service.name,service.id) from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name,'sku',item.sku,'unit',item.unit,'low_stock_threshold',item.low_stock_threshold,'active',item.active) order by item.active desc,item.name,item.id) from public.inventory_items item where item.organization_id=p_organization),'[]'::jsonb),
    'warehouses',coalesce((select jsonb_agg(jsonb_build_object('id',warehouse.id,'location_id',warehouse.location_id,'name',warehouse.name,'active',warehouse.active) order by warehouse.active desc,warehouse.name,warehouse.id) from public.inventory_warehouses warehouse where warehouse.organization_id=p_organization),'[]'::jsonb),
    'balances',coalesce((select jsonb_agg(jsonb_build_object('warehouse_id',balance.warehouse_id,'inventory_item_id',balance.inventory_item_id,'quantity',balance.quantity,'updated_at',balance.updated_at) order by balance.warehouse_id,balance.inventory_item_id) from public.inventory_stock_balances balance where balance.organization_id=p_organization),'[]'::jsonb),
    'usage',coalesce((select jsonb_agg(jsonb_build_object('service_id',usage.service_id,'inventory_item_id',usage.inventory_item_id,'quantity',usage.quantity) order by usage.service_id,usage.inventory_item_id) from public.inventory_service_usage usage where usage.organization_id=p_organization),'[]'::jsonb),
    'movements',coalesce((select jsonb_agg(jsonb_build_object('id',movement.id,'warehouse_id',movement.warehouse_id,'inventory_item_id',movement.inventory_item_id,'booking_id',movement.booking_id,'movement_type',movement.movement_type,'quantity_delta',movement.quantity_delta,'quantity_after',movement.quantity_after,'reason',movement.reason,'created_at',movement.created_at) order by movement.created_at desc,movement.id desc) from (select * from public.inventory_movements where organization_id=p_organization order by created_at desc,id desc limit 200) movement),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'details',entry.details,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc) from (select * from public.inventory_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_minuta_inventory_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_inventory_workspace(uuid) to authenticated;

commit;
