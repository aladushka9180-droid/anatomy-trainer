// Real PostgreSQL only. The standard guard rejects production and unconfirmed databases.
// npm install --no-save pg; node tests/service-presets-v160-postgres-test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio:'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function', 'PostgreSQL Client constructor unavailable');
const read = name => readFileSync(new URL(name, root), 'utf8');
const tls = process.env.MINUTA_TEST_PG_TLS_NO_VERIFY === 'MIGRATION_TEST_ONLY' ? { rejectUnauthorized:false } : undefined;
const client = new Client({
  connectionString:process.env.MINUTA_TEST_DATABASE_URL,
  application_name:'minuta-v160-isolated-test',
  ...(tls ? { ssl:tls } : {})
});

let applied = false;
try {
  await client.connect();
  await client.query("set statement_timeout='120s'; set lock_timeout='15s'");
  const preexisting = (await client.query(`select to_regclass('public.minuta_service_preset_requests_v160') is not null present`)).rows[0]?.present;
  if (preexisting) await client.query(read('supabase-migration-v160-rollback.sql'));

  await client.query(read('supabase-migration-v160.sql'));
  applied = true;
  await client.query(read('tests/service-presets-v160-integration.sql'));
  const state = (await client.query(`select jsonb_build_object(
    'professionCount',(select count(*) from public.minuta_professions_v160),
    'presetCount',(select count(*) from public.minuta_service_presets_v160),
    'requestCount',(select count(*) from public.minuta_service_preset_requests_v160),
    'selectionCount',(select count(*) from public.minuta_performer_professions_v160),
    'normalizedIndex',to_regclass('public.services_normalized_name_v160_idx') is not null,
    'duplicateTrigger',exists(select 1 from pg_trigger where tgname='services_prevent_duplicate_name_v160' and not tgisinternal),
    'securityDefiner',(select prosecdef from pg_proc where oid='public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)'::regprocedure),
    'fixedSearchPath',(select proconfig=array['search_path=""']::text[] from pg_proc where oid='public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)'::regprocedure),
    'authenticatedExecute',has_function_privilege('authenticated','public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)','EXECUTE'),
    'anonExecute',has_function_privilege('anon','public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)','EXECUTE'),
    'serviceRoleExecute',has_function_privilege('service_role','public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)','EXECUTE')
  ) state`)).rows[0]?.state;
  assert.equal(Number(state?.professionCount), 12);
  assert.equal(Number(state?.presetCount), 83);
  assert.equal(Number(state?.requestCount), 0, 'Integration transaction leaked request rows');
  assert.equal(Number(state?.selectionCount), 0, 'Integration transaction leaked profession rows');
  assert.equal(state?.normalizedIndex, true);
  assert.equal(state?.duplicateTrigger, true);
  assert.equal(state?.securityDefiner, true);
  assert.equal(state?.fixedSearchPath, true);
  assert.equal(state?.authenticatedExecute, true);
  assert.equal(state?.anonExecute, false);
  assert.equal(state?.serviceRoleExecute, false);

  await client.query(read('supabase-migration-v160-rollback.sql'));
  applied = false;
  let removed = (await client.query(`select
    to_regprocedure('public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)') is null rpc_removed,
    to_regclass('public.minuta_service_presets_v160') is null catalog_removed,
    to_regclass('public.services_normalized_name_v160_idx') is null index_removed`)).rows[0];
  assert.deepEqual(removed, { rpc_removed:true, catalog_removed:true, index_removed:true });

  await client.query(read('supabase-migration-v160.sql'));
  applied = true;
  await client.query(read('supabase-migration-v160-rollback.sql'));
  applied = false;
  removed = (await client.query(`select
    to_regprocedure('public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)') is null rpc_removed,
    to_regclass('public.minuta_service_presets_v160') is null catalog_removed,
    to_regclass('public.services_normalized_name_v160_idx') is null index_removed`)).rows[0];
  assert.deepEqual(removed, { rpc_removed:true, catalog_removed:true, index_removed:true });
  console.log('PASS: v160 apply, catalog parity, owner isolation, exact replay, conflict, duplicate guard, rollback and clean reapply');
} finally {
  try { await client.query('rollback'); } catch {}
  if (applied) {
    try { await client.query(read('supabase-migration-v160-rollback.sql')); } catch {}
  }
  await client.end().catch(() => {});
}
