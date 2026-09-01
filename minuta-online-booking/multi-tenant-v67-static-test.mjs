import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(directory, 'supabase-migration-v67.sql'), 'utf8');
const rollback = await readFile(join(directory, 'recovery', 'rollback-multi-tenant-v67.sql'), 'utf8');
const integration = await readFile(join(directory, 'multi-tenant-v67-integration.sql'), 'utf8');
const app = await readFile(join(directory, 'app.js'), 'utf8');
const config = await readFile(join(directory, 'config.js'), 'utf8');
const safeRelease = await readFile(join(directory, '..', '.github', 'workflows', 'minuta-safe-release.yml'), 'utf8');

assert.match(migration, /v67_requires_v66/i, 'v67 must require the complete v66 foundation');
assert.match(migration, /create or replace function public\.get_public_minuta_catalog\(p_slug text\)[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path to ''/i, 'public catalog must be a stable hardened RPC');
assert.match(migration, /organization\.status = 'active'[\s\S]*organization\.public_booking_enabled/i, 'disabled or suspended organizations must stay private');
assert.match(migration, /membership\.active[\s\S]*membership\.is_bookable[\s\S]*service\.active/i, 'catalog must include only active bookable members and active services');
assert.doesNotMatch(migration, /'(?:email|phone|role|actor_id|created_by|audit)'/i, 'public catalog must not expose private team data');
assert.match(migration, /revoke all on function public\.get_public_minuta_catalog\(text\)[\s\S]*from public, anon, authenticated, service_role/i, 'catalog ACL must be reset explicitly');
assert.match(migration, /grant execute on function public\.get_public_minuta_catalog\(text\) to anon, authenticated/i, 'catalog must be callable by public booking clients');
assert.match(migration, /where public_booking_enabled[\s\S]*public_slug <> 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'[\s\S]*v_target_count <> 1[\s\S]*set public_booking_enabled = true[\s\S]*public_slug = 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'[\s\S]*status = 'active'[\s\S]*and not public_booking_enabled[\s\S]*commit;/i, 'v67 must atomically and idempotently activate exactly the configured active organization');
assert.doesNotMatch(migration, /(?:insert into|update|delete from|alter table) public\.(?:bookings|services|provider_schedule)/i, 'v67 must not alter legacy booking data');
assert.match(rollback, /where public_booking_enabled[\s\S]*public_slug <> 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'[\s\S]*v_target_count <> 1[\s\S]*set public_booking_enabled = false[\s\S]*public_slug = 'minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f'[\s\S]*and public_booking_enabled[\s\S]*drop function if exists public\.get_public_minuta_catalog\(text\)[\s\S]*commit;/i, 'v67 rollback must atomically and idempotently disable the configured organization before removing the RPC');
assert.doesNotMatch(rollback, /\bcascade\b/i, 'v67 rollback must not use CASCADE');
assert.match(integration, /v67_disabled_organization_was_public/i, 'integration must keep the catalog hidden before activation');
assert.match(integration, /v67_catalog_service_scope_failed/i, 'integration must verify organization-scoped services');
assert.match(integration, /v67_unknown_tenant_visible/i, 'integration must reject unknown tenants');
assert.match(integration, /rollback;\s*$/i, 'v67 integration test must be transaction-scoped');

assert.match(app, /requestedOrganizationSlug/, 'client must accept only a validated organization slug');
assert.match(config, /defaultOrganizationSlug:\s*'minuta-[a-f0-9]{32}'/, 'the legacy public page must have one explicit tenant slug');
assert.match(app, /db\.rpc\('get_public_minuta_catalog'/, 'client must load a tenant-scoped public catalog');
assert.match(app, /state\.teamMode = Boolean\(state\.organization\)/, 'team selector must require an enabled organization returned by the RPC');
assert.match(app, /section\.hidden = !state\.teamMode \|\| performers\.length < 2/, 'selector must stay hidden outside the tenant-scoped team flow');
const productionRelease = safeRelease.split('production-migration:')[1] || '';
assert.ok(productionRelease.indexOf('supabase-migration-v66.sql') < productionRelease.indexOf('supabase-migration-v67.sql'), 'production must apply v67 only after v66');
assert.match(productionRelease, /get_public_minuta_catalog\(text\)[\s\S]*exists \(select 1 from public\.organizations where public_slug='minuta-abeb5b13ca1d45c6a2adb0e4119b2e1f' and public_booking_enabled and status='active'\)/, 'production post-check must require the configured organization to be active');
assert.match(safeRelease, /rollback-multi-tenant-v67\.sql[\s\S]*to_regprocedure\('public\.get_public_minuta_catalog\(text\)'\) is null[\s\S]*supabase-migration-v67\.sql/i, 'test release must verify the v67 rollback before restoring v67');

const evidence = JSON.parse(await readFile(join(directory, 'recovery', 'v67-production-trial.json'), 'utf8'));
assert.equal(evidence.production_applied, false, 'v67 evidence must not claim production activation');
assert.equal(evidence.migration_sha256, sha256(migration), 'v67 trial must cover the current migration SHA');
assert.equal(evidence.integration_sha256, sha256(integration), 'v67 trial must cover the current integration SHA');
assert.equal(evidence.rollback_sha256, sha256(rollback), 'v67 trial must cover the current rollback SHA');

console.log('multi-tenant v67 static test: OK');

function sha256(value) {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
}
