begin;

set local search_path = public, extensions, pg_catalog;

-- Additive material-cost and visit-profitability ledger. Existing inventory
-- quantities, write-offs, booking outcomes and payroll snapshots stay intact.
do $$ begin
  if to_regclass('public.inventory_items') is null
     or to_regclass('public.inventory_stock_balances') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.inventory_service_usage') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.payroll_items') is null
     or to_regclass('public.payroll_periods') is null
     or to_regprocedure('public.get_minuta_inventory_role(uuid)') is null
     or to_regprocedure('public.get_minuta_inventory_workspace(uuid)') is null
     or to_regprocedure('public.write_minuta_inventory_audit(uuid,text,uuid,jsonb)') is null then
    raise exception using errcode='P0001',message='v113_requires_inventory_v82_and_payroll_v72';
  end if;
end $$;

alter table public.inventory_movements
  add column if not exists purchase_total_cost_kopecks bigint;

do $$ begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.inventory_movements'::regclass
      and conname='inventory_purchase_cost_receipt_only_v113'
  ) then
    alter table public.inventory_movements
      add constraint inventory_purchase_cost_receipt_only_v113
      check(purchase_total_cost_kopecks is null or (
        movement_type='receipt' and purchase_total_cost_kopecks between 0 and 1000000000000
      ));
  end if;
end $$;

create table if not exists public.inventory_cost_layers (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  warehouse_id uuid not null,
  inventory_item_id uuid not null,
  source_key text not null unique,
  source_movement_id bigint references public.inventory_movements(id) on delete restrict,
  original_quantity numeric(14,3) not null check(original_quantity>0),
  remaining_quantity numeric(14,3) not null check(remaining_quantity>=0 and remaining_quantity<=original_quantity),
  unit_cost_kopecks numeric(20,6),
  created_at timestamptz not null default now(),
  foreign key(warehouse_id,organization_id) references public.inventory_warehouses(id,organization_id) on delete restrict,
  foreign key(inventory_item_id,organization_id) references public.inventory_items(id,organization_id) on delete restrict,
  check(unit_cost_kopecks is null or unit_cost_kopecks>=0)
);

create unique index if not exists inventory_cost_layers_source_movement_idx
  on public.inventory_cost_layers(source_movement_id) where source_movement_id is not null;
create index if not exists inventory_cost_layers_fifo_idx
  on public.inventory_cost_layers(organization_id,warehouse_id,inventory_item_id,created_at,id)
  where remaining_quantity>0;

create table if not exists public.inventory_movement_cost_snapshots (
  movement_id bigint primary key references public.inventory_movements(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  quantity_costed numeric(14,3) not null check(quantity_costed>=0),
  total_cost_kopecks bigint,
  cost_complete boolean not null,
  created_at timestamptz not null default now(),
  check(total_cost_kopecks is null or total_cost_kopecks>=0),
  check(cost_complete=(total_cost_kopecks is not null))
);

create table if not exists public.inventory_cost_allocations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  movement_id bigint not null references public.inventory_movements(id) on delete restrict,
  cost_layer_id bigint not null references public.inventory_cost_layers(id) on delete restrict,
  quantity numeric(14,3) not null check(quantity>0),
  unit_cost_kopecks numeric(20,6),
  cost_amount_kopecks numeric(24,6),
  created_at timestamptz not null default now(),
  unique(movement_id,cost_layer_id),
  check(unit_cost_kopecks is null or unit_cost_kopecks>=0),
  check(cost_amount_kopecks is null or cost_amount_kopecks>=0),
  check((unit_cost_kopecks is null)=(cost_amount_kopecks is null))
);

create table if not exists public.inventory_service_cost_settings (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  effective_from date not null default (timezone('Europe/Samara',now())::date),
  material_mode text not null check(material_mode in ('tracked','none')),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(service_id,effective_from)
);
create index if not exists inventory_service_cost_settings_history_idx
  on public.inventory_service_cost_settings(organization_id,service_id,effective_from desc,id desc);

