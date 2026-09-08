\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';
set local statement_timeout = '3min';
set local search_path = public, extensions, pg_catalog;

-- D09: one immutable, idempotent document moves one item between two active
-- warehouses in the same organization. The feature is opt-in and the cost
-- ledger starts from an explicit owner-approved opening snapshot.
do $$ begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.organization_inventory_settings') is null
     or to_regclass('public.inventory_items') is null
     or to_regclass('public.inventory_warehouses') is null
     or to_regclass('public.inventory_stock_balances') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.inventory_audit_log') is null
     or to_regprocedure('public.get_minuta_inventory_role(uuid)') is null
     or to_regprocedure('public.get_minuta_inventory_workspace(uuid)') is null
     or to_regprocedure('public.write_minuta_inventory_audit(uuid,text,uuid,jsonb)') is null
     or to_regprocedure('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)') is null then
    raise exception using errcode='P0001',message='v130_requires_inventory_v82_v108';
  end if;
end $$;

do $$ begin
  if to_regclass('public.inventory_cost_layers') is not null
     and to_regclass('public.organization_inventory_transfer_settings') is null then
    raise exception using errcode='P0001',message='v130_conflicting_inventory_cost_schema';
  end if;
end $$;

create table if not exists public.organization_inventory_transfer_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  initialized_at timestamptz,
  initialized_by uuid references auth.users(id) on delete set null,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  suspended_at timestamptz,
  suspended_by uuid references auth.users(id) on delete set null,
  suspension_reason text check(char_length(suspension_reason)<=500),
  updated_at timestamptz not null default now(),
  check(not enabled or (initialized_at is not null and suspended_at is null))
);

create table if not exists public.inventory_transfer_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source_warehouse_id uuid not null,
  destination_warehouse_id uuid not null,
  inventory_item_id uuid not null,
  quantity numeric(14,3) not null check(quantity>0),
  reason text not null check(char_length(reason) between 2 and 500),
  request_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id,request_id),
  unique(id,organization_id),
  foreign key(source_warehouse_id,organization_id)
    references public.inventory_warehouses(id,organization_id) on delete restrict,
  foreign key(destination_warehouse_id,organization_id)
    references public.inventory_warehouses(id,organization_id) on delete restrict,
  foreign key(inventory_item_id,organization_id)
    references public.inventory_items(id,organization_id) on delete restrict,
  check(source_warehouse_id<>destination_warehouse_id)
);

alter table public.inventory_movements
  add column if not exists purchase_total_cost_kopecks bigint,
  add column if not exists transfer_document_id uuid;
create unique index if not exists inventory_movements_id_organization_v130
  on public.inventory_movements(id,organization_id);

do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.inventory_movements'::regclass
      and conname='inventory_movements_transfer_document_fk_v130'
  ) then
    alter table public.inventory_movements
      add constraint inventory_movements_transfer_document_fk_v130
      foreign key(transfer_document_id,organization_id)
      references public.inventory_transfer_documents(id,organization_id)
      on delete restrict deferrable initially deferred;
  end if;
end $$;

alter table public.inventory_movements
  drop constraint if exists inventory_movements_movement_type_check,
  drop constraint if exists inventory_movements_movement_type_check_v130,
  drop constraint if exists inventory_purchase_cost_receipt_only_v130,
  drop constraint if exists inventory_transfer_movement_shape_v130;
alter table public.inventory_movements
  add constraint inventory_movements_movement_type_check_v130
    check(movement_type in ('receipt','write_off','inventory','service_use','transfer_out','transfer_in')) not valid,
  add constraint inventory_purchase_cost_receipt_only_v130
    check(purchase_total_cost_kopecks is null or (
      movement_type='receipt' and purchase_total_cost_kopecks between 0 and 1000000000000
    )) not valid,
  add constraint inventory_transfer_movement_shape_v130
    check(
      (movement_type in ('transfer_out','transfer_in') and transfer_document_id is not null and booking_id is null)
      or (movement_type not in ('transfer_out','transfer_in') and transfer_document_id is null)
    ) not valid;
alter table public.inventory_movements
  validate constraint inventory_movements_movement_type_check_v130;
alter table public.inventory_movements
  validate constraint inventory_purchase_cost_receipt_only_v130;
alter table public.inventory_movements
  validate constraint inventory_transfer_movement_shape_v130;

create unique index if not exists inventory_transfer_movement_side_v130
  on public.inventory_movements(transfer_document_id,movement_type)
  where transfer_document_id is not null;

create table if not exists public.inventory_cost_layers (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  warehouse_id uuid not null,
  inventory_item_id uuid not null,
  source_key text not null unique,
  source_movement_id bigint,
  transferred_from_layer_id bigint,
  original_quantity numeric(14,3) not null check(original_quantity>0),
  remaining_quantity numeric(14,3) not null check(remaining_quantity>=0 and remaining_quantity<=original_quantity),
  unit_cost_kopecks numeric(20,6),
  created_at timestamptz not null default now(),
  foreign key(warehouse_id,organization_id)
    references public.inventory_warehouses(id,organization_id) on delete restrict,
  foreign key(inventory_item_id,organization_id)
    references public.inventory_items(id,organization_id) on delete restrict,
  foreign key(source_movement_id,organization_id)
    references public.inventory_movements(id,organization_id) on delete restrict,
  unique(id,organization_id),
  foreign key(transferred_from_layer_id,organization_id)
    references public.inventory_cost_layers(id,organization_id) on delete restrict,
  check(unit_cost_kopecks is null or unit_cost_kopecks>=0)
);
create unique index if not exists inventory_cost_layers_source_movement_v130
  on public.inventory_cost_layers(source_movement_id)
  where source_movement_id is not null and transferred_from_layer_id is null;
