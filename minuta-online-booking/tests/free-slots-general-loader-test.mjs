import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = source.indexOf('async function getFreeSlotsGeneralAvailability(');
const end = source.indexOf('\nconst SCHEDULE_DATE_KEY', start);
const calls = [];
let failure = '';
let stale = false;
let countChanges = false;
let rows = Array.from({ length:1201 }, (_, id) => ({ id:String(id) }));
let payload;
const db = { from(table) {
  const call = { table, filters:[] };
  calls.push(call);
  const query = {
    select(columns, options) { call.columns = columns; call.count = options?.count; return query; },
    eq(...args) { call.filters.push(['eq', ...args]); return query; },
    gte(...args) { call.filters.push(['gte', ...args]); return query; },
    lte(...args) { call.filters.push(['lte', ...args]); return query; },
    neq(...args) { call.filters.push(['neq', ...args]); return query; },
    in(...args) { call.filters.push(['in', ...args]); return query; },
    order(column) { call.order = column; return query; },
    range(from, to) { call.range = [from, to]; return query; },
    maybeSingle() { return query; },
    then(resolve, reject) {
      const data = table === 'bookings' ? rows.slice(call.range[0], Math.min(call.range[1] + 1, call.range[0] + 100)) : [];
      return Promise.resolve({ data, error:table === failure ? new Error('read_failed') : null,
        count:table === 'bookings' ? rows.length + (countChanges && call.range[0] ? 1 : 0) : 0 }).then(resolve, reject);
    }
  };
  return query;
} };
const context = vm.createContext({ db, currentUser:{ id:'own' }, sessionGeneration:1,
  sessionIsCurrent:() => !stale, organizationController:{ getActiveOrganization:() => ({ id:'org' }) },
  window:{ MinutaFreeSlots:{ calculateFreeWindows:value => { payload = value; return ['checked']; } } }
});
vm.runInContext(source.slice(start, end), context);
const args = { context:{ performerId:'own', organizationId:'org', resourceScheduling:true, branchShiftScheduling:true,
  services:[{ performer_id:'own', location_ids:['branch'] }] }, locationId:'branch', from:'2026-09-06', to:'2026-09-07' };
const load = () => context.getFreeSlotsGeneralAvailability(args);
assert.deepEqual(Array.from((await load()).data), ['checked']);
assert.equal(payload.bookings.length, 1201, 'Must read beyond both server cap and first REST page');
assert.ok(calls.every(call => call.filters.some(filter => filter[0] === 'eq' && filter[1] === 'performer_id' && filter[2] === 'own')));
assert.ok(calls.filter(call => call.table === 'bookings').every(call => !call.filters.some(filter => ['organization_id', 'location_id'].includes(filter[1]))), 'Bookings in another branch/org still occupy this master');
assert.ok(calls.filter(call => ['staff_location_shifts', 'staff_absences'].includes(call.table)).every(call => call.filters.some(filter => filter[1] === 'organization_id' && filter[2] === 'org')));
assert.ok(calls.filter(call => call.range).every(call => call.count === 'exact'));
for (const table of ['provider_schedule', 'provider_days_off', 'bookings', 'booking_policies', 'group_booking_events', 'staff_location_shifts', 'staff_absences']) {
  failure = table;
  await assert.rejects(load, /read_failed/);
}
failure = '';
countChanges = true;
await assert.rejects(load, /schedule_changed_during_read/);
countChanges = false;
stale = true;
await assert.rejects(load, /stale_session/);
stale = false;
args.context.performerId = 'someone-else';
await assert.rejects(load, /stale_session/);
args.context.performerId = 'own';
args.locationId = 'other-branch';
await assert.rejects(load, /own_services_unavailable/);
console.log('PASS: fresh own-master reads, full pagination with smaller server cap, cross-org occupancy, branch shifts, all read errors fail closed, session guard');
