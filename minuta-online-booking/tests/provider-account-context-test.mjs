import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractFunctionDeclaration } from './source-function-fixture.mjs';

// Standalone actual-Source regression; all application ports are fake and synthetic.
// Copy this file into app/tests beside the existing unchanged source-function-fixture.mjs.
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(['--password-source', '--governance-source'].includes(process.argv[i]));
  assert(process.argv[i + 1] && !options.has(process.argv[i]));
  options.set(process.argv[i], process.argv[i + 1]);
}
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
const passwordPath = options.get('--password-source') || path.join(defaultRoot, 'provider.js');
const governancePath = options.get('--governance-source') || path.join(defaultRoot, 'data-governance.js');
const passwordSource = fs.readFileSync(passwordPath, 'utf8');
const governanceSource = fs.readFileSync(governancePath, 'utf8');
const passwordDeclaration = extractFunctionDeclaration(passwordSource, 'changePassword');
const sha = value => createHash('sha256').update(value).digest('hex');
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const cases = [];
const test = async (name, run) => { try { await run(); cases.push({ name, status: 'PASS' }); } catch { cases.push({ name, status: 'FAIL' }); } };

function governanceFixture() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, hidden: false, textContent: '', innerHTML: '', dataset: {} });
    return elements.get(id);
  };
  $('#dataExportFrom').value = '2026-10-01'; $('#dataExportTo').value = '2026-10-02';
  const calls = [];
  const context = vm.createContext({ window: {} });
  new vm.Script(governanceSource, { filename: 'actual-data-governance.js' }).runInContext(context);
  const controller = context.window.MinutaDataGovernance.createController({
    $,
    db: { rpc(name, params) {
      assert.equal(name, 'get_minuta_data_governance_workspace_v110', 'only a synthetic workspace-read port');
      const pending = deferred(); calls.push({ name, org: params.p_organization, pending }); return pending.promise;
    } },
    escapeHtml: value => String(value), notify() { assert.fail('no action port allowed'); }
  });
  const complete = (index, role, value) => calls[index].pending.resolve({ data: { role, settings: { booking_retention_months: value }, recent_access: [], requests: [] }, error: null });
  const view = () => ({ owner: $('#dataGovernanceCard').dataset.owner, disabled: $('#bookingRetentionMonths').disabled, value: $('#bookingRetentionMonths').value });
  return { controller, complete, view, $, calls };
}
await test('data current owner control', async () => {
  const f = governanceFixture(); f.controller.setOrganization({ id: 'SYNTHETIC_A', current_role: 'owner' });
  f.complete(0, 'owner', 101); await flush();
  assert.deepEqual(f.view(), { owner: 'true', disabled: false, value: 101 });
});
await test('data current viewer control', async () => {
  const f = governanceFixture(); f.controller.setOrganization({ id: 'SYNTHETIC_B', current_role: 'viewer' });
  f.complete(0, 'viewer', 202); await flush();
  assert.deepEqual(f.view(), { owner: 'false', disabled: true, value: 202 });
});
await test('data old organization result cannot replace current viewer', async () => {
  const f = governanceFixture();
  f.controller.setOrganization({ id: 'SYNTHETIC_A', current_role: 'owner' });
  f.controller.setOrganization({ id: 'SYNTHETIC_B', current_role: 'viewer' });
  f.complete(1, 'viewer', 202); await flush(); f.complete(0, 'owner', 101); await flush();
  assert.deepEqual(f.view(), { owner: 'false', disabled: true, value: 202 });
});
await test('data reset disables controls and rejects late response', async () => {
  const f = governanceFixture();
  f.controller.setOrganization({ id: 'SYNTHETIC_A', current_role: 'owner' }); f.complete(0, 'owner', 101); await flush();
  f.controller.setOrganization({ id: 'SYNTHETIC_A', current_role: 'owner' }); f.controller.setOrganization(null);
  const disabledImmediately = f.view().disabled;
  f.complete(1, 'owner', 303); await flush();
  assert(disabledImmediately); assert.equal(f.view().owner, 'false'); assert(f.view().disabled);
});
await test('data role change cannot publish an obsolete owner response', async () => {
  const f = governanceFixture(); const org = { id: 'SYNTHETIC_A', current_role: 'owner' };
  f.controller.setOrganization(org); org.current_role = 'viewer'; f.complete(0, 'owner', 101); await flush();
  assert.equal(f.view().owner, 'false'); assert(f.view().disabled);
});
await test('data latest same-organization load wins', async () => {
  const f = governanceFixture(); const org = { id: 'SYNTHETIC_A', current_role: 'owner' };
  f.controller.setOrganization(org); f.controller.setOrganization(org);
  f.complete(1, 'owner', 202); await flush(); f.complete(0, 'owner', 101); await flush();
  assert.deepEqual(f.view(), { owner: 'true', disabled: false, value: 202 });
});

