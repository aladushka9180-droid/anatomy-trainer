begin;
set local search_path=public,extensions,pg_catalog;

drop function if exists public.provider_repeat_appointment_v164(uuid,uuid,text,date,time without time zone,text,text,integer,text);
drop function if exists public.get_provider_repeat_visit_v164(uuid);
drop function if exists public.minuta_provider_repeat_visit_payload_v164(uuid,uuid);

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
revoke all on function public.consume_minuta_inventory_for_booking(uuid) from public,anon,authenticated,service_role;
comment on function public.consume_minuta_inventory_for_booking(uuid) is null;

notify pgrst,'reload schema';
commit;
