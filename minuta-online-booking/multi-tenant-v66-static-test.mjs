import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(directory, 'supabase-migration-v66.sql'), 'utf8');
const rollback = await readFile(join(directory, 'recovery', 'rollback-multi-tenant-v66.sql'), 'utf8');
const rollbackV65 = await readFile(join(directory, 'recovery', 'rollback-multi-tenant-v65.sql'), 'utf8');
const integration = await readFile(join(directory, 'multi-tenant-v66-integration.sql'), 'utf8');
const providerHtml = await readFile(join(directory, 'provider.html'), 'utf8');
const providerJs = await readFile(join(directory, 'provider.js'), 'utf8');
const organizationJs = await readFile(join(directory, 'organization.js'), 'utf8');
const styles = await readFile(join(directory, 'styles.css'), 'utf8');
const serviceWorker = await readFile(join(directory, 'sw.js'), 'utf8');
const safeRelease = await readFile(join(directory, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');

for (const table of ['organization_invitations', 'organization_audit_log']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'), `v66 must create ${table}`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must enable RLS`);
  assert.match(migration, new RegExp(`revoke all on table[\\s\\S]*public\\.${table}[\\s\\S]*from public, anon, authenticated`, 'i'), `${table} must deny client table access`);
}

assert.match(migration, /organization_invitations_one_pending_email_idx[\s\S]*organization_id, lower\(email\)[\s\S]*where status = 'pending'/i, 'pending invitations must be unique per organization and email');
assert.match(migration, /email_confirmed_at is not null/i, 'invitation acceptance must require a confirmed email');
assert.match(migration, /create or replace function public\.accept_minuta_invitation\(p_invitation uuid\)[\s\S]*lower\(invitation\.email\) = v_email[\s\S]*invitation\.expires_at > now\(\)/i, 'acceptance must bind the invite to the confirmed actor email and expiry');
assert.doesNotMatch(migration, /create trigger performer_profiles_accept_team_invitations/i, 'a profile insert must not silently grant team access');
assert.match(migration, /ensure_minuta_organization_foundation\(\)[\s\S]*organization_invitations[\s\S]*return new/i, 'a pending invite must suppress an unwanted personal organization without granting access');
assert.equal((migration.match(/pg_advisory_xact_lock\(pg_catalog\.hashtextextended\(v_email, 66\)\)/g) || []).length, 2, 'invite and profile creation must share one email-scoped transaction lock');

assert.match(migration, /create trigger organization_memberships_protect_last_owner[\s\S]*before update of organization_id, role, active or delete/i, 'the last-owner invariant must be protected at table level');
assert.match(migration, /protect_minuta_last_owner\(\)[\s\S]*from public\.organizations organization[\s\S]*for update[\s\S]*last_owner_must_remain/i, 'last-owner changes must serialize on the organization row');
assert.match(migration, /update_minuta_member[\s\S]*from public\.organizations organization[\s\S]*for update[\s\S]*last_owner_must_remain/i, 'member RPC must use the same organization lock');
assert.match(migration, /invite_minuta_member[\s\S]*from public\.organizations organization[\s\S]*for update/i, 'parallel invitations must serialize per organization');
assert.match(migration, /v_actor_role = 'admin' and v_invitation_role <> 'specialist'[\s\S]*admin_can_cancel_specialist_only/i, 'admins must not cancel privileged invitations');

const publicRpcs = [
  ['get_minuta_workspace', ''],
  ['update_minuta_organization', 'uuid, text'],
  ['create_minuta_location', 'uuid, text, text, text'],
  ['update_minuta_location', 'uuid, text, text, text, boolean, boolean'],
  ['invite_minuta_member', 'uuid, text, text, boolean'],
  ['update_minuta_member', 'uuid, uuid, text, boolean, boolean'],
  ['cancel_minuta_invitation', 'uuid'],
  ['accept_minuta_invitation', 'uuid'],
];

for (const [name, signature] of publicRpcs) {
  assert.match(migration, new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?security definer[\\s\\S]*?set search_path to ''`, 'i'), `${name} must be SECURITY DEFINER with empty search_path`);
  assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\(${signature.replaceAll(' ', '\\s*')}\\) from public, anon, authenticated, service_role`, 'i'), `${name} must clear inherited execute grants`);
  assert.match(migration, new RegExp(`grant execute on function public\\.${name}\\(${signature.replaceAll(' ', '\\s*')}\\) to authenticated`, 'i'), `${name} must be authenticated-only`);
}

for (const protectedRpc of ['provider_delete_booking', 'book_appointment', 'get_available_slots', 'provider_book_appointment']) {
  assert.doesNotMatch(migration, new RegExp(`create or replace function public\\.${protectedRpc}\\s*\\(`, 'i'), `v66 must not replace ${protectedRpc}`);
}
assert.doesNotMatch(migration, /alter table public\.(?:bookings|services|provider_schedule|provider_days_off|booking_reviews|payments)\b/i, 'v66 must not alter legacy booking data yet');
assert.doesNotMatch(migration, /grant all on table/i, 'v66 must not grant TRUNCATE or TRIGGER');

assert.match(rollback, /v66_rollback_blocked_foundation_is_in_use/i, 'v66 rollback must stop after first use');
assert.match(rollback, /restore the exact v65 signup behavior/i, 'v66 rollback must restore the v65 signup function');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'v66 rollback must not use CASCADE');
assert.match(rollbackV65, /v65_rollback_blocked_v66_must_be_rolled_back_first/i, 'v65 rollback must explicitly refuse while v66 exists');
assert.match(safeRelease, /v65_table_count[\s\S]*0\)[\s\S]*supabase-migration-v65\.sql[\s\S]*3\)[\s\S]*v65 foundation already exists[\s\S]*Partial v65 foundation detected/i, 'production release must skip an existing complete v65 foundation and refuse partial state');
assert.match(safeRelease, /v66_object_count[\s\S]*0\)[\s\S]*supabase-migration-v66\.sql[\s\S]*4\)[\s\S]*v66 team layer already exists[\s\S]*Partial v66 team layer detected/i, 'production release must preserve an existing complete v66 layer and refuse partial state');

