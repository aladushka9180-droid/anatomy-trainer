begin;
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.booking_session_items') is null
     or to_regclass('public.inventory_movements') is null
     or to_regclass('public.inventory_service_usage') is null
     or to_regclass('public.booking_resource_allocations') is null
     or to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v164_repeat_visit_prerequisites_missing';
  end if;
end
$guard$;

create or replace function public.minuta_provider_repeat_visit_payload_v164(p_booking uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype;
  v_items jsonb;
  v_materials jsonb;
  v_payload jsonb;
  v_signature text;
begin
  select * into v_booking from public.bookings booking
  where booking.id=p_booking and booking.performer_id=p_actor;
  if not found then raise exception using errcode='42501',message='repeat_source_access_denied'; end if;
  if v_booking.status='cancelled' or v_booking.client_phone='0000000000' then
    raise exception using errcode='P0001',message='repeat_source_unavailable';
  end if;

  if not exists(select 1 from public.services service where service.id=v_booking.service_id and service.performer_id=p_actor and service.active) then
    raise exception using errcode='P0001',message='repeat_service_unavailable';
  end if;
  if exists(
    select 1 from public.booking_session_items entry
    where entry.booking_id=p_booking and entry.service_id is not null
      and not exists(select 1 from public.services service where service.id=entry.service_id and service.performer_id=p_actor and service.active)
  ) then raise exception using errcode='P0001',message='repeat_service_unavailable'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind',entry.item_kind,'service_id',entry.service_id,'title',entry.title,
    'duration_minutes',entry.duration_minutes,'price_rub',entry.price_rub,
    'extends_duration',entry.extends_duration
  ) order by case when entry.item_kind='primary' then 0 else 1 end,entry.position,entry.id),'[]'::jsonb)
  into v_items from public.booking_session_items entry where entry.booking_id=p_booking;
  if jsonb_array_length(v_items)=0 then
    select jsonb_build_array(jsonb_build_object(
      'kind','primary','service_id',service.id,'title',service.name,
      'duration_minutes',v_booking.duration_minutes,
      'price_rub',coalesce(v_booking.total_price_rub,v_booking.original_price_rub,service.price_rub,0),
      'extends_duration',true
    )) into v_items from public.services service where service.id=v_booking.service_id;
  end if;

  if exists(select 1 from public.inventory_movements movement where movement.booking_id=p_booking and movement.movement_type='service_use') then
    select coalesce(jsonb_agg(jsonb_build_object(
      'inventory_item_id',material.inventory_item_id,'name',material.name,'unit',material.unit,'quantity',material.quantity
    ) order by material.name,material.inventory_item_id),'[]'::jsonb)
    into v_materials from (
      select item.id inventory_item_id,item.name,item.unit,abs(sum(movement.quantity_delta)) quantity
      from public.inventory_movements movement
      join public.inventory_items item on item.id=movement.inventory_item_id and item.organization_id=v_booking.organization_id
      where movement.booking_id=p_booking and movement.movement_type='service_use' and movement.quantity_delta<0
      group by item.id,item.name,item.unit
    ) material;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'inventory_item_id',material.inventory_item_id,'name',material.name,'unit',material.unit,'quantity',material.quantity
    ) order by material.name,material.inventory_item_id),'[]'::jsonb)
    into v_materials from (
      select item.id inventory_item_id,item.name,item.unit,sum(usage.quantity) quantity
      from public.inventory_service_usage usage
      join public.inventory_items item on item.id=usage.inventory_item_id and item.organization_id=v_booking.organization_id and item.active
      where usage.organization_id=v_booking.organization_id
        and usage.service_id in (select nullif(value->>'service_id','')::uuid from jsonb_array_elements(v_items) value)
      group by item.id,item.name,item.unit
    ) material;
  end if;

  if exists(
    select 1 from jsonb_array_elements(v_materials) material
    where not exists(select 1 from public.inventory_items item
      where item.id=(material->>'inventory_item_id')::uuid and item.organization_id=v_booking.organization_id and item.active)
  ) then raise exception using errcode='P0001',message='repeat_material_unavailable'; end if;

  v_payload:=jsonb_build_object(
    'source_booking_id',v_booking.id,'client_name',v_booking.client_name,'client_phone',v_booking.client_phone,
    'duration_minutes',v_booking.duration_minutes,
    'total_price_rub',coalesce(v_booking.total_price_rub,(select sum((value->>'price_rub')::integer) from jsonb_array_elements(v_items) value),0),
    'comment',coalesce(v_booking.provider_note,''),'items',v_items,'materials',v_materials
  );
  v_signature:=encode(extensions.digest(convert_to(v_payload::text,'UTF8'),'sha256'),'hex');
  return v_payload||jsonb_build_object('source_signature',v_signature);
