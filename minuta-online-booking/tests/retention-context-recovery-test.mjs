import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../retention-management.js', import.meta.url), 'utf8');
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Element {
  constructor(id) {
    Object.assign(this, { id, hidden:false, disabled:false, checked:false, value:'', textContent:'', innerHTML:'',
      dataset:{}, listeners:new Map(), controls:[], parentForm:null });
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler); this.listeners.set(type, handlers);
  }
  dispatch(type, details = {}) {
    const event = { target:this, currentTarget:this, preventDefault() {}, ...details };
    return Promise.all((this.listeners.get(type) || []).map(handler => handler(event)));
  }
  querySelectorAll() { return this.controls; }
  querySelector() { return null; }
  closest(selector) { return selector === '#retentionSettingsForm' ? this.parentForm : null; }
  checkValidity() { return true; }
  reportValidity() { return true; }
}
function workspace(id) {
  return { organization_id:id, current_role:'owner', enabled:true, inactivity_days:45, cooldown_days:90,
    message_template:`Шаблон ${id} {ссылка}`,
    clients:[{ client_account_id:`client-${id}`, client_name:`Клиент ${id}`, client_phone:'+79990000000',
      last_visit_on:'2025-01-01', eligible:true, consent_status:'granted', completed_visits:1,
      performer_id:'performer-a', last_booking_id:'booking-a', last_sent_at:null }],
    deliveries:[], audit:[] };
}
// Exact v83 RPC outputs: mutations do not return the workspace.
function successData(name, args) {
  const scope = { organization_id:args.p_organization };
  if (name === 'save_minuta_retention_settings') return { ...scope, enabled:args.p_enabled };
  if (name === 'set_minuta_marketing_consent') return { ...scope, client_account_id:args.p_client_account, status:args.p_status };
  if (name === 'prepare_minuta_retention_delivery') return { ...scope, id:'delivery-a', client_phone:'+79990000000', message:'Приглашаем клиента снова', status:'prepared' };
  if (name === 'finish_minuta_retention_delivery') return { ...scope, id:args.p_delivery, status:args.p_action };
  return workspace(args.p_organization);
}
function fixture() {
  const ids = ['retentionPanel', 'retentionLoading', 'retentionUnavailable', 'retentionWorkspace',
    'retentionUnavailableText', 'retentionEnabled', 'retentionInactivityDays', 'retentionCooldownDays',
    'retentionMessageTemplate', 'retentionEligibleCount', 'retentionSaveStatus', 'retentionClientsList',
    'retentionDeliveriesList', 'retentionSettingsForm', 'prepare', 'finish', 'consent'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  elements.retentionPanel.controls = [elements.retentionEnabled, elements.retentionInactivityDays,
    elements.retentionCooldownDays, elements.retentionMessageTemplate, elements.prepare, elements.finish];
  for (const id of ['retentionEnabled', 'retentionInactivityDays', 'retentionCooldownDays', 'retentionMessageTemplate']) {
    elements[id].parentForm = elements.retentionSettingsForm;
  }
  const state = { user:'owner', generation:1 };
  const calls = [], notices = [];
  let override = () => undefined;
  const db = { rpc:async (name, args) => {
    calls.push({ name, args:JSON.parse(JSON.stringify(args)) });
    const reply = override(name, args);
    if (reply !== undefined) return reply;
    return { data:successData(name, args), error:null };
  } };
  const window = {};
  runInNewContext(source, { window, setTimeout, clearTimeout, confirm:() => true, console });
  const controller = window.MinutaRetention.createController({ db, $:selector => elements[selector.replace(/^#/, '')] || null,
    escapeHtml:value => String(value ?? ''), notify:message => notices.push(message), requireWrites:() => true,
    getCurrentUser:() => state.user ? { id:state.user } : null, getSessionGeneration:() => state.generation,
    sessionIsCurrent:(user, generation) => state.user === user && state.generation === generation,
    applyWriteAvailability() {} });
  controller.bind();
  return { controller, elements, state, calls, notices, override:handler => { override = handler; } };
}
const org = (id, role = 'owner') => ({ id, current_role:role });
const loads = f => f.calls.filter(call => call.name === 'get_minuta_retention_workspace').map(call => call.args.p_organization);
const save = f => f.elements.retentionPanel.dispatch('submit', { target:f.elements.retentionSettingsForm });
const prepare = f => f.elements.retentionPanel.dispatch('click', {
  target:{ closest:selector => selector === '[data-retention-prepare]' ? Object.assign(f.elements.prepare, { dataset:{ retentionPrepare:'client-org-a' } }) : null }
});
const finish = f => f.elements.retentionPanel.dispatch('click', {
  target:{ closest:selector => selector === '[data-retention-finish]' ? Object.assign(f.elements.finish, { dataset:{ retentionFinish:'delivery-a', retentionAction:'sent' } }) : null }
});
const consent = f => f.elements.retentionPanel.dispatch('change', {
  target:Object.assign(f.elements.consent, { dataset:{ retentionConsent:'client-org-a' }, value:'granted' })
});

for (const outcome of ['success', 'server-error', 'throw']) {
  test(`queued organization switch during settings ${outcome} hides A and loads B exactly once`, async () => {
    const f = fixture(), pending = deferred();
    await f.controller.setOrganization(org('org-a'));
    f.override(name => name === 'save_minuta_retention_settings' ? pending.promise : undefined);
    const request = save(f);
    await f.controller.setOrganization(org('org-b'));
    assert.equal(f.elements.retentionWorkspace.hidden, true, 'old client data must hide immediately');
    assert.equal(f.controller.payload, null);
    if (outcome === 'throw') pending.reject(new Error('connection lost'));
    else pending.resolve({ data:outcome === 'success' ? { organization_id:'org-a', enabled:true } : null,
      error:outcome === 'server-error' ? { code:'42501', message:'owner_required' } : null });
    await request;
    await flush();
    assert.deepEqual(loads(f), ['org-a', 'org-b']);
    assert.equal(f.controller.payload.organization_id, 'org-b');
    assert.equal(f.controller.availability, 'ready');
    assert.equal(f.elements.retentionWorkspace.hidden, false);
    assert.match(f.elements.retentionClientsList.innerHTML, /Клиент org-b/);
    assert.doesNotMatch(f.elements.retentionClientsList.innerHTML, /Клиент org-a/);
    assert.equal(f.elements.retentionSaveStatus.textContent, 'Изменения сохраняются автоматически');
    assert.deepEqual(f.notices, []);
  });
}

test('queued A to B to C switch applies only the final organization', async () => {
  const f = fixture(), pending = deferred();
  await f.controller.setOrganization(org('org-a'));
  f.override(name => name === 'prepare_minuta_retention_delivery' ? pending.promise : undefined);
  const request = prepare(f);
  await f.controller.setOrganization(org('org-b'));
  await f.controller.setOrganization(org('org-c'));
  pending.resolve({ data:successData('prepare_minuta_retention_delivery', { p_organization:'org-a' }), error:null });
  await request;
  assert.deepEqual(loads(f), ['org-a', 'org-c']);
  assert.equal(f.controller.payload.organization_id, 'org-c');
  assert.deepEqual(f.notices, []);
});

for (const change of ['logout', 'revoked-role']) {
  test(`${change} during pending mutation cannot reopen the old workspace or announce success`, async () => {
    const f = fixture(), pending = deferred();
    await f.controller.setOrganization(org('org-a'));
    f.override(name => name === 'finish_minuta_retention_delivery' ? pending.promise : undefined);
    const request = finish(f);
    if (change === 'logout') {
      f.state.user = null; f.state.generation += 1;
      await f.controller.setOrganization(null);
    } else await f.controller.setOrganization(org('org-a', 'specialist'));
    assert.equal(f.elements.retentionWorkspace.hidden, true);
    pending.resolve({ data:successData('finish_minuta_retention_delivery', { p_organization:'org-a', p_delivery:'delivery-a', p_action:'sent' }), error:null });
    await request;
    assert.deepEqual(loads(f), ['org-a']);
    assert.equal(f.controller.payload, null);
    assert.equal(f.elements.retentionPanel.hidden, true);
    assert.equal(f.elements.retentionWorkspace.hidden, true);
    assert.deepEqual(f.notices, []);
  });
}

test('reset and new account while old save is pending cannot contaminate the new workspace', async () => {
  const f = fixture(), pending = deferred();
  await f.controller.setOrganization(org('org-a'));
  f.override(name => name === 'save_minuta_retention_settings' ? pending.promise : undefined);
  const request = save(f);
  f.controller.reset();
  f.state.user = 'other-owner'; f.state.generation += 1;
  await f.controller.setOrganization(org('org-b'));
  pending.resolve({ data:{ organization_id:'org-a', enabled:true }, error:null });
  await request;
  await flush();
  assert.deepEqual(loads(f), ['org-a', 'org-b']);
  assert.equal(f.controller.payload.organization_id, 'org-b');
  assert.equal(f.elements.retentionMessageTemplate.value, 'Шаблон org-b {ссылка}');
  assert.equal(f.elements.retentionSaveStatus.textContent, 'Изменения сохраняются автоматически');
  assert.deepEqual(f.notices, []);
});

for (const [label, rpc, action] of [
  ['settings', 'save_minuta_retention_settings', save],
  ['prepare', 'prepare_minuta_retention_delivery', prepare],
  ['finish', 'finish_minuta_retention_delivery', finish],
  ['consent', 'set_minuta_marketing_consent', consent]
]) {
  test(`thrown ${label} RPC releases busy controls and allows a later user retry`, async () => {
    const f = fixture();
    await f.controller.setOrganization(org('org-a'));
    f.override(name => { if (name === rpc) throw new Error('connection lost'); });
    await action(f);
    assert.equal(f.elements.prepare.disabled, false);
    assert.equal(f.elements.retentionEnabled.disabled, false);
    assert.equal(f.notices.length, 1);
    f.override(() => undefined);
    await action(f);
    assert.equal(f.calls.filter(call => call.name === rpc).length, 2, 'recovery must not leave the internal writing flag stuck');
    await f.controller.setOrganization(org('org-b'));
    assert.equal(f.controller.payload.organization_id, 'org-b');
    assert.equal(f.controller.availability, 'ready');
  });
}

test('thrown workspace load exits loading and a fresh load recovers', async () => {
  const f = fixture();
  f.override(() => { throw new Error('offline'); });
  await f.controller.setOrganization(org('org-a'));
  assert.equal(f.controller.availability, 'error');
  assert.equal(f.elements.retentionLoading.hidden, true);
  assert.equal(f.elements.retentionUnavailable.hidden, false);
  assert.equal(f.elements.retentionWorkspace.hidden, true);
  f.override(() => undefined);
  await f.controller.load();
  assert.equal(f.controller.availability, 'ready');
  assert.equal(f.elements.retentionWorkspace.hidden, false);
});

test('late workspace response cannot replace the newer organization', async () => {
  const f = fixture(), pending = deferred();
  f.override((name, args) => name === 'get_minuta_retention_workspace' && args.p_organization === 'org-a' ? pending.promise : undefined);
  const first = f.controller.setOrganization(org('org-a'));
  await f.controller.setOrganization(org('org-b'));
  pending.resolve({ data:workspace('org-a'), error:null });
  await first;
  assert.equal(f.controller.payload.organization_id, 'org-b');
  assert.doesNotMatch(f.elements.retentionClientsList.innerHTML, /Клиент org-a/);
});

test('settings payload records the submitted snapshot rather than later DOM edits', async () => {
  const f = fixture(), pending = deferred();
  await f.controller.setOrganization(org('org-a'));
  f.elements.retentionMessageTemplate.value = 'Отправленный шаблон {ссылка}';
  f.elements.retentionInactivityDays.value = '50';
  f.override(name => name === 'save_minuta_retention_settings' ? pending.promise : undefined);
  const request = save(f);
  f.elements.retentionMessageTemplate.value = 'Несохранённый шаблон {ссылка}';
  f.elements.retentionInactivityDays.value = '60';
  pending.resolve({ data:{ organization_id:'org-a', enabled:true }, error:null });
  await request;
  assert.equal(f.controller.payload.message_template, 'Отправленный шаблон {ссылка}');
  assert.equal(f.controller.payload.inactivity_days, 50);
});

test('old write finishing after reset cannot unlock a new write in another session', async () => {
  const f = fixture(), oldWrite = deferred(), newWrite = deferred();
  await f.controller.setOrganization(org('org-a'));
  f.override((name, args) => name === 'save_minuta_retention_settings'
    ? args.p_organization === 'org-a' ? oldWrite.promise : newWrite.promise : undefined);
  const oldRequest = save(f);
  f.controller.reset();
  f.state.user = 'other-owner'; f.state.generation += 1;
  await f.controller.setOrganization(org('org-b'));
  const newRequest = save(f);
  assert.equal(f.elements.retentionEnabled.disabled, true);
  oldWrite.resolve({ data:{ organization_id:'org-a', enabled:true }, error:null });
  await oldRequest;
  assert.equal(f.elements.retentionEnabled.disabled, true, 'old completion must not release new write controls');
  assert.deepEqual(f.notices, []);
  newWrite.resolve({ data:{ organization_id:'org-b', enabled:true }, error:null });
  await newRequest;
  assert.equal(f.elements.retentionEnabled.disabled, false);
  assert.equal(f.controller.payload.organization_id, 'org-b');
});

for (const [label, invalid] of [
  ['empty response', () => null],
  ['empty envelope', () => ({})],
  ['null data', () => ({ data:null, error:null })],
  ['missing workspace fields', () => ({ data:{ organization_id:'org-a' }, error:null })],
  ['null client row', () => ({ data:{ ...workspace('org-a'), clients:[null] }, error:null })],
  ['null delivery row', () => ({ data:{ ...workspace('org-a'), deliveries:[null] }, error:null })],
  ['non-array clients', () => ({ data:{ ...workspace('org-a'), clients:{} }, error:null })],
  ['missing message template', () => { const data = workspace('org-a'); delete data.message_template; return { data, error:null }; }]
]) {
  test(`malformed load: ${label} fails closed and the next valid load recovers`, async () => {
    const f = fixture();
    f.override(invalid);
    await f.controller.setOrganization(org('org-a'));
    assert.equal(f.controller.availability, 'error');
    assert.equal(f.controller.payload, null);
    assert.equal(f.elements.retentionLoading.hidden, true);
    assert.equal(f.elements.retentionWorkspace.hidden, true);
    assert.equal(f.elements.retentionUnavailable.hidden, false);
    f.override(() => undefined);
    await f.controller.load();
    assert.equal(f.controller.availability, 'ready');
    assert.equal(f.elements.retentionWorkspace.hidden, false);
  });
}

test('SQL nullable eligible and absent visit dates remain valid client rows', async () => {
  const f = fixture(), data = workspace('org-a');
  Object.assign(data.clients[0], { eligible:null, consent_status:'unknown', last_visit_on:null, last_sent_at:null, completed_visits:0 });
  f.override(() => ({ data, error:null }));
  await f.controller.setOrganization(org('org-a'));
  assert.equal(f.controller.availability, 'ready');
  assert.doesNotMatch(f.elements.retentionClientsList.innerHTML, /data-retention-prepare/);
});

test('real nonempty v83 delivery and audit records render without extra schema requirements', async () => {
  const f = fixture(), data = workspace('org-a');
  data.deliveries = [{ id:'delivery-a', client_account_id:'client-org-a', channel:'whatsapp',
    status:'prepared', message_snapshot:'Приглашение для клиента', prepared_at:'2026-09-05T10:00:00Z', sent_at:null }];
  data.audit = [{ id:'audit-a', action:'retention_settings_saved', subject_id:null, created_at:'2026-09-05T10:00:00Z' }];
  f.override(() => ({ data, error:null }));
  await f.controller.setOrganization(org('org-a'));
  assert.equal(f.controller.availability, 'ready');
  assert.match(f.elements.retentionDeliveriesList.innerHTML, /data-retention-finish="delivery-a"/);
});

test('organization switch during error recovery load suppresses the old failure notice', async () => {
  const f = fixture(), recovery = deferred();
  await f.controller.setOrganization(org('org-a'));
  f.override((name, args) => {
    if (name === 'prepare_minuta_retention_delivery') return { data:null, error:{ code:'P0001', message:'retention_cooldown_active' } };
    if (name === 'get_minuta_retention_workspace' && args.p_organization === 'org-a') return recovery.promise;
  });
  const request = prepare(f);
  await flush();
  assert.equal(f.controller.availability, 'loading');
  await f.controller.setOrganization(org('org-b'));
  recovery.resolve({ data:workspace('org-a'), error:null });
  await request;
  assert.equal(f.controller.payload.organization_id, 'org-b');
  assert.deepEqual(f.notices, []);
  assert.deepEqual(loads(f), ['org-a', 'org-a', 'org-b']);
});

for (const [label, rpc, action] of [
  ['save', 'save_minuta_retention_settings', save],
  ['consent', 'set_minuta_marketing_consent', consent],
  ['prepare', 'prepare_minuta_retention_delivery', prepare],
  ['finish', 'finish_minuta_retention_delivery', finish]
]) {
  test(`partial ${label} response is not success; exact v83 response permits recovery`, async () => {
    const f = fixture();
    await f.controller.setOrganization(org('org-a'));
    f.override(name => name === rpc ? { data:{ organization_id:'org-a' }, error:null } : undefined);
    await action(f);
    assert.equal(f.elements.retentionEnabled.disabled, false);
    assert.doesNotMatch(f.notices.join(' '), /Настройки возврата клиентов сохранены|Согласие клиента обновлено|Сообщение подготовлено|Отправка отмечена/);
    assert.notEqual(f.elements.retentionSaveStatus.textContent, 'Сохранено автоматически');
    assert.equal(f.controller.availability, 'ready', 'recover from authoritative workspace');
    f.override(() => undefined);
    await action(f);
    assert.equal(f.calls.filter(call => call.name === rpc).length, 2);
    if (label === 'save') assert.equal(f.elements.retentionSaveStatus.textContent, 'Сохранено автоматически');
    else assert.equal(f.notices.length, 2, 'one failure followed by one true success');
  });
}
