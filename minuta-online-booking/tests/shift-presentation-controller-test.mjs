import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Protect the private edit identity and native RPC contract, without a browser
// or real transport. Presentation is optional; backend authorization is unchanged.
const nodes = new Map(), handlers = {}, calls = [], hooks = [];
let allowed = true, resets = 0;
const node = id => {
  if (!nodes.has(id)) nodes.set(id, { id, value: '', hidden: false, checked: false, disabled: false, dataset: {}, textContent: '', innerHTML: '',
    querySelectorAll: () => [], querySelector: () => submitter, scrollIntoView() {},
    reset() { resets++; node('shiftStart').value = '10:00'; node('shiftEnd').value = '20:00'; node('shiftHasBreak').checked = false; node('shiftNote').value = ''; } });
  return nodes.get(id);
};
const submitter = { disabled: false, textContent: 'Создать смену' };
const workspace = { organization_id: 'org-a', current_role: 'specialist', can_manage_team: false, enabled: false,
  locations: [{ id: 'l1', name: 'Основной', active: true }], performers: [{ id: 'u1', display_name: 'Анна' }], services: [], bookings: [], absences: [], utilization: [], audit: [],
  shifts: [{ id: 'existing', performer_id: 'u1', location_id: 'l1', shift_date: '2099-10-03', start_time: '11:00', end_time: '18:00', active: true }] };
const runtime = { Date, setTimeout, clearTimeout, window: { MinutaTeamSchedule: {
  reset: () => hooks.push('reset'), setContext: (...args) => hooks.push(['context', ...args]), beforeLoad: () => hooks.push('beforeLoad'), render: () => hooks.push('render')
} }, document: { querySelector: selector => node(selector.replace(/^#/, '')), addEventListener: (name, fn) => { handlers[name] = fn; } } };
vm.runInNewContext(readFileSync(new URL('../shift-management.js', import.meta.url), 'utf8'), runtime);
node('shiftStartDate').value = '2099-10-02'; node('shiftPeriod').value = '7'; node('shiftPerformer').value = 'u1'; node('shiftLocation').value = 'l1';
const controller = runtime.window.MinutaShifts.createController({
  db: { rpc: async (name, parameters) => { calls.push({ name, parameters }); return name === 'get_minuta_shift_workspace' ? { data: { ...workspace, organization_id: parameters.p_organization } } : { data: { ok: true } }; } },
  escapeHtml: v => String(v ?? ''), notify() {}, requireWrites: () => allowed, applyWriteAvailability() {},
  getCurrentUser: () => ({ id: 'u1' }), getSessionGeneration: () => 1, sessionIsCurrent: () => true
});
controller.bind(); await controller.setOrganization({ id: 'org-a' });
assert.equal(calls[0].parameters.p_end, '2099-10-08', 'week selection must bound the native read to seven days');
assert.ok(hooks.includes('render'));
const click = (selector, dataset) => handlers.click({ target: { closest: match => match === selector ? { dataset } : null } });
const save = () => handlers.submit({ target: { id: 'shiftForm' }, preventDefault() {}, submitter });
await click('[data-edit-shift]', { editShift: 'existing' });
await click('[data-shift-new]', { shiftDate: '2099-10-08', shiftPerformer: 'u1', shiftLocation: 'l1' });
assert.equal(node('shiftDate').value, '2099-10-08'); assert.equal(node('shiftHasBreak').checked, false);
assert.equal(submitter.textContent, 'Создать смену'); await save();
let write = calls.findLast(call => call.name === 'upsert_minuta_staff_shift');
assert.equal(write.parameters.p_shift, null, 'new after edit must never update the old shift');
assert.equal(write.parameters.p_organization, 'org-a'); assert.equal(write.parameters.p_performer, 'u1');
assert.equal(write.parameters.p_break_start, null); assert.equal(write.parameters.p_start, '10:00');
await click('[data-edit-shift]', { editShift: 'existing' }); await save();
assert.equal(calls.findLast(call => call.name === 'upsert_minuta_staff_shift').parameters.p_shift, 'existing', 'normal editing must retain its native identity');
await click('[data-edit-shift]', { editShift: 'existing' }); await controller.setOrganization({ id: 'org-b' }); await save();
write = calls.findLast(call => call.name === 'upsert_minuta_staff_shift');
assert.equal(write.parameters.p_shift, null, 'changing organization must discard the previous edit identity');
assert.equal(write.parameters.p_organization, 'org-b');
const dropdownTrigger = { disabled: false };
node('shiftSubstitutionPanel').querySelector = selector => {
  return selector === 'button[type="submit"]' ? submitter : dropdownTrigger;
};
submitter.disabled = false;
workspace.can_manage_team = true;
await controller.load();
assert.equal(submitter.disabled, true, 'no alternatives must disable the actual substitution submit');
assert.equal(dropdownTrigger.disabled, false, 'select enhancement buttons must not be mistaken for the substitution submit');
allowed = false; const resetsBefore = resets, writesBefore = calls.length;
await click('[data-shift-new]', { shiftDate: '2099-10-09' }); await save();
assert.equal(resets, resetsBefore, 'a denied write gate must not launch a new form');
assert.equal(calls.length, writesBefore, 'a denied write gate must not call the backend');
controller.reset(); assert.equal(hooks.at(-1), 'reset');
console.log('Shift presentation controller contract passed');
