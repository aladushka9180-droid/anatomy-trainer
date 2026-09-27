import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.env.MINUTA_PGLITE_PACKAGE) {
  throw new Error('Set MINUTA_PGLITE_PACKAGE to an isolated @electric-sql/pglite package directory');
}
const { PGlite } = createRequire(import.meta.url)(path.join(process.env.MINUTA_PGLITE_PACKAGE, 'dist/index.cjs'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = name => fs.readFileSync(path.join(root, name), 'utf8');
const expiryWorkflow = fs.readFileSync(path.join(root, '..', '.github', 'workflows',
  'minuta-unpaid-booking-expiry.yml'), 'utf8');
assert.match(expiryWorkflow, /grep -c 'auto_completion_inventory_shortfall booking_id='/,
  'the workflow detects only the domain shortfall warning');
assert.match(expiryWorkflow, /::warning title=Складской дефицит/,
  'skipped visits remain visible as a workflow annotation');
assert.match(expiryWorkflow, /if: failure\(\)/,
  'unexpected failures retain the existing Telegram path');
const definition = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} definition exists`);
  const end = source.indexOf('$$;', source.indexOf(' as $$', start));
  assert.notEqual(end, -1, `${name} definition closes`);
  return source.slice(start, end + 3);
};
const db = new PGlite();
const org = '10000000-0000-4000-8000-000000000001';
const performer = '10000000-0000-4000-8000-000000000002';
const location = '10000000-0000-4000-8000-000000000003';
const service = '10000000-0000-4000-8000-000000000004';
const safeService = '10000000-0000-4000-8000-000000000006';
const warehouse = '10000000-0000-4000-8000-000000000005';
const item = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const booking = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scalar = async query => (await db.query(query)).rows[0].value;

try {
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create role anon; create role authenticated; create role service_role;
    create table public.bookings(
      id uuid primary key, organization_id uuid, location_id uuid, service_id uuid,
      performer_id uuid, status text, booking_date date, booking_time time without time zone,
      duration_minutes integer, original_price_rub integer, total_price_rub integer,
      booking_policy_snapshot jsonb not null default '{}'::jsonb
    );
    create table public.booking_policies(performer_id uuid primary key, auto_complete_visits boolean,
      auto_complete_payment_method text);
    create table public.services(id uuid primary key, duration_minutes integer, price_rub integer);
    create table public.locations(id uuid primary key, timezone text);
    create table public.booking_outcomes(
      booking_id uuid primary key, performer_id uuid, visit_status text, payment_method text,
      amount_rub integer, actual_duration_minutes integer, calculated_amount_rub integer,
      completion_source text, updated_at timestamptz
    );
    create table public.organization_inventory_settings(
      organization_id uuid primary key, enabled boolean, auto_deduct_completed_visits boolean
    );
    create table public.inventory_items(id uuid primary key, organization_id uuid, active boolean);
    create table public.inventory_service_usage(
      organization_id uuid,service_id uuid,inventory_item_id uuid,quantity numeric(14,3)
    );
    create table public.inventory_warehouses(
      id uuid primary key,organization_id uuid,location_id uuid,active boolean
    );
    create table public.inventory_stock_balances(
      organization_id uuid,warehouse_id uuid,inventory_item_id uuid,
      quantity numeric(14,3) not null check(quantity>=0),updated_at timestamptz,
      primary key(organization_id,warehouse_id,inventory_item_id)
    );
    create table public.inventory_movements(
      organization_id uuid,warehouse_id uuid,inventory_item_id uuid,booking_id uuid,
      movement_type text,quantity_delta numeric(14,3),quantity_after numeric(14,3),
      request_id uuid,reason text,actor_id uuid
    );
    create function public.write_minuta_inventory_audit(uuid,text,uuid,jsonb)
      returns void language plpgsql as $$ begin return; end $$;
  `);
  await db.exec(definition(sql('supabase-migration-v164.sql'), 'consume_minuta_inventory_for_booking'));
  await db.exec(definition(sql('supabase-migration-v82.sql'), 'sync_minuta_inventory_on_outcome'));
  await db.exec(`create trigger booking_outcomes_sync_inventory after insert or update of visit_status
    on public.booking_outcomes for each row execute function public.sync_minuta_inventory_on_outcome()`);
  await db.exec(definition(sql('supabase-migration-v124.sql'), 'process_minuta_auto_completed_visits_v106'));
  const baselineDefinition = await scalar(`select pg_get_functiondef(
    'public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure) as value`);
  await db.exec(`
    insert into public.booking_policies values('${performer}',true,'unpaid');
    insert into public.services values('${service}',60,1000),('${safeService}',60,1000);
    insert into public.locations values('${location}','Europe/Samara');
    insert into public.organization_inventory_settings values('${org}',true,true);
    insert into public.inventory_warehouses values('${warehouse}','${org}','${location}',true);
    insert into public.inventory_items values('${item(1)}','${org}',true),('${item(2)}','${org}',true);
    insert into public.inventory_service_usage values
      ('${org}','${service}','${item(1)}',1),('${org}','${service}','${item(2)}',1),
      ('${org}','${safeService}','${item(1)}',1);
    insert into public.inventory_stock_balances values
      ('${org}','${warehouse}','${item(1)}',2,now()),
      ('${org}','${warehouse}','${item(2)}',1,now());
    insert into public.bookings(id,organization_id,location_id,service_id,performer_id,status,
      booking_date,booking_time,duration_minutes,total_price_rub)
    values
      ('${booking(1)}','${org}','${location}','${safeService}','${performer}','confirmed','2020-01-01','10:00',60,1000),
      ('${booking(2)}','${org}','${location}','${service}','${performer}','confirmed','2020-01-02','10:00',60,1000);
    insert into public.booking_outcomes(booking_id,performer_id,visit_status)
    values('${booking(1)}','${performer}','scheduled');
  `);

  // Existing behavior: the second material runs short for booking 2, so the
  // whole batch aborts and even booking 1's valid completion is rolled back.
  await db.exec(`update public.inventory_stock_balances set quantity=0
    where inventory_item_id='${item(2)}'`);
  await assert.rejects(db.query('select public.process_minuta_auto_completed_visits_v106(2)'),
    /insufficient_inventory_stock_for_completed_visit/);
  assert.equal(await scalar(`select visit_status as value from public.booking_outcomes where booking_id='${booking(1)}'`),
    'scheduled');
  assert.equal(await scalar('select count(*)::integer as value from public.inventory_movements'), 0);

  // Put the shortfall first so p_limit=1 proves a later healthy booking is
  // reached; partial stock updates of the failed visit must also roll back.
  await db.exec(`update public.bookings set booking_date='2020-01-03' where id='${booking(1)}';
    update public.bookings set booking_date='2020-01-01' where id='${booking(2)}';`);
  await db.exec(sql('supabase-migration-v181.sql').replace(/^\\set .*\r?\n/m, ''));
  await db.exec(sql('supabase-migration-v181.sql').replace(/^\\set .*\r?\n/m, ''));
  assert.equal(await scalar(`select has_function_privilege('authenticated',
    'public.process_minuta_auto_completed_visits_v106(integer)','EXECUTE') as value`), false,
  'browser role cannot invoke the batch');
  assert.equal(await scalar('select public.process_minuta_auto_completed_visits_v106(1) as value'), 1,
    'short visit does not consume the limit; the later stocked visit completes');
  assert.equal(await scalar('select count(*)::integer as value from public.inventory_movements'), 1,
    'earlier item deduction in failed visit rolls back');
  assert.equal(await scalar(`select quantity::integer as value from public.inventory_stock_balances
    where inventory_item_id='${item(1)}'`), 1);
  assert.equal(await scalar(`select payment_method as value from public.booking_outcomes where booking_id='${booking(1)}'`),
    'unpaid');
  assert.equal(await scalar(`select amount_rub as value from public.booking_outcomes where booking_id='${booking(1)}'`),
    0);
  assert.equal(await scalar(`select count(*)::integer as value from public.booking_outcomes where booking_id='${booking(2)}'`),
    0);

  assert.equal(await scalar('select public.process_minuta_auto_completed_visits_v106(1) as value'), 0,
    'retry leaves the blocked visit incomplete');
  await db.exec(`update public.inventory_stock_balances set quantity=1 where inventory_item_id='${item(2)}'`);
  assert.equal(await scalar('select public.process_minuta_auto_completed_visits_v106(1) as value'), 1,
    'restored stock permits normal completion');
  assert.equal(await scalar(`select quantity::integer as value from public.inventory_stock_balances
    where inventory_item_id='${item(2)}'`), 0);
  assert.equal(await scalar('select count(*)::integer as value from public.inventory_movements'), 3);
  await db.exec(`insert into public.bookings(id,organization_id,location_id,service_id,performer_id,status,
    booking_date,booking_time,duration_minutes,total_price_rub)
    values('${booking(3)}','${org}','${location}','${service}','${performer}','confirmed','2020-01-04','10:00',60,1000);
    update public.inventory_warehouses set active=false where id='${warehouse}';`);
  await assert.rejects(db.query('select public.process_minuta_auto_completed_visits_v106(1)'),
    /inventory_warehouse_missing_for_location/, 'other inventory errors are not suppressed');
  assert.equal(await scalar(`select count(*)::integer as value from public.booking_outcomes where booking_id='${booking(3)}'`), 0);

  // A bounded success limit must not strand a healthy booking behind a long
  // prefix of shortfalls. Use distinct dates, as the full schema disallows
  // overlapping bookings for one performer.
  await db.exec(`update public.inventory_warehouses set active=true where id='${warehouse}';
    update public.inventory_stock_balances set quantity=1 where inventory_item_id='${item(1)}';
    insert into public.bookings(id,organization_id,location_id,service_id,performer_id,status,
      booking_date,booking_time,duration_minutes,total_price_rub)
    select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
      '${org}','${location}','${service}','${performer}','confirmed',
      date '2020-01-05'+(n-4),'10:00'::time,60,1000
    from generate_series(4,203) n;
    insert into public.bookings(id,organization_id,location_id,service_id,performer_id,status,
      booking_date,booking_time,duration_minutes,total_price_rub)
    values('${booking(204)}','${org}','${location}','${safeService}','${performer}',
      'confirmed','2021-01-01','10:00',60,1000);`);
  const scanStartedAt = performance.now();
  assert.equal(await scalar('select public.process_minuta_auto_completed_visits_v106(1) as value'), 1,
    'a healthy visit after 201 stock shortfalls is still completed');
  const scanMs = Math.round(performance.now() - scanStartedAt);
  assert.equal(await scalar(`select count(*)::integer as value from public.booking_outcomes
    where booking_id='${booking(204)}' and visit_status='completed'`), 1);
  assert.equal(await scalar('select count(*)::integer as value from public.inventory_movements'), 4);
  console.log(`Synthetic 201-shortfall scan in isolated PGlite: ${scanMs} ms`);

  await db.exec(`update public.inventory_warehouses set active=true where id='${warehouse}';
    update public.inventory_stock_balances set quantity=0 where inventory_item_id='${item(2)}'`);
  await db.exec(sql('supabase-migration-v181-rollback.sql').replace(/^\\set .*\r?\n/m, ''));
  assert.equal(await scalar(`select pg_get_functiondef(
    'public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure) as value`),
    baselineDefinition, 'rollback restores the exact v124 function body');
  await assert.rejects(db.query('select public.process_minuta_auto_completed_visits_v106(1)'),
    /insufficient_inventory_stock_for_completed_visit/, 'rollback restores the v124 fail-fast contract');
  console.log('PrimeTime Pro auto-complete inventory v181 isolated DB checks: PASS');
} finally {
  await db.close();
}