create unique index if not exists inventory_cost_layers_transfer_source_v130
  on public.inventory_cost_layers(source_movement_id,transferred_from_layer_id)
  where source_movement_id is not null and transferred_from_layer_id is not null;
create index if not exists inventory_cost_layers_fifo_v130
  on public.inventory_cost_layers(organization_id,warehouse_id,inventory_item_id,created_at,id)
  where remaining_quantity>0;

create table if not exists public.inventory_movement_cost_snapshots (
  movement_id bigint primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  quantity_costed numeric(14,3) not null check(quantity_costed>=0),
  total_cost_kopecks bigint,
  cost_complete boolean not null,
  created_at timestamptz not null default now(),
  foreign key(movement_id,organization_id)
    references public.inventory_movements(id,organization_id) on delete restrict,
  check(total_cost_kopecks is null or total_cost_kopecks>=0),
  check(cost_complete=(total_cost_kopecks is not null))
);

create table if not exists public.inventory_cost_allocations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  movement_id bigint not null,
  cost_layer_id bigint not null,
  quantity numeric(14,3) not null check(quantity>0),
  unit_cost_kopecks numeric(20,6),
  cost_amount_kopecks numeric(24,6),
  created_at timestamptz not null default now(),
  unique(movement_id,cost_layer_id),
  foreign key(movement_id,organization_id)
    references public.inventory_movements(id,organization_id) on delete restrict,
  foreign key(cost_layer_id,organization_id)
    references public.inventory_cost_layers(id,organization_id) on delete restrict,
  check(unit_cost_kopecks is null or unit_cost_kopecks>=0),
  check(cost_amount_kopecks is null or cost_amount_kopecks>=0),
  check((unit_cost_kopecks is null)=(cost_amount_kopecks is null))
);

alter table public.organization_inventory_transfer_settings enable row level security;
alter table public.inventory_transfer_documents enable row level security;
alter table public.inventory_cost_layers enable row level security;
alter table public.inventory_movement_cost_snapshots enable row level security;
alter table public.inventory_cost_allocations enable row level security;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'organization_inventory_transfer_settings','inventory_transfer_documents',
    'inventory_cost_layers','inventory_movement_cost_snapshots','inventory_cost_allocations'
  ] loop
    execute format('drop policy if exists inventory_transfer_manager_read on public.%I',v_table);
    execute format(
      'create policy inventory_transfer_manager_read on public.%I for select to authenticated using (public.has_organization_role(organization_id,array[''owner'',''admin'']))',
      v_table
    );
  end loop;
end $$;

revoke all on public.organization_inventory_transfer_settings,public.inventory_transfer_documents,
  public.inventory_cost_layers,public.inventory_movement_cost_snapshots,public.inventory_cost_allocations
  from public,anon,authenticated;
grant select on public.organization_inventory_transfer_settings,public.inventory_transfer_documents,
  public.inventory_cost_layers,public.inventory_movement_cost_snapshots,public.inventory_cost_allocations
  to authenticated;
grant all on public.organization_inventory_transfer_settings,public.inventory_transfer_documents,
  public.inventory_cost_layers,public.inventory_movement_cost_snapshots,public.inventory_cost_allocations
  to service_role;

create or replace function public.protect_minuta_inventory_transfer_ledger_v130()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception using errcode='55000',message='inventory_transfer_ledger_immutable';
end $$;
revoke all on function public.protect_minuta_inventory_transfer_ledger_v130()
  from public,anon,authenticated,service_role;

drop trigger if exists inventory_transfer_documents_immutable_v130 on public.inventory_transfer_documents;
create trigger inventory_transfer_documents_immutable_v130
before update or delete on public.inventory_transfer_documents
for each row execute function public.protect_minuta_inventory_transfer_ledger_v130();
drop trigger if exists inventory_movement_cost_snapshots_immutable_v130 on public.inventory_movement_cost_snapshots;
create trigger inventory_movement_cost_snapshots_immutable_v130
before update or delete on public.inventory_movement_cost_snapshots
for each row execute function public.protect_minuta_inventory_transfer_ledger_v130();
drop trigger if exists inventory_cost_allocations_immutable_v130 on public.inventory_cost_allocations;
create trigger inventory_cost_allocations_immutable_v130
before update or delete on public.inventory_cost_allocations
for each row execute function public.protect_minuta_inventory_transfer_ledger_v130();

create or replace function public.record_minuta_inventory_cost_v130()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_remaining numeric(14,3);
  v_take numeric(14,3);
  v_total numeric(24,6):=0;
  v_complete boolean:=true;
  v_layer record;
  v_unit numeric(20,6);
