import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(directory, 'supabase-migration-v69.sql'), 'utf8');
const rollback = await readFile(join(directory, 'recovery', 'rollback-resource-scheduling-v69.sql'), 'utf8');
const previousRollback = await readFile(join(directory, 'recovery', 'rollback-team-calendar-v68.sql'), 'utf8');
const integration = await readFile(join(directory, 'multi-tenant-v69-integration.sql'), 'utf8');
const concurrency = await readFile(join(directory, 'multi-tenant-v69-concurrency-test.sh'), 'utf8');
const app = await readFile(join(directory, 'app.js'), 'utf8');
const booking = await readFile(join(directory, 'booking.js'), 'utf8');
const provider = await readFile(join(directory, 'provider.js'), 'utf8');
const html = await readFile(join(directory, 'provider.html'), 'utf8');
const controller = await readFile(join(directory, 'resource-management.js'), 'utf8');
const teamCalendar = await readFile(join(directory, 'team-calendar.js'), 'utf8');
const workflow = await readFile(join(directory, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');

assert.match(migration, /v69_requires_v68/i, 'v69 must fail closed without the complete v68 layer');
for (const table of ['resource_groups', 'resources', 'service_resource_requirements', 'booking_resource_allocations', 'resource_audit_log']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'), `${table} must be additive and repeatable`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must use RLS`);
}
assert.match(migration, /foreign key \(location_id, organization_id\)[\s\S]*references public\.locations\(id, organization_id\)/i, 'resources must stay inside their organization branch');
assert.match(migration, /booking_resources_active_no_overlap[\s\S]*exclude using gist[\s\S]*resource_id with =[\s\S]*tsrange\(starts_at, ends_at, '\[\)'\) with &&/i, 'resource overlap must have a database exclusion constraint');
assert.match(migration, /create trigger bookings_sync_minuta_resources[\s\S]*after insert or update of organization_id, location_id, service_id,[\s\S]*booking_date, booking_time, duration_minutes, status/i, 'all booking mutations must synchronize allocations');
assert.match(migration, /pg_advisory_xact_lock[\s\S]*order by requirement\.group_id[\s\S]*order by resource\.id[\s\S]*resource_unavailable/i, 'allocation must be serialized, deterministic and fail atomically');
assert.match(migration, /replace_minuta_service_resource_requirements[\s\S]*for v_booking in[\s\S]*allocate_minuta_booking_resources/i, 'requirement activation must backfill future bookings in the same transaction');
assert.match(migration, /resource_has_future_bookings/i, 'moving or disabling an allocated resource must be blocked');
assert.match(migration, /resource_group_has_active_requirements|resource_group_required_by_service|resource_group_is_required/i, 'an active service requirement must block disabling its resource group');
assert.match(migration, /get_minuta_resource_workspace[\s\S]*join public\.organizations[\s\S]*organization\.status\s*=\s*'active'/i, 'suspended organizations must not remain readable through the workspace SECURITY DEFINER RPC');
assert.match(migration, /get_public_minuta_available_slots_v3[\s\S]*get_available_slots\(p_service,p_start,p_end,null\)[\s\S]*booking_resource_allocations/i, 'v3 slots must preserve canonical availability and add resource filtering');
assert.match(migration, /get_public_minuta_catalog_v3[\s\S]*resource_scheduling[\s\S]*resource_required[\s\S]*location_ids/i, 'v3 catalog must advertise resource-aware service locations');
assert.match(migration, /get_minuta_team_calendar_v2[\s\S]*public\.get_minuta_team_calendar\([\s\S]*p_resource[\s\S]*foreign_resource_denied/i, 'resource calendar must enrich the protected v68 reader and reject a foreign resource server-side');
assert.match(migration, /get_minuta_team_calendar_v2[\s\S]*booking_resource_allocations[\s\S]*allocation\.resource_id\s*=\s*p_resource/i, 'resource calendar must enrich bookings and apply the resource filter server-side');
assert.match(migration, /get_reschedule_slots_v3[\s\S]*public\.get_reschedule_slots\([\s\S]*booking_resource_allocations\s+allocation[\s\S]*allocation\.booking_id\s*<>\s*v_booking/i, 'resource-aware reschedule slots must preserve v41 policy and ignore only the current booking allocation');
assert.match(migration, /revoke all on function public\.get_minuta_team_calendar_v2[\s\S]*to authenticated[\s\S]*revoke all on function public\.get_reschedule_slots_v3[\s\S]*to anon, authenticated/i, 'calendar and reschedule v69 RPC ACLs must be explicit');

for (const protectedRpc of ['provider_delete_booking', 'book_appointment', 'book_minuta_appointment', 'get_available_slots', 'get_minuta_team_calendar']) {
  assert.doesNotMatch(migration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`, 'i'), `v69 must not replace protected ${protectedRpc}`);
}

assert.match(rollback, /v69_rollback_blocked_resources_in_use/i, 'v69 structural rollback must stop after configuration or use');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'v69 rollback must not use CASCADE');
assert.match(previousRollback, /drop column if exists organization_id/i, 'v69 rollback must return to the unchanged, trial-verified v68 rollback contract');

assert.match(integration, /v69_cross_organization_read_was_allowed[\s\S]*v69_suspended_organization_still_readable/i, 'integration must create a foreign tenant and reject both foreign and suspended workspace reads');
assert.match(integration, /resource_group_has_active_requirements|resource_group_required_by_service|resource_group_is_required/i, 'integration must prove that required groups cannot be disabled');
assert.match(integration, /set local role authenticated[\s\S]*resource_management_denied/i, 'integration must exercise authenticated role boundaries, not only function ACL metadata');
assert.match(concurrency, /replace_minuta_service_resource_requirements[\s\S]*book_minuta_appointment[\s\S]*pg_sleep/i, 'two-session test must race real booking allocation behind an active requirement');
assert.doesNotMatch(concurrency, /-c\s+"[^"]*:'holder_app'/i, 'psql variables must not be used through -c');
assert.doesNotMatch(concurrency, /insert into public\.booking_resource_allocations/i, 'concurrency must not bypass the allocator with direct allocation inserts');
assert.match(concurrency, /resource_unavailable[\s\S]*status\s*=\s*'cancelled'[\s\S]*book_minuta_appointment/i, 'concurrency must prove conflict rejection and resource release after cancellation');

assert.match(app, /get_public_minuta_catalog_v3/, 'public booking must prefer the v3 catalog');
assert.match(app, /get_public_minuta_available_slots_v3/, 'public booking must request branch-aware resource slots');
assert.match(app, /state\.resourceScheduling[\s\S]*get_public_minuta_available_slots_v3[\s\S]*get_available_slots/, 'legacy availability fallback must remain isolated from advertised resource scheduling');
assert.match(app, /resource_unavailable/, 'resource booking races need a clear client error');
assert.match(teamCalendar, /get_minuta_team_calendar_v2[\s\S]*get_minuta_team_calendar/, 'team calendar must fall back to the unchanged v68 RPC when v69 is absent');
assert.match(teamCalendar, /teamCalendarResource[\s\S]*resource_id|resourceId[\s\S]*resources/i, 'team calendar controller must expose resource selection without mixing it into the personal journal');
assert.match(booking, /get_reschedule_slots_v3[\s\S]*get_reschedule_slots/, 'booking management must use resource-aware reschedule slots with a v41 fallback');
assert.match(provider, /MinutaResources/, 'provider must initialize the isolated resource controller');
assert.match(html, /id="resourcesPanel"[\s\S]*id="resourceRequirementForm"/, 'resource management must live inside the organization workspace');
assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB|MinutaReliability/i, 'tenant resource data must not be cached on the device');
assert.match(controller, /requestRevision[\s\S]*sessionIsCurrent/i, 'resource UI must reject stale organization/session responses');
assert.match(controller, /isUnsupported[\s\S]*resourcesPanel'\)\.hidden = true/i, 'missing v69 must hide only the optional resource panel');

const testMigrationRelease = workflow.split('test-migration:')[1]?.split('production-migration:')[0] || '';
const productionRelease = workflow.split('production-migration:')[1] || '';
assert.match(testMigrationRelease, /rollback-resource-scheduling-v69\.sql[\s\S]*to_regclass\('public\.resource_audit_log'\) is null[\s\S]*bookings_sync_minuta_resources/i, 'test rollback postcheck must prove every v69 table and trigger is absent');
assert.match(testMigrationRelease, /v68_contract_before_v69[\s\S]*v68_contract_after_v69_rollback[\s\S]*test "\$v68_contract_before_v69" = "\$v68_contract_after_v69_rollback"/i, 'v69 rollback must restore the exact v68 data, RPC and ACL contract');
assert.match(productionRelease, /v69_layer_state[\s\S]*(?:complete|partial)/i, 'production release must distinguish complete and partial v69 installations');
assert.match(productionRelease, /bookings_sync_minuta_resources[\s\S]*booking_resources_active_no_overlap/i, 'production partial detector must include the trigger and overlap constraint');
assert.match(productionRelease, /to_regclass\('public\.resource_audit_log'\)[\s\S]*get_public_minuta_catalog_v3[\s\S]*get_public_minuta_available_slots_v3/i, 'production contract must include every v69 table and public RPC');
assert.ok(productionRelease.indexOf('supabase-migration-v68.sql') < productionRelease.indexOf('supabase-migration-v69.sql'), 'production must apply v69 only after v68');
assert.match(workflow, /test "\$MINUTA_BACKUP_CONFIRM" = "BACKUP_VERIFIED"[\s\S]*supabase-migration-v69\.sql/i, 'production v69 must remain behind the verified-backup gate');
assert.match(workflow, /supabase-migration-v69\.sql[\s\S]*multi-tenant-v69-integration\.sql[\s\S]*multi-tenant-v69-concurrency-test\.sh[\s\S]*rollback-resource-scheduling-v69\.sql[\s\S]*rollback-team-calendar-v68\.sql/i, 'test release must exercise v69 before rolling back v68');

console.log('multi-tenant v69 static test: OK');
