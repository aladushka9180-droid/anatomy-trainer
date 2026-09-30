import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { catalog, migration, compatibleBody, compatibilityRollback } from '../scripts/build-service-catalog-v2.mjs';
const require = createRequire(import.meta.url);
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
assert.equal(read('../supabase-service-catalog-v2.sql'), migration, 'Regenerate SQL after catalog changes');
assert.equal(read('../supabase-service-catalog-v2-compatibility-rollback.sql'), compatibilityRollback);
let db;
if (process.argv.includes('--postgres')) {
  const url = process.env.SERVICE_CATALOG_LOCAL_POSTGRES_URL;
  assert.ok(url, 'Disposable local database required');
  const target = new URL(url);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname), 'Remote databases refused');
  assert.equal(target.pathname, '/service_catalog_test');
  const { Client } = require('pg');
  db = new Client({ connectionString:url });
  await db.connect();
  db.exec = sql => db.query(sql);
} else {
  const { PGlite } = require(path.join(process.env.MINUTA_PGLITE_PACKAGE || '@electric-sql/pglite', 'dist/index.cjs'));
  db = new PGlite();
}
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const role = async (uid = owner, name = 'authenticated') => {
  await db.query('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await db.query(`set role ${name}`);
};
const create = async (version, profession, preset, name, request = randomUUID()) => {
  const r = await db.query('select public.create_provider_services_from_presets_v160($1,$2,$3,$4::jsonb) result',
    [request, version, [profession], JSON.stringify([{ item_id:preset, preset_id:preset, name, duration_minutes:37, price_rub:1234 }])]);
  return r.rows[0].result;
};
const snapshot = async () => {
  await db.query('reset role');
  return {
    functions:(await db.query("select proname,replace(prosrc,E'\\r\\n',E'\\n') prosrc,proacl::text,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace order by proname")).rows,
    security:(await db.query("select relname,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows,
    policies:(await db.query("select * from pg_policies where schemaname='public' order by tablename,policyname")).rows
  };
};
try {
  assert.equal((await db.query("select count(*)::int n from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')")).rows[0].n, 0, 'Populated databases refused');
  await db.exec(read('./services-42501-fixture.sql'));
  await db.exec(read('../supabase-migration-v160.sql'));
  const security = await snapshot();
  await role();
  await create(1, 'massage_therapist', 'massage_full_body', 'Старая услуга');
  await db.query('reset role');
  await db.exec(migration);
  await db.exec(migration);
  const compatibleSecurity = await snapshot();
  const rpc = compatibleSecurity.functions.find(f => f.proname === 'create_provider_services_from_presets_v160');
  assert.equal(rpc.prosrc.replaceAll('\r\n','\n'), compatibleBody);
  rpc.prosrc = security.functions.find(f => f.proname === rpc.proname).prosrc;
  assert.deepEqual(compatibleSecurity, security, 'Only the exact compatibility body may change; ACLs stay intact');
  await db.exec(read('../supabase-service-catalog-v2-rollback.sql'));
  await db.exec(compatibilityRollback);
  assert.deepEqual(await snapshot(), security, 'Full guarded rollback must restore original function');
  await db.exec(migration);
  const rows = (await db.query('select * from public.get_provider_service_preset_catalog_v160()')).rows;
  assert.equal(rows.length, catalog.professions.reduce((n,p) => n + p.services.length, 0));
  assert.ok(rows.every(r => r.catalog_version === 2));
  assert.equal((await db.query('select * from public.get_provider_service_preset_catalog_v160(1)')).rows.length, 83);
  await role();
  const request = randomUUID();
  const first = await create(2, 'tire_fitter', 'tire_seasonal', 'Новая услуга', request);
  assert.equal(first.created_count, 1);
  assert.equal((await create(2, 'tire_fitter', 'tire_seasonal', 'Новая услуга', request)).replayed, true);
  const oldAfterNew = await create(1, 'massage_therapist', 'massage_head', 'Old PWA after new');
  assert.deepEqual(oldAfterNew.profession_ids, ['massage_therapist','tire_fitter'], 'Old PWA must preserve professions it cannot display');
  await assert.rejects(create(1, 'tire_fitter', 'tire_seasonal', 'Wrong version'));
  await assert.rejects(create(2, 'massage_therapist', 'tire_seasonal', 'Wrong profession'));
  await role(other);
  const stateOther = (await db.query('select public.get_provider_service_preset_state_v160() state')).rows[0].state;
  assert.deepEqual(stateOther.profession_ids, []);
  await create(1, 'nail_artist', 'nails_pedicure', 'Cached PWA service');
  await role(other, 'anon');
  await assert.rejects(create(2, 'tire_fitter', 'tire_seasonal', 'Anonymous'), e => e.code === '42501');
  await db.query('reset role');
  const userRows = async () => (await db.query(`select jsonb_build_object(
    'services',(select jsonb_agg(s order by id) from public.services s),
    'choices',(select jsonb_agg(p order by performer_id,profession_id) from public.minuta_performer_professions_v160 p),
    'requests',(select jsonb_agg(r order by performer_id,request_id) from public.minuta_service_preset_requests_v160 r)) snapshot`)).rows[0].snapshot;
  const beforeRollback = await userRows();
  await db.exec(read('../supabase-service-catalog-v2-rollback.sql'));
  assert.deepEqual(await userRows(), beforeRollback, 'Rollback erased user data');
  assert.equal((await db.query('select * from public.get_provider_service_preset_catalog_v160()')).rows.length, 83);
  await role();
  const retained = (await db.query('select public.get_provider_service_preset_state_v160() state')).rows[0].state;
  assert.deepEqual(retained.profession_ids, ['massage_therapist','tire_fitter']);
  await assert.rejects(create(2, 'tire_fitter', 'tire_seasonal', 'Disabled catalog'));
  assert.deepEqual((await create(1, 'massage_therapist', 'massage_head', 'Rollback old client')).profession_ids, ['massage_therapist','tire_fitter']);
  await db.query('reset role');
  await assert.rejects(db.exec(compatibilityRollback), /service_catalog_compatibility_still_required/);
  await db.query('rollback');
  await db.exec(migration);
  await role();
  await create(2, 'tire_fitter', 'tire_balance', 'Reapplied catalog');
  assert.deepEqual((await create(1, 'massage_therapist', 'massage_head', 'Old PWA after reapply')).profession_ids, ['massage_therapist','tire_fitter']);
  await db.query('reset role');
  await db.query("update public.minuta_professions_v160 set label='Collision' where catalog_version=2 and profession_id='tire_fitter'");
  await assert.rejects(db.exec(migration), /service_catalog_v2_collision/);
  await db.query('rollback');
  assert.equal((await db.query("select label from public.minuta_professions_v160 where catalog_version=2 and profession_id='tire_fitter'")).rows[0].label, 'Collision');
  console.log('PASS catalog v2: parity, v1 compatibility, v2/replay, isolation, no ACL/RPC drift, rollback preservation, reapply and collision refusal');
} finally { await (db.end ? db.end() : db.close()); }