assert.equal((providerHtml.match(/data-provider-panel="organization"/g) || []).length, 1, 'provider must have exactly one organization panel');
assert.ok((providerHtml.match(/data-provider-view="organization"/g) || []).length >= 2, 'organization must be reachable from desktop and mobile More');
const mobileNav = providerHtml.match(/<nav class="provider-mobile-nav"[\s\S]*?<\/nav>/i)?.[0] || '';
assert.equal((mobileNav.match(/data-provider-view=/g) || []).length, 5, 'mobile bottom navigation must stay at five items');
assert.doesNotMatch(mobileNav, /data-provider-view="organization"/, 'organization belongs in mobile More, not the fixed bottom bar');
assert.match(providerHtml, /id="organizationLoading"[\s\S]*aria-live="polite"/i, 'organization loading state must be announced');
assert.match(providerHtml, /id="organizationUnavailable"[^>]*role="status"[^>]*aria-live="polite"/i, 'organization errors must be announced');
assert.match(providerHtml, /id="organizationPersonalInvites"[^>]*role="status"[^>]*aria-live="polite"/i, 'personal invitations must be announced');
assert.match(providerHtml, /id="reloadOrganization"/i, 'organization error state must be retryable');
assert.match(styles, /\.provider-body \.organization-unavailable \{[^}]*display:grid;[^}]*grid-template-columns:44px minmax\(0,1fr\) auto;/i, 'organization unavailable state must keep readable content columns');
assert.match(styles, /\.provider-body \.organization-unavailable \.secondary-button \{[^}]*width:auto;[^}]*margin-top:0;/i, 'organization retry button must not consume the whole desktop row');
assert.match(providerHtml, /organization\.js\?v=243/i, 'provider must load the current organization controller');
assert.match(serviceWorker, /organization\.js\?v=243/i, 'service worker must cache the organization controller');

assert.match(providerJs, /view === 'organization'[\s\S]*organizationController\.load\(\)/i, 'organization view must load lazily');
assert.match(providerJs, /if \(organizationController\.availability === null\) organizationController\.load\(\);\s*else organizationController\.render\(\);/, 'first organization view must load before rendering empty state');
assert.match(providerJs, /organizationController\.reset\(\)/i, 'session changes must clear organization data');
assert.match(providerJs, /organizationController\.availability === null[\s\S]*optional:true/i, 'organization synchronization must remain optional for legacy compatibility');
assert.doesNotMatch(organizationJs, /db\.from\(['"](?:organizations|locations|organization_memberships|organization_invitations|organization_audit_log)['"]\)/i, 'organization UI must not bypass RPC writes');
assert.match(organizationJs, /function render\(\) \{\s*if \(availability === null\)/, 'render must preserve the initial loading state');
for (const rpc of publicRpcs.map(item => item[0])) {
  if (rpc === 'get_minuta_workspace') continue;
  assert.match(organizationJs, new RegExp(`['"]${rpc}['"]`), `organization UI must expose ${rpc}`);
}

const evidence = JSON.parse(await readFile(join(directory, 'recovery', 'v66-production-trial.json'), 'utf8'));
assert.equal(evidence.production_applied, false, 'evidence must not claim v66 was applied to production');
assert.equal(evidence.v66_sha256, sha256(migration), 'production trial must cover the current v66 migration SHA');
assert.equal(evidence.integration_sha256, sha256(integration), 'production trial must cover the current v66 integration SHA');
assert.equal(evidence.rollback_sha256, sha256(rollback), 'production trial must cover the current v66 rollback SHA');

console.log('multi-tenant v66 static test: OK');

function sha256(value) {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
}