end $$;
revoke all on function public.minuta_provider_repeat_visit_payload_v164(uuid,uuid) from public,anon,authenticated,service_role;
comment on function public.minuta_provider_repeat_visit_payload_v164(uuid,uuid) is 'minuta:v164:repeat-visit:payload';

create or replace function public.get_provider_repeat_visit_v164(p_booking uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  return public.minuta_provider_repeat_visit_payload_v164(p_booking,auth.uid());
end $$;
revoke all on function public.get_provider_repeat_visit_v164(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_provider_repeat_visit_v164(uuid) to authenticated;
comment on function public.get_provider_repeat_visit_v164(uuid) is 'minuta:v164:repeat-visit:preview';

create or replace function public.provider_repeat_appointment_v164(
  p_request_id uuid,p_source_booking uuid,p_source_signature text,p_date date,p_time time without time zone,
  p_client_name text,p_client_phone text,p_total_price_rub integer,p_comment text
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_preview jsonb;
  v_existing public.bookings%rowtype;
  v_booking public.bookings%rowtype;
  v_code text;
  v_token uuid;
  v_source_total integer;
  v_addon_total integer;
  v_primary_price integer;
  v_duration integer;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null or p_source_booking is null or p_date is null or p_time is null then
    raise exception using errcode='22023',message='invalid_repeat_booking';
  end if;
  if p_total_price_rub is null or p_total_price_rub not between 0 and 10000000 then
    raise exception using errcode='22023',message='invalid_repeat_price';
  end if;
  if char_length(coalesce(p_comment,''))>1000 then raise exception using errcode='22023',message='invalid_repeat_comment'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_request_id::text,16400));
  select * into v_existing from public.bookings booking where booking.request_id=p_request_id;
  if found then
    if v_existing.performer_id<>v_actor or v_existing.booking_policy_snapshot->>'repeat_source_id'<>p_source_booking::text then
      raise exception using errcode='P0001',message='request_conflict';
    end if;
    return jsonb_build_object('booking_id',v_existing.id,'booking_code',v_existing.booking_code,'request_id',p_request_id,'recovered',true);
  end if;

  v_preview:=public.minuta_provider_repeat_visit_payload_v164(p_source_booking,v_actor);
  if v_preview->>'source_signature' is distinct from lower(trim(coalesce(p_source_signature,''))) then
    raise exception using errcode='P0001',message='repeat_source_changed';
  end if;
  v_duration:=(v_preview->>'duration_minutes')::integer;
  v_source_total:=(v_preview->>'total_price_rub')::integer;
  select coalesce(sum((value->>'price_rub')::integer),0) into v_addon_total
    from jsonb_array_elements(v_preview->'items') value where value->>'kind'='addon';
  v_primary_price:=p_total_price_rub-v_addon_total;
  if v_primary_price not between 0 and 1000000 then raise exception using errcode='22023',message='invalid_repeat_price'; end if;

  select result.booking_code,result.manage_token into v_code,v_token
  from public.book_appointment(
    p_request_id,(v_preview->'items'->0->>'service_id')::uuid,p_date,p_time,
    coalesce(nullif(btrim(p_client_name),''),v_preview->>'client_name'),
    coalesce(nullif(btrim(p_client_phone),''),v_preview->>'client_phone')
  ) result;
  select * into v_booking from public.bookings booking where booking.request_id=p_request_id for update;
  if not found or v_booking.performer_id<>v_actor or v_booking.booking_code<>v_code then
    raise exception using errcode='55000',message='provider_booking_acknowledgement_mismatch';
  end if;
  if exists(
    select 1 from public.bookings other where other.performer_id=v_actor and other.id<>v_booking.id
      and other.booking_date=p_date and other.status<>'cancelled'
      and p_time<other.booking_time+make_interval(mins=>other.duration_minutes)
      and p_time+make_interval(mins=>v_duration)>other.booking_time
  ) then raise exception using errcode='23P01',message='slot_unavailable'; end if;
  if not exists(
    select 1 from public.provider_schedule schedule
    where schedule.performer_id=v_actor and schedule.weekday=extract(isodow from p_date)::integer and schedule.enabled
      and p_time>=schedule.start_time and p_time+make_interval(mins=>v_duration)<=schedule.end_time
      and not (schedule.break_start is not null and tsrange(p_date+p_time,p_date+p_time+make_interval(mins=>v_duration),'[)') && tsrange(p_date+schedule.break_start,p_date+schedule.break_end,'[)'))
  ) or exists(
    select 1 from public.provider_days_off day_off where day_off.performer_id=v_actor and day_off.off_date=p_date
      and (day_off.all_day or tsrange(p_date+p_time,p_date+p_time+make_interval(mins=>v_duration),'[)') && tsrange(p_date+day_off.start_time,p_date+day_off.end_time,'[)'))
  ) then raise exception using errcode='23P01',message='slot_unavailable'; end if;

  delete from public.booking_session_items where booking_id=v_booking.id;
  insert into public.booking_session_items(
    booking_id,performer_id,position,item_kind,service_id,title,duration_minutes,price_rub,extends_duration
  ) select v_booking.id,v_actor,ordinality::integer,value->>'kind',nullif(value->>'service_id','')::uuid,
      btrim(value->>'title'),(value->>'duration_minutes')::integer,
      case when value->>'kind'='primary' then v_primary_price else (value->>'price_rub')::integer end,
      case when value->>'kind'='primary' then true else coalesce((value->>'extends_duration')::boolean,false) end
    from jsonb_array_elements(v_preview->'items') with ordinality;

  update public.bookings booking set
    duration_minutes=v_duration,
    original_price_rub=v_source_total,
    total_price_rub=p_total_price_rub,
    booking_source='provider_manual',
    provider_note=btrim(coalesce(p_comment,'')),
    booking_policy_snapshot=coalesce(booking.booking_policy_snapshot,'{}'::jsonb)||jsonb_build_object(
      'repeat_source_id',p_source_booking,'repeat_source_signature',p_source_signature,
      'repeat_materials',v_preview->'materials'
    )
  where booking.id=v_booking.id returning * into v_booking;

  update public.booking_resource_allocations allocation
  set ends_at=allocation.starts_at+make_interval(mins=>v_duration)
  where allocation.booking_id=v_booking.id;

  insert into public.booking_session_revisions(booking_id,performer_id,items,total_price_rub,total_duration_minutes)
  select v_booking.id,v_actor,jsonb_agg(jsonb_build_object(
      'kind',entry.item_kind,'service_id',entry.service_id,'title',entry.title,
      'duration_minutes',entry.duration_minutes,'price_rub',entry.price_rub,'extends_duration',entry.extends_duration
    ) order by entry.position,entry.id),p_total_price_rub,v_duration
  from public.booking_session_items entry where entry.booking_id=v_booking.id;
  perform public.write_minuta_schedule_audit(v_booking.organization_id,'booking_repeated',v_booking.id,
    jsonb_build_object('source_booking_id',p_source_booking,'services',jsonb_array_length(v_preview->'items'),'materials',jsonb_array_length(v_preview->'materials'),'total_price_rub',p_total_price_rub));
  return jsonb_build_object('booking_id',v_booking.id,'booking_code',v_booking.booking_code,'request_id',p_request_id,'recovered',false);
end $$;
revoke all on function public.provider_repeat_appointment_v164(uuid,uuid,text,date,time without time zone,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.provider_repeat_appointment_v164(uuid,uuid,text,date,time without time zone,text,text,integer,text) to authenticated;
comment on function public.provider_repeat_appointment_v164(uuid,uuid,text,date,time without time zone,text,text,integer,text) is 'minuta:v164:repeat-visit:create';

-- A repeated visit consumes the material snapshot captured from its source.
-- Ordinary visits keep the current service-norm behavior.
create or replace function public.consume_minuta_inventory_for_booking(p_booking uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype; v_warehouse uuid; v_usage record;
  v_before numeric(14,3); v_after numeric(14,3); v_existing integer; v_repeat_materials jsonb;
begin
  select * into v_booking from public.bookings booking where booking.id=p_booking for update;
  if v_booking.id is null or v_booking.organization_id is null or v_booking.location_id is null then return; end if;
  if not exists(select 1 from public.booking_outcomes outcome where outcome.booking_id=p_booking and outcome.visit_status='completed') then return; end if;
  if not coalesce((select enabled and auto_deduct_completed_visits from public.organization_inventory_settings where organization_id=v_booking.organization_id),false) then return; end if;
  perform pg_advisory_xact_lock_shared(13000);
  perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text,13001));
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,8202));
  select count(*) into v_existing from public.inventory_movements where booking_id=p_booking and movement_type='service_use';
  if v_existing>0 then return; end if;
  v_repeat_materials:=v_booking.booking_policy_snapshot->'repeat_materials';
  if jsonb_typeof(v_repeat_materials)='array' and jsonb_array_length(v_repeat_materials)>0 then
    if exists(select 1 from jsonb_array_elements(v_repeat_materials) material where not exists(
      select 1 from public.inventory_items item where item.id=(material->>'inventory_item_id')::uuid and item.organization_id=v_booking.organization_id and item.active
    )) then raise exception using errcode='55000',message='repeat_material_unavailable'; end if;
  elsif not exists(select 1 from public.inventory_service_usage usage where usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id) then return;
  end if;
  select warehouse.id into v_warehouse from public.inventory_warehouses warehouse
    where warehouse.organization_id=v_booking.organization_id and warehouse.location_id=v_booking.location_id and warehouse.active for update;
  if v_warehouse is null then raise exception using errcode='55000',message='inventory_warehouse_missing_for_location'; end if;
  for v_usage in
    select material.inventory_item_id,material.quantity from (
      select (value->>'inventory_item_id')::uuid inventory_item_id,(value->>'quantity')::numeric quantity
      from jsonb_array_elements(v_repeat_materials) value where jsonb_typeof(v_repeat_materials)='array'
      union all
      select usage.inventory_item_id,usage.quantity from public.inventory_service_usage usage
      where jsonb_typeof(v_repeat_materials) is distinct from 'array'
        and usage.organization_id=v_booking.organization_id and usage.service_id=v_booking.service_id
    ) material order by material.inventory_item_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_warehouse::text||':'||v_usage.inventory_item_id::text,8201));
    insert into public.inventory_stock_balances(organization_id,warehouse_id,inventory_item_id,quantity)
      values(v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,0) on conflict do nothing;
    select quantity into v_before from public.inventory_stock_balances
      where organization_id=v_booking.organization_id and warehouse_id=v_warehouse and inventory_item_id=v_usage.inventory_item_id for update;
    v_after:=v_before-v_usage.quantity;
    if v_after<0 then raise exception using errcode='55000',message='insufficient_inventory_stock_for_completed_visit'; end if;
    update public.inventory_stock_balances set quantity=v_after,updated_at=now()
      where organization_id=v_booking.organization_id and warehouse_id=v_warehouse and inventory_item_id=v_usage.inventory_item_id;
    insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,booking_id,movement_type,quantity_delta,quantity_after,request_id,reason,actor_id)
    values(v_booking.organization_id,v_warehouse,v_usage.inventory_item_id,p_booking,'service_use',-v_usage.quantity,v_after,gen_random_uuid(),'Автоматическое списание по завершённому визиту',auth.uid());
  end loop;
  perform public.write_minuta_inventory_audit(v_booking.organization_id,'inventory_booking_consumed',p_booking,
    jsonb_build_object('warehouse_id',v_warehouse,'service_id',v_booking.service_id,'repeat_snapshot',jsonb_typeof(v_repeat_materials)='array'));
end $$;
revoke all on function public.consume_minuta_inventory_for_booking(uuid) from public,anon,authenticated,service_role;
comment on function public.consume_minuta_inventory_for_booking(uuid) is 'minuta:v164:repeat-visit:inventory';

notify pgrst,'reload schema';
commit;
