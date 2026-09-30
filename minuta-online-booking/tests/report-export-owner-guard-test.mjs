import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../provider.js', import.meta.url)), 'utf8');
const start = source.indexOf('function reportExportFilename(');
const end = source.indexOf('function reportPdfText', start);
assert.ok(start >= 0 && end > start);

const state = { user:'user-a', auth:'user-a', org:'org-a', active:'org-a', role:'owner',
  source:'own', period:'last30', performer:'all', team:true, status:'ready', key:'scope-a', consent:false,
  workspaceReads:0, afterWorkspace:null };
const downloads = [], notifications = [], payloads = [];
const context = {
  Blob, state, downloads, notifications, payloads,
  get currentUser() { return { id:state.user }; },
  get sessionGeneration() { return 1; },
  get reportDataSource() { return state.source; },
  get reportPeriod() { return state.period; },
  get reportCanViewTeam() { return state.team; },
  get reportPerformerFilter() { return state.performer; },
  get reportScopedBookingsState() { return { key:state.key, status:state.status }; },
  organizationController:{ getActiveOrganization:() => ({ id:state.active }) },
  reportOrganizationId:() => state.org,
  reportRange:() => ({ start:'2026-09-01', end:'2026-09-30' }),
  reportUsesScopedBookings:() => state.team,
  previousReportRange:() => null,
  reportForecastEnd:range => range.end,
  reportDataQueryRange:range => range,
  reportSessionKey:() => 'scope-a',
  document:{ querySelector:() => state.consent ? { checked:true } : null },
  db:{
    auth:{ getUser:async () => ({ data:{ user:{ id:state.auth } }, error:null }) },
    async rpc(name) {
      assert.equal(name, 'get_minuta_workspace');
      state.workspaceReads += 1;
      const role = state.role;
      state.afterWorkspace?.(state.workspaceReads);
      return { data:{ organizations:[{ id:'org-a', current_role:role, status:'active' }] }, error:null };
    }
  },
  notify:value => notifications.push(value),
  reportExportData:privacy => { payloads.push(privacy); return { range:{ start:'2026-09-01', end:'2026-09-30' }, headers:['Телефон'], rows:[['+7 (900) 123-45-67']] }; },
  reportExportDate:value => value,
  reportProfessionalWorkbook:() => new Blob(['xlsx']),
  reportExportSheets:() => [],
  URL:{ createObjectURL:() => 'blob:test', revokeObjectURL(){} },
  setTimeout(){}, clearTimeout(){},
  $:() => null,
  window:{ Worker:true, Blob:true, URL:true }
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);
vm.runInContext('reportExportDownload = (blob, filename) => downloads.push({blob,filename})', context);
const csv = mode => vm.runInContext(`exportBookingsCsv('${mode}')`, context);
const xlsx = mode => vm.runInContext(`exportBookingsXlsx('${mode}')`, context);
const reset = () => { downloads.length = 0; payloads.length = 0; notifications.length = 0; state.workspaceReads = 0; state.afterWorkspace = null; };

await csv('full');
assert.equal(downloads.length, 0, 'direct full export without separate confirmation must fail');
assert.equal(payloads.length, 0, 'denied export must not build a sensitive payload');
reset(); state.consent = true;
await csv('full');
assert.equal(downloads.length, 1, 'confirmed owner can download');
assert.deepEqual(payloads, ['full']);
assert.equal(state.workspaceReads, 2, 'role is rechecked immediately before file delivery');
reset(); state.role = 'admin';
await csv('full');
assert.equal(downloads.length, 0, 'admin must not get full phones even with a forged checked box');
assert.equal(payloads.length, 0);
reset();
await csv('masked');
assert.equal(downloads.length, 1, 'admin can download masked CSV');
reset(); state.role = 'specialist';
await xlsx('full');
assert.equal(downloads.length, 0, 'specialist must not get full XLSX');
reset(); state.role = 'owner';
state.afterWorkspace = reads => { if (reads === 1) state.role = 'admin'; };
await csv('full');
assert.equal(downloads.length, 0, 'demotion during export must prevent delivery');
reset(); state.role = 'owner';
state.afterWorkspace = reads => { if (reads === 1) state.auth = 'user-b'; };
await csv('full');
assert.equal(downloads.length, 0, 'account switch during export must prevent delivery');
reset(); state.auth = 'user-a';
state.afterWorkspace = reads => { if (reads === 1) state.active = 'org-b'; };
await csv('full');
assert.equal(downloads.length, 0, 'organization switch during export must prevent delivery');
reset(); state.active = 'org-a'; state.status = 'loading';
await csv('masked');
assert.equal(downloads.length, 0, 'unfinished scoped report must not export stale rows');
reset(); state.status = 'ready'; state.key = 'older-period';
await csv('masked');
assert.equal(downloads.length, 0, 'ready rows for a previous report scope must not export');
reset(); state.key = 'scope-a';
assert.match(source, /async function exportBookingsPdf\(\)\{[\s\S]*?reportExportData\('none'\)/, 'PDF must force phone omission');
const backgroundStart = source.indexOf('async function exportBookingsXlsxInBackground(');
const backgroundEnd = source.indexOf('function notificationTaskKey', backgroundStart);
assert.ok(backgroundStart >= 0 && backgroundEnd > backgroundStart);
vm.runInContext(source.slice(backgroundStart, backgroundEnd), context);
let pendingWorker;
context.Worker = class {
  constructor() { pendingWorker = this; }
  postMessage(){}
  terminate(){}
};
reset();
const inFlight = vm.runInContext("exportBookingsXlsxInBackground('full')", context);
for (let turn = 0; turn < 8 && !pendingWorker; turn += 1) await Promise.resolve();
assert.ok(pendingWorker, 'background worker must start after owner check');
state.role = 'admin';
pendingWorker.onmessage({ data:{ blob:new Blob(['xlsx']) } });
await inFlight;
assert.equal(downloads.length, 0, 'role change while worker runs must prevent delivery');
reset(); state.role = 'owner'; pendingWorker = null;
const failedWorker = vm.runInContext("exportBookingsXlsxInBackground('full')", context);
for (let turn = 0; turn < 8 && !pendingWorker; turn += 1) await Promise.resolve();
assert.ok(pendingWorker);
state.auth = 'user-b';
pendingWorker.onerror({ error:new Error('synthetic worker failure') });
await failedWorker;
assert.equal(downloads.length, 0, 'worker fallback must not bypass account change');
console.log('report export owner guard: ok');