begin
  perform pg_advisory_xact_lock_shared(13000);
  perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text,13001));
  if not coalesce((
    select setting.initialized_at is not null
    from public.organization_inventory_transfer_settings setting
    where setting.organization_id=new.organization_id
  ),false) then return new; end if;

  -- The transfer RPC reconstructs destination layers from the exact source
  -- allocations. A generic positive-layer branch would lose that provenance.
  if new.movement_type='transfer_in' then return new; end if;

  if new.quantity_delta>0 then
    v_unit:=case
      when new.movement_type='receipt' and new.purchase_total_cost_kopecks is not null
        then new.purchase_total_cost_kopecks/new.quantity_delta
      else null
    end;
    insert into public.inventory_cost_layers(
      organization_id,warehouse_id,inventory_item_id,source_key,source_movement_id,
      original_quantity,remaining_quantity,unit_cost_kopecks,created_at
    ) values(
      new.organization_id,new.warehouse_id,new.inventory_item_id,'movement-v130:'||new.id::text,new.id,
      new.quantity_delta,new.quantity_delta,v_unit,new.created_at
    );
    insert into public.inventory_movement_cost_snapshots(
      movement_id,organization_id,quantity_costed,total_cost_kopecks,cost_complete
    ) values(
      new.id,new.organization_id,new.quantity_delta,
      case when v_unit is null then null else new.purchase_total_cost_kopecks end,
      v_unit is not null
    );
    return new;
  end if;

  if new.quantity_delta=0 then
    insert into public.inventory_movement_cost_snapshots(
      movement_id,organization_id,quantity_costed,total_cost_kopecks,cost_complete
    ) values(new.id,new.organization_id,0,0,true);
    return new;
  end if;

  v_remaining:=abs(new.quantity_delta);
  for v_layer in
    select layer.* from public.inventory_cost_layers layer
    where layer.organization_id=new.organization_id
      and layer.warehouse_id=new.warehouse_id
      and layer.inventory_item_id=new.inventory_item_id
      and layer.remaining_quantity>0
    order by layer.created_at,layer.id
    for update
  loop
    exit when v_remaining<=0;
    v_take:=least(v_remaining,v_layer.remaining_quantity);
    update public.inventory_cost_layers
      set remaining_quantity=remaining_quantity-v_take
      where id=v_layer.id;
    insert into public.inventory_cost_allocations(
      organization_id,movement_id,cost_layer_id,quantity,unit_cost_kopecks,cost_amount_kopecks
    ) values(
      new.organization_id,new.id,v_layer.id,v_take,v_layer.unit_cost_kopecks,
      case when v_layer.unit_cost_kopecks is null then null else v_take*v_layer.unit_cost_kopecks end
    );
    if v_layer.unit_cost_kopecks is null then
      v_complete:=false;
    else
      v_total:=v_total+v_take*v_layer.unit_cost_kopecks;
    end if;
    v_remaining:=v_remaining-v_take;
  end loop;
  if v_remaining>0 then
    raise exception using errcode='55000',message='inventory_cost_ledger_out_of_sync';
  end if;
  insert into public.inventory_movement_cost_snapshots(
    movement_id,organization_id,quantity_costed,total_cost_kopecks,cost_complete
  ) values(
    new.id,new.organization_id,abs(new.quantity_delta),
    case when v_complete then round(v_total)::bigint else null end,v_complete
  );
  return new;
end $$;
revoke all on function public.record_minuta_inventory_cost_v130()
  from public,anon,authenticated,service_role;

drop trigger if exists inventory_movement_cost_v130 on public.inventory_movements;
create trigger inventory_movement_cost_v130 after insert on public.inventory_movements
for each row execute function public.record_minuta_inventory_cost_v130();

create or replace function public.verify_minuta_inventory_transfer_pair_v130()
returns trigger language plpgsql set search_path to '' as $$
declare v_document uuid; v_row public.inventory_transfer_documents%rowtype;
begin
  if tg_table_name='inventory_transfer_documents' then
    v_document:=new.id;
  else
    v_document:=new.transfer_document_id;
  end if;
  if v_document is null then return new; end if;
  select * into v_row from public.inventory_transfer_documents where id=v_document;
  if v_row.id is null
     or (select count(*) from public.inventory_movements movement where movement.transfer_document_id=v_document)<>2
     or not exists(
       select 1 from public.inventory_movements movement
       where movement.transfer_document_id=v_document
         and movement.organization_id=v_row.organization_id
         and movement.warehouse_id=v_row.source_warehouse_id
         and movement.inventory_item_id=v_row.inventory_item_id
         and movement.movement_type='transfer_out'
         and movement.quantity_delta=-v_row.quantity
     )
     or not exists(
       select 1 from public.inventory_movements movement
       where movement.transfer_document_id=v_document
         and movement.organization_id=v_row.organization_id
         and movement.warehouse_id=v_row.destination_warehouse_id
         and movement.inventory_item_id=v_row.inventory_item_id
         and movement.movement_type='transfer_in'
         and movement.quantity_delta=v_row.quantity
     ) then
    raise exception using errcode='23514',message='inventory_transfer_pair_incomplete';
  end if;
  return new;
end $$;
revoke all on function public.verify_minuta_inventory_transfer_pair_v130()
  from public,anon,authenticated,service_role;

drop trigger if exists inventory_transfer_document_pair_v130 on public.inventory_transfer_documents;
create constraint trigger inventory_transfer_document_pair_v130
after insert on public.inventory_transfer_documents deferrable initially deferred
for each row execute function public.verify_minuta_inventory_transfer_pair_v130();
drop trigger if exists inventory_transfer_movement_pair_v130 on public.inventory_movements;
create constraint trigger inventory_transfer_movement_pair_v130
after insert on public.inventory_movements deferrable initially deferred
for each row when (new.transfer_document_id is not null)
execute function public.verify_minuta_inventory_transfer_pair_v130();

