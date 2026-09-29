// Apply/rollback rehearsal against a schema-only clone in a disposable local server.
import assert from 'node:assert/strict';
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
const db = new Client({ connectionString: endpoint.href, application_name: 'v176-full-schema-rehearsal' });
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const body = name => {
  const source = read(name);
  assert.equal((source.match(/^begin;$/gm) || []).length, 1);
  assert.equal((source.match(/^commit;$/gm) || []).length, 1);
  return source.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
};
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
const legacy = async () => (await db.query(`select
  pg_get_functiondef('public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)'::regprocedure) route,
  pg_get_functiondef('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)'::regprocedure) single,
  has_function_privilege('anon','public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)','execute') route_anon,
  has_function_privilege('anon','public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)','execute') single_anon`)).rows[0];

await db.connect();
try {
  await db.query("begin; set local statement_timeout='90s'; set local lock_timeout='5s'");
  assert.equal(await scalar('select current_database()'), 'minuta-v176-fixture');
  assert.equal(await scalar(`select count(*)::int from minuta_migration_guard.target
    where project_ref=$1 and allow_migrations`, [process.env.MINUTA_TEST_PROJECT_REF]), 1);
  for (const table of ['bookings', 'public_multi_service_routes_v167'])
    assert.equal(await scalar(`select count(*)::int from public.${table}`), 0, 'schema clone must have no source rows');
  const prerequisites = (await db.query(`select
    to_regclass('public.bookings') is not null bookings,
    to_regclass('public.public_multi_service_routes_v167') is not null route_v167_table,
    to_regprocedure('public.book_minuta_multi_service_route_v167(uuid,text,uuid,text,text,jsonb)') is not null route_v167_rpc,
    to_regprocedure('public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)') is not null single_rpc,
    to_regprocedure('public.get_public_minuta_catalog_v5(text)') is not null catalog_rpc,
    to_regprocedure('public.get_available_slots(uuid,date,date)') is not null slots_rpc,
    to_regprocedure('extensions.digest(bytea,text)') is not null digest_rpc`)).rows[0];
  const missing = Object.entries(prerequisites).filter(([, present]) => !present).map(([name]) => name);
  assert.deepEqual(missing, [], `v176 full-schema prerequisites absent: ${missing.join(', ')}`);
  const before = await legacy();
  await db.query(body('supabase-migration-v176.sql'));
  await db.query(body('supabase-migration-v176.sql'));
  assert.deepEqual(await legacy(), before);
  for (const table of ['public_route_travel_evidence_v176', 'public_multi_resource_routes_v176', 'public_multi_resource_route_items_v176']) {
    assert.equal(await scalar('select relrowsecurity from pg_class where oid=$1::regclass', [`public.${table}`]), true);
    assert.equal(await scalar(`select has_table_privilege('anon',$1,'select')`, [`public.${table}`]), false);
    assert.equal(await scalar(`select has_table_privilege('authenticated',$1,'insert')`, [`public.${table}`]), false);
    assert.equal(await scalar(`select count(*)::int from public.${table}`), 0);
  }
  const signature = 'public.book_minuta_multi_resource_route_v176(uuid,text,text,jsonb,jsonb)';
  for (const role of ['anon', 'authenticated', 'service_role'])
    assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')', [role, signature]), false);
  await db.query(body('supabase-migration-v176-rollback.sql'));
  assert.deepEqual(await legacy(), before);
  await db.query(body('supabase-migration-v176.sql'));
  assert.deepEqual(await legacy(), before);
  assert.equal(await scalar('select has_function_privilege(\'anon\',$1,\'execute\')', [signature]), false);
  console.log('PASS: full-schema apply twice, legacy definitions and grants, closed RPC/RLS, rollback/reapply');
} catch (error) {
  console.error(JSON.stringify({ error: error.message, code: error.code }));
  process.exitCode = 1;
} finally {
  await db.query('rollback');
  await db.end();
}
