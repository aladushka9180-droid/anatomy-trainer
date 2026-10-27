import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, after } from 'node:test';
import { ids, fixtureSQL } from './provider-visit-terms-v197-fixture.mjs';

const endpoint = process.env.MINUTA_VISIT_TERMS_TEST_DATABASE_URL;
if (!endpoint) throw new Error('MINUTA_VISIT_TERMS_TEST_DATABASE_URL is required; only the disposable loopback fixture is accepted');
const parsed = new URL(endpoint);
if (!['127.0.0.1','localhost'].includes(parsed.hostname) || parsed.pathname !== '/visit_terms_test') {
  throw new Error('Refusing a database outside the disposable visit_terms_test loopback target');
}
const driver = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = driver.Client ?? driver.default.Client;
const admin = new Client({ connectionString:endpoint, connectionTimeoutMillis:5000 });
const left = new Client({ connectionString:endpoint, connectionTimeoutMillis:5000 });
const right = new Client({ connectionString:endpoint, connectionTimeoutMillis:5000 });
after(async () => { await Promise.allSettled([left.end(), right.end(), admin.end()]); });
await Promise.all([admin.connect(), left.connect(), right.connect()]);
const root = fileURLToPath(new URL('../../', import.meta.url));
await admin.query(fixtureSQL);
for (const name of ['supabase-migration-v53.sql','supabase-migration-v156.sql']) {
  await admin.query(readFileSync(`${root}minuta-online-booking/${name}`, 'utf8'));
}
const migration = readdirSync(`${root}supabase/migrations/`).filter(name => name.endsWith('_provider_visit_terms_v197.sql'));
assert.equal(migration.length, 1);
await admin.query(readFileSync(`${root}supabase/migrations/${migration[0]}`, 'utf8'));
for (const connection of [left, right]) {
  await connection.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.actor]);
  await connection.query("set role authenticated; set statement_timeout='3s'");
}
async function seed() {
  return (await admin.query(`insert into public.bookings(request_id,performer_id,organization_id,service_id,
    booking_date,booking_time,duration_minutes,client_phone,original_price_rub,total_price_rub)
    values(gen_random_uuid(),$1,$2,$3,'2099-10-28','12:30',36,'synthetic-client',20,720) returning id`,
  [ids.actor, ids.organization, ids.service])).rows[0].id;
}
const read = async booking => (await left.query('select public.get_minuta_visit_terms_v197($1::uuid) as value', [booking])).rows[0].value;
const save = async (connection, request, booking, expected) => (await connection.query(
  'select public.save_minuta_visit_terms_v197($1::uuid,$2::uuid,$3::jsonb,23,36) as value',
  [request, booking, JSON.stringify(expected)])).rows[0].value;
const rollback = readFileSync(`${root}minuta-online-booking/recovery/rollback-provider-visit-terms-v197.sql`, 'utf8');

test('unused native contract rolls back and reapplies without changing the legacy RPC', async () => {
  const legacy = (await admin.query("select prosrc from pg_proc where oid='public.save_booking_session(uuid,jsonb)'::regprocedure")).rows[0].prosrc;
  await admin.query(rollback);
  assert.equal((await admin.query("select to_regprocedure('public.get_minuta_visit_terms_v197(uuid)') as value")).rows[0].value, null);
  await admin.query(readFileSync(`${root}supabase/migrations/${migration[0]}`, 'utf8'));
  assert.equal((await admin.query("select prosrc from pg_proc where oid='public.save_booking_session(uuid,jsonb)'::regprocedure")).rows[0].prosrc, legacy);
});

test('a legacy-held booking row returns busy and releases the new day lock instead of forming a wait cycle', async () => {
  const booking = await seed(); const expected = await read(booking);
  const request = (await admin.query('select gen_random_uuid() as id')).rows[0].id;
  // This is the real row-lock phase of the unchanged v156 writer.
  // Its later duration trigger needs the day advisory lock held by the new path.
  await admin.query('begin');
  try {
    await admin.query('select * from public.bookings where id=$1 for update', [booking]);
    await assert.rejects(save(right, request, booking, expected), error => error.code === '40001' && error.message === 'visit_terms_booking_busy');
    await admin.query("set local statement_timeout='3s'");
    await admin.query('select pg_advisory_xact_lock(hashtextextended($1::text,0))', [ids.actor + expected.date]);
    assert.equal((await admin.query('select total_price_rub from public.bookings where id=$1', [booking])).rows[0].total_price_rub, 720);
  } finally { await admin.query('rollback'); }
  assert.equal((await admin.query('select count(*)::integer as count from public.provider_visit_terms_edits_v197 where request_id=$1', [request])).rows[0].count, 0);
});

test('two real connections serialize an identical mutation into one revision and one receipt', async () => {
  const booking = await seed(); const expected = await read(booking);
  const request = (await admin.query('select gen_random_uuid() as id')).rows[0].id;
  const previousCount = (await admin.query('select count(*)::integer as count from public.booking_session_revisions where booking_id=$1', [booking])).rows[0].count;
  const results = await Promise.all([save(left, request, booking, expected), save(right, request, booking, expected)]);
  assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  assert.equal(results[0].appliedRevisionId, results[1].appliedRevisionId);
  assert.equal((await admin.query('select count(*)::integer as count from public.provider_visit_terms_edits_v197 where request_id=$1', [request])).rows[0].count, 1);
  assert.equal((await admin.query('select count(*)::integer as count from public.booking_session_revisions where booking_id=$1', [booking])).rows[0].count, previousCount + 1);
});

test('native rollback refuses to delete a successful mutation receipt', async () => {
  const before = (await admin.query('select jsonb_agg(to_jsonb(e)) as value from public.provider_visit_terms_edits_v197 e')).rows[0].value;
  assert.equal(before.length, 1);
  await assert.rejects(admin.query(rollback), error => error.code === '55000' && error.message === 'v197_rollback_data_retention_hold');
  await admin.query('rollback');
  assert.deepEqual((await admin.query('select jsonb_agg(to_jsonb(e)) as value from public.provider_visit_terms_edits_v197 e')).rows[0].value, before);
});