create or replace function public.enable_minuta_inventory_transfers_v130(p_organization uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_initialized timestamptz; v_suspended timestamptz;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if v_role<>'owner' then
    raise exception using errcode='42501',message='inventory_transfer_owner_required';
  end if;
  perform pg_advisory_xact_lock_shared(13000);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,13001));
  v_role:=public.get_minuta_inventory_role(p_organization);
  if v_role<>'owner' then
    raise exception using errcode='42501',message='inventory_transfer_owner_required';
  end if;
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  insert into public.organization_inventory_transfer_settings(organization_id)
    values(p_organization) on conflict(organization_id) do nothing;
  select initialized_at,suspended_at into v_initialized,v_suspended
    from public.organization_inventory_transfer_settings
    where organization_id=p_organization for update;
  if v_suspended is not null then
    raise exception using errcode='55000',message='inventory_transfer_reactivation_requires_reconciliation';
  end if;
  if v_initialized is null then
    insert into public.inventory_cost_layers(
      organization_id,warehouse_id,inventory_item_id,source_key,
      original_quantity,remaining_quantity,unit_cost_kopecks,created_at
    )
    select balance.organization_id,balance.warehouse_id,balance.inventory_item_id,
      'opening-v130:'||balance.organization_id::text||':'||balance.warehouse_id::text||':'||balance.inventory_item_id::text,
      balance.quantity,balance.quantity,null,now()
    from public.inventory_stock_balances balance
    where balance.organization_id=p_organization and balance.quantity>0
    on conflict(source_key) do nothing;
    v_initialized:=now();
  end if;
  update public.organization_inventory_transfer_settings set
    enabled=true,initialized_at=v_initialized,initialized_by=coalesce(initialized_by,auth.uid()),
    enabled_at=coalesce(enabled_at,now()),enabled_by=coalesce(enabled_by,auth.uid()),updated_at=now()
  where organization_id=p_organization;
  perform public.write_minuta_inventory_audit(
    p_organization,'inventory_transfers_enabled',p_organization,
    jsonb_build_object('initialized_at',v_initialized)
  );
  return jsonb_build_object('organization_id',p_organization,'enabled',true,'initialized_at',v_initialized);
end $$;
revoke all on function public.enable_minuta_inventory_transfers_v130(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.enable_minuta_inventory_transfers_v130(uuid) to authenticated;

create or replace function public.set_minuta_inventory_transfers_enabled_v130(
  p_organization uuid,p_enabled boolean
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_setting public.organization_inventory_transfer_settings%rowtype;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if v_role<>'owner' then
    raise exception using errcode='42501',message='inventory_transfer_owner_required';
  end if;
  perform pg_advisory_xact_lock_shared(13000);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,13001));
  v_role:=public.get_minuta_inventory_role(p_organization);
  if v_role<>'owner' then
    raise exception using errcode='42501',message='inventory_transfer_owner_required';
  end if;
  select * into v_setting from public.organization_inventory_transfer_settings
    where organization_id=p_organization for update;
  if v_setting.initialized_at is null then
    raise exception using errcode='55000',message='inventory_transfer_not_initialized';
  end if;
  if v_setting.suspended_at is not null then
    raise exception using errcode='55000',message='inventory_transfer_reactivation_requires_reconciliation';
  end if;
  update public.organization_inventory_transfer_settings set
    enabled=coalesce(p_enabled,false),
    enabled_at=case when p_enabled then coalesce(enabled_at,now()) else enabled_at end,
    enabled_by=case when p_enabled then coalesce(enabled_by,auth.uid()) else enabled_by end,
    updated_at=now()
  where organization_id=p_organization;
  perform public.write_minuta_inventory_audit(
    p_organization,'inventory_transfers_setting_changed',p_organization,
    jsonb_build_object('enabled',coalesce(p_enabled,false))
  );
  return jsonb_build_object('organization_id',p_organization,'enabled',coalesce(p_enabled,false),
    'initialized_at',v_setting.initialized_at);
end $$;
revoke all on function public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean) to authenticated;

