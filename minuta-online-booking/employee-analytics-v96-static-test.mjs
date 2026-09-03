import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v96.sql', root), 'utf8');
const rollback = readFileSync(new URL('recovery/rollback-employee-analytics-v96.sql', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');

assert.match(migration, /v96_requires_v94_v95/i);
assert.match(migration, /add column if not exists completed_performer_id uuid/i);
assert.match(migration, /booking_outcomes_snapshot_performer_v95/i);
assert.match(migration, /get_minuta_staff_report_bookings_v95\(p_organization uuid,p_start date,p_end date,p_performer uuid default null\)/i);
assert.match(migration, /get_minuta_staff_report_availability\(p_organization uuid,p_start date,p_end date,p_performer uuid default null\)/i);
assert.match(migration, /grant execute on function public\.get_minuta_staff_report_bookings_v95\(uuid,date,date,uuid\) to authenticated/i);
assert.match(migration, /grant execute on function public\.get_minuta_staff_report_availability\(uuid,date,date,uuid\) to authenticated/i);
assert.match(rollback, /drop function if exists public\.get_minuta_staff_report_availability/i);
assert.doesNotMatch(rollback, /drop column if exists completed_performer_id/i);
assert.match(provider, /db\.rpc\('get_minuta_staff_report_bookings_v95'/i);
assert.match(provider, /db\.rpc\('get_minuta_staff_report_availability'/i);

console.log('v96 employee analytics static checks passed');
