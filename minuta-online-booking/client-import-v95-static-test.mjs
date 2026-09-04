import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('./', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v95.sql', root), 'utf8');
const rollback = readFileSync(new URL('recovery/rollback-client-import-v95.sql', root), 'utf8');
const clientImport = readFileSync(new URL('client-import.js', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const html = readFileSync(new URL('provider.html', root), 'utf8');
const xlsxVendorBytes = readFileSync(new URL('vendor/xlsx-0.20.3.full.min.js', root));
const xlsxVendor = xlsxVendorBytes.toString('utf8');
const xlsxLicense = readFileSync(new URL('vendor/xlsx-0.20.3.LICENSE', root), 'utf8');
const releaseWorkflow = readFileSync(new URL('../.github/workflows/minuta-safe-release.yml', root), 'utf8');

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
assert.equal((migration.match(/::name\[\]/gi) || []).length, 2);
assert.match(migration, /create index concurrently if not exists organization_imported_clients_updated_v95_idx/i);
assert.match(migration, /get_minuta_imported_clients\(p_organization uuid,p_limit integer,p_offset integer\)/i);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[^;]*to authenticated/i);
assert.match(rollback, /v95_rollback_blocked_imported_clients_exist/i);
assert.match(rollback, /v95_rollback_blocked_import_batches_exist/i);
const testClientImportGuard = releaseWorkflow.split('\n').find(line =>
  line.includes("select (select count(*)=3 from information_schema.columns") &&
  line.includes("client_import_batches_scope_v95_idx")
);
assert.ok(testClientImportGuard, 'release: не найдена итоговая проверка слоя v95');
assert.match(
  testClientImportGuard,
  /client_import_batches_scope_v95_idx'[\s\S]*createindexclient_import_batches_scope_v95_idxonpublic\.client_import_batchesusingbtree\(organization_id,created_atdesc,iddesc\)'\)\)\);"/,
  'release: проверка трёх индексов v95 должна закрывать условие и подзапрос'
);
assert.doesNotMatch(`${clientImport}\n${html}`, /YCLIENTS|DIKIDI|Masters/);
assert.match(clientImport, /Поддерживаются XLS, XLSX, CSV, TSV и TXT/);
assert.match(clientImport, /XLSX\.utils\.sheet_to_json/);
assert.match(clientImport, /clients\.set\(phone/);
assert.match(clientImport, /import_minuta_clients/);
assert.match(clientImport, /p_source_system:'other'/);
assert.match(clientImport, /showMapping\(pendingTable\)/);
assert.match(clientImport, /applyManualMapping/);
assert.match(clientImport, /мобильный номер/);
assert.match(clientImport, /const IMPORT_BATCH_SIZE = 500/);
assert.match(clientImport, /preview\.rows\.slice\(offset, offset \+ IMPORT_BATCH_SIZE\)/);
assert.match(provider, /importedClients\.forEach/);
assert.match(provider, /clientImportController\.setOrganization\(organization\?\.public_slug === REPORT_DEMO_SLUG \? null : organization\)/);
assert.match(html, /id="clientImportPanel"[\s\S]*<strong>Импорт<\/strong>[\s\S]*id="clientImportFile"[\s\S]*id="clientImportMapping"[\s\S]*client-import\.js\?v=\d+/);
assert.match(html, /accept="[^"]*\.xls,[^"]*\.xlsx/);
assert.match(html, /vendor\/xlsx-0\.20\.3\.full\.min\.js" integrity="sha384-EnyY0\/GSHQGSxSgMwaIPzSESbqoOLSexfnSMN2AP\+39Ckmn92stwABZynq1JyzdT"/);
assert.doesNotMatch(html, /id="clientImportSource"/);
assert.equal(createHash('sha256').update(xlsxVendorBytes).digest('hex'), 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41');
assert.match(xlsxLicense, /Apache License[\s\S]*Version 2\.0/);

const xlsxContext = {};
vm.runInNewContext(xlsxVendor, xlsxContext);
assert.ok(xlsxContext.XLSX?.read);
assert.equal(xlsxContext.XLSX.version, '0.20.3');
const context = { window:{ crypto:globalThis.crypto, XLSX:xlsxContext.XLSX } };
vm.runInNewContext(clientImport, context);
const manuallyMapped = context.window.MinutaClientImport.mapRows([
  ['Первый столбец','Второй столбец'],
  ['Анна','+7 999 111-22-33']
], { name:0, phone:1 });
assert.equal(manuallyMapped.rows[0].name, 'Анна');
assert.equal(manuallyMapped.rows[0].phone, '79991112233');
const exportedFormat = context.window.MinutaClientImport.mapRows([
  ['Имя клиента','Фамилия клиента','Мобильный номер','Количество записей','Потрачено'],
  ['Анна','Иванова','+7 999 111-22-33','12','25000']
]);
assert.equal(exportedFormat.rows[0].name, 'Анна Иванова');
assert.equal(exportedFormat.rows[0].phone, '79991112233');
assert.equal(exportedFormat.rows[0].visit_count, 12);
assert.equal(exportedFormat.rows[0].total_spent_rub, 25000);
const largeExport = [
  ['Имя клиента','Мобильный номер'],
  ...Array.from({ length:501 }, (_, index) => [`Клиент ${index + 1}`, String(79000000000 + index)])
];
assert.equal(context.window.MinutaClientImport.mapRows(largeExport).rows.length, 501);
const legacyWorkbook = xlsxContext.XLSX.utils.book_new();
xlsxContext.XLSX.utils.book_append_sheet(legacyWorkbook, xlsxContext.XLSX.utils.aoa_to_sheet([
  ['Имя клиента','Фамилия клиента','Мобильный номер'],
  ['Анна','Иванова','+7 999 111-22-33']
]), 'Клиенты');
const legacyBytes = xlsxContext.XLSX.write(legacyWorkbook, { bookType:'biff8', type:'array' });
const legacyTable = context.window.MinutaClientImport.parseSpreadsheet(new Uint8Array(legacyBytes));
const legacyMapped = context.window.MinutaClientImport.mapRows(legacyTable);
assert.equal(legacyMapped.rows[0].name, 'Анна Иванова');
assert.equal(legacyMapped.rows[0].phone, '79991112233');

console.log('v95 client import static checks passed');
