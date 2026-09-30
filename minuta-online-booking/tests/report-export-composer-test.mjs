import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Synthetic RPC fixture only; no network, user records, or downloads.
const source = readFileSync(fileURLToPath(new URL('../provider.js',import.meta.url)),'utf8').replace('function notificationTaskKey(',readFileSync(new URL('../report-export-provider.js',import.meta.url),'utf8')+'\nfunction notificationTaskKey(');
const start = source.indexOf('function reportExportSegmentItems(');
const end = source.indexOf('async function exportBookingsXlsx(',start);
assert.ok(start >= 0 && end > start);
const scope = { source:'own', organizationId:'org-a', start:'2026-09-01', end:'2026-09-30',
  performer:'all', locationId:'all', segment:'all' };
const current = { authorized:true, calls:[], live:[], imported:[], mismatch:false, fail:false, afterRpc:null };
const row = (id,date,key,prior=false) => ({ id, organization_id:'org-a', location_id:'branch-a',
  performer_id:'staff-a', booking_date:date, booking_time:'10:00', client_export_key:key,
  client_phone:'+7 *** ***-22-33', status:'confirmed', booking_outcomes:{ visit_status:'completed' },
  client_had_previous:prior });
current.live = [row('a','2026-09-02','record:a',false),row('b','2026-09-03','record:b',true)];
current.imported = [row('c','2026-09-05','record:a',false)];
const context = {
  reportExportAuthorized:async () => current.authorized,
  reportCompletedItems:items => items.filter(item => item.booking_outcomes?.visit_status === 'completed'),
  reportClientIdentity:item => item.client_export_key,
  reportExportData:(_privacy,items) => ({ items }),
  db:{ rpc:async (name,params) => {
    current.calls.push([name,params]);
    current.afterRpc?.(current.calls.length);
    if (current.fail) return {error:{code:'PGRST202'}};
    const entries = name === 'get_minuta_report_export_bookings' ? current.live : current.imported;
    return {data:{ organization_id:current.mismatch ? 'org-b' : params.p_organization,
      location_id:null, performer_id:null, phone_mode:params.p_phone_mode,
      bookings:entries.slice(params.p_offset,params.p_offset+params.p_limit), has_more:false, next_offset:null }};
  }}
};
vm.createContext(context);
vm.runInContext(source.slice(start,end),context);
const get = expression => vm.runInContext(expression,context);
const load = () => get("reportExportItems(scope, 'masked', false)");
context.scope = scope;
assert.equal((await load()).length,3,'all locations retain imported history');
assert.deepEqual(current.calls.map(([name])=>name),
  ['get_minuta_report_export_bookings','get_minuta_report_export_imported_history']);
assert.equal((await get("reportExportItems({...scope,segment:'new'},'masked',false)")).length,2,
  'new segment includes both visits for a first-time client');
assert.equal((await get("reportExportItems({...scope,segment:'returning'},'masked',false)")).length,1);
await assert.rejects(get("reportExportItems({...scope,locationId:'branch-a'},'masked',false)"),
  /location_import_history_undecided/,'mixed branch/import scope is blocked');
current.mismatch = true;
await assert.rejects(load(),/scope_mismatch/,'foreign organization metadata is refused');
current.mismatch = false;
current.fail = true;
await assert.rejects(load(),error => error?.code === 'PGRST202','missing export RPC cannot fall back to v97');
current.fail = false;
current.authorized = false;
current.calls.length = 0;
await assert.rejects(load(),/context_changed/);
assert.equal(current.calls.length,0,'changed account or rights must stop before RPC');
current.authorized = true;
current.calls.length = 0;
current.afterRpc = count => { if (count === 1) current.authorized = false; };
await assert.rejects(load(),/context_changed/,'role/account change between live and import pages stops export');
assert.equal(current.calls.length,1);
current.afterRpc = null;
current.authorized = true;
current.live = [row('x','2026-08-31','record:x')];
await assert.rejects(load(),/row_scope_mismatch/,'out-of-period row is refused');
current.live = [row('x','2026-09-02','record:x')];
current.live[0].client_phone = '+7 (900) 111-22-33';
await assert.rejects(load(),/row_scope_mismatch/,'unmasked phone in masked RPC result is refused');
console.log('report export composer synthetic scope: ok');
