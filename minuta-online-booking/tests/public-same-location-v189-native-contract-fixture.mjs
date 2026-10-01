// Capture real native v189 acknowledgements using disposable synthetic fixtures only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const endpoint = new URL(process.env.MINUTA_TEST_DATABASE_URL || '');
assert.equal(process.env.MINUTA_V176_EPHEMERAL_CONFIRM, 'SCHEMA_ONLY_EMPTY_DATABASE');
assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname));
assert.equal(endpoint.pathname, '/minuta-v176-fixture');
assert.equal(process.env.MINUTA_TEST_PROJECT_REF, 'minuta-v176-fixture');
assert.notEqual(process.env.MINUTA_TEST_PROJECT_REF, process.env.MINUTA_PRODUCTION_PROJECT_REF);
assert.ok(process.env.MINUTA_V189_CONTRACT_OUTPUT);

const pg = await import(pathToFileURL(process.env.MINUTA_PG_MODULE).href);
const Client = pg.Client || pg.default?.Client;
const db = new Client({ connectionString: endpoint.href, application_name: 'v189-client-contract' });

await db.connect();
try {
  await db.query("begin; set local statement_timeout='90s'; set local lock_timeout='5s'");
  const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
  assert.equal(await scalar('select current_database()'), 'minuta-v176-fixture');
  assert.equal(await scalar(`select count(*)::int from minuta_migration_guard.target
    where project_ref='minuta-v176-fixture' and allow_migrations`), 1);

  const services = (await db.query(`select service.id::text, service.performer_id::text,
    service.price_rub, service.duration_minutes, organization.public_slug,
    location.id::text location_id
    from public.services service
    join public.organization_memberships membership on membership.user_id=service.performer_id
      and membership.active and membership.is_bookable
    join public.organizations organization on organization.id=membership.organization_id
    join public.locations location on location.organization_id=organization.id
    where organization.public_slug like 'v176-race-%'
      and service.name in ('V176 race first','V176 race second')
    order by service.name`)).rows;
  assert.equal(services.length, 2, 'only the two synthetic race fixture services are allowed');
  assert.notEqual(services[0].performer_id, services[1].performer_id);
  assert.equal(services[0].location_id, services[1].location_id);
  const pair = (await db.query(`select first_slot.booking_date::text visit_date,
    first_slot.booking_time::text start_a, second_slot.booking_time::text start_b
    from public.get_available_slots($1,current_date+1,current_date+7) first_slot
    join public.get_available_slots($2,current_date+1,current_date+7) second_slot
      on second_slot.booking_date=first_slot.booking_date
      and second_slot.booking_time=first_slot.booking_time+interval '30 minutes'
    order by first_slot.booking_date,first_slot.booking_time limit 1`,
  [services[0].id, services[1].id])).rows[0];
  assert.ok(pair, 'a consecutive synthetic slot pair is required');
  const requestId = randomUUID();
  const input = {
    requestId,
    customerName: 'V189 isolated client adapter',
    customerPhone: '79990001890',
    items: services.map((service, index) => ({
      requestId: randomUUID(),
      target: {
        resourceId: `pc_fixture_${index}`,
        locationId: `org:${service.public_slug}:${service.location_id}`,
        timeZone: 'Europe/Samara',
        master: { organizationSlug: service.public_slug, locationId: service.location_id, performerId: service.performer_id },
        service: { id: service.id },
      },
      slotStart: new Date(`${pair.visit_date}T${index === 0 ? pair.start_a : pair.start_b}+04:00`).toISOString(),
      expectedPriceRub: Number(service.price_rub),
      expectedDurationMinutes: Number(service.duration_minutes),
    })),
  };
  const body = {
    p_request_id: requestId,
    p_client_name: input.customerName,
    p_client_phone: input.customerPhone,
    p_items: input.items.map((item, index) => ({
      request_id: item.requestId,
      organization_slug: services[index].public_slug,
      location_id: services[index].location_id,
      performer_id: services[index].performer_id,
      service_id: services[index].id,
      booking_date: pair.visit_date,
      booking_time: index === 0 ? pair.start_a : pair.start_b,
      expected_price_rub: item.expectedPriceRub,
      expected_duration_minutes: item.expectedDurationMinutes,
    })),
  };
  const call = async () => {
    await db.query('set local role service_role');
    try {
      return (await db.query('select public.book_minuta_same_location_route_v189($1::uuid,$2,$3,$4::jsonb) result',
        [body.p_request_id, body.p_client_name, body.p_client_phone, JSON.stringify(body.p_items)])).rows[0].result;
    } finally { await db.query('reset role'); }
  };
  const created = await call();
  assert.equal(created.bookings.length, 2);
  assert.equal(created.idempotent, false);
  assert.equal(await scalar('select count(*)::int from public.bookings where request_id=any($1::uuid[])',
    [input.items.map(item => item.requestId)]), 2);
  const replay = await call();
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.bookings, created.bookings);
  assert.equal(await scalar('select count(*)::int from public.public_multi_resource_route_items_v176 where route_request_id=$1', [requestId]), 2);
  writeFileSync(process.env.MINUTA_V189_CONTRACT_OUTPUT, JSON.stringify({
    schemaVersion: 1,
    source: 'disposable-postgresql17-schema-only',
    serverSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    input, body, created, replay,
  }, null, 2));
  console.log('PASS: real v189 acknowledgements captured for two consecutive synthetic performers; native booking and journal rows verified');
} finally {
  await db.query('rollback');
  await db.end();
}
