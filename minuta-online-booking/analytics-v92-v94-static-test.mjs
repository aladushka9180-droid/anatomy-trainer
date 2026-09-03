import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('./', import.meta.url);
const v92 = readFileSync(new URL('supabase-migration-v92.sql', root), 'utf8');
const v93 = readFileSync(new URL('supabase-migration-v93.sql', root), 'utf8');
const v94 = readFileSync(new URL('supabase-migration-v94.sql', root), 'utf8');
const rollback92 = readFileSync(new URL('recovery/rollback-booking-attribution-v92.sql', root), 'utf8');
const rollback93 = readFileSync(new URL('recovery/rollback-booking-events-v93.sql', root), 'utf8');
const rollback94 = readFileSync(new URL('supabase-migration-v94-rollback.sql', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');

assert.match(v92, /v92_requires_v54_v65_v68_v72_v91/i);
assert.match(v92, /bootstrap_client_identity_session\(text,text,text\)/i);
assert.match(v92, /add column if not exists booking_source text/i);
assert.match(v92, /new\.booking_source:=null[\s\S]*new\.created_by_user_id:=null[\s\S]*new\.created_by_role:=null/i);
assert.match(v92, /booking_creation_attribution_immutable/i);
assert.match(v92, /grant execute on function public\.get_minuta_team_analytics\(date,date\)[\s\S]*to authenticated/i);
assert.match(v92, /revoke all on function public\.get_minuta_team_analytics\(date,date\)[\s\S]*from public,anon,authenticated,service_role/i);
assert.doesNotMatch(v92, /provider_delete_booking/i);

assert.match(v93, /v93_requires_v92/i);
assert.match(v93, /get_minuta_team_analytics\(date,date\)/i);
assert.match(v93, /create table if not exists public\.booking_events/i);
assert.match(v93, /alter table public\.booking_events enable row level security/i);
assert.match(v93, /bookings_capture_event_v93[\s\S]*after insert or update on public\.bookings/i);
assert.match(v93, /booking_outcomes_capture_event_v93[\s\S]*after insert or update on public\.booking_outcomes/i);
assert.match(v93, /grant execute on function public\.get_minuta_booking_events\(uuid,date,date,integer\) to authenticated/i);
assert.match(v93, /revoke all on table public\.booking_events from public,anon,authenticated,service_role/i);
assert.doesNotMatch(v93, /provider_delete_booking/i);

assert.match(v94, /v94_requires_v93/i);
assert.match(v94, /create index if not exists bookings_performer_date_time_v94_idx/i);
assert.match(v94, /get_minuta_staff_report_bookings\(p_organization uuid,p_start date,p_end date,p_performer uuid default null\)/i);
assert.match(rollback94, /drop index if exists public\.bookings_performer_date_time_v94_idx/i);
assert.match(rollback94, /drop function if exists public\.get_minuta_staff_report_bookings\(uuid,date,date,uuid\)/i);
assert.match(rollback93, /v93_rollback_blocked_booking_events_exist/i);
assert.match(rollback93, /drop trigger if exists booking_outcomes_capture_event_v93/i);
assert.match(rollback92, /v92_rollback_requires_v93_removed/i);
assert.match(rollback92, /v92_rollback_blocked_booking_attribution_exists/i);
assert.match(rollback92, /drop column if exists booking_source/i);

assert.match(provider, /db\.rpc\('get_minuta_team_analytics'/i);
assert.match(provider, /db\.rpc\('get_minuta_booking_events'/i);

console.log('v92-v94 analytics, event history and index static checks passed');