create or replace function public.apply_minuta_stock_movement_v130(
  p_organization uuid,p_warehouse uuid,p_item uuid,p_kind text,p_quantity numeric,
  p_counted_quantity numeric,p_reason text,p_request_id uuid,p_purchase_total_cost_kopecks bigint
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_before numeric(14,3); v_delta numeric(14,3); v_after numeric(14,3);
  v_existing public.inventory_movements%rowtype; v_movement bigint; v_reason text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock_shared(13000);
  if p_request_id is null then raise exception using errcode='22023',message='inventory_request_id_required'; end if;
  if coalesce(p_kind,'') not in ('receipt','write_off','inventory') then
    raise exception using errcode='22023',message='invalid_inventory_movement';
  end if;
  if p_purchase_total_cost_kopecks is not null and (
    p_kind<>'receipt' or p_purchase_total_cost_kopecks<0 or p_purchase_total_cost_kopecks>1000000000000
  ) then raise exception using errcode='22023',message='invalid_inventory_purchase_cost'; end if;
  v_reason:=trim(coalesce(p_reason,''));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8200));
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,13001));
  v_role:=public.get_minuta_inventory_role(p_organization);
  select * into v_existing from public.inventory_movements
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.warehouse_id<>p_warehouse or v_existing.inventory_item_id<>p_item
       or v_existing.movement_type<>p_kind or v_existing.reason<>v_reason
       or v_existing.purchase_total_cost_kopecks is distinct from p_purchase_total_cost_kopecks
       or (p_kind='receipt' and v_existing.quantity_delta<>p_quantity)
       or (p_kind='write_off' and v_existing.quantity_delta<>-p_quantity)
       or (p_kind='inventory' and v_existing.quantity_after<>p_counted_quantity) then
      raise exception using errcode='23505',message='inventory_request_conflict';
    end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,
      'quantity_after',v_existing.quantity_after,'purchase_total_cost_kopecks',v_existing.purchase_total_cost_kopecks);
  end if;
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  if not coalesce((select initialized_at is not null from public.organization_inventory_transfer_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_transfer_not_initialized';
  end if;
  if not exists(select 1 from public.inventory_warehouses where id=p_warehouse and organization_id=p_organization and active)
     or not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization and active) then
    raise exception using errcode='55000',message='inventory_target_inactive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text||':'||p_item::text,8201));
  insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity)
    values(p_organization,p_warehouse,p_item,0) on conflict do nothing;
  select quantity into v_before from public.inventory_stock_balances
    where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item for update;
  if p_kind='inventory' then
    if p_counted_quantity is null or p_counted_quantity<0 or p_counted_quantity>99999999999.999
       or p_counted_quantity<>trunc(p_counted_quantity,3) then
      raise exception using errcode='22023',message='invalid_inventory_count';
    end if;
    v_after:=p_counted_quantity; v_delta:=v_after-v_before;
  else
    if p_quantity is null or p_quantity<=0 or p_quantity>99999999999.999
       or p_quantity<>trunc(p_quantity,3) then
      raise exception using errcode='22023',message='invalid_inventory_quantity';
    end if;
    v_delta:=case when p_kind='receipt' then p_quantity else -p_quantity end;
    v_after:=v_before+v_delta;
  end if;
  if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock'; end if;
  if p_kind in ('write_off','inventory') and char_length(v_reason)<2 then
    raise exception using errcode='22023',message='inventory_reason_required';
  end if;
  update public.inventory_stock_balances set quantity=v_after,updated_at=now()
    where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item;
  insert into public.inventory_movements(
    organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,
    request_id,reason,actor_id,purchase_total_cost_kopecks
  ) values(
    p_organization,p_warehouse,p_item,p_kind,v_delta,v_after,p_request_id,v_reason,auth.uid(),p_purchase_total_cost_kopecks
  ) returning id into v_movement;
  perform public.write_minuta_inventory_audit(
    p_organization,'inventory_movement_recorded',p_item,
    jsonb_build_object('movement_id',v_movement,'warehouse_id',p_warehouse,'kind',p_kind,
      'purchase_cost_recorded',p_purchase_total_cost_kopecks is not null)
  );
  return jsonb_build_object('organization_id',p_organization,'id',v_movement,
    'quantity_after',v_after,'purchase_total_cost_kopecks',p_purchase_total_cost_kopecks);
end $$;
revoke all on function public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)
  to authenticated;

-- Keep the published v82 entry point on the same organization-before-item lock
-- protocol as v130.  This prevents its cost trigger from inverting locks with a
-- concurrent transfer while preserving the legacy request and response shape.
create or replace function public.apply_minuta_stock_movement(
  p_organization uuid,p_warehouse uuid,p_item uuid,p_kind text,p_quantity numeric,
  p_counted_quantity numeric,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_before numeric(14,3); v_delta numeric(14,3); v_after numeric(14,3);
  v_existing public.inventory_movements%rowtype; v_movement bigint;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock_shared(13000);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  if p_request_id is null then raise exception using errcode='22023',message='inventory_request_id_required'; end if;
  if coalesce(p_kind,'') not in ('receipt','write_off','inventory') then
    raise exception using errcode='22023',message='invalid_inventory_movement';
  end if;
  if not exists(select 1 from public.inventory_warehouses where id=p_warehouse and organization_id=p_organization and active)
     or not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization and active) then
    raise exception using errcode='55000',message='inventory_target_inactive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8200));
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,13001));
  v_role:=public.get_minuta_inventory_role(p_organization);
  select * into v_existing from public.inventory_movements
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.warehouse_id<>p_warehouse or v_existing.inventory_item_id<>p_item or v_existing.movement_type<>p_kind
       or (p_kind='receipt' and v_existing.quantity_delta<>p_quantity)
       or (p_kind='write_off' and v_existing.quantity_delta<>-p_quantity)
       or (p_kind='inventory' and v_existing.quantity_after<>p_counted_quantity) then
      raise exception using errcode='23505',message='inventory_request_conflict';
    end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'quantity_after',v_existing.quantity_after);
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_warehouse::text||':'||p_item::text,8201));
  insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity)
    values(p_organization,p_warehouse,p_item,0) on conflict do nothing;
  select quantity into v_before from public.inventory_stock_balances
    where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item for update;
  if p_kind='inventory' then
    if coalesce(p_counted_quantity,-1)<0 then raise exception using errcode='22023',message='invalid_inventory_count'; end if;
    v_after:=p_counted_quantity; v_delta:=v_after-v_before;
  else
    if coalesce(p_quantity,0)<=0 then raise exception using errcode='22023',message='invalid_inventory_quantity'; end if;
    v_delta:=case when p_kind='receipt' then p_quantity else -p_quantity end; v_after:=v_before+v_delta;
  end if;
  if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock'; end if;
  if p_kind in ('write_off','inventory') and char_length(trim(coalesce(p_reason,'')))<2 then
    raise exception using errcode='22023',message='inventory_reason_required';
  end if;
  update public.inventory_stock_balances set quantity=v_after,updated_at=now()
    where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item;
  insert into public.inventory_movements(
    organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,
    request_id,reason,actor_id
  ) values(
    p_organization,p_warehouse,p_item,p_kind,v_delta,v_after,p_request_id,trim(coalesce(p_reason,'')),auth.uid()
  ) returning id into v_movement;
  perform public.write_minuta_inventory_audit(
    p_organization,'inventory_movement_recorded',p_item,
    jsonb_build_object('movement_id',v_movement,'warehouse_id',p_warehouse,'kind',p_kind)
  );
  return jsonb_build_object('organization_id',p_organization,'id',v_movement,'quantity_after',v_after);
