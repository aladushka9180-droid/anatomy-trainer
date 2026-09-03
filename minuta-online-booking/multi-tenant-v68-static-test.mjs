import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(directory, 'supabase-migration-v68.sql'), 'utf8');
const rollback = await readFile(join(directory, 'recovery', 'rollback-team-calendar-v68.sql'), 'utf8');
const integration = await readFile(join(directory, 'multi-tenant-v68-integration.sql'), 'utf8');
const concurrency = await readFile(join(directory, 'multi-tenant-v68-concurrency-test.sh'), 'utf8');
const app = await readFile(join(directory, 'app.js'), 'utf8');
const provider = await readFile(join(directory, 'provider.js'), 'utf8');
const organization = await readFile(join(directory, 'organization.js'), 'utf8');
const workflow = await readFile(join(directory, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');

assert.match(migration, /v68_requires_v67/i, 'v68 must require the complete v67 layer');
assert.match(migration, /add column if not exists organization_id uuid[\s\S]*add column if not exists location_id uuid[\s\S]*booking_scope_source text/i, 'bookings must receive explicit tenant scope');
assert.match(migration, /organization\.legacy_performer_id = booking\.performer_id[\s\S]*v68_booking_tenant_ambiguous/i, 'backfill must prefer the deterministic legacy tenant and fail closed');
assert.match(migration, /foreign key \(location_id, organization_id\)[\s\S]*references public\.locations\(id, organization_id\)/i, 'location must belong to the same organization');
assert.match(migration, /create trigger bookings_scope_minuta_tenant[\s\S]*before insert or update of organization_id, location_id, performer_id, service_id/i, 'legacy and team inserts must pass the tenant guard');
assert.match(migration, /booking_organization_required[\s\S]*booking_location_unavailable[\s\S]*booking_performer_unavailable[\s\S]*booking_service_performer_mismatch/i, 'tenant guard must reject every invalid relation');
assert.match(migration, /update of organization_id, location_id, performer_id, service_id, booking_scope_source/i, 'scope source must not be directly forgeable');
assert.match(migration, /bookings_performer_active_no_overlap[\s\S]*exclude using gist[\s\S]*performer_id with =[\s\S]*tsrange\([\s\S]*with &&[\s\S]*status <> 'cancelled'/i, 'every active booking write must have a database overlap constraint');

for (const protectedRpc of ['provider_delete_booking', 'book_appointment', 'get_available_slots', 'provider_book_appointment', 'save_booking_session']) {
  assert.doesNotMatch(migration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`, 'i'), `v68 must not replace ${protectedRpc}`);
}

assert.match(migration, /create or replace function public\.get_minuta_team_calendar\([\s\S]*security definer[\s\S]*set search_path to ''/i, 'team calendar must be a hardened RPC');
assert.match(migration, /membership\.user_id = v_user[\s\S]*membership\.active[\s\S]*v_role = 'specialist'[\s\S]*v_effective_performer := v_user/i, 'specialists must be limited to themselves');
assert.match(migration, /booking\.organization_id = p_organization[\s\S]*booking\.booking_date between p_start and p_end[\s\S]*booking\.location_id = p_location[\s\S]*booking\.performer_id = v_effective_performer/i, 'calendar filters must be server-side and tenant-scoped');
assert.doesNotMatch(migration.match(/create or replace function public\.get_minuta_team_calendar[\s\S]*?revoke all on function public\.get_minuta_team_calendar/i)?.[0] || '', /manage_token|payment_url|client_account_id|provider_note/i, 'calendar payload must not expose secrets');
assert.match(migration, /revoke all on function public\.get_minuta_team_calendar\(uuid,date,date,uuid,uuid\)[\s\S]*from public, anon, authenticated, service_role[\s\S]*grant execute[\s\S]*to authenticated/i, 'team calendar ACL must be explicit');

assert.match(migration, /create or replace function public\.get_public_minuta_catalog_v2\(p_slug text\)[\s\S]*'id', location\.id/i, 'v2 public catalog must expose a branch id');
assert.match(migration, /create or replace function public\.book_minuta_appointment\([\s\S]*set_config\('minuta\.booking_organization'[\s\S]*public\.book_appointment\([\s\S]*v_existing_location is distinct from p_location[\s\S]*request_conflict/i, 'public wrapper must preserve legacy booking and tenant-aware idempotency');
assert.match(migration, /v_previous_organization[\s\S]*exception when others[\s\S]*set_config\('minuta\.booking_organization', coalesce\(v_previous_organization, ''\)[\s\S]*raise;/i, 'public wrapper must restore tenant context on failure');
assert.match(migration, /'visit_status'[\s\S]*left join public\.booking_outcomes outcome/i, 'team calendar must include effective visit outcomes');
assert.match(migration, /revoke all on function public\.book_minuta_appointment[\s\S]*from public, anon, authenticated, service_role[\s\S]*to anon, authenticated/i, 'public booking ACL must exclude PUBLIC and service role');

assert.match(rollback, /v68_rollback_blocked_team_bookings_exist/i, 'structural rollback must stop after real team use');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'rollback must not use CASCADE');
assert.match(rollback, /drop trigger if exists bookings_scope_minuta_tenant[\s\S]*drop column if exists organization_id[\s\S]*commit;/i, 'rollback must restore the v67 structure only while safe');

assert.match(integration, /v68_cross_organization_booking_leak/i, 'integration must test the same performer in two organizations');
assert.match(integration, /distinct on \(available\.booking_date, available\.booking_time\)/i, 'integration must not select duplicate public slots as two bookings');
assert.match(integration, /v68_anon_calendar_was_allowed/i, 'integration must deny anonymous calendar reads');
assert.match(integration, /v68_provider_delete_acl_changed/i, 'integration must preserve v64 ACL');
assert.match(integration, /v68_wrapper_context_leaked[\s\S]*v68_wrapper_scope_or_idempotency_failed[\s\S]*v68_overlap_update_was_allowed[\s\S]*v68_team_outcome_status_missing/i, 'integration must exercise tenant writes, context restoration, overlap and outcomes');
assert.match(integration, /rollback;\s*$/i, 'integration must be transaction-scoped');
assert.match(concurrency, /v68_rollback_blocked_team_bookings_exist[\s\S]*v68 concurrent overlap was not rejected/i, 'two-session test must cover rollback guard and concurrent overlap');

assert.match(app, /get_public_minuta_catalog_v2/, 'public client must request branch-addressable catalog v2');
assert.match(app, /book_minuta_appointment/, 'team booking must use the tenant-aware wrapper');
assert.match(provider, /MinutaTeamCalendar/, 'provider must integrate the isolated team calendar controller');
assert.match(organization, /getActiveOrganization|subscribe/, 'organization controller must expose read-only selection changes');

const productionRelease = workflow.split('production-migration:')[1] || '';
assert.ok(productionRelease.indexOf('supabase-migration-v67.sql') < productionRelease.indexOf('supabase-migration-v68.sql'), 'production must apply v68 only after v67');
assert.match(workflow, /test "\$MINUTA_BACKUP_CONFIRM" = "BACKUP_VERIFIED"[\s\S]*supabase-migration-v68\.sql/i, 'production v68 must remain behind the verified-backup gate');
assert.match(workflow, /rollback-team-calendar-v68\.sql[\s\S]*supabase-migration-v68\.sql/i, 'test release must exercise rollback and restore v68');
assert.match(workflow, /multi-tenant-v68-concurrency-test\.sh/i, 'test release must run the v68 two-session overlap test');

const evidence = JSON.parse(await readFile(join(directory, 'recovery', 'v68-production-trial.json'), 'utf8'));
assert.equal(evidence.production_applied, false, 'trial evidence must not claim a production migration');
assert.equal(evidence.transaction_rolled_back, true, 'trial must end with ROLLBACK');
assert.equal(evidence.migration_sha256, sha256(migration), 'trial must cover the current migration SHA');
assert.equal(evidence.integration_sha256, sha256(integration), 'trial must cover the current integration SHA');
assert.equal(evidence.rollback_sha256, sha256(rollback), 'trial must cover the current rollback SHA');

console.log('multi-tenant v68 static test: OK');

function sha256(value) {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
}
