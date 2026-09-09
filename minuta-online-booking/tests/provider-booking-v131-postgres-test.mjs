// Real PostgreSQL only. The standard guard rejects production and unconfirmed databases.
// npm install --no-save pg; node tests/provider-booking-v131-postgres-test.mjs
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
  application_name:'minuta-v131-isolated-test',
  ...(tls ? { ssl:tls } : {})
});

let applied = false;
try {
  await client.connect();
  await client.query("set statement_timeout='30s'; set lock_timeout='15s'");
  await client.query(read('supabase-migration-v131-rollback.sql'));
  await client.query(read('supabase-migration-v131.sql'));
  applied = true;
  await client.query(read('supabase-migration-v131.sql'));
  await client.query('begin');
  await client.query(read('tests/booking-concurrency-v123-fixture.sql'));
  await client.query(read('tests/provider-booking-v131-integration.sql'));
  await client.query('rollback');
  await client.query(read('supabase-migration-v131-rollback.sql'));
  applied = false;
  const state = await client.query(`select
    to_regprocedure('public.provider_book_appointment(uuid,date,time without time zone,text,text)') is not null legacy,
    to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)') is null removed`);
  assert.equal(state.rows[0].legacy, true);
  assert.equal(state.rows[0].removed, true);
  console.log('PASS: v131 apply/reapply, ACL, exact replay, conflict, ownership, inactive-service recovery, rollback');
} finally {
  try { await client.query('rollback'); } catch {}
  if (applied) {
    try { await client.query(read('supabase-migration-v131-rollback.sql')); } catch {}
  }
  await client.end().catch(() => {});
}