create table if not exists public.booking_confirmed_commissions (
  booking_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  amount_kopecks bigint not null check(amount_kopecks between 0 and 1000000000000),
  note text not null default '' check(char_length(note)<=500),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(booking_id,organization_id) references public.bookings(id,organization_id) on delete restrict
);

alter table public.inventory_cost_layers enable row level security;
alter table public.inventory_movement_cost_snapshots enable row level security;
alter table public.inventory_cost_allocations enable row level security;
alter table public.inventory_service_cost_settings enable row level security;
alter table public.booking_confirmed_commissions enable row level security;

revoke all on public.inventory_cost_layers,public.inventory_movement_cost_snapshots,
  public.inventory_cost_allocations,public.inventory_service_cost_settings,
  public.booking_confirmed_commissions from public,anon,authenticated;
grant all on public.inventory_cost_layers,public.inventory_movement_cost_snapshots,
  public.inventory_cost_allocations,public.inventory_service_cost_settings,
  public.booking_confirmed_commissions to service_role;

-- Current stock predates cost accounting and is deliberately represented as
-- an unknown-cost opening layer. It must never be silently valued at zero.
insert into public.inventory_cost_layers(
  organization_id,warehouse_id,inventory_item_id,source_key,
  original_quantity,remaining_quantity,unit_cost_kopecks,created_at
)
select balance.organization_id,balance.warehouse_id,balance.inventory_item_id,
  'opening-v113:'||balance.warehouse_id::text||':'||balance.inventory_item_id::text,
  balance.quantity,balance.quantity,null,balance.updated_at
from public.inventory_stock_balances balance
where balance.quantity>0
on conflict(source_key) do nothing;

create or replace function public.record_minuta_inventory_cost_v113()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_remaining numeric(14,3);
  v_take numeric(14,3);
  v_total numeric(24,6):=0;
  v_complete boolean:=true;
  v_layer record;
  v_unit numeric(20,6);
begin
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
      new.organization_id,new.warehouse_id,new.inventory_item_id,'movement-v113:'||new.id::text,new.id,
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
revoke all on function public.record_minuta_inventory_cost_v113() from public,anon,authenticated,service_role;

drop trigger if exists inventory_movement_cost_v113 on public.inventory_movements;
create trigger inventory_movement_cost_v113 after insert on public.inventory_movements
for each row execute function public.record_minuta_inventory_cost_v113();

