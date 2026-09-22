import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8').replace(/\r/g, '');
const migration = read('supabase-migration-v173.sql');
const rollback = read('supabase-migration-v173-rollback.sql');
const integration = read('tests/abuse-guards-v173-integration.sql');
const concurrency = read('tests/abuse-guards-v173-postgres-concurrency-test.mjs');
const booking = read('supabase-migration-v153.sql');
const waitlist = read('supabase-migration-v111.sql');
const messages = read('supabase-migration-v162.sql');

assert.match(migration, /minuta_abuse_rate_buckets_v173[\s\S]*force row level security/);
assert.match(migration, /revoke all on table public\.minuta_abuse_rate_buckets_v173 from public,anon,authenticated,service_role/);
assert.match(migration, /on conflict\(scope_kind,scope_sha256,window_seconds,window_started_at\)[\s\S]*request_count=.*request_count\+1/);
assert.match(migration, /message_participant_minute'[\s\S]*,60,12/);
assert.match(migration, /booking_phone_hour'[\s\S]*,3600,5/);
assert.match(migration, /waitlist_phone_hour'[\s\S]*,3600,5/);
assert.match(migration, /char_length\(v_phone\) not between 10 and 15/);
for (const [guardName, maxNameBytes] of [
  ['guard_minuta_public_booking_v173', 480],
  ['guard_minuta_waitlist_v173', 320],
]) {
  const guard = migration.match(new RegExp(`create or replace function public\\.${guardName}\\(\\)[\\s\\S]*?\\$\\$;`, 'u'))?.[0];
  assert.ok(guard, `${guardName} definition exists`);
  const phoneBound = guard.indexOf("octet_length(coalesce(new.client_phone,''))>40");
  const nameBound = guard.indexOf(`octet_length(coalesce(new.client_name,''))>${maxNameBytes}`);
  const phoneNormalization = guard.indexOf('v_phone:=regexp_replace');
  assert.ok(phoneBound >= 0 && nameBound >= 0 && phoneBound < phoneNormalization && nameBound < phoneNormalization,
    `${guardName} bounds raw input before phone normalization`);
}
assert.match(migration, /v_request_role not in\('anon','authenticated'\) then return new/);
assert.equal((migration.match(/coalesce\(auth\.role\(\),''\) not in\('anon','authenticated'\) then return new/g) || []).length,2);
assert.match(migration, /before insert on public\.bookings/);
assert.match(migration, /before insert on public\.organization_waitlist_requests/);
assert.match(migration, /before insert on public\.conversation_messages_v162/);
assert.doesNotMatch(migration, /client_phone\s+text|ip_address|device_id|turnstile/i);
assert.match(migration, /raise exception using errcode='P0001',message='request_rate_limited'/);
assert.match(migration, /revoke all on function public\.minuta_consume_abuse_limit_v173[\s\S]*from public,anon,authenticated,service_role/);

// Exact replays finish before the guarded INSERT, so they do not spend a new budget.
assert.ok(booking.indexOf('if v_existing then') < booking.indexOf('from public.book_minuta_appointment('));
assert.ok(messages.indexOf("minuta_message_receipt_v162(p_actor_key,'send_message'") < messages.indexOf('insert into public.conversation_messages_v162('));
assert.ok(waitlist.indexOf('if v_existing.id is not null then') < waitlist.indexOf('insert into public.organization_waitlist_requests('));

assert.match(integration, /ISOLATED TEST DATABASE ONLY/);
assert.match(integration, /request_rate_limited/);
assert.match(integration, /set local role anon/);
assert.match(integration, /bucket_contains_no_raw_scope_or_pii/);
assert.match(integration, /trusted_provider_and_import_paths_bypass_public_budgets/);
assert.match(integration, /rollback;\s*$/i);
assert.match(concurrency, /Promise\.allSettled/);
assert.match(concurrency, /allowed,5/);
assert.match(concurrency, /MINUTA_TEST_DATABASE_URL/);
assert.match(concurrency, /migration-config-guard\.mjs/);
assert.match(concurrency, /delete from public\.minuta_abuse_rate_buckets_v173/);

assert.match(rollback, /drop trigger if exists bookings_abuse_guard_v173/);
assert.match(rollback, /drop trigger if exists waitlist_abuse_guard_v173/);
assert.match(rollback, /drop trigger if exists messages_abuse_guard_v173/);
assert.match(rollback, /drop table public\.minuta_abuse_rate_buckets_v173/);
assert.doesNotMatch(`${migration}\n${rollback}`, /service[_-]?role[_-]?key|SUPABASE_DB_URL|__SECRET__/i);

console.log('PASS: v173 server-side booking, waitlist and message abuse-guard contract');
