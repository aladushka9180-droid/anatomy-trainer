// Native races on a disposable schema-only PostgreSQL clone; no external writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const endpoint = new URL(process.env.MINUTA_TEST_DATABASE_URL || '');
assert.equal(process.env.MINUTA_V176_EPHEMERAL_CONFIRM, 'SCHEMA_ONLY_EMPTY_DATABASE');
assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname));
assert.equal(endpoint.pathname, '/minuta-v176-fixture');
assert.equal(process.env.MINUTA_TEST_PROJECT_REF, 'minuta-v176-fixture');
assert.notEqual(process.env.MINUTA_TEST_PROJECT_REF, process.env.MINUTA_PRODUCTION_PROJECT_REF);
const pg = await import(pathToFileURL(process.env.MINUTA_PG_MODULE).href);
const Client = pg.Client || pg.default?.Client;
const connections = [];
async function connect(label) {
  const client = new Client({ connectionString: endpoint.href, application_name: `v176-${label}` });
  await client.connect();
  connections.push(client);
  await client.query("set statement_timeout='20s'; set lock_timeout='15s'");
  return client;
}
const one = async (client, sql, params = []) => Object.values((await client.query(sql, params)).rows[0])[0];
const pending = promise => promise.then(result => ({ result }), error => ({ error }));
const sameLocation = process.env.MINUTA_V189_FULL_SCHEMA === '1';
const call = (client, route, items) => client.query(
  sameLocation
    ? 'select public.book_minuta_same_location_route_v189($1::uuid,$2,$3,$4::jsonb) result'
    : 'select public.book_minuta_multi_resource_route_v176($1::uuid,$2,$3,$4::jsonb,\'[]\'::jsonb) result',
  [route, 'V176 isolated race', '+79990001761', JSON.stringify(items)]
);
async function lockWait(observer, pid, task) {
  for (let attempt = 0; attempt < 40; attempt++) {
    assert.equal(task.settled, false, 'competitor must still be waiting');
    if (await one(observer, "select coalesce((select wait_event_type='Lock' from pg_stat_activity where pid=$1),false)", [pid]))
      return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('expected a real PostgreSQL lock wait');
}
const track = promise => {
  const task = { settled: false };
  task.outcome = pending(promise).then(outcome => { task.settled = true; return outcome; });
  return task;
};

const admin = await connect('admin');
try {
  assert.equal(await one(admin, 'select current_database()'), 'minuta-v176-fixture');
  assert.equal(await one(admin, `select count(*)::int from minuta_migration_guard.target
    where project_ref='minuta-v176-fixture' and allow_migrations`), 1);
  assert.equal(await one(admin, 'select count(*)::int from public.public_multi_resource_routes_v176'), 0);
  const actorA = await one(admin, `select service.performer_id from public.services service
    join public.organization_memberships membership on membership.user_id=service.performer_id
      and membership.active and membership.is_bookable
    where service.active order by service.id limit 1`);
  assert.ok(actorA, 'synthetic source performer is required');
  const actorB = randomUUID(), org = randomUUID(), loc = randomUUID();
  const serviceA = randomUUID(), serviceB = randomUUID();
  const slug = `v176-race-${org.replaceAll('-', '')}`;
  await admin.query('begin');
  try {
    await admin.query('set local session_replication_role=replica');
    await admin.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      $2,now(),'{}','{}',now(),now())`, [actorB, `${actorB}@example.invalid`]);
    await admin.query('set local session_replication_role=origin');
    await admin.query("insert into public.performer_profiles(id,display_name) values($1,'V176 isolated race performer')", [actorB]);
    await admin.query(`insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes)
      select $1,day,true,'09:00','18:00',15 from generate_series(1,7) day`, [actorB]);
    await admin.query(`insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
      values($1,'V176 isolated race',$2,'active',true,$3)`, [org, slug, actorA]);
    await admin.query(`insert into public.locations(id,organization_id,name,address,timezone,active,is_primary)
      values($1,$2,'V176 isolated race location','Test-only address','Europe/Samara',true,true)`, [loc, org]);
    await admin.query(`insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
      values($1,$2,'specialist',true,true,$2),($1,$3,'specialist',true,true,$2)`, [org, actorA, actorB]);
    await admin.query(`insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
      values($1,$2,'V176 race first',30,1761,true),($3,$4,'V176 race second',30,1762,true)`,
      [serviceA, actorA, serviceB, actorB]);
    await admin.query('commit');
  } catch (error) {
    await admin.query('rollback');
    throw error;
  }
  // The legacy test models its caller; v189 tests use the migration's real service-role grant.
  if (!sameLocation)
    await admin.query('grant execute on function public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb) to anon');
  else {
    const wrapper = 'public.book_minuta_same_location_route_v189(uuid,text,text,jsonb)';
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(await one(admin, 'select has_function_privilege($1,$2,\'execute\')', [role, wrapper]), role === 'service_role');
      assert.equal(await one(admin, 'select has_function_privilege($1,$2,\'execute\')',
        [role, 'public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)']), false);
    }
  }
  const first = await connect('first'), second = await connect('second');
  await first.query(sameLocation ? 'set role service_role' : 'set role anon');
  await second.query(sameLocation ? 'set role service_role' : 'set role anon');
  const secondPid = await one(second, 'select pg_backend_pid()');
  const selectPair = async () => (await admin.query(`select first_slot.booking_date::text as visit_date,
    first_slot.booking_time::text start_a,second_slot.booking_time::text start_b
    from public.get_available_slots($1,current_date+1,current_date+7) first_slot
    join public.get_available_slots($2,current_date+1,current_date+7) second_slot
      on second_slot.booking_date=first_slot.booking_date
      and second_slot.booking_time>=first_slot.booking_time+interval '30 minutes'
      and second_slot.booking_time<=first_slot.booking_time+interval '90 minutes'
    order by first_slot.booking_date,first_slot.booking_time,second_slot.booking_time limit 1`,
    [serviceA, serviceB])).rows[0];
  const makeItems = pair => [
    { request_id: randomUUID(), organization_slug: slug, location_id: loc, performer_id: actorA,
      service_id: serviceA, booking_date: pair.visit_date, booking_time: pair.start_a,
      expected_price_rub: 1761, expected_duration_minutes: 30 },
    { request_id: randomUUID(), organization_slug: slug, location_id: loc, performer_id: actorB,
      service_id: serviceB, booking_date: pair.visit_date, booking_time: pair.start_b,
      expected_price_rub: 1762, expected_duration_minutes: 30 }
  ];

  const pairA = await selectPair();
  assert.ok(pairA, 'two-performer calendar must offer a pair');
  const routeA = randomUUID(), itemsA = makeItems(pairA);
  if (sameLocation) {
    const refusedRoute = randomUUID();
    const mixedLocations = [itemsA[0], { ...itemsA[1], location_id: randomUUID() }];
    const refused = await pending(call(first, refusedRoute, mixedLocations));
    assert.match(refused.error?.message || '', /same_location_route_scope_invalid/);
    assert.equal(await one(admin, 'select count(*)::int from public.bookings where request_id=$1 or request_id=$2',
      [itemsA[0].request_id, itemsA[1].request_id]), 0);
    assert.equal(await one(admin, 'select count(*)::int from public.public_multi_resource_routes_v176 where request_id=$1', [refusedRoute]), 0);
    await second.query('set role anon');
    const denied = await pending(call(second, routeA, itemsA));
    assert.equal(denied.error?.code, '42501');
    await second.query('set role service_role');
  }
  await first.query('begin');
  const created = (await call(first, routeA, itemsA)).rows[0].result;
  const duplicate = track(call(second, routeA, itemsA));
  await lockWait(admin, secondPid, duplicate);
  await first.query('commit');
  const replay = await duplicate.outcome;
  assert.equal(replay.error, undefined);
  assert.equal(created.idempotent, false);
  assert.equal(replay.result.rows[0].result.idempotent, true);
  assert.deepEqual(replay.result.rows[0].result.bookings, created.bookings);
  assert.equal(await one(admin, 'select count(*)::int from public.public_multi_resource_route_items_v176 where route_request_id=$1', [routeA]), 2);

  const pairB = await selectPair();
  assert.ok(pairB, 'second available pair is required for calendar race');
  const routeB = randomUUID(), routeC = randomUUID();
  const itemsB = makeItems(pairB), itemsC = makeItems(pairB);
  await first.query('begin');
  const winner = (await call(first, routeB, itemsB)).rows[0].result;
  const competing = track(call(second, routeC, itemsC));
  await lockWait(admin, secondPid, competing);
  await first.query('commit');
  const loser = await competing.outcome;
  assert.equal(winner.bookings.length, 2);
  assert.ok(loser.error, 'competing route must not book the same calendars');
  assert.equal(await one(admin, 'select count(*)::int from public.public_multi_resource_routes_v176 where request_id=$1', [routeC]), 0);
  assert.equal(await one(admin, 'select count(*)::int from public.bookings where request_id=$1 or request_id=$2',
    [itemsC[0].request_id, itemsC[1].request_id]), 0);
  if (sameLocation) {
    const counts = async () => (await admin.query(`select
      (select count(*)::int from public.bookings) bookings,
      (select count(*)::int from public.public_multi_resource_routes_v176) routes,
      (select count(*)::int from public.public_multi_resource_route_items_v176) items`)).rows[0];
    const beforeRollback = await counts();
    await admin.query(readFileSync(new URL('../supabase-migration-v189-rollback.sql', import.meta.url), 'utf8'));
    assert.deepEqual(await counts(), beforeRollback);
    const disabled = await pending(call(first, routeA, itemsA));
    assert.equal(disabled.error?.code, '42501');
    await admin.query(readFileSync(new URL('../supabase-migration-v189.sql', import.meta.url), 'utf8'));
    const afterReapply = (await call(first, routeA, itemsA)).rows[0].result;
    assert.equal(afterReapply.idempotent, true);
    assert.deepEqual(afterReapply.bookings, created.bookings);
    assert.deepEqual(await counts(), beforeRollback);
    console.log('PASS: v189 full-schema real service-role create, browser/cross-location denial, concurrent replay/calendar race, preserved rows after rollback/reapply');
  }
  console.log('PASS: full-schema concurrent duplicate replay and competing calendar route; no partial booking');
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code }));
  process.exitCode = 1;
} finally {
  await Promise.all(connections.map(async client => {
    try { await client.query('rollback'); } catch { /* dispose the ephemeral connection */ }
    await client.end();
  }));
}