end $$;
revoke all on function public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)
  to authenticated;

-- The booking path may consume several items in one transaction.  Acquire the
-- organization lock once before the ordered item loop so no later item lock can
-- be taken while another writer is waiting for the cost-ledger lock.
create or replace function public.consume_minuta_inventory_for_booking(p_booking uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype; v_warehouse uuid; v_usage record;
  v_before numeric(14,3); v_after numeric(14,3); v_existing integer;
begin
  select * into v_booking from public.bookings booking where booking.id=p_booking for update;
  if v_booking.id is null or v_booking.organization_id is null or v_booking.location_id is null then return; end if;
  if not exists(select 1 from public.booking_outcomes outcome where outcome.booking_id=p_booking and outcome.visit_status='completed') then return; end if;
  if not coalesce((select enabled and auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=v_booking.organization_id),false) then return; end if;
  perform pg_advisory_xact_lock_shared(13000);
  perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text,13001));
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,8202));
  select count(*) into v_existing from public.inventory_movements
    where booking_id=p_booking and movement_type='service_use';
  if v_existing>0 then return; end if;
  if not exists(select 1 from public.inventory_service_usage usage
      where usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id) then return; end if;
  select warehouse.id into v_warehouse from public.inventory_warehouses warehouse
    where warehouse.organization_id=v_booking.organization_id
      and warehouse.location_id=v_booking.location_id and warehouse.active for update;
  if v_warehouse is null then
    raise exception using errcode='55000',message='inventory_warehouse_missing_for_location';
  end if;
  for v_usage in
    select usage.inventory_item_id,usage.quantity from public.inventory_service_usage usage
    join public.inventory_items item
      on item.id=usage.inventory_item_id and item.organization_id=usage.organization_id and item.active
    where usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id
    order by usage.inventory_item_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_warehouse::text||':'||v_usage.inventory_item_id::text,8201));
    insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity)
      values(v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,0) on conflict do nothing;
    select quantity into v_before from public.inventory_stock_balances
      where organization_id=v_booking.organization_id and warehouse_id=v_warehouse
        and inventory_item_id=v_usage.inventory_item_id for update;
    v_after:=v_before-v_usage.quantity;
    if v_after<0 then
      raise exception using errcode='55000',message='insufficient_inventory_stock_for_completed_visit';
    end if;
    update public.inventory_stock_balances set quantity=v_after,updated_at=now()
      where organization_id=v_booking.organization_id and warehouse_id=v_warehouse
        and inventory_item_id=v_usage.inventory_item_id;
    insert into public.inventory_movements(
      organization_id,warehouse_id,inventory_item_id,booking_id,movement_type,
      quantity_delta,quantity_after,request_id,reason,actor_id
    ) values(
      v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,p_booking,'service_use',
      -v_usage.quantity,v_after,gen_random_uuid(),'Автоматическое списание по завершённому визиту',auth.uid()
    );
  end loop;
  perform public.write_minuta_inventory_audit(
    v_booking.organization_id,'inventory_booking_consumed',p_booking,
    jsonb_build_object('warehouse_id',v_warehouse,'service_id',v_booking.service_id)
  );