create or replace function public.apply_minuta_stock_movement_v113(
  p_organization uuid,p_warehouse uuid,p_item uuid,p_kind text,p_quantity numeric,
  p_counted_quantity numeric,p_reason text,p_request_id uuid,p_purchase_total_cost_kopecks bigint
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_before numeric(14,3); v_delta numeric(14,3); v_after numeric(14,3);
  v_existing public.inventory_movements%rowtype; v_movement bigint;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if not coalesce((select enabled from public.organization_inventory_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='inventory_disabled';
  end if;
  if p_request_id is null then raise exception using errcode='22023',message='inventory_request_id_required'; end if;
  if coalesce(p_kind,'') not in ('receipt','write_off','inventory') then raise exception using errcode='22023',message='invalid_inventory_movement'; end if;
  if p_purchase_total_cost_kopecks is not null and (
    p_kind<>'receipt' or p_purchase_total_cost_kopecks<0 or p_purchase_total_cost_kopecks>1000000000000
  ) then raise exception using errcode='22023',message='invalid_inventory_purchase_cost'; end if;
  if not exists(select 1 from public.inventory_warehouses where id=p_warehouse and organization_id=p_organization and active)
     or not exists(select 1 from public.inventory_items where id=p_item and organization_id=p_organization and active) then
    raise exception using errcode='55000',message='inventory_target_inactive';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8200));
  select * into v_existing from public.inventory_movements
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.warehouse_id<>p_warehouse
       or v_existing.inventory_item_id<>p_item
       or v_existing.movement_type<>p_kind
       or v_existing.purchase_total_cost_kopecks is distinct from p_purchase_total_cost_kopecks
       or (p_kind='receipt' and v_existing.quantity_delta<>p_quantity)
       or (p_kind='write_off' and v_existing.quantity_delta<>-p_quantity)
       or (p_kind='inventory' and v_existing.quantity_after<>p_counted_quantity) then
      raise exception using errcode='23505',message='inventory_request_conflict';
    end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,
      'quantity_after',v_existing.quantity_after,'purchase_total_cost_kopecks',v_existing.purchase_total_cost_kopecks);
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
    v_delta:=case when p_kind='receipt' then p_quantity else -p_quantity end;
    v_after:=v_before+v_delta;
  end if;
  if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock'; end if;
  if p_kind in ('write_off','inventory') and char_length(trim(coalesce(p_reason,'')))<2 then
    raise exception using errcode='22023',message='inventory_reason_required';
  end if;
  update public.inventory_stock_balances set quantity=v_after,updated_at=now()
    where organization_id=p_organization and warehouse_id=p_warehouse and inventory_item_id=p_item;
  insert into public.inventory_movements(
    organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,
    request_id,reason,actor_id,purchase_total_cost_kopecks
  ) values(
    p_organization,p_warehouse,p_item,p_kind,v_delta,v_after,p_request_id,
    trim(coalesce(p_reason,'')),auth.uid(),p_purchase_total_cost_kopecks
  ) returning id into v_movement;
  perform public.write_minuta_inventory_audit(
    p_organization,'inventory_movement_recorded',p_item,
    jsonb_build_object('movement_id',v_movement,'warehouse_id',p_warehouse,'kind',p_kind,
      'purchase_cost_recorded',p_purchase_total_cost_kopecks is not null)
  );
  return jsonb_build_object('organization_id',p_organization,'id',v_movement,
    'quantity_after',v_after,'purchase_total_cost_kopecks',p_purchase_total_cost_kopecks);
end $$;
revoke all on function public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)
  to authenticated;

