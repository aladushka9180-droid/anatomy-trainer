\set ON_ERROR_STOP on
\if :{?source_slug}
\else
  \set source_slug 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'
\endif

\ir demo-statistics-cleanup.sql

begin;
select pg_advisory_xact_lock(hashtextextended('minuta-demo-statistics', 0));

select set_config(
  'minuta.demo_owner',
  coalesce((
    select membership.user_id::text
    from public.organizations organization
    join public.organization_memberships membership
      on membership.organization_id = organization.id
     and membership.active
     and membership.role = 'owner'
    where organization.public_slug = :'source_slug'
      and organization.status = 'active'
    order by membership.created_at, membership.user_id
    limit 1
  ), ''),
  false
);

do $$
begin
  if current_setting('minuta.demo_owner', true) = '' then
    raise exception using errcode = 'P0001', message = 'source_organization_owner_not_found';
  end if;
  if exists (
    select 1 from public.organizations
    where public_slug = 'minuta-demo-statistics'
      and id <> 'd3500000-0000-4000-8000-000000000001'
  ) then
    raise exception using errcode = 'P0001', message = 'demo_organization_slug_collision';
  end if;
end $$;

set local session_replication_role = replica;
insert into auth.users(
  id, instance_id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select
  ('d3500000-0000-4000-8000-' || lpad((100 + staff_no)::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated',
  format('demo.statistics.%s@example.invalid', staff_no), now(),
  '{}'::jsonb, jsonb_build_object('demo_fixture', 'demo_statistics'), now(), now()
from generate_series(1, 7) staff_no;
set local session_replication_role = origin;

insert into public.organizations(
  id, name, public_slug, status, public_booking_enabled, created_by
)
values(
  'd3500000-0000-4000-8000-000000000001',
  'Minuta Demo — статистика [demo_statistics]',
  'minuta-demo-statistics', 'active', false,
  current_setting('minuta.demo_owner')::uuid
);

insert into public.locations(id, organization_id, name, timezone, address, active, is_primary)
values
  ('d3500000-0000-4000-8000-000000000201','d3500000-0000-4000-8000-000000000001','Центр','Europe/Samara','Тестовый филиал · центр',true,true),
  ('d3500000-0000-4000-8000-000000000202','d3500000-0000-4000-8000-000000000001','Север','Europe/Samara','Тестовый филиал · север',true,false),
  ('d3500000-0000-4000-8000-000000000203','d3500000-0000-4000-8000-000000000001','Юг','Europe/Samara','Тестовый филиал · юг',true,false);

insert into public.organization_memberships(
  organization_id, user_id, role, is_bookable, active, created_by
)
values(
  'd3500000-0000-4000-8000-000000000001',current_setting('minuta.demo_owner')::uuid,'owner',false,true,current_setting('minuta.demo_owner')::uuid
);

insert into public.organization_memberships(
  organization_id, user_id, role, is_bookable, active, created_by
)
select
  'd3500000-0000-4000-8000-000000000001'::uuid,
  ('d3500000-0000-4000-8000-' || lpad((100 + staff_no)::text, 12, '0'))::uuid,
  'specialist', true, true, current_setting('minuta.demo_owner')::uuid
from generate_series(1, 7) staff_no;

insert into public.performer_profiles(id, display_name)
values
  ('d3500000-0000-4000-8000-000000000101','Анна · Центр'),
  ('d3500000-0000-4000-8000-000000000102','Мария · Центр'),
  ('d3500000-0000-4000-8000-000000000103','Ольга · Центр'),
  ('d3500000-0000-4000-8000-000000000104','Елена · Север'),
  ('d3500000-0000-4000-8000-000000000105','София · Север'),
  ('d3500000-0000-4000-8000-000000000106','Дарья · Юг'),
  ('d3500000-0000-4000-8000-000000000107','Ирина · Юг');

insert into public.services(id, performer_id, name, duration_minutes, price_rub, active)
select
  md5(format('demo-statistics-service-%s-%s', staff_no, service_no))::uuid,
  ('d3500000-0000-4000-8000-' || lpad((100 + staff_no)::text, 12, '0'))::uuid,
  case service_no
    when 1 then (array['Массаж спины','Спортивный массаж','Общий массаж','Массаж шеи','Лимфодренажный массаж','Массаж ног','Расслабляющий массаж'])[staff_no]
    else (array['Массаж спины + ШВЗ','Восстановительный массаж','Комплексный массаж','Массаж рук и головы','Массаж всего тела','Глубокий массаж','Массаж 90 минут'])[staff_no]
  end,
  case when service_no = 1 then 60 else 90 end,
  case when service_no = 1 then 2600 + staff_no * 120 else 3900 + staff_no * 170 end,
  true
from generate_series(1, 7) staff_no
cross join generate_series(1, 2) service_no;

insert into public.provider_schedule(
  performer_id, weekday, enabled, start_time, end_time,
  break_start, break_end, slot_interval_minutes
)
select
  ('d3500000-0000-4000-8000-' || lpad((100 + staff_no)::text, 12, '0'))::uuid,
  weekday,
  weekday between 1 and 6,
  time '09:00', time '20:00', time '13:00', time '14:00', 30
from generate_series(1, 7) staff_no
cross join generate_series(1, 7) weekday
on conflict(performer_id, weekday) do update set
  enabled = excluded.enabled,
  start_time = excluded.start_time,
  end_time = excluded.end_time,
  break_start = excluded.break_start,
  break_end = excluded.break_end,
  slot_interval_minutes = excluded.slot_interval_minutes;

insert into public.organization_shift_settings(organization_id, enabled, enabled_at, enabled_by)
values('d3500000-0000-4000-8000-000000000001', true, now(), current_setting('minuta.demo_owner')::uuid);

insert into public.staff_location_shifts(
  id, organization_id, location_id, performer_id, shift_date,
  start_time, end_time, break_start, break_end, note, active, created_by
)
select
  md5(format('demo-statistics-shift-%s-%s', staff_no, work_date))::uuid,
  'd3500000-0000-4000-8000-000000000001'::uuid,
  case when staff_no <= 3 then 'd3500000-0000-4000-8000-000000000201'::uuid
       when staff_no <= 5 then 'd3500000-0000-4000-8000-000000000202'::uuid
       else 'd3500000-0000-4000-8000-000000000203'::uuid end,
  ('d3500000-0000-4000-8000-' || lpad((100 + staff_no)::text, 12, '0'))::uuid,
  work_date, time '09:00', time '20:00', time '13:00', time '14:00',
  'Тестовая смена · demo_statistics', true, current_setting('minuta.demo_owner')::uuid
from generate_series(1, 7) staff_no
cross join generate_series(current_date - 90, current_date + 14, interval '1 day') day_row
cross join lateral (select day_row::date as work_date) normalized
where extract(isodow from work_date) between 1 and 6;

set local session_replication_role = replica;
with fixture as (
  select
    booking_no,
    1 + ((booking_no * 5) % 7) as staff_no,
    1 + (booking_no % 2) as service_no,
    current_date - (89 - ((booking_no - 1) % 90)) as booking_date,
    (time '09:00' + make_interval(mins => ((booking_no - 1) % 7) * 90))::time as booking_time
  from generate_series(1, 300) booking_no
), prepared as (
  select fixture.*,
    ('d3500000-0000-4000-8000-' || lpad((100 + staff_no)::text, 12, '0'))::uuid as performer_id,
    md5(format('demo-statistics-service-%s-%s', staff_no, service_no))::uuid as service_id,
    case when staff_no <= 3 then 'd3500000-0000-4000-8000-000000000201'::uuid
         when staff_no <= 5 then 'd3500000-0000-4000-8000-000000000202'::uuid
         else 'd3500000-0000-4000-8000-000000000203'::uuid end as location_id,
    case when service_no = 1 then 60 else 90 end as duration_minutes,
    case when service_no = 1 then 2600 + staff_no * 120 else 3900 + staff_no * 170 end as price_rub,
    case
      when staff_no >= 6 and booking_date > current_date - 30 and booking_no % 3 = 0 then 'cancelled'
      when booking_no % 17 = 0 then 'cancelled'
      else 'confirmed'
    end as booking_status
  from fixture
)
insert into public.bookings(
  id, booking_code, manage_token, request_id, request_fingerprint,
  performer_id, service_id, client_name, client_phone,
  booking_date, booking_time, duration_minutes, total_price_rub,
  status, deposit_amount_rub, payment_status, payment_url,
  organization_id, location_id, booking_scope_source,
  booking_source, created_by_user_id, created_by_role, created_at, updated_at
)
select
  md5('demo-statistics-booking-' || booking_no)::uuid,
  'DEMO-' || lpad(booking_no::text, 4, '0'),
  md5('demo-statistics-manage-' || booking_no)::uuid,
  md5('demo-statistics-request-' || booking_no)::uuid,
  md5('demo-statistics-fingerprint-' || booking_no) || md5('demo-statistics-fingerprint-b-' || booking_no),
  performer_id, service_id,
  'Тестовый клиент ' || (1 + ((booking_no * 13) % 55)),
  '+7999555' || lpad((1 + ((booking_no * 13) % 55))::text, 4, '0'),
  booking_date, booking_time, duration_minutes, price_rub,
  booking_status, 0, 'not_required', '',
  'd3500000-0000-4000-8000-000000000001'::uuid, location_id, 'team',
  case booking_no % 3 when 0 then 'client_online' when 1 then 'provider_manual' else 'admin_manual' end,
  case booking_no % 3 when 0 then null when 1 then performer_id else current_setting('minuta.demo_owner')::uuid end,
  case booking_no % 3 when 0 then null when 1 then 'specialist' else 'owner' end,
  booking_date + booking_time - interval '7 days', booking_date + booking_time - interval '7 days'
from prepared;

with fixture as (
  select
    future_no,
    1 + ((future_no * 3) % 7) as staff_no,
    1 + (future_no % 2) as service_no,
    current_date + 1 + ((future_no - 1) % 12) as booking_date,
    (time '10:00' + make_interval(mins => ((future_no - 1) % 5) * 105))::time as booking_time
  from generate_series(1, 12) future_no
)
insert into public.bookings(
  id, booking_code, manage_token, request_id, request_fingerprint,
  performer_id, service_id, client_name, client_phone,
  booking_date, booking_time, duration_minutes, total_price_rub,
  status, deposit_amount_rub, payment_status, payment_url,
  organization_id, location_id, booking_scope_source,
  booking_source, created_by_user_id, created_by_role, created_at, updated_at
)
select
  md5('demo-statistics-future-' || future_no)::uuid,
  'DEMO-F-' || lpad(future_no::text, 3, '0'),
  md5('demo-statistics-future-manage-' || future_no)::uuid,
  md5('demo-statistics-future-request-' || future_no)::uuid,
  md5('demo-statistics-future-fingerprint-' || future_no) || md5('demo-statistics-future-fingerprint-b-' || future_no),
  ('d3500000-0000-4000-8000-' || lpad((100 + staff_no)::text, 12, '0'))::uuid,
  md5(format('demo-statistics-service-%s-%s', staff_no, service_no))::uuid,
  'Тестовый клиент ' || (40 + future_no), '+7999666' || lpad(future_no::text, 4, '0'),
  booking_date, booking_time,
  case when service_no = 1 then 60 else 90 end,
  case when service_no = 1 then 2600 + staff_no * 120 else 3900 + staff_no * 170 end,
  'confirmed', 0, 'not_required', '',
  'd3500000-0000-4000-8000-000000000001'::uuid,
  case when staff_no <= 3 then 'd3500000-0000-4000-8000-000000000201'::uuid
       when staff_no <= 5 then 'd3500000-0000-4000-8000-000000000202'::uuid
       else 'd3500000-0000-4000-8000-000000000203'::uuid end,
  'team', 'admin_manual', current_setting('minuta.demo_owner')::uuid, 'owner', now(), now()
from fixture;

with target as (
  select booking.*,
    row_number() over(order by booking.booking_date, booking.booking_time, booking.id) as sequence_no
  from public.bookings booking
  where booking.organization_id = 'd3500000-0000-4000-8000-000000000001'
    and booking.status <> 'cancelled'
), prepared_outcome as (
  select target.*,
    case
      when booking_date >= current_date then 'scheduled'
      when performer_id::text in ('d3500000-0000-4000-8000-000000000106','d3500000-0000-4000-8000-000000000107')
        and booking_date > current_date - 30 and sequence_no % 4 = 0 then 'no_show'
      when sequence_no % 19 = 0 then 'no_show'
      when booking_date >= current_date - 4 and sequence_no % 3 = 1 then 'scheduled'
      else 'completed'
    end as fixture_visit_status
  from target
)
insert into public.booking_outcomes(
  booking_id, performer_id, visit_status, payment_method, amount_rub,
  actual_duration_minutes, calculated_amount_rub, completion_source,
  completed_performer_id, updated_at
)
select
  id, performer_id,
  fixture_visit_status,
  case
    when fixture_visit_status <> 'completed' then 'unpaid'
    when sequence_no % 11 = 0 then 'unpaid'
    when sequence_no % 3 = 0 then 'cash'
    when sequence_no % 3 = 1 then 'transfer'
    else 'card'
  end,
  case
    when fixture_visit_status <> 'completed' or sequence_no % 11 = 0 then 0
    when sequence_no % 9 = 0 then round(total_price_rub * 0.7)::integer
    else total_price_rub
  end,
  case when fixture_visit_status = 'completed' then greatest(30, duration_minutes + ((sequence_no % 3) - 1) * 10) else null end,
  case when fixture_visit_status = 'completed' then total_price_rub else null end,
  'manual',
  case when fixture_visit_status = 'completed' then performer_id else null end,
  greatest(updated_at, booking_date + booking_time + make_interval(mins => duration_minutes))
from prepared_outcome;
set local session_replication_role = origin;

insert into public.organization_inventory_settings(
  organization_id, enabled, auto_deduct_completed_visits, enabled_at, enabled_by
)
values('d3500000-0000-4000-8000-000000000001', true, true, now(), current_setting('minuta.demo_owner')::uuid);

insert into public.inventory_items(
  id, organization_id, name, sku, unit, low_stock_threshold, active, created_by
)
values
  ('d3500000-0000-4000-8000-000000000301','d3500000-0000-4000-8000-000000000001','Массажное масло','DEMO-OIL','ml',500,true,current_setting('minuta.demo_owner')::uuid),
  ('d3500000-0000-4000-8000-000000000302','d3500000-0000-4000-8000-000000000001','Одноразовые простыни','DEMO-SHEET','piece',30,true,current_setting('minuta.demo_owner')::uuid),
  ('d3500000-0000-4000-8000-000000000303','d3500000-0000-4000-8000-000000000001','Крем для массажа','DEMO-CREAM','ml',300,true,current_setting('minuta.demo_owner')::uuid),
  ('d3500000-0000-4000-8000-000000000304','d3500000-0000-4000-8000-000000000001','Салфетки','DEMO-WIPE','pack',8,true,current_setting('minuta.demo_owner')::uuid),
  ('d3500000-0000-4000-8000-000000000305','d3500000-0000-4000-8000-000000000001','Антисептик','DEMO-ANTISEPTIC','ml',400,true,current_setting('minuta.demo_owner')::uuid);

insert into public.inventory_warehouses(id, organization_id, location_id, name, active, created_by)
values
  ('d3500000-0000-4000-8000-000000000401','d3500000-0000-4000-8000-000000000001','d3500000-0000-4000-8000-000000000201','Склад · Центр',true,current_setting('minuta.demo_owner')::uuid),
  ('d3500000-0000-4000-8000-000000000402','d3500000-0000-4000-8000-000000000001','d3500000-0000-4000-8000-000000000202','Склад · Север',true,current_setting('minuta.demo_owner')::uuid),
  ('d3500000-0000-4000-8000-000000000403','d3500000-0000-4000-8000-000000000001','d3500000-0000-4000-8000-000000000203','Склад · Юг',true,current_setting('minuta.demo_owner')::uuid);

insert into public.inventory_stock_balances(organization_id, warehouse_id, inventory_item_id, quantity)
select
  'd3500000-0000-4000-8000-000000000001'::uuid,
  ('d3500000-0000-4000-8000-' || lpad((400 + warehouse_no)::text, 12, '0'))::uuid,
  ('d3500000-0000-4000-8000-' || lpad((300 + item_no)::text, 12, '0'))::uuid,
  case item_no when 1 then 420 when 2 then 18 when 3 then 850 when 4 then 5 else 1200 end
    + (warehouse_no - 1) * 20
from generate_series(1, 3) warehouse_no
cross join generate_series(1, 5) item_no;

insert into public.inventory_service_usage(
  organization_id, service_id, inventory_item_id, quantity, created_by
)
select
  'd3500000-0000-4000-8000-000000000001'::uuid,
  service.id,
  'd3500000-0000-4000-8000-000000000301'::uuid,
  case when service.duration_minutes = 60 then 35 else 50 end,
  current_setting('minuta.demo_owner')::uuid
from public.services service
where service.performer_id::text like 'd3500000-0000-4000-8000-0000000001__';

do $$
declare
  v_org constant uuid := 'd3500000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.locations where organization_id = v_org) <> 3
     or (select count(*) from public.organization_memberships where organization_id = v_org and role = 'specialist') <> 7
     or (select count(*) from public.services where performer_id::text like 'd3500000-0000-4000-8000-0000000001__') <> 14
     or (select count(*) from public.bookings where organization_id = v_org) <> 312
     or (select count(*) from public.booking_outcomes outcome join public.bookings booking on booking.id = outcome.booking_id where booking.organization_id = v_org and outcome.visit_status = 'completed') < 200
     or (select count(*) from public.inventory_items where organization_id = v_org) <> 5 then
    raise exception using errcode = 'P0001', message = 'demo_statistics_fixture_contract_failed';
  end if;
end $$;

commit;

select jsonb_build_object(
  'organization', organization.name,
  'public_booking_enabled', organization.public_booking_enabled,
  'locations', (select count(*) from public.locations where organization_id = organization.id),
  'specialists', (select count(*) from public.organization_memberships where organization_id = organization.id and role = 'specialist'),
  'services', (select count(*) from public.services where performer_id::text like 'd3500000-0000-4000-8000-0000000001__'),
  'bookings', (select count(*) from public.bookings where organization_id = organization.id),
  'completed', (select count(*) from public.booking_outcomes outcome join public.bookings booking on booking.id=outcome.booking_id where booking.organization_id=organization.id and outcome.visit_status='completed'),
  'cancelled', (select count(*) from public.bookings where organization_id=organization.id and status='cancelled'),
  'no_show', (select count(*) from public.booking_outcomes outcome join public.bookings booking on booking.id=outcome.booking_id where booking.organization_id=organization.id and outcome.visit_status='no_show'),
  'inventory_items', (select count(*) from public.inventory_items where organization_id=organization.id)
) as demo_statistics_summary
from public.organizations organization
where organization.id = 'd3500000-0000-4000-8000-000000000001';
