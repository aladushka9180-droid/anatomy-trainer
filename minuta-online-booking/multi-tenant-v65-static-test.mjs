import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(directory, 'supabase-migration-v65.sql'), 'utf8');
const integrationPath = join(directory, 'multi-tenant-v65-integration.sql');
const rollbackPath = join(directory, 'recovery', 'rollback-multi-tenant-v65.sql');

for (const table of ['organizations', 'locations', 'organization_memberships']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'), `v65 must create ${table}`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must enable RLS`);
}

assert.match(migration, /legacy_performer_id uuid unique references public\.performer_profiles\(id\)/i, 'legacy performer mapping must be unique');
assert.match(migration, /primary key \(organization_id, user_id\)/i, 'membership must be unique per organization and user');
assert.match(migration, /role in \('owner', 'admin', 'specialist'\)/i, 'roles must use the canonical owner/admin/specialist contract');
assert.doesNotMatch(migration, /role in \([^)]*(?:manager|performer|viewer|receptionist)/i, 'v65 must not introduce ambiguous extra roles');
assert.match(migration, /is_bookable boolean not null default false/i, 'bookability must be independent from permissions');
assert.match(migration, /'owner',\s*true,\s*true,/i, 'a legacy owner must remain bookable and active');
assert.match(migration, /public_booking_enabled boolean not null default false/i, 'the new public flow must remain disabled until v66');
assert.match(migration, /legacy_performer_id uuid unique references public\.performer_profiles\(id\) on delete cascade/i, 'deleting a legacy profile must clean up its foundation');
assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/i, 'deleting an invited user must clean up memberships');
assert.match(migration, /create unique index if not exists locations_one_primary_per_org_idx[\s\S]*where is_primary/i, 'each organization must have at most one primary location');

for (const helper of ['is_organization_member', 'has_organization_role']) {
  assert.match(
    migration,
    new RegExp(`create or replace function public\\.${helper}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path to ''`, 'i'),
    `${helper} must be SECURITY DEFINER with an empty search_path`,
  );
  assert.match(migration, new RegExp(`revoke all on function public\\.${helper}\\([^;]+\\) from public, anon, authenticated, service_role`, 'i'), `${helper} must clear inherited grants`);
  assert.match(migration, new RegExp(`grant execute on function public\\.${helper}\\([^;]+\\) to authenticated`, 'i'), `${helper} must be executable only by authenticated users`);
}
assert.doesNotMatch(migration, /grant execute on function public\.(?:is_organization_member|has_organization_role)\([^;]+\) to (?:anon|public|service_role)/i, 'organization helpers must not be executable by anon, public, or service_role');

assert.match(migration, /create policy organizations_member_read[\s\S]*public\.is_organization_member\(id\)/i, 'organization rows must be tenant-scoped');
assert.match(migration, /create policy locations_member_read[\s\S]*public\.is_organization_member\(organization_id\)/i, 'location rows must be tenant-scoped');
assert.match(migration, /create policy organization_memberships_roster_read[\s\S]*public\.is_organization_member\(organization_id\)[\s\S]*user_id = \(select auth\.uid\(\)\)[\s\S]*array\['owner', 'admin'\]/i, 'membership roster must be limited to active self or organization managers');
assert.match(migration, /join public\.organizations organization[\s\S]*organization\.status = 'active'/i, 'suspended organizations must not authorize access');

assert.match(migration, /on conflict \(legacy_performer_id\) do nothing/i, 'legacy organization backfill must be idempotent');
assert.match(migration, /'minuta-' \|\| replace\((?:profile|new)\.id::text, '-', ''\)/i, 'legacy slugs must use the full UUID to avoid prefix collisions');
assert.match(migration, /on conflict \(organization_id, user_id\) do nothing/i, 'membership backfill must be idempotent');
assert.match(migration, /if exists \([\s\S]*organization_memberships[\s\S]*membership\.user_id = new\.id[\s\S]*membership\.active[\s\S]*return new/i, 'invited members must not receive duplicate personal organizations');
assert.match(migration, /after insert on public\.performer_profiles[\s\S]*ensure_minuta_organization_foundation/i, 'future legacy signups must receive the foundation automatically');

assert.doesNotMatch(migration, /create or replace function public\.(?:provider_delete_booking|book_appointment|get_available_slots|provider_book_appointment)\s*\(/i, 'v65 must not replace protected legacy RPCs');
const legacyTables = [
  'booking_outcomes', 'booking_policies', 'booking_reviews', 'booking_waitlist_requests',
  'bookings', 'client_accounts', 'client_device_sessions', 'client_login_limits',
  'client_notes', 'client_telegram_subscriptions', 'notification_marks',
  'notification_templates', 'performer_profiles', 'portfolio_items', 'portfolio_photos',
  'provider_days_off', 'provider_schedule', 'services', 'telegram_notification_log',
];
for (const table of legacyTables) {
  assert.doesNotMatch(
    migration,
    new RegExp(`(?:alter table|insert into|update|delete from)\\s+public\\.${table}\\b`, 'i'),
    `v65 must not mutate or alter legacy table ${table}`,
  );
}
assert.doesNotMatch(migration, /\b(?:payments|payment_events|client_labels)\b/i, 'v65 must not depend on optional production tables');
assert.doesNotMatch(migration, /grant all on table/i, 'service-role grants must not include TRUNCATE or TRIGGER');

const rollback = await readFile(rollbackPath, 'utf8');
assert.match(rollback, /v65_rollback_blocked_foundation_is_in_use/i, 'rollback must refuse to delete a foundation already in use');
assert.ok(rollback.indexOf('drop table if exists public.organizations') < rollback.indexOf('drop function if exists public.is_organization_member'), 'rollback must remove policy-owning tables before helper functions');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'rollback must not use CASCADE');

const integration = await readFile(integrationPath, 'utf8');
for (const role of ['owner', 'admin', 'specialist']) {
  assert.match(integration, new RegExp(`${role}_[a-z_]+_(?:failed|visible)`), `integration test must exercise ${role}`);
}
assert.match(integration, /suspended_organization_still_visible/i, 'integration test must reject suspended tenant access');
assert.match(integration, /invited_specialist_received_duplicate_org/i, 'integration test must cover invited-specialist compatibility');
assert.match(integration, /rollback;\s*$/i, 'integration test must always be transaction-scoped');

const evidence = JSON.parse(await readFile(join(directory, 'recovery', 'v65-production-trial.json'), 'utf8'));
assert.equal(evidence.production_applied, false, 'evidence must not claim v65 was applied to production');
assert.equal(evidence.migration_sha256, sha256(migration), 'production trial must cover the current v65 migration SHA');
assert.equal(evidence.integration_sha256, sha256(integration), 'production trial must cover the current integration-test SHA');
assert.equal(evidence.rollback_sha256, sha256(rollback), 'production trial must cover the current rollback SHA');

console.log('multi-tenant v65 static test: OK');

function sha256(value) {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
}
