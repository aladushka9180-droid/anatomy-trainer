// Real PostgreSQL only. The standard guard rejects production and unconfirmed databases.
// npm install --no-save pg; node tests/provider-booking-v131-postgres-test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
let canonicalState = null;
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
  canonicalState = (await client.query(`
    with procedures as (
      select
        max(md5(replace(proc.prosrc, E'\\r', ''))) filter (
          where proc.oid = to_regprocedure('public.provider_book_appointment(uuid,date,time without time zone,text,text)')
        ) legacy_hash,
        max(md5(replace(proc.prosrc, E'\\r', ''))) filter (
          where proc.oid = to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)')
        ) idempotent_booking_hash,
        max(md5(replace(proc.prosrc, E'\\r', ''))) filter (
          where proc.oid = to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)')
        ) v131_hash,
        bool_and(pg_get_userbyid(proc.proowner) = current_user) owner_invariant,
        bool_and(proc.prosecdef) filter (
          where proc.oid = to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)')
        ) v131_security_definer,
        bool_and(array_to_string(proc.proconfig, ',') like '%search_path=""%') filter (
          where proc.oid = to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)')
        ) v131_search_path_fixed
      from pg_proc proc
      where proc.oid in (
        to_regprocedure('public.provider_book_appointment(uuid,date,time without time zone,text,text)'),
        to_regprocedure('public.book_appointment(uuid,uuid,date,time without time zone,text,text)'),
        to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)')
      )
    )
    select jsonb_build_object(
      'schemaServerVersion', current_setting('server_version'),
      'schemaServerMajor', current_setting('server_version_num')::integer / 10000,
      'legacyHash', legacy_hash,
      'idempotentBookingHash', idempotent_booking_hash,
      'v131Hash', v131_hash,
      'ownerInvariant', owner_invariant,
      'v131SecurityDefiner', v131_security_definer,
      'v131SearchPathFixed', v131_search_path_fixed,
      'authenticatedExecute', has_function_privilege('authenticated', 'public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)', 'EXECUTE'),
      'anonExecute', has_function_privilege('anon', 'public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)', 'EXECUTE'),
      'serviceRoleExecute', has_function_privilege('service_role', 'public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)', 'EXECUTE'),
      'requestIndexReady', exists (
        select 1 from pg_indexes
        where schemaname='public' and tablename='bookings' and indexname='idx_bookings_request_id'
          and indexdef ilike 'create unique index%on public.bookings%request_id%'
      )
    ) state
    from procedures
  `)).rows[0]?.state;
  assert.equal(canonicalState?.legacyHash, '653390c7c91458eef408e82593f38249');
  assert.equal(canonicalState?.idempotentBookingHash, 'abadc0c81de68738ba6382cd03dda62d');
  assert.match(String(canonicalState?.v131Hash || ''), /^[0-9a-f]{32}$/);
  assert.equal(canonicalState?.ownerInvariant, true);
  assert.equal(canonicalState?.v131SecurityDefiner, true);
  assert.equal(canonicalState?.v131SearchPathFixed, true);
  assert.equal(canonicalState?.authenticatedExecute, true);
  assert.equal(canonicalState?.anonExecute, false);
  assert.equal(canonicalState?.serviceRoleExecute, false);
  assert.equal(canonicalState?.requestIndexReady, true);
  await client.query(read('supabase-migration-v131-rollback.sql'));
  applied = false;
  const state = await client.query(`select
    to_regprocedure('public.provider_book_appointment(uuid,date,time without time zone,text,text)') is not null legacy,
    to_regprocedure('public.provider_book_appointment(uuid,uuid,date,time without time zone,text,text)') is null removed`);
  assert.equal(state.rows[0].legacy, true);
  assert.equal(state.rows[0].removed, true);
  if (process.env.MINUTA_V131_ATTESTATION_PATH) {
    writeFileSync(process.env.MINUTA_V131_ATTESTATION_PATH, `${JSON.stringify({
      status:'success', phase:'test-v131', isolatedDatabase:true, productionWritten:false,
      applyReapplyPassed:true, aclPassed:true, exactReplayPassed:true, conflictPassed:true,
      ownershipPassed:true, inactiveServiceRecoveryPassed:true, rollbackVerified:true,
      ...canonicalState
    })}\n`, { encoding:'utf8', mode:0o600 });
  }
  console.log('PASS: v131 apply/reapply, ACL, exact replay, conflict, ownership, inactive-service recovery, rollback');
} finally {
  try { await client.query('rollback'); } catch {}
  if (applied) {
    try { await client.query(read('supabase-migration-v131-rollback.sql')); } catch {}
  }
  await client.end().catch(() => {});
}
