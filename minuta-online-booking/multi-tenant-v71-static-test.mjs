import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(root, 'supabase-migration-v71.sql'), 'utf8');
const rollback = await readFile(join(root, 'recovery', 'rollback-branch-shifts-v71.sql'), 'utf8');
const controller = await readFile(join(root, 'shift-management.js'), 'utf8');
const provider = await readFile(join(root, 'provider.js'), 'utf8');
const app = await readFile(join(root, 'app.js'), 'utf8');
const html = await readFile(join(root, 'provider.html'), 'utf8');
const workflow = await readFile(join(root, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');

assert.match(migration, /v71_requires_v70/i, 'v71 must fail closed without the complete v70 layer');
for (const table of ['organization_shift_settings', 'staff_location_shifts', 'staff_absences', 'staff_schedule_audit_log']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'), `${table} must be additive`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must use RLS`);
}
assert.match(migration, /staff_location_shifts_no_performer_overlap[\s\S]*performer_id with =[\s\S]*tsrange\(shift_date \+ start_time, shift_date \+ end_time, '\[\)'\) with &&/i, 'the database must reject overlapping branch shifts');
assert.match(migration, /staff_absences_no_performer_overlap[\s\S]*daterange\(starts_on, ends_on, '\[\]'\) with &&/i, 'absence periods must not overlap silently');
assert.match(migration, /organization_shift_settings[\s\S]*enabled boolean not null default false/i, 'branch shifts must be disabled by default');
assert.match(migration, /create trigger bookings_enforce_active_shift[\s\S]*after insert or update of organization_id,location_id,performer_id,booking_date,booking_time,duration_minutes,status/i, 'all relevant booking changes must be checked');
assert.match(migration, /minuta_booking_fits_active_shift[\s\S]*staff_absences[\s\S]*staff_location_shifts[\s\S]*break_start/i, 'availability must account for shifts, absence and breaks');
assert.match(migration, /set_minuta_branch_shifts_enabled[\s\S]*existing_bookings_outside_shifts/i, 'activation must preserve all existing bookings');
assert.match(migration, /substitute_minuta_booking[\s\S]*for update[\s\S]*update public\.bookings set service_id=p_new_service,performer_id=v_performer/i, 'substitution must update the original booking atomically');
assert.match(migration, /booking_substitution_addons_require_manual_remap/i, 'substitution must fail closed when add-ons cannot be safely remapped');
assert.match(migration, /delete from public\.notification_marks where booking_id=p_booking/i, 'substitution must reset stale notification state without moving another performer’s marks');
assert.match(migration, /primary_duration_minutes[\s\S]*booking_session_items/i, 'substitution must compare the primary service duration, not total add-on duration');
assert.match(migration, /get_public_minuta_available_slots_v4[\s\S]*get_public_minuta_available_slots_v3[\s\S]*minuta_booking_fits_active_shift/i, 'v4 availability must enrich v69 rather than replace it');
assert.match(migration, /get_reschedule_slots_v4[\s\S]*get_reschedule_slots_v3[\s\S]*minuta_booking_fits_active_shift/i, 'reschedule options must respect active branch shifts');
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\([\s\S]*7100/i, 'booking and schedule mutations must share an organization lock');
assert.doesNotMatch(migration, /insert into public\.staff_absences[\s\S]{0,800}update public\.staff_location_shifts set active=false/i, 'temporary absence must not destroy configured shifts');
assert.match(migration, /get_public_minuta_catalog_v4[\s\S]*get_public_minuta_catalog_v3/i, 'v4 catalog must preserve the v69 resource catalog');

for (const protectedRpc of ['provider_delete_booking', 'book_appointment', 'book_minuta_appointment', 'get_available_slots', 'get_minuta_team_calendar_v2', 'get_public_minuta_available_slots_v3']) {
  assert.doesNotMatch(migration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`, 'i'), `v71 must not replace protected ${protectedRpc}`);
}
assert.match(rollback, /disable_branch_shifts_before_rollback/i, 'rollback must refuse while strict scheduling is active');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'rollback must not use CASCADE');
assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB/i, 'tenant schedules must not be cached on the device');
assert.match(controller, /sessionIsCurrent[\s\S]*organization_id/i, 'controller must reject stale and cross-organization responses');
assert.match(controller, /absence_has_bookings[\s\S]*Сначала замените специалиста/i, 'unsafe absence changes need a clear explanation');
assert.match(provider, /MinutaShifts[\s\S]*shiftController\.setOrganization/i, 'provider must scope the optional controller to the active organization');
assert.match(html, /id="shiftsPanel"[\s\S]*id="shiftForm"[\s\S]*id="absenceForm"[\s\S]*id="substitutionForm"/i, 'organization UI must expose all v71 workflows');
assert.match(app, /get_public_minuta_catalog_v4[\s\S]*get_public_minuta_catalog_v3/i, 'public catalog must fall back safely when v71 is absent');
assert.match(app, /get_public_minuta_available_slots_v4[\s\S]*get_public_minuta_available_slots_v3/i, 'public slots must fall back safely when v71 is absent');
assert.match(workflow, /multi-tenant-v71-static-test\.mjs/i, 'v71 static safety checks must run in CI');

console.log('multi-tenant v71 static test: OK');
