import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('.', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v106.sql', root), 'utf8');
const rollback = readFileSync(new URL('supabase-migration-v106-rollback.sql', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const worker = readFileSync(new URL('sw.js', root), 'utf8');
const html = readFileSync(new URL('provider.html', root), 'utf8');
const expiry = readFileSync(new URL('../.github/workflows/minuta-unpaid-booking-expiry.yml', root), 'utf8');

assert.match(migration, /save_minuta_booking_outcome_v106/);
assert.match(migration, /process_minuta_auto_completed_visits_v106/);
assert.match(migration, /security definer set search_path to ''/i);
assert.match(migration, /for update of booking skip locked/i);
assert.match(migration, /pg_try_advisory_xact_lock/i);
assert.match(migration, /pg_timezone_names/);
assert.match(migration, /add column if not exists auto_complete_visits boolean not null default false/);
assert.match(migration, /add column if not exists completion_source text not null default 'manual'/);
assert.match(migration, /add column if not exists actual_duration_minutes integer/);
assert.match(migration, /add column if not exists calculated_amount_rub integer/);
assert.match(migration, /v106_incompatible_outcome_metadata/);
assert.match(migration, /grant execute on function public\.save_minuta_booking_outcome_v106[^;]+to authenticated/i);
assert.match(migration, /revoke all on function public\.process_minuta_auto_completed_visits_v106[^;]+from public,anon,authenticated,service_role/i);
assert.doesNotMatch(rollback, /delete from|truncate|drop table/i);
assert.match(provider, /db\.rpc\('save_minuta_booking_outcome_v106'/);
assert.match(provider, /Ожидает синхронизации/);
assert.match(provider, /_sync_pending/);
assert.doesNotMatch(provider, /delete compatibleRecord\.auto_complete_visits/);
assert.match(expiry, /process_minuta_auto_completed_visits_v106/);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v358`/);
assert.match(html, /provider\.js\?v=358/);

console.log('Visit outcomes v106 static checks passed.');
