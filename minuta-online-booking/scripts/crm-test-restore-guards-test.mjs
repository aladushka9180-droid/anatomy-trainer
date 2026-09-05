// Static contract + synthetic predicate tests only. Never connects to a database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`crm-test-restore-${name}.sql`, import.meta.url), 'utf8');
const preflight = read('preflight');
const quiesce = read('quiesce');
const before = read('before');
const after = read('after');

test('preflight is read-only and rejects replica-capable auth/business hooks', () => {
  assert.match(preflight, /begin read only;/);
  assert.match(preflight, /rollback;/);
  for (const sql of [preflight, before]) {
    assert.match(sql, /c\.relnamespace in \('public'::regnamespace,'auth'::regnamespace\)/);
    assert.match(sql, /t\.tgenabled in \('A','R'\)/);
    assert.match(sql, /exists\(select 1 from net\.http_request_queue\)/);
  }
});

test('cron guard accepts permanent launcher but rejects libpq and background jobs', () => {
  for (const sql of [quiesce, before]) {
    assert.match(sql, /backend_type ilike '%cron%' and backend_type<>'pg_cron launcher'/);
    assert.match(sql, /application_name ilike 'pg_cron%'\s+and backend_type<>'pg_cron launcher'/);
  }
  // Mirrors the exact boolean expression above, with distinct launcher/job fixtures.
  const blocks = (type, app) => (/cron/i.test(type) || /^pg_cron/i.test(app)) && type !== 'pg_cron launcher';
  assert.equal(blocks('pg_cron launcher', 'pg_cron scheduler'), false);
  assert.equal(blocks('pg_cron worker', ''), true);
  assert.equal(blocks('client backend', 'pg_cron'), true);
  assert.equal(blocks('client backend', 'pg_cron job'), true);
  assert.equal(blocks('client backend', 'psql'), false);
});

test('before requires local replica transaction before destructive mutations', () => {
  const guard = (sql) => sql.slice(sql.indexOf('do $guard$'), sql.indexOf('$guard$;') + '$guard$;'.length).replaceAll('\r', '');
  assert.equal(guard(before), guard(preflight), 'in-transaction preflight must exactly match the read-only standalone gate');
  assert.doesNotMatch(before, /^rollback;/m);
  const check = before.indexOf("current_setting('session_replication_role')<>'replica'");
  assert.ok(check > 0);
  assert.ok(check < before.indexOf('delete from vault.secrets'));
  assert.ok(check < before.indexOf('truncate net.http_request_queue'));
  assert.match(before, /pg_try_advisory_xact_lock\(114,112\)/);
  assert.match(before, /lock table auth\.users in share row exclusive mode;/);
  assert.match(after, /to_regclass\('pg_temp\.crm_preserved_auth_triggers'\) is null/);
  assert.ok(after.indexOf('$transaction$') < after.indexOf('revoke all'));
});

test('preservation compares complete trigger sets and managed function definitions', () => {
  assert.match(before, /pg_get_triggerdef\(t\.oid\) as definition/);
  assert.match(after, /pg_get_triggerdef\(current\.oid\) is distinct from saved\.definition/);
  assert.match(after, /auth_trigger_set_changed_during_restore/);
  assert.match(after, /count\(\*\) from crm_preserved_event_triggers/);
  for (const field of ['evtname', 'evtevent', 'evttags', 'evtowner']) {
    assert.ok(after.includes(`current.${field} is distinct from saved.${field}`));
  }
  assert.match(after, /pg_get_functiondef\(p\.oid\) is distinct from saved\.definition/);
  assert.match(after, /p\.proowner is distinct from saved\.proowner/);
  assert.match(after, /pg_get_functiondef\(p\.oid\) is distinct from saved\.function_definition/);
  assert.match(after, /p\.proconfig is distinct from saved\.proconfig/);
  assert.match(after, /p\.prosecdef is distinct from saved\.prosecdef/);
});

test('ACL seal includes procedures, not only functions', () => {
  assert.match(after, /revoke all on all routines in schema public from public,anon,authenticated,service_role;/);
  assert.match(after, /revoke all on schema public from public,anon,authenticated,service_role;/);
  assert.match(after, /alter default privileges in schema public revoke all on functions from public;/);
});

test('phone contract accepts synthetic phones and blocked-slot sentinel, rejects null/malformed', () => {
  assert.doesNotMatch(after, /like '7000%'/i);
  assert.match(after, /client_phone is null/);
  assert.match(after, /client_phone<>'0000000000' and client_phone !~ '\^7\[0-9\]\{10\}\$'/);
  assert.match(after, /payment_url is distinct from '' or provider_note is distinct from ''/);
  const valid = (phone) => phone !== null && (phone === '0000000000' || /^7[0-9]{10}$/.test(phone));
  for (const phone of ['0000000000', '70000000001', '70010000001']) assert.equal(valid(phone), true);
  for (const phone of [null, '', '7000', '700000000000', '+70000000001', '0000000001']) assert.equal(valid(phone), false);
});
