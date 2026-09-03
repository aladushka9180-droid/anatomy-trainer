import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v95.sql', root), 'utf8');
const rollback = readFileSync(new URL('recovery/rollback-client-import-v95.sql', root), 'utf8');
const clientImport = readFileSync(new URL('client-import.js', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const html = readFileSync(new URL('provider.html', root), 'utf8');

assert.match(migration, /v95_requires_v65_v94/i);
assert.match(migration, /create table if not exists public\.organization_imported_clients/i);
assert.match(migration, /unique \(organization_id,normalized_phone\)/i);
assert.match(migration, /jsonb_array_length\(p_rows\)[\s\S]*v_count<1 or v_count>500/i);
assert.match(migration, /has_organization_role\(p_organization,array\['owner','admin'\]\)/i);
assert.match(migration, /on conflict \(organization_id,normalized_phone\) do update/i);
assert.match(migration, /revoke all on table public\.client_import_batches,public\.organization_imported_clients from public,anon,authenticated/i);
assert.match(migration, /grant execute on function public\.import_minuta_clients\(uuid,text,jsonb,uuid\) to authenticated/i);
assert.match(migration, /v95_incompatible_existing_index/i);
assert.match(migration, /v95_incompatible_existing_schema/i);
assert.match(migration, /expected\(column_name,data_type,is_nullable\)/i);
assert.match(migration, /array_agg\(attribute_row\.attname order by key_row\.ordinality\)/i);
assert.match(migration, /create index concurrently if not exists organization_imported_clients_updated_v95_idx/i);
assert.match(migration, /get_minuta_imported_clients\(p_organization uuid,p_limit integer,p_offset integer\)/i);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[^;]*to authenticated/i);
assert.match(rollback, /v95_rollback_blocked_imported_clients_exist/i);
assert.match(rollback, /v95_rollback_blocked_import_batches_exist/i);
assert.doesNotMatch(`${clientImport}\n${html}`, /YCLIENTS|DIKIDI|Masters/);
assert.match(clientImport, /Поддерживаются CSV, TSV и TXT/);
assert.match(clientImport, /clients\.set\(phone/);
assert.match(clientImport, /import_minuta_clients/);
assert.match(clientImport, /p_source_system:'other'/);
assert.match(clientImport, /showMapping\(pendingTable\)/);
assert.match(clientImport, /applyManualMapping/);
assert.match(provider, /importedClients\.forEach/);
assert.match(provider, /clientImportController\.setOrganization\(organization\)/);
assert.match(html, /id="clientImportPanel"[\s\S]*Импорт клиентов[\s\S]*id="clientImportFile"[\s\S]*id="clientImportMapping"[\s\S]*client-import\.js\?v=\d+/);
assert.doesNotMatch(html, /id="clientImportSource"/);

const context = { window:{ crypto:globalThis.crypto } };
vm.runInNewContext(clientImport, context);
const manuallyMapped = context.window.MinutaClientImport.mapRows([
  ['Первый столбец','Второй столбец'],
  ['Анна','+7 999 111-22-33']
], { name:0, phone:1 });
assert.equal(manuallyMapped.rows[0].name, 'Анна');
assert.equal(manuallyMapped.rows[0].phone, '79991112233');

console.log('v95 client import static checks passed');
