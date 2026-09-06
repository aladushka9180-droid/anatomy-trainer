import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const [migration,rollback,integration,catalog,app,provider] = await Promise.all([
  readFile(new URL('supabase-migration-v118.sql',root),'utf8'),
  readFile(new URL('supabase-migration-v118-rollback.sql',root),'utf8'),
  readFile(new URL('tests/client-page-settings-v118-integration.sql',root),'utf8'),
  readFile(new URL('theme-catalog.js',root),'utf8'),
  readFile(new URL('app.js',root),'utf8'),
  readFile(new URL('provider.js',root),'utf8'),
]);

assert.match(migration,/create table if not exists public\.organization_client_page_settings/i);
assert.match(migration,/enable row level security/i);
assert.match(migration,/revoke all on public\.organization_client_page_settings from public,anon,authenticated,service_role/i);
assert.match(migration,/grant select on public\.organization_client_page_settings to authenticated/i);
assert.match(migration,/has_organization_role\(p_organization,array\['owner'\]::text\[\]\)/i);
assert.match(migration,/organization_owner_required/i);
assert.match(migration,/get_public_minuta_catalog_v5/i);
assert.match(migration,/'client_page',jsonb_build_object\([\s\S]*?'theme_key'[\s\S]*?'headline_key'/i);
assert.doesNotMatch(migration,/'client_page'[\s\S]{0,260}'updated_(?:at|by)'/i);
assert.match(rollback,/intentionally retained/i);
assert.doesNotMatch(rollback,/drop\s+table|truncate|delete\s+from/i);
assert.match(integration,/admin_update_allowed/);
assert.match(integration,/outsider_(?:read|update)_allowed/);
assert.match(integration,/public_catalog_leaked_private_metadata/);
assert.match(integration,/check_client_page_v118_rollback/);
assert.match(integration,/check_client_page_v118_reapply/);

assert.match(catalog,/minuta-client-theme-v2:organization:/);
assert.match(catalog,/legacyClientStorageKey/);
assert.match(catalog,/migrateClientOverride/);
assert.match(app,/get_public_minuta_catalog_v5/);
assert.ok(app.indexOf("get_public_minuta_catalog_v5") < app.indexOf("get_public_minuta_catalog_v4"));
assert.match(app,/readClientOverride\(state\.organization\?\.id,\s*requestedOrganizationSlug\)/);
assert.match(app,/writeClientOverride\(state\.organization\?\.id,\s*event\.target\.value,\s*requestedOrganizationSlug\)/);
assert.match(provider,/get_minuta_client_page_settings_v118/);
assert.match(provider,/set_minuta_client_page_settings_v118/);
assert.match(provider,/sync_status:'pending'/);
assert.match(provider,/clientPageSettingsSaveQueue/);
assert.match(provider,/clientPageSettingsQueuedRevisions/);
assert.match(provider,/addEventListener\('online'/);
assert.doesNotMatch(provider,/provider_client_page_settings_v1/);
const appearanceRuntime = provider.slice(provider.indexOf('function normalizeClientPageSettings'),provider.indexOf('function focusProviderViewHeading'));
assert.doesNotMatch(appearanceRuntime,/db\.auth\.updateUser/);

console.log('Client page settings v118 static checks passed.');
