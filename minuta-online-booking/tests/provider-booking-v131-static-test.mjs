import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase-migration-v131.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase-migration-v131-rollback.sql', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');

const functionBody = (source, name, nextName = '') => {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  assert.ok(end > start, `${name} boundary must exist`);
  return source.slice(start, end);
};

test('migration adds only the six-argument authenticated provider overload', () => {
  assert.match(migration, /create or replace function public\.provider_book_appointment\(\s*p_request_id uuid,\s*p_service uuid,/i);
  assert.match(migration, /to_regprocedure\(\s*'public\.provider_book_appointment\(uuid,date,time without time zone,text,text\)'/i);
  assert.match(migration, /from public\.book_appointment\(\s*p_request_id,\s*p_service,\s*p_date,\s*p_time,/i);
  assert.match(migration, /where booking\.request_id = p_request_id/i);
  assert.match(migration, /booking\.performer_id is distinct from v_actor/i);
  assert.match(migration, /service\.performer_id = v_actor/i);
  assert.doesNotMatch(migration, /service\.active\s+and service\.performer_id/i, 'inactive-service replay must reach the idempotent core');
  assert.match(migration, /grant execute on function public\.provider_book_appointment\([\s\S]*?\) to authenticated;/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*?to (?:anon|public|service_role)/i);
});

test('rollback removes only the new overload and preserves legacy five-argument API and rows', () => {
  assert.match(rollback, /drop function if exists public\.provider_book_appointment\(\s*uuid, uuid, date, time without time zone, text, text\s*\)/i);
  assert.match(rollback, /v131_rollback_legacy_provider_api_missing/);
  assert.doesNotMatch(rollback, /delete from|truncate|drop table/i);
  assert.doesNotMatch(rollback, /drop function[^;]*provider_book_appointment\(\s*uuid,\s*date/i);
});

test('provider persists request identity, uses the overload, and falls back only on its exact absence', () => {
  const submit = functionBody(provider, 'submitProviderBookingAttempt', 'readConnectionLog');
  assert.ok(submit.indexOf('saveProviderBookingAttempt(attempt, userId)') < submit.indexOf("db.rpc('provider_book_appointment', { p_request_id:attempt.requestId"));
  assert.match(submit, /if \(isMissingProviderBookingRequestRpc\(reply\?\.error\)\)/);
  assert.doesNotMatch(submit, /db\.rpc\('book_appointment'/);
  assert.match(submit, /legacyFallback:true, legacyUncertain:true/);
  assert.match(submit, /if \(attempt\.legacyUncertain \|\| attempt\.legacyFallback\) return/);
  const missing = functionBody(provider, 'isMissingProviderBookingRequestRpc', 'submitProviderBookingAttempt');
  assert.match(missing, /provider_book_appointment/);
  assert.match(missing, /p_request_id/);
});

test('manual and visible repeat booking share exact-row recovery; hidden legacy form is gone', () => {
  const create = functionBody(provider, 'createNewBooking', 'closeBookingSheet');
  assert.match(create, /submitProviderBookingAttempt\(/);
  assert.match(create, /bookingCode:bookingCodeFromRpcResult\(bookingRpcResult\)/);
  assert.match(create, /ensureCreatedBookingVisible\(createdCriteria\)/);
  assert.match(create, /clearProviderBookingAttempt\(providerAttempt\.requestId, userId\)/);
  assert.ok(create.indexOf('const unresolvedProviderAttempt = readProviderBookingAttempt(userId)') < create.indexOf('if (editingOfflineBookingId)'), 'unresolved online write must block a new offline draft');
  assert.doesNotMatch(create, /db\.rpc\('book_appointment'/);
  assert.doesNotMatch(html, /repeatBookingForm|client-repeat-legacy|id="repeatService"|id="repeatTimes"/);
  assert.doesNotMatch(provider, /createRepeatBooking|loadRepeatSlots|populateRepeatServices|data-repeat-time/);
  assert.match(provider, /function openRepeatBookingFromSheet[\s\S]*?openNewBookingSheet\(/);
});

test('exact recovery accepts neither a similar client row nor a wrong returned code', () => {
  const recovery = functionBody(provider, 'createdBookingMatches', 'findCreatedBooking');
  assert.match(recovery, /\(!id \|\| item\.id === id\)/);
  assert.match(recovery, /\(!bookingCode \|\| item\.booking_code === bookingCode\)/);
  assert.match(recovery, /item\.service_id === service/);
  assert.match(recovery, /normalizePhone\(item\.client_phone\) === normalizePhone\(phone\)/);
});
