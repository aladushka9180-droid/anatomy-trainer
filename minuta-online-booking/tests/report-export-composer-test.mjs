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
const current = { authorized:true, calls:[], live:[], imported:[], mismatch:false, mismatchLocation:false,
  fail:false, afterRpc:null, notices:[] };
const row = (id,date,key,prior=false) => ({ id, organization_id:'org-a', location_id:'branch-a',
  performer_id:'staff-a', booking_date:date, booking_time:'10:00', client_export_key:key,
  client_phone:'+7 *** ***-22-33', status:'confirmed', booking_outcomes:{ visit_status:'completed' },
  client_had_previous:prior });
current.live = [row('a','2026-09-02','record:a',false),row('b','2026-09-03','record:b',true)];
current.imported = [{ ...row('c','2026-09-05','record:a',false), location_id:null, is_imported_history:true }];
const context = {
  reportExportAuthorized:async () => current.authorized,
  reportCompletedItems:items => items.filter(item => item.booking_outcomes?.visit_status === 'completed'),
  reportClientIdentity:item => item.client_export_key,
  reportExportData:(_privacy,items) => ({ items }),
  notify:message => current.notices.push(message),
  db:{ rpc:async (name,params) => {
    current.calls.push([name,params]);
    current.afterRpc?.(current.calls.length);
    if (current.fail) return {error:{code:'PGRST202'}};
    const entries = name === 'get_minuta_report_export_bookings' ? current.live : current.imported;
    return {data:{ organization_id:current.mismatch ? 'org-b' : params.p_organization,
      location_id:current.mismatchLocation ? null : params.p_location, performer_id:null, phone_mode:params.p_phone_mode,
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
current.calls.length = 0;
assert.equal((await get("reportExportItems({...scope,locationId:'branch-a'},'masked',false)")).length,2,
  'selected branch retains only its live visits');
assert.deepEqual(current.calls.map(([name])=>name),['get_minuta_report_export_bookings'],
  'selected branch never requests imported history without a location');
assert.equal(current.calls[0][1].p_location,'branch-a');
assert.equal((await get("reportExportItems({...scope,locationId:'branch-a',segment:'new'},'masked',false)")).length,1);
assert.equal((await get("reportExportItems({...scope,locationId:'branch-a',segment:'returning'},'masked',false)")).length,1);
current.notices.length = 0;
await get("reportExportPreparedData({...scope,locationId:'branch-a'},'masked',false)");
assert.match(current.notices[0],/импортированные визиты без филиала исключены/,
  'selected branch explicitly explains the omitted history');
current.notices.length = 0;
await get("reportExportPreparedData(scope,'masked',false)");
assert.equal(current.notices.length,0,'all locations keep history without exclusion notice');
current.mismatchLocation = true;
await assert.rejects(get("reportExportPreparedData({...scope,locationId:'branch-a'},'masked',false)"),
  /scope_mismatch/,'selected branch requires matching RPC scope');
current.mismatchLocation = false;
current.live[0].location_id = 'branch-b';
await assert.rejects(get("reportExportItems({...scope,locationId:'branch-a'},'masked',false)"),
  /row_scope_mismatch/,'selected branch refuses a foreign-branch row');
current.live[0].location_id = 'branch-a';
current.live[0].is_imported_history = true;
await assert.rejects(get("reportExportItems({...scope,locationId:'branch-a'},'masked',false)"),
  /row_scope_mismatch/,'selected branch refuses an imported row even if it carries a branch ID');
delete current.live[0].is_imported_history;
current.calls.length = 0;
current.afterRpc = count => { if (count === 1) current.authorized = false; };
await assert.rejects(get("reportExportPreparedData({...scope,locationId:'branch-a'},'masked',false)"),
  /context_changed/,'account or role change during branch RPC stops export');
current.afterRpc = null;
current.authorized = true;
current.calls.length = 0;
assert.equal((await load()).length,3,'all locations still retain imported history after branch exports');
assert.deepEqual(current.calls.map(([name])=>name),
  ['get_minuta_report_export_bookings','get_minuta_report_export_imported_history']);
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
