import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider=readFileSync(new URL('./provider.js',import.meta.url),'utf8');
const html=readFileSync(new URL('./provider.html',import.meta.url),'utf8');
const worker=readFileSync(new URL('./sw.js',import.meta.url),'utf8');
const migration=readFileSync(new URL('./supabase-migration-v143.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('./supabase-migration-v143-rollback.sql',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/minuta-v143-safe-release.yml',import.meta.url),'utf8');

for(const required of [
  "db.rpc('reschedule_minuta_provider_booking_v143'",
  'p_expected_date:item.booking_date',
  'p_expected_time:item.booking_time',
  'providerRescheduleRpcMissing(result.error)',
  'return updateBookingAtExpectedStateLegacy(item, changes, userId)',
  "row?.notifications_suppressed === false",
  'providerRescheduleErrorMessage(error)'
])assert.ok(provider.includes(required),`missing provider v143 contract: ${required}`);
assert.match(provider,/if \(result\.error && providerRescheduleRpcMissing\(result\.error\)\) \{\s*return updateBookingAtExpectedStateLegacy\(item, changes, userId\);\s*\}/,
  'legacy update must only follow an exact missing-RPC classification');

for(const required of [
  'reschedule_minuta_provider_booking_v143',
  "pg_advisory_xact_lock(hashtextextended(p_booking::text,7302))",
  "pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text,7100))",
  "raise exception using errcode='40001',message='provider_booking_changed'",
  "raise exception using errcode='23P01',message='provider_booking_slot_unavailable'",
  'get_available_slots_v101(v_booking.service_id,p_date,p_date,p_booking)',
  "v_booking.performer_id<>v_actor",
  "to authenticated;"
])assert.ok(migration.includes(required),`missing migration v143 contract: ${required}`);
assert.match(rollback,/drop function if exists public\.reschedule_minuta_provider_booking_v143/);
assert.match(html,/provider\.js\?v=700/);
assert.match(worker,/const CACHE = `\$\{CACHE_PREFIX\}v700`/);
assert.match(worker,/\.\/provider\.js\?v=700/);

for(const required of [
  'options: [test-v143, validate-production-v143, apply-production-v143, observe-production-v143]',
  'BACKUP_VERIFIED',
  'minuta-supabase-backup.yml',
  'minuta-supabase-restore-drill.yml',
  'provider-reschedule-v143-integration.sql'
])assert.ok(workflow.includes(required),`missing v143 safe-release gate: ${required}`);

console.log('Provider reschedule v143 static checks passed.');
