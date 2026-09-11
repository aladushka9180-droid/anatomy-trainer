import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const migration = read('supabase-migration-v144.sql');
const rollback = read('supabase-migration-v144-rollback.sql');
const clientImport = read('client-import.js');
const releaseWorkflow = read('../.github/workflows/minuta-v144-safe-release.yml');

assert.match(migration, /v144_requires_v95_v99_v110_v112/);
assert.match(migration, /create table if not exists public\.provider_data_transfer_batches/);
assert.match(migration, /create table if not exists public\.provider_data_transfer_changes/);
assert.match(migration, /unique \(organization_id,request_id\)/);
assert.match(migration, /unique \(batch_id,entity_kind,entity_key\)/);
assert.match(migration, /target_state_hash text not null check \(target_state_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
assert.match(migration, /minuta_provider_transfer_target_hash_v144/);
assert.match(migration, /organization_imported_clients_source_v144_idx[\s\S]*organization_id,source_system,source_external_id/);
assert.match(migration, /status text not null default 'previewed'[\s\S]*'applied'[\s\S]*'rolled_back'[\s\S]*'expired'/);
assert.match(migration, /expires_at timestamptz not null default \(now\(\)\+interval '15 minutes'\)/);
assert.match(migration, /p_rows is null or jsonb_typeof\(p_rows\)<>'array'/);
assert.match(migration, /coalesce\(v_phone,''\)!~'\^7\[0-9\]\{10\}\$'/);
assert.match(migration, /v_date is null[\s\S]*v_time is null[\s\S]*v_duration is null/);
assert.match(migration, /provider_transfer_request_conflict/);
assert.match(migration, /provider_transfer_conflict/);
assert.match(migration, /count\(\*\) filter \(where existing\.id is not null and not \(/);
assert.match(migration, /into v_create,v_update,v_unchanged/);
assert.match(migration, /lock table public\.organization_imported_booking_history in share row exclusive mode;[\s\S]*lock table public\.organization_imported_clients in share row exclusive mode;/);
assert.match(migration, /<>v_batch\.target_state_hash[\s\S]*'reason','target_changed'/);
assert.match(migration, /before_row,after_row[\s\S]*to_jsonb\(existing\),to_jsonb\(existing\)/);
assert.match(migration, /to_jsonb\(current_row\)<>change_row\.after_row/);
assert.match(migration, /provider_transfer_rollback_conflict/);
assert.match(migration, /provider_transfer_rollback_client_records_exist/);
assert.match(migration, /record_row\.organization_id=p_organization and record_row\.client_phone=change_row\.entity_key/);
assert.doesNotMatch(migration, /change_row\.operation='created' and not record_row\.archived/);
assert.match(migration, /has_organization_role\(p_organization,array\['owner'\]\)/);
assert.match(migration, /p_offset\+p_limit>100000/);
assert.match(migration, /'dataset_revision',v_dataset_revision/);
assert.match(migration, /minuta_personal_data_access_log[\s\S]*'export','provider_transfer'/);
assert.match(migration, /purge_expired_minuta_provider_transfer_previews_v144/);
assert.match(migration, /revoke all on table public\.provider_data_transfer_batches,public\.provider_data_transfer_changes[\s\S]*from public,anon,authenticated,service_role/);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[^;]*to authenticated/i);
assert.match(rollback, /drop function if exists public\.preview_minuta_provider_transfer_v144/);
assert.match(rollback, /drop function if exists public\.minuta_provider_transfer_target_hash_v144/);
assert.match(rollback, /set status='expired',staged_payload=null/);
assert.doesNotMatch(rollback, /drop table|delete from public\.provider_data_transfer_(?:batches|changes)/i);
assert.match(releaseWorkflow, /'transferTablesRetained',to_regclass\('public\.provider_data_transfer_batches'\) is not null/);
assert.match(releaseWorkflow, /\.transferTablesRetained and \.transferSurfaceDisabled and \.transferRows==0/);
assert.doesNotMatch(releaseWorkflow, /'transfer',to_regclass\('public\.provider_data_transfer_batches'\) is null/);

assert.match(clientImport, /preview_minuta_provider_transfer_v144/);
assert.match(clientImport, /apply_minuta_provider_transfer_v144/);
assert.match(clientImport, /if \(applied\.status !== 'applied'\)/);
assert.match(clientImport, /rollback_minuta_provider_transfer_v144/);
assert.match(clientImport, /export_minuta_provider_transfer_data_v144/);
assert.match(clientImport, /get_minuta_provider_transfer_journal_v144/);
assert.match(clientImport, /transferRequestIds\[absoluteOffset\] \|\| uuid\(\)/);
assert.match(clientImport, /transferBaseOffset:importPreview\.transferBaseOffset\+processedCount/);

const context = { window:{ crypto:globalThis.crypto } };
vm.runInNewContext(clientImport, context);
const api = context.window.MinutaClientImport;

const rpcCalls = [];
const successfulDb = {
  async rpc(name, args) {
    rpcCalls.push([name, args]);
    if (name === 'preview_minuta_provider_transfer_v144') {
      return { data:{ batch_id:'batch-1',status:'previewed',conflict_count:0,create_count:1 },error:null };
    }
    return { data:{ batch_id:'batch-1',status:'applied',created_count:1 },error:null };
  }
};
const transfer = await api.executeProviderTransferBatch(successfulDb, {
  organizationId:'org-1',kind:'clients',sourceSystem:'dikidi',rows:[{ name:'Анна' }],requestId:'request-1'
});
assert.equal(transfer.supported, true);
assert.equal(transfer.data.created_count, 1);
assert.deepEqual(rpcCalls.map(([name]) => name), [
  'preview_minuta_provider_transfer_v144','apply_minuta_provider_transfer_v144'
]);
assert.equal(rpcCalls[0][1].p_source_system, 'dikidi');
assert.equal(rpcCalls[1][1].p_batch, 'batch-1');

let fallbackCalls = 0;
const fallback = await api.executeProviderTransferBatch({
  async rpc() { fallbackCalls += 1; return { data:null,error:{ code:'PGRST202',message:'missing' } }; }
}, { organizationId:'org-1',kind:'clients',rows:[{}],requestId:'request-2' });
assert.equal(fallback.supported, false);
assert.equal(fallbackCalls, 1);

let conflictCalls = 0;
await assert.rejects(() => api.executeProviderTransferBatch({
  async rpc() {
    conflictCalls += 1;
    return { data:{ batch_id:'batch-2',status:'previewed',conflict_count:1 },error:null };
  }
}, { organizationId:'org-1',kind:'clients',rows:[{}],requestId:'request-3' }), /внешний идентификатор/);
assert.equal(conflictCalls, 1);

const exportCalls = [];
const exportRevision = 'a'.repeat(64);
const firstExportPage = Array.from({ length:1000 }, (_, index) => ({ name:`Клиент ${index + 1}` }));
const exported = await api.fetchProviderTransferExport({
  async rpc(name, args) {
    exportCalls.push([name, args]);
    if (args.p_offset === 0) return {
      data:{ exported_at:'2026-09-11T10:00:00Z',dataset_revision:exportRevision,rows:firstExportPage,has_more:true,next_offset:1000 },error:null
    };
    return { data:{ exported_at:'2026-09-11T10:00:01Z',dataset_revision:exportRevision,rows:[{ name:'Борис' }],has_more:false,next_offset:null },error:null };
  }
}, 'org-1', 'clients');
assert.equal(exported.rows.length, 1001);
assert.equal(exported.rows[0].name, 'Клиент 1');
assert.equal(exported.rows.at(-1).name, 'Борис');
assert.equal(exported.exported_at, '2026-09-11T10:00:00Z');
assert.deepEqual(exportCalls.map(([,args]) => args.p_offset), [0,1000]);

await assert.rejects(() => api.fetchProviderTransferExport({
  async rpc() { return { data:{ dataset_revision:exportRevision,rows:[],has_more:true,next_offset:0 },error:null }; }
}, 'org-1', 'clients'), /неверную страницу/);
let changingPage = 0;
await assert.rejects(() => api.fetchProviderTransferExport({
  async rpc() {
    changingPage += 1;
    return changingPage === 1
      ? { data:{ dataset_revision:exportRevision,rows:firstExportPage,has_more:true,next_offset:1000 },error:null }
      : { data:{ dataset_revision:'b'.repeat(64),rows:[],has_more:false,next_offset:null },error:null };
  }
}, 'org-1', 'clients'), /Данные изменились/);

const payload = {
  kind:'clients',exported_at:'2026-09-11T10:00:00Z',dataset_revision:exportRevision,rows:[{
    name:'=2+2',display_phone:'+7 999 111-22-33',email:'anna@example.test',birthday:'1990-01-01',
    note:'<частное>, "значение"',source_system:'other',external_id:'@external',visit_count:2,
    total_spent_rub:5000,last_visit_on:'2026-09-10',marketing_consent:true,
    personal_data_consent:false,server_secret:'must-not-leak',nested:{ secret:'must-not-leak' }
  }]
};
const csv = api.buildProviderTransferExport(payload, 'csv');
assert.equal(csv.filename, 'primetime-pro-clients-2026-09-11.csv');
assert.equal(csv.rowCount, 1);
assert.ok(csv.content.startsWith('\ufeff'));
assert.match(csv.content, /'=2\+2/);
assert.match(csv.content, /'@external/);
assert.doesNotMatch(csv.content, /must-not-leak|\[object Object\]/);

const json = api.buildProviderTransferExport(payload, 'json');
assert.doesNotMatch(json.content, /must-not-leak|<частное>/);
const parsedJson = JSON.parse(json.content);
assert.equal(parsedJson.dataset_revision, exportRevision);
assert.equal(parsedJson.rows[0].note, '<частное>, "значение"');
assert.equal(Object.hasOwn(parsedJson.rows[0], 'server_secret'), false);
assert.equal(Object.hasOwn(parsedJson.rows[0], 'nested'), false);
assert.deepEqual(Object.keys(parsedJson.rows[0]), [
  'name','display_phone','email','birthday','note','source_system','external_id','visit_count',
  'total_spent_rub','last_visit_on','marketing_consent','personal_data_consent'
]);
assert.throws(() => api.buildProviderTransferExport({ kind:'other',rows:[] }, 'json'), /Неизвестный раздел/);
assert.throws(() => api.buildProviderTransferExport({ kind:'clients',rows:[] }, 'xlsx'), /CSV и JSON/);

const makeElement = () => ({
  hidden:true,disabled:false,textContent:'',innerHTML:'',value:'',listeners:Object.create(null),
  addEventListener(name, listener) { this.listeners[name] = listener; },
  setAttribute(name) { if (name === 'hidden') this.hidden = true; },
  reset() {}
});
const elements = Object.fromEntries([
  'clientImportPanel','clientContactsImport','clientImportHistory','clientImportPreview','clientImportMapping',
  'clientImportPreviewList','clientImportPreviewSummary','clientImportSubmit','clientImportForm',
  'clientImportFile','clientImportApplyMapping','clientImportNameColumn','clientImportPhoneColumn'
].map(id => [id, makeElement()]));
elements.clientImportSubmit.textContent = 'Импортировать';
context.navigator = {
  onLine:true,
  contacts:{
    async getProperties() { return ['name','tel']; },
    async select() { return [{ name:['Новый клиент'],tel:['+7 900 123-45-67'] }]; }
  }
};
const controllerCalls = [];
const requestIds = [];
let applyAttempts = 0;
const controller = api.createController({
  db:{ async rpc(name, args) {
    controllerCalls.push([name,args]);
    if (name === 'get_minuta_imported_clients') return { data:{ can_import:true,clients:[],recent_batches:[],has_more:false },error:null };
    if (name === 'get_minuta_imported_booking_history') return { data:{ rows:[],summary:null,has_more:false },error:null };
    if (name === 'get_minuta_provider_transfer_journal_v144') return { data:{ batches:[] },error:null };
    if (name === 'preview_minuta_provider_transfer_v144') {
      requestIds.push(args.p_request_id);
      return { data:{ batch_id:'retry-batch',status:applyAttempts ? 'applied' : 'previewed',conflict_count:0 },error:null };
    }
    if (name === 'apply_minuta_provider_transfer_v144') {
      applyAttempts += 1;
      return applyAttempts === 1
        ? { data:null,error:new Error('Ответ сервера потерян') }
        : { data:{ batch_id:'retry-batch',status:'applied',created_count:1,updated_count:0,idempotent:true },error:null };
    }
    throw new Error(`Unexpected RPC: ${name}`);
  } },
  $:selector => elements[selector.slice(1)] || null,
  escapeHtml:value => String(value ?? ''),notify:() => {},requireWrites:() => true,onLoaded:() => {}
});
controller.bind();
controller.setOrganization({ id:'organization-retry' });
await controller.load();
await elements.clientContactsImport.listeners.click();
assert.equal(elements.clientImportPreview.hidden, false);
await elements.clientImportForm.listeners.submit({ preventDefault() {} });
assert.equal(elements.clientImportPreview.hidden, false, 'failed response must keep a retryable preview');
await elements.clientImportForm.listeners.submit({ preventDefault() {} });
assert.equal(requestIds.length, 2);
assert.equal(requestIds[0], requestIds[1], 'a lost apply response must retry with the same request id');
assert.equal(controllerCalls.some(([name]) => name === 'import_minuta_clients'), false);
assert.equal(controller.getTransferBatches().length, 0);

console.log('Provider data transfer v144 static and browser-core checks passed.');