end $$;
revoke all on function public.consume_minuta_inventory_for_booking(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.transfer_minuta_inventory_stock_v130(
  p_organization uuid,p_source_warehouse uuid,p_destination_warehouse uuid,p_item uuid,
  p_quantity numeric,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_reason text; v_document public.inventory_transfer_documents%rowtype;
  v_source_before numeric(14,3); v_destination_before numeric(14,3);
  v_source_after numeric(14,3); v_destination_after numeric(14,3);
  v_out bigint; v_in bigint; v_out_snapshot public.inventory_movement_cost_snapshots%rowtype;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock_shared(13000);
  if p_request_id is null then
    raise exception using errcode='22023',message='inventory_transfer_request_id_required';
  end if;
  v_reason:=trim(coalesce(p_reason,''));
  if p_source_warehouse is null or p_destination_warehouse is null or p_source_warehouse=p_destination_warehouse then
    raise exception using errcode='22023',message='inventory_transfer_warehouses_invalid';
  end if;
  if p_quantity is null or p_quantity<=0 or p_quantity>99999999999.999
     or p_quantity<>trunc(p_quantity,3) then
    raise exception using errcode='22023',message='invalid_inventory_transfer_quantity';
  end if;
  if char_length(v_reason) not between 2 and 500 then
    raise exception using errcode='22023',message='inventory_transfer_reason_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8200));
  v_role:=public.get_minuta_inventory_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,13001));
  v_role:=public.get_minuta_inventory_role(p_organization);
  select * into v_document from public.inventory_transfer_documents
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_document.source_warehouse_id<>p_source_warehouse
       or v_document.destination_warehouse_id<>p_destination_warehouse
       or v_document.inventory_item_id<>p_item
       or v_document.quantity<>p_quantity or v_document.reason<>v_reason then
      raise exception using errcode='23505',message='inventory_transfer_request_conflict';
    end if;
    select movement.id into v_out from public.inventory_movements movement
      where movement.transfer_document_id=v_document.id and movement.movement_type='transfer_out';
    select movement.id into v_in from public.inventory_movements movement
      where movement.transfer_document_id=v_document.id and movement.movement_type='transfer_in';
    if v_out is null or v_in is null then
      raise exception using errcode='55000',message='inventory_transfer_pair_incomplete';
    end if;
    return jsonb_build_object(
      'organization_id',p_organization,'document_id',v_document.id,
      'source_movement_id',v_out,'destination_movement_id',v_in,
      'source_quantity_after',(select quantity_after from public.inventory_movements where id=v_out),
      'destination_quantity_after',(select quantity_after from public.inventory_movements where id=v_in),
      'cost_complete',(select cost_complete from public.inventory_movement_cost_snapshots where movement_id=v_out)
    );
  end if;

  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  if not coalesce((
    select setting.enabled and setting.initialized_at is not null and setting.suspended_at is null
    from public.organization_inventory_transfer_settings setting
    where setting.organization_id=p_organization
  ),false) then
    raise exception using errcode='55000',message='inventory_transfers_disabled';
  end if;

  perform 1 from public.inventory_warehouses warehouse
    where warehouse.organization_id=p_organization
      and warehouse.id in(p_source_warehouse,p_destination_warehouse)
    order by warehouse.id::text for update;
  if (select count(*) from public.inventory_warehouses warehouse
      where warehouse.organization_id=p_organization and warehouse.active
        and warehouse.id in(p_source_warehouse,p_destination_warehouse))<>2
     or not exists(select 1 from public.inventory_items item
       where item.id=p_item and item.organization_id=p_organization and item.active) then
    raise exception using errcode='55000',message='inventory_transfer_target_inactive';
  end if;

  if p_source_warehouse::text<p_destination_warehouse::text then
    perform pg_advisory_xact_lock(hashtextextended(p_source_warehouse::text||':'||p_item::text,8201));
    perform pg_advisory_xact_lock(hashtextextended(p_destination_warehouse::text||':'||p_item::text,8201));
  else
    perform pg_advisory_xact_lock(hashtextextended(p_destination_warehouse::text||':'||p_item::text,8201));
    perform pg_advisory_xact_lock(hashtextextended(p_source_warehouse::text||':'||p_item::text,8201));
  end if;
  insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity)
    values(p_organization,p_source_warehouse,p_item,0),(p_organization,p_destination_warehouse,p_item,0)
    on conflict do nothing;
  perform 1 from public.inventory_stock_balances balance
    where balance.organization_id=p_organization and balance.inventory_item_id=p_item
      and balance.warehouse_id in(p_source_warehouse,p_destination_warehouse)
    order by balance.warehouse_id::text for update;
  select quantity into v_source_before from public.inventory_stock_balances
    where organization_id=p_organization and warehouse_id=p_source_warehouse and inventory_item_id=p_item;
  select quantity into v_destination_before from public.inventory_stock_balances
    where organization_id=p_organization and warehouse_id=p_destination_warehouse and inventory_item_id=p_item;
  if v_source_before<p_quantity then
    raise exception using errcode='55000',message='insufficient_inventory_stock';
  end if;
  v_source_after:=v_source_before-p_quantity;
  v_destination_after:=v_destination_before+p_quantity;
  if v_destination_after>99999999999.999 then
    raise exception using errcode='22003',message='inventory_transfer_destination_overflow';
  end if;

  insert into public.inventory_transfer_documents(
    organization_id,source_warehouse_id,destination_warehouse_id,inventory_item_id,
    quantity,reason,request_id,actor_id
  ) values(
    p_organization,p_source_warehouse,p_destination_warehouse,p_item,
    p_quantity,v_reason,p_request_id,auth.uid()
  ) returning * into v_document;
  update public.inventory_stock_balances set quantity=v_source_after,updated_at=now()
    where organization_id=p_organization and warehouse_id=p_source_warehouse and inventory_item_id=p_item;
  update public.inventory_stock_balances set quantity=v_destination_after,updated_at=now()
    where organization_id=p_organization and warehouse_id=p_destination_warehouse and inventory_item_id=p_item;

  insert into public.inventory_movements(
    organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,
    request_id,reason,actor_id,transfer_document_id
  ) values(
    p_organization,p_source_warehouse,p_item,'transfer_out',-p_quantity,v_source_after,
    gen_random_uuid(),v_reason,auth.uid(),v_document.id
  ) returning id into v_out;
  select * into v_out_snapshot from public.inventory_movement_cost_snapshots where movement_id=v_out;
  if v_out_snapshot.movement_id is null then
    raise exception using errcode='55000',message='inventory_transfer_cost_snapshot_missing';
  end if;

  insert into public.inventory_movements(
    organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,
    request_id,reason,actor_id,transfer_document_id
  ) values(
    p_organization,p_destination_warehouse,p_item,'transfer_in',p_quantity,v_destination_after,
    gen_random_uuid(),v_reason,auth.uid(),v_document.id
  ) returning id into v_in;

  insert into public.inventory_cost_layers(
    organization_id,warehouse_id,inventory_item_id,source_key,source_movement_id,
    transferred_from_layer_id,original_quantity,remaining_quantity,unit_cost_kopecks,created_at
  )
  select p_organization,p_destination_warehouse,p_item,
    'transfer-v130:'||v_document.id::text||':'||source_layer.id::text,
    v_in,source_layer.id,allocation.quantity,allocation.quantity,
    allocation.unit_cost_kopecks,source_layer.created_at
  from public.inventory_cost_allocations allocation
  join public.inventory_cost_layers source_layer on source_layer.id=allocation.cost_layer_id
  where allocation.movement_id=v_out
  order by source_layer.created_at,source_layer.id;
  insert into public.inventory_movement_cost_snapshots(
    movement_id,organization_id,quantity_costed,total_cost_kopecks,cost_complete,created_at
  ) values(
    v_in,p_organization,v_out_snapshot.quantity_costed,v_out_snapshot.total_cost_kopecks,
    v_out_snapshot.cost_complete,v_document.created_at
  );

  if (select coalesce(sum(layer.original_quantity),0) from public.inventory_cost_layers layer
      where layer.source_movement_id=v_in)<>p_quantity then
    raise exception using errcode='55000',message='inventory_transfer_cost_layers_incomplete';
  end if;
  perform public.write_minuta_inventory_audit(
    p_organization,'inventory_transfer_recorded',v_document.id,
    jsonb_build_object('source_warehouse_id',p_source_warehouse,
      'destination_warehouse_id',p_destination_warehouse,'inventory_item_id',p_item,
      'quantity',p_quantity,'source_movement_id',v_out,'destination_movement_id',v_in,
      'cost_complete',v_out_snapshot.cost_complete)
  );
  return jsonb_build_object(
    'organization_id',p_organization,'document_id',v_document.id,
    'source_movement_id',v_out,'destination_movement_id',v_in,
    'source_quantity_after',v_source_after,'destination_quantity_after',v_destination_after,
    'cost_complete',v_out_snapshot.cost_complete
  );
