import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const migration = await readFile(join(root, 'supabase-migration-v83.sql'), 'utf8');
const rollback = await readFile(join(root, 'recovery', 'rollback-retention-v83.sql'), 'utf8');
const controller = await readFile(join(root, 'retention-management.js'), 'utf8');
const html = await readFile(join(root, 'provider.html'), 'utf8');

assert.match(migration, /v83_requires_v65_and_client_accounts/i);
for (const table of ['organization_retention_settings', 'client_marketing_consents', 'retention_deliveries', 'retention_audit_log']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`, 'i'));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
}
assert.match(migration, /organization_retention_settings[\s\S]*enabled boolean not null default false/i);
assert.match(migration, /status text not null check \(status in \('granted','revoked'\)\)/i);
assert.match(migration, /marketing_consent_required/i);
assert.match(migration, /retention_cooldown_active/i);
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_organization::text\|\|':'\|\|p_client_account::text,83\)\)/i);
for (const rpc of ['get_minuta_retention_workspace', 'save_minuta_retention_settings', 'set_minuta_marketing_consent', 'prepare_minuta_retention_delivery', 'finish_minuta_retention_delivery']) {
  assert.match(migration, new RegExp(`create or replace function public\\.${rpc}`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}`, 'i'));
  assert.match(controller, new RegExp(rpc));
}
for (const protectedRpc of ['provider_delete_booking', 'book_appointment', 'book_minuta_appointment', 'get_available_slots']) {
  assert.doesNotMatch(migration, new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${protectedRpc}\\s*\\(`, 'i'));
}
assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB/i);
assert.match(controller, /scopeMatches/);
assert.match(controller, /sessionIsCurrent/);
assert.match(html, /id="retentionPanel"/);
assert.match(html, /retention-management\.js\?v=/);
assert.match(rollback, /disable_retention_before_rollback/i);
assert.match(rollback, /export_and_remove_all_retention_data_before_rollback/i);
assert.doesNotMatch(rollback, /\bcascade\b/i);

console.log('retention v83 static test: OK');
