import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration = fs.readFileSync(new URL('./supabase-migration-v89.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('./recovery/rollback-client-fields-v89.sql', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('./client-fields.js', import.meta.url), 'utf8');

for (const table of ['organization_client_field_settings','client_field_definitions','client_field_values','client_field_audit_log']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`));
}

assert.match(migration, /enabled boolean not null default false/);
assert.match(migration, /client_field_audit_is_immutable/);
assert.match(migration, /unique \(organization_id,request_id\)/);
assert.match(migration, /client_field_request_conflict/);
assert.match(migration, /client_field_manager_required/);
assert.match(migration, /booking\.performer_id=auth\.uid\(\)/);
assert.match(migration, /revoke all on table[\s\S]*from public,anon,authenticated/);
assert.match(migration, /grant execute on function public\.get_minuta_client_field_workspace\(uuid,text\) to authenticated/);
assert.doesNotMatch(migration, /grant (select|insert|update|delete).*to authenticated/);
assert.match(rollback, /v89_rollback_blocked_client_field_data_exists/);
assert.match(controller, /secure_request_id_unavailable/);
assert.match(controller, /get_minuta_client_field_workspace/);
assert.match(controller, /save_minuta_client_field_definition/);
assert.match(controller, /set_minuta_client_field_value/);
assert.match(controller, /delete_minuta_client_field_value/);

console.log('v89 client fields static checks passed');
