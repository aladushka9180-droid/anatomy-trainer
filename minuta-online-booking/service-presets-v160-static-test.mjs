import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v160.sql');
const rollback = read('./supabase-migration-v160-rollback.sql');
const integration = read('./tests/service-presets-v160-integration.sql');
const catalogSource = read('./service-presets-catalog.js');
const fixture = { window:{} };
vm.runInNewContext(catalogSource, fixture, { filename:'service-presets-catalog.js' });
const catalog = fixture.window.MinutaServicePresetCatalog;

assert.equal(catalog.version, 1);
assert.equal(catalog.locale, 'ru-RU');
assert.equal(catalog.professions.length, 12);
assert.equal(catalog.professions.flatMap(item => item.services).length, 83);
const sql = value => String(value).replaceAll("'", "''");
for (const [professionOrder, profession] of catalog.professions.entries()) {
  assert.ok(migration.includes(`(1,'ru-RU','${sql(profession.id)}','${sql(profession.label)}','${sql(profession.shortLabel)}',${professionOrder},true)`),
    `SQL profession seed drift: ${profession.id}`);
  for (const service of profession.services) {
    assert.ok(migration.includes(`(1,'ru-RU','${sql(service.id)}','${sql(profession.id)}','${sql(service.name)}','${sql(service.category)}',${service.defaultDuration},${service.rank},true)`),
      `SQL preset seed drift: ${service.id}`);
  }
}

assert.match(migration, /create function public\.create_provider_services_from_presets_v160\(\s*p_request uuid,p_catalog_version integer,p_professions text\[\],p_services jsonb\s*\)/i);
assert.match(migration, /v_uid uuid:=auth\.uid\(\)/);
assert.doesNotMatch(migration, /p_performer\b/i, 'Owner identity must never be accepted from the client');
assert.match(migration, /jsonb_typeof\(p_services\) is distinct from 'array'[\s\S]*jsonb_array_length\(p_services\)>100/,
  'The server must type-check and bound a JSON array without rejecting zero selected items');
assert.match(migration, /jsonb_typeof\(v_item->'price_rub'\) is distinct from 'number'/);
assert.match(migration, /v_price_numeric<>trunc\(v_price_numeric\) or v_price_numeric not between 0 and 1000000/);
assert.match(migration, /preset\.catalog_version=p_catalog_version[\s\S]*preset\.preset_id=v_preset_id and preset\.active[\s\S]*v_preset_profession=any\(v_professions\)/,
  'Preset identity, version and selected profession must be server-authoritative');

assert.match(migration, /minuta_service_preset_requests_v160[\s\S]*primary key\(performer_id,request_id\)/);
assert.match(migration, /extensions\.digest\([\s\S]*'sha256'/);
assert.match(migration, /service-preset-request:[^\n]+160/);
assert.match(migration, /service-preset-state[^\n]+160/);
assert.match(migration, /service_preset_request_conflict/);
assert.match(migration, /return v_existing_request\.result\|\|jsonb_build_object\('replayed',true\)/);
assert.match(migration, /minuta_normalize_service_name_v160[\s\S]*normalize\(coalesce\(value,''\),NFKC\)[\s\S]*\[\[:space:\]\]\+/);
assert.match(migration, /create trigger services_prevent_duplicate_name_v160[\s\S]*before insert or update of performer_id,name on public\.services/);
assert.match(migration, /duplicate_service_name/);
assert.match(migration, /order by item\.value->>'normalized_name'[\s\S]*service-name:/,
  'Name locks must be acquired in deterministic order before insert');
assert.match(migration, /status','already_exists'/);
assert.match(migration, /where service\.performer_id=v_uid[\s\S]*limit 1 for update/);

for (const table of ['minuta_professions_v160','minuta_service_presets_v160','minuta_performer_professions_v160','minuta_service_preset_requests_v160']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`));
  assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public,anon,authenticated,service_role`));
}
assert.match(migration, /grant execute on function public\.create_provider_services_from_presets_v160\(uuid,integer,text\[\],jsonb\) to authenticated/);
assert.match(migration, /revoke all on function public\.create_provider_services_from_presets_v160\(uuid,integer,text\[\],jsonb\) from public,anon,authenticated,service_role/);

assert.match(rollback, /v160_rollback_blocked_provider_state_exists/);
assert.match(rollback, /drop trigger services_prevent_duplicate_name_v160 on public\.services/);
assert.match(rollback, /drop table public\.minuta_service_preset_requests_v160/);
for (const scenario of [
  'owner_batch_and_exact_replay','changed_request_conflict','existing_service_unchanged',
  'cross_owner_isolation','forged_preset_rejected','wrong_profession_rejected',
  'duplicate_input_rejected','direct_duplicate_rejected','partial_failure_rollback','zero_items_allowed'
]) assert.ok(integration.includes(scenario), `Missing SQL scenario: ${scenario}`);

console.log('PASS: v160 catalog parity, owner-only atomic RPC, duplicate protection, idempotency and rollback contract');