function passwordFixture({ deferredUpdate = false } = {}) {
  const signIns = []; const update = deferred();
  const button = { disabled: false, textContent: 'Сохранить новый пароль' };
  const nodes = new Map([['#currentPassword', { value: 'synthetic-old-1' }], ['#newPassword', { value: 'synthetic-new-2' }], ['#confirmPassword', { value: 'synthetic-new-2' }]]);
  const observations = { updates: [], resets: 0, notifications: 0, errors: 0 };
  const context = vm.createContext({
    currentUser: { id: 'SYNTHETIC_A', email: 'synthetic-a@example.invalid' }, sessionGeneration: 1,
    $: id => { assert(nodes.has(id)); return nodes.get(id); },
    clearFormError() {}, showFormError() { observations.errors += 1; }, notify() { observations.notifications += 1; }
  });
  context.sessionIsCurrent = (id, generation) => context.currentUser?.id === id && context.sessionGeneration === generation;
  context.db = { auth: {
    signInWithPassword(payload) {
      assert.deepEqual(Object.keys(payload).sort(), ['email', 'password']);
      assert.equal(payload.email, context.currentUser.email); assert.equal(payload.password, 'synthetic-old-1');
      const pending = deferred(); signIns.push(pending); return pending.promise;
    },
    updateUser(payload) {
      assert.deepEqual(Object.keys(payload), ['password']); assert.equal(payload.password, 'synthetic-new-2');
      observations.updates.push(context.currentUser?.id || null);
      return deferredUpdate ? update.promise : Promise.resolve({ error: null });
    }
  } };
  new vm.Script(`${passwordDeclaration}\nthis.invoke = changePassword;`, { filename: 'actual-changePassword.js' }).runInContext(context);
  const event = { preventDefault() {}, submitter: button, target: { reset() { observations.resets += 1; } } };
  const changeActor = () => { context.currentUser = { id: 'SYNTHETIC_B', email: 'synthetic-b@example.invalid' }; context.sessionGeneration += 1; };
  return { context, observations, signIns, update, event, button, changeActor };
}
await test('password current actor control and exact payloads', async () => {
  const f = passwordFixture(); const run = f.context.invoke(f.event); f.signIns[0].resolve({ error: null }); await run;
  assert.deepEqual(f.observations.updates, ['SYNTHETIC_A']); assert.equal(f.observations.resets, 1); assert.equal(f.observations.notifications, 1); assert.equal(f.button.disabled, false);
});
await test('password actor change after reauth refuses next write', async () => {
  const f = passwordFixture(); const run = f.context.invoke(f.event); f.changeActor(); f.signIns[0].resolve({ error: null }); await run;
  assert.equal(f.observations.updates.length, 0); assert.equal(f.observations.resets, 0); assert.equal(f.observations.notifications, 0); assert.equal(f.button.disabled, false);
});
await test('password actor change after update suppresses stale reset and success', async () => {
  const f = passwordFixture({ deferredUpdate: true }); const run = f.context.invoke(f.event); f.signIns[0].resolve({ error: null }); await flush();
  f.changeActor(); f.update.resolve({ error: null }); await run;
  assert.deepEqual(f.observations.updates, ['SYNTHETIC_A']); assert.equal(f.observations.resets, 0); assert.equal(f.observations.notifications, 0); assert.equal(f.button.disabled, false);
});
await test('password old continuation cannot release a newer button owner', async () => {
  const f = passwordFixture(); const first = f.context.invoke(f.event); f.changeActor(); const second = f.context.invoke(f.event);
  f.signIns[0].resolve({ error: null }); await first; const secondStillPending = f.button.disabled;
  f.signIns[1].resolve({ error: null }); await second;
  assert(secondStillPending); assert.deepEqual(f.observations.updates, ['SYNTHETIC_B']); assert.equal(f.observations.notifications, 1); assert.equal(f.button.disabled, false);
});

const report = {
  format: 'PRO_SETTINGS_ACTUAL_SOURCE_REGRESSION_R1',
  status: cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL',
  counts: { total: cases.length, passed: cases.filter(item => item.status === 'PASS').length, failed: cases.filter(item => item.status === 'FAIL').length },
  sources: { passwordPath, passwordDeclarationBytes: Buffer.byteLength(passwordDeclaration), passwordDeclarationSha256: sha(passwordDeclaration), governancePath, governanceBytes: Buffer.byteLength(governanceSource), governanceSha256: sha(governanceSource) },
  cases,
  actual: { auth: 0, rpc: 0, export: 0, deletion: 0, purchase: 0, network: 0, browser: 0, applicationWrites: 0 }
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.counts.failed ? 1 : 0;