end $$;
revoke all on function public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)
  to authenticated;

create or replace function public.get_minuta_inventory_workspace_v130(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_base jsonb; v_setting public.organization_inventory_transfer_settings%rowtype;
begin
  v_base:=public.get_minuta_inventory_workspace(p_organization);
  select * into v_setting from public.organization_inventory_transfer_settings
    where organization_id=p_organization;
  return v_base||jsonb_build_object(
    'transfer_version',130,
    'transfers_enabled',coalesce(v_setting.enabled,false)
      and v_setting.initialized_at is not null and v_setting.suspended_at is null,
    'transfers_initialized_at',v_setting.initialized_at,
    'transfers_suspended_at',v_setting.suspended_at,
    'transfer_documents',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',document.id,'source_warehouse_id',document.source_warehouse_id,
        'destination_warehouse_id',document.destination_warehouse_id,
        'inventory_item_id',document.inventory_item_id,'quantity',document.quantity,
        'reason',document.reason,'created_at',document.created_at,
        'source_movement_id',outgoing.id,'destination_movement_id',incoming.id,
        'cost_complete',snapshot.cost_complete,'total_cost_kopecks',snapshot.total_cost_kopecks
      ) order by document.created_at desc,document.id desc)
      from(
        select * from public.inventory_transfer_documents
        where organization_id=p_organization order by created_at desc,id desc limit 100
      ) document
      left join public.inventory_movements outgoing
        on outgoing.transfer_document_id=document.id and outgoing.movement_type='transfer_out'
      left join public.inventory_movements incoming
        on incoming.transfer_document_id=document.id and incoming.movement_type='transfer_in'
      left join public.inventory_movement_cost_snapshots snapshot on snapshot.movement_id=outgoing.id
    ),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_minuta_inventory_workspace_v130(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_inventory_workspace_v130(uuid) to authenticated;

do $$ begin
  if to_regclass('public.organization_inventory_transfer_settings') is null
     or to_regclass('public.inventory_transfer_documents') is null
     or to_regclass('public.inventory_cost_layers') is null
     or to_regclass('public.inventory_movement_cost_snapshots') is null
     or to_regclass('public.inventory_cost_allocations') is null
     or to_regprocedure('public.enable_minuta_inventory_transfers_v130(uuid)') is null
     or to_regprocedure('public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean)') is null
     or to_regprocedure('public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)') is null
     or to_regprocedure('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)') is null
     or to_regprocedure('public.get_minuta_inventory_workspace_v130(uuid)') is null
     or has_function_privilege('anon','public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)','EXECUTE') then
    raise exception using errcode='P0001',message='v130_inventory_transfer_schema_invalid';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
