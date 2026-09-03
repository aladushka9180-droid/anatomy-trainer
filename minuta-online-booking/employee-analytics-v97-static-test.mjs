import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v97.sql', root), 'utf8');
const rollback = readFileSync(new URL('recovery/rollback-employee-analytics-v97.sql', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');

assert.match(migration, /\\set ON_ERROR_STOP on/i);
assert.match(migration, /v97_requires_v94_v95_v96/i);
assert.match(migration, /add column if not exists completed_performer_id uuid/i);
assert.match(migration, /add column if not exists completion_source text not null default 'manual'/i);
assert.match(migration, /set completion_source='manual'[\s\S]*where completion_source is null/i);
assert.match(migration, /alter column completion_source set default 'manual'/i);
assert.match(migration, /alter column completion_source set not null/i);
assert.match(migration, /check \(completion_source in \('manual','auto'\)\) not valid/i);
assert.match(migration, /validate constraint booking_outcomes_completion_source_check/i);
assert.match(migration, /v97_incompatible_completion_source_(type|value)/i);
assert.match(migration, /notify pgrst, 'reload schema'/i);
assert.match(migration, /booking_outcomes_snapshot_performer_v97/i);
assert.match(migration, /client_name_snapshot text/i);
assert.match(migration, /on delete set null not valid/i);
assert.match(migration, /array_length\(constraint_row\.conkey,1\)=1/i);
assert.match(migration, /get_minuta_staff_report_bookings_v97\(/i);
assert.match(migration, /get_minuta_booking_events_v97\(/i);
assert.match(migration, /p_limit integer,p_offset integer/i);
assert.match(migration, /public\.normalize_client_phone\(previous\.client_phone\)/i);
assert.match(migration, /coalesce\(outcome\.completed_performer_id,booking\.performer_id\)/i);
assert.match(migration, /create index concurrently if not exists booking_outcomes_completed_performer_v97_idx/i);
assert.match(migration, /MINUTA_CONCURRENT_INDEXES_BEGIN/i);
assert.doesNotMatch(migration, /to_jsonb\(booking\)/i);
assert.match(rollback, /drop function if exists public\.get_minuta_staff_report_bookings_v97/i);
assert.doesNotMatch(rollback, /drop column if exists (completed_performer_id|client_name_snapshot)/i);
assert.match(provider, /rpcName = 'get_minuta_staff_report_bookings_v97'/i);
assert.match(provider, /\.rpc\(rpcName/i);
assert.match(provider, /db\.rpc\('get_minuta_booking_events_v97'/i);
assert.match(provider, /db\.rpc\('get_minuta_staff_report_availability'/i);

console.log('v97 employee analytics and audit-history static checks passed');