create or replace function public.set_minuta_service_material_mode_v113(
  p_organization uuid,p_service uuid,p_material_mode text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if coalesce(p_material_mode,'') not in ('tracked','none') then
    raise exception using errcode='22023',message='invalid_material_cost_mode';
  end if;
  if not exists(
    select 1 from public.services service
    join public.organization_memberships membership
      on membership.organization_id=p_organization and membership.user_id=service.performer_id
      and membership.active and membership.is_bookable
    where service.id=p_service
  ) then raise exception using errcode='23503',message='service_not_in_organization'; end if;
  insert into public.inventory_service_cost_settings(organization_id,service_id,effective_from,material_mode,updated_by)
    values(p_organization,p_service,timezone('Europe/Samara',now())::date,p_material_mode,auth.uid())
    on conflict(service_id,effective_from) do update set
      organization_id=excluded.organization_id,material_mode=excluded.material_mode,
      updated_by=excluded.updated_by,updated_at=now();
  perform public.write_minuta_inventory_audit(
    p_organization,'service_material_cost_mode_saved',p_service,
    jsonb_build_object('material_mode',p_material_mode)
  );
  return jsonb_build_object('organization_id',p_organization,'service_id',p_service,'material_mode',p_material_mode);
end $$;
revoke all on function public.set_minuta_service_material_mode_v113(uuid,uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_service_material_mode_v113(uuid,uuid,text) to authenticated;

create or replace function public.save_minuta_booking_commission_v113(
  p_organization uuid,p_booking uuid,p_amount_kopecks bigint,p_note text default ''
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_previous bigint;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if p_amount_kopecks is null or p_amount_kopecks<0 or p_amount_kopecks>1000000000000
     or char_length(coalesce(p_note,''))>500 then
    raise exception using errcode='22023',message='invalid_confirmed_commission';
  end if;
  if not exists(
    select 1 from public.bookings booking
    join public.booking_outcomes outcome on outcome.booking_id=booking.id and outcome.visit_status='completed'
    where booking.id=p_booking and booking.organization_id=p_organization
  ) then raise exception using errcode='23503',message='completed_booking_not_found'; end if;
  select amount_kopecks into v_previous from public.booking_confirmed_commissions
    where booking_id=p_booking for update;
  insert into public.booking_confirmed_commissions(
    booking_id,organization_id,amount_kopecks,note,confirmed_by
  ) values(p_booking,p_organization,p_amount_kopecks,trim(coalesce(p_note,'')),auth.uid())
  on conflict(booking_id) do update set
    organization_id=excluded.organization_id,amount_kopecks=excluded.amount_kopecks,
    note=excluded.note,confirmed_by=excluded.confirmed_by,confirmed_at=now(),updated_at=now();
  perform public.write_minuta_inventory_audit(
    p_organization,'booking_commission_confirmed',p_booking,
    jsonb_build_object('previous_amount_kopecks',v_previous,'amount_kopecks',p_amount_kopecks)
  );
  return jsonb_build_object('organization_id',p_organization,'booking_id',p_booking,
    'amount_kopecks',p_amount_kopecks,'confirmed',true);
end $$;
revoke all on function public.save_minuta_booking_commission_v113(uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_booking_commission_v113(uuid,uuid,bigint,text) to authenticated;

create or replace function public.get_minuta_inventory_workspace_v113(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_base jsonb; v_items jsonb; v_movements jsonb;
begin
  v_base:=public.get_minuta_inventory_workspace(p_organization);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',item.id,'name',item.name,'sku',item.sku,'unit',item.unit,
    'low_stock_threshold',item.low_stock_threshold,'active',item.active,
    'last_purchase_total_cost_kopecks',last_receipt.purchase_total_cost_kopecks,
    'last_purchase_quantity',last_receipt.quantity_delta,
    'stock_value_kopecks',case
      when coalesce(stock.quantity,0)=0 then 0
      when stock.unknown_quantity=0 then round(stock.known_value)::bigint
      else null end,
    'stock_cost_complete',coalesce(stock.quantity,0)=0 or stock.unknown_quantity=0
  ) order by item.active desc,item.name,item.id),'[]'::jsonb)
  into v_items
  from public.inventory_items item
  left join lateral(
    select movement.purchase_total_cost_kopecks,movement.quantity_delta
    from public.inventory_movements movement
    where movement.organization_id=p_organization and movement.inventory_item_id=item.id
      and movement.movement_type='receipt'
    order by movement.created_at desc,movement.id desc limit 1
  ) last_receipt on true
  left join lateral(
    select coalesce(sum(layer.remaining_quantity),0) quantity,
      coalesce(sum(layer.remaining_quantity) filter(where layer.unit_cost_kopecks is null),0) unknown_quantity,
      coalesce(sum(layer.remaining_quantity*layer.unit_cost_kopecks) filter(where layer.unit_cost_kopecks is not null),0) known_value
    from public.inventory_cost_layers layer
    where layer.organization_id=p_organization and layer.inventory_item_id=item.id
  ) stock on true
  where item.organization_id=p_organization;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',movement.id,'warehouse_id',movement.warehouse_id,'inventory_item_id',movement.inventory_item_id,
    'booking_id',movement.booking_id,'movement_type',movement.movement_type,
    'quantity_delta',movement.quantity_delta,'quantity_after',movement.quantity_after,
    'reason',movement.reason,'created_at',movement.created_at,
    'purchase_total_cost_kopecks',movement.purchase_total_cost_kopecks,
    'material_cost_kopecks',snapshot.total_cost_kopecks,
    'material_cost_complete',snapshot.cost_complete
  ) order by movement.created_at desc,movement.id desc),'[]'::jsonb)
  into v_movements
  from(
    select * from public.inventory_movements
    where organization_id=p_organization order by created_at desc,id desc limit 200
  ) movement
  left join public.inventory_movement_cost_snapshots snapshot on snapshot.movement_id=movement.id;

  return v_base||jsonb_build_object(
    'costing_version',113,'items',v_items,'movements',v_movements,
    'service_cost_settings',coalesce((
      select jsonb_agg(jsonb_build_object('service_id',setting.service_id,'material_mode',setting.material_mode,
        'effective_from',setting.effective_from) order by setting.service_id)
      from(
        select distinct on(history.service_id) history.*
        from public.inventory_service_cost_settings history
        where history.organization_id=p_organization and history.effective_from<=timezone('Europe/Samara',now())::date
        order by history.service_id,history.effective_from desc,history.id desc
      ) setting
    ),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_minuta_inventory_workspace_v113(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_inventory_workspace_v113(uuid) to authenticated;

create or replace function public.get_minuta_profitability_v113(
  p_organization uuid,p_start date,p_end date,p_service uuid default null,p_booking uuid default null
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_result jsonb;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then
    raise exception using errcode='22023',message='invalid_profitability_range';
  end if;
  with visit_source as(
    select booking.id booking_id,booking.booking_date,booking.service_id,service.name service_name,
      profile.display_name performer_name,
      case when outcome.amount_rub is null then null else outcome.amount_rub::bigint*100 end revenue_kopecks,
      case
        when material.movement_count>0 and material.movement_count=material.complete_count
          then material.total_cost_kopecks
        when material.movement_count=0 and setting.material_mode='none' then 0
        else null
      end material_cost_kopecks,
      commission.amount_kopecks commission_kopecks,
      case when payout.item_count>0 then payout.amount_kopecks else null end payout_kopecks,
      coalesce(material.movement_count,0) material_movement_count,
      coalesce(material.complete_count,0) material_complete_count,
      coalesce(setting.material_mode,case when material.movement_count>0 then 'tracked' else 'unspecified' end) material_mode,
      commission.confirmed_at commission_confirmed_at,
      payout.paid_at payout_paid_at
    from public.bookings booking
    join public.booking_outcomes outcome on outcome.booking_id=booking.id and outcome.visit_status='completed'
    join public.services service on service.id=booking.service_id
    join public.performer_profiles profile on profile.id=booking.performer_id
    left join lateral(
      select history.material_mode
      from public.inventory_service_cost_settings history
      where history.organization_id=booking.organization_id and history.service_id=booking.service_id
        and history.effective_from<=booking.booking_date
      order by history.effective_from desc,history.id desc limit 1
    ) setting on true
    left join lateral(
      select count(*)::integer movement_count,
        count(*) filter(where snapshot.cost_complete)::integer complete_count,
        coalesce(sum(snapshot.total_cost_kopecks) filter(where snapshot.cost_complete),0)::bigint total_cost_kopecks
      from public.inventory_movements movement
      left join public.inventory_movement_cost_snapshots snapshot on snapshot.movement_id=movement.id
      where movement.organization_id=booking.organization_id and movement.booking_id=booking.id
        and movement.movement_type='service_use'
    ) material on true
    left join public.booking_confirmed_commissions commission
      on commission.organization_id=booking.organization_id and commission.booking_id=booking.id
    left join lateral(
      select count(*)::integer item_count,coalesce(sum(item.payroll_rub),0)::bigint*100 amount_kopecks,
        max(period.paid_at) paid_at
      from public.payroll_items item
      join public.payroll_periods period on period.id=item.period_id and period.status='paid'
      where item.organization_id=booking.organization_id and item.booking_id=booking.id
    ) payout on true
    where booking.organization_id=p_organization and booking.booking_date between p_start and p_end
      and (p_service is null or booking.service_id=p_service)
      and (p_booking is null or booking.id=p_booking)
  ), visits as(
    select source.*,
      case when source.revenue_kopecks is not null
             and source.material_cost_kopecks is not null
             and source.commission_kopecks is not null
             and source.payout_kopecks is not null
        then source.revenue_kopecks-source.material_cost_kopecks-source.commission_kopecks-source.payout_kopecks
        else null end remainder_before_overhead_kopecks
    from visit_source source
  ), service_rows as(
    select service_id,min(service_name) service_name,count(*)::integer visit_count,
      case when count(revenue_kopecks)=count(*) then sum(revenue_kopecks)::bigint else null end revenue_kopecks,
      case when count(material_cost_kopecks)=count(*) then sum(material_cost_kopecks)::bigint else null end material_cost_kopecks,
      case when count(commission_kopecks)=count(*) then sum(commission_kopecks)::bigint else null end commission_kopecks,
      case when count(payout_kopecks)=count(*) then sum(payout_kopecks)::bigint else null end payout_kopecks,
      case when count(remainder_before_overhead_kopecks)=count(*) then sum(remainder_before_overhead_kopecks)::bigint else null end remainder_before_overhead_kopecks,
      count(*) filter(where material_cost_kopecks is null)::integer missing_material_cost_count,
      count(*) filter(where commission_kopecks is null)::integer missing_commission_count,
      count(*) filter(where payout_kopecks is null)::integer missing_payout_count
    from visits group by service_id
  )
  select jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'period',jsonb_build_object('start',p_start,'end',p_end),
    'summary',jsonb_build_object(
      'visit_count',(select count(*) from visits),
      'revenue_kopecks',(select case when count(revenue_kopecks)=count(*) then coalesce(sum(revenue_kopecks),0)::bigint else null end from visits),
      'material_cost_kopecks',(select case when count(material_cost_kopecks)=count(*) then coalesce(sum(material_cost_kopecks),0)::bigint else null end from visits),
      'commission_kopecks',(select case when count(commission_kopecks)=count(*) then coalesce(sum(commission_kopecks),0)::bigint else null end from visits),
      'payout_kopecks',(select case when count(payout_kopecks)=count(*) then coalesce(sum(payout_kopecks),0)::bigint else null end from visits),
      'remainder_before_overhead_kopecks',(select case when count(remainder_before_overhead_kopecks)=count(*) then coalesce(sum(remainder_before_overhead_kopecks),0)::bigint else null end from visits),
      'missing_material_cost_count',(select count(*) from visits where material_cost_kopecks is null),
      'missing_commission_count',(select count(*) from visits where commission_kopecks is null),
      'missing_payout_count',(select count(*) from visits where payout_kopecks is null)
    ),
    'services',coalesce((select jsonb_agg(to_jsonb(service_result) order by service_result.remainder_before_overhead_kopecks desc nulls last,service_result.service_name,service_result.service_id) from service_rows service_result),'[]'::jsonb),
    'visits',coalesce((select jsonb_agg(jsonb_build_object(
      'booking_id',visit.booking_id,'booking_date',visit.booking_date,'service_id',visit.service_id,
      'service_name',visit.service_name,'performer_name',visit.performer_name,
      'revenue_kopecks',visit.revenue_kopecks,'material_cost_kopecks',visit.material_cost_kopecks,
      'commission_kopecks',visit.commission_kopecks,'payout_kopecks',visit.payout_kopecks,
      'remainder_before_overhead_kopecks',visit.remainder_before_overhead_kopecks,
      'material_mode',visit.material_mode,'material_movement_count',visit.material_movement_count,
      'material_complete_count',visit.material_complete_count,
      'commission_confirmed_at',visit.commission_confirmed_at,'payout_paid_at',visit.payout_paid_at
    ) order by visit.booking_date desc,visit.booking_id desc) from visits visit),'[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid) to authenticated;

do $$ begin
  if to_regclass('public.inventory_cost_layers') is null
     or to_regclass('public.inventory_movement_cost_snapshots') is null
     or to_regclass('public.booking_confirmed_commissions') is null
     or to_regprocedure('public.apply_minuta_stock_movement_v113(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint)') is null
     or to_regprocedure('public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)') is null
     or has_function_privilege('anon','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_minuta_profitability_v113(uuid,date,date,uuid,uuid)','EXECUTE') then
    raise exception using errcode='P0001',message='v113_profitability_schema_invalid';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
