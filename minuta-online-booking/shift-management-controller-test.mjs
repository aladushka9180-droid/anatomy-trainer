import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

class MockElement {
  constructor(id = '') { this.id = id; this.hidden = false; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.checked = false; this.disabled = false; this.dataset = {}; this.title = ''; }
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
  closest() { return null; }
}

globalThis.window = { confirm: () => true };
globalThis.document = { addEventListener() {}, querySelector: () => new MockElement() };
await import(new URL(`./shift-management.js?test=${Date.now()}`, import.meta.url));

const base = {
  organization_id:'org-1', current_role:'owner', can_manage_team:true, enabled:false,
  locations:[{ id:'loc-1', name:'Центр', active:true }], performers:[{ id:'p-1', display_name:'Анна' }],
  services:[], shifts:[], absences:[], bookings:[], utilization:[], audit:[]
};
assert.deepEqual(window.MinutaShifts.shiftCoverage(base), { state:'zero', performerCount:0, performerTotal:1, locationCount:0, locationTotal:1 });
assert.equal(window.MinutaShifts.shiftCoverage({ ...base, performers:[...base.performers,{ id:'p-2' }], shifts:[{ performer_id:'p-1', location_id:'loc-1', active:true }] }).state, 'partial');
assert.equal(window.MinutaShifts.shiftCoverage({ ...base, shifts:[{ performer_id:'p-1', location_id:'loc-1', active:true }] }).state, 'full');

const source = readFileSync(new URL('./shift-management.js', import.meta.url), 'utf8');
assert.match(source, /coverage\.state === 'zero'[\s\S]*checked = false[\s\S]*return;/, 'zero coverage must stop before mutate');
assert.match(source, /coverage\.state === 'partial'[\s\S]*confirmAction[\s\S]*Существующие записи сохранятся/, 'partial coverage must require an explicit review');
assert.match(source, /set_minuta_branch_shifts_enabled/, 'full coverage path must preserve the existing RPC contract');

console.log('shift management coverage controller tests passed');
