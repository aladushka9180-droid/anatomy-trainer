import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// No network, accounts or real records. Exercise the actual controller event handlers.
const source = readFileSync(new URL('../shift-management.js', import.meta.url), 'utf8');
function harness({ mutationTimeoutMs = 40 } = {}) {
  const nodes = new Map(), handlers = {}, calls = [], notices = [];
  let actor = 'actor-a', generation = 1, writeImpl = async () => ({ data: true });
  let readImpl = null;
  const submit = { disabled: false, textContent: 'Создать смену' };
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', hidden: true, checked: false, disabled: false, dataset: {}, textContent: '', innerHTML: '', open: false,
      querySelectorAll: () => [], querySelector: () => id === 'shiftSubstitutionPanel' ? { disabled: false } : submit, reset() {}, scrollIntoView() {} });
    return nodes.get(id);
  };
  const payload = { organization_id: 'org-a', current_role: 'owner', can_manage_team: true, enabled: false,
    locations: [{ id: 'l1', name: 'Учебный', active: true }], performers: [{ id: 'p1', display_name: 'Учебный' }],
    shifts: [], absences: [], services: [], bookings: [], utilization: [], audit: [] };
  const runtime = { Date, setTimeout, clearTimeout, AbortController, window: {},
    document: { querySelector: s => node(s.slice(1)), addEventListener: (name, fn) => { handlers[name] = fn; } } };
  vm.runInNewContext(source, runtime);
  node('shiftStartDate').value = node('shiftDate').value = '2099-10-15'; node('shiftPeriod').value = '7';
  node('shiftStart').value = '10:00'; node('shiftEnd').value = '18:00'; node('shiftLocation').value = 'l1'; node('shiftPerformer').value = 'p1';
  const controller = runtime.window.MinutaShifts.createController({
    db: { rpc(name, p) { calls.push({ name, p }); return name === 'get_minuta_shift_workspace'
      ? (readImpl ? readImpl(name, p) : Promise.resolve({ data: { ...payload, organization_id: p.p_organization } })) : writeImpl(name, p); } },
    escapeHtml: String, notify: x => notices.push(x), requireWrites: () => true, applyWriteAvailability() {}, mutationTimeoutMs,
    getCurrentUser: () => ({ id: actor }), getSessionGeneration: () => generation, sessionIsCurrent: (id, g) => id === actor && g === generation
  });
  controller.bind();
  return { controller, node, submit, calls, notices, payload, read(fn) { readImpl = fn; }, write(fn) { writeImpl = fn; }, changeActor() { actor = 'actor-b'; generation++; }, renewSession() { generation++; },
    save: (absence = false) => handlers.submit({ target: { id: absence ? 'absenceForm' : 'shiftForm' }, preventDefault() {}, submitter: submit }),
    open: (absence = false) => handlers.click({ target: { closest: s => s === (absence ? '[data-absence-new]' : '[data-shift-new]') ? { dataset: {} } : null } }),
    cancel: (absence = false) => handlers.click({ target: { closest: s => s === (absence ? '[data-cancel-absence]' : '[data-cancel-shift]')
      ? { dataset: absence ? { cancelAbsence: 'missing' } : { cancelShift: 'missing' }, disabled: false, textContent: 'Отменить' } : null } }),
    disable: () => handlers.change({ target: { id: 'shiftSchedulingEnabled', checked: false } }) };
}
const writes = h => h.calls.filter(c => c.name !== 'get_minuta_shift_workspace');
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' });
  h.write(async () => { throw Error('transport rejected'); }); await h.save();
  assert.equal(h.submit.textContent, 'Создать смену'); assert.equal(h.submit.disabled, false);
  assert.match(h.node('shiftError').textContent, /Не удалось подтвердить результат/); assert.equal(writes(h).length, 1);
  h.write(async () => ({ data: 'created' })); await h.save(); assert.equal(writes(h).length, 2, 'a deliberate retry is possible');
}
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' });
  let finish, signal;
  h.write(() => { const request = new Promise(resolve => { finish = resolve; }); request.abortSignal = s => { signal = s; return request; }; return request; });
  await h.save(); assert.equal(signal.aborted, true); assert.equal(h.submit.disabled, false); assert.equal(h.submit.textContent, 'Создать смену');
  assert.equal(writes(h).length, 1, 'unknown writes must never be retried automatically');
  assert.match(h.node('shiftError').textContent, /Не удалось подтвердить результат/);
  finish({ data: 'late-created' }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(h.notices.includes('Смена добавлена'), false, 'late success must not replace the unknown result');
}
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' }); h.node('shiftNote').value = 'Не терять черновик';
  h.write(async () => {
    h.payload.shifts = [{ id: 'created', performer_id: 'p1', location_id: 'l1', shift_date: '2099-10-15', start_time: '10:00', end_time: '18:00', active: true }];
    return { error: { message: 'Failed to fetch' } };
  });
  await h.save(); assert.match(h.node('shiftsList').innerHTML, /created/); assert.equal(writes(h).length, 1);
  assert.match(h.node('shiftError').textContent, /Не удалось подтвердить результат/);
  assert.doesNotMatch(h.node('shiftError').textContent, /не сохранено|не затронуты/); assert.equal(h.node('shiftNote').value, 'Не терять черновик');
}
for (const absence of [false, true]) {
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' }); h.write(async () => ({ data: false })); await h.cancel(absence);
  assert.match(h.notices.at(-1), /Отмена не выполнена/); assert.equal(h.notices.includes(absence ? 'Отсутствие отменено' : 'Смена отменена'), false);
  h.write(async () => ({ data: true })); await h.cancel(absence); assert.equal(h.notices.at(-1), absence ? 'Отсутствие отменено' : 'Смена отменена');
}
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' }); h.write(async () => undefined); await h.save();
  assert.equal(h.notices.includes('Смена добавлена'), false); assert.match(h.node('shiftError').textContent, /Не удалось подтвердить результат/);
}
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' }); h.write(async () => ({ data: false })); await h.disable();
  assert.equal(h.notices.at(-1), 'Учёт смен при онлайн-записи выключен', 'false is the valid disabled state, not a failed cancellation');
}
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' });
  h.write(async () => ({ error: { code: 'P0001', message: 'shift_change_conflicts_with_booking' } })); await h.save();
  assert.match(h.node('shiftError').textContent, /действующую запись вне рабочего времени или на перерыве/);
}
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' }); let finish;
  h.write(() => new Promise(resolve => { finish = resolve; })); const save = h.save();
  await h.controller.setOrganization({ id: 'org-b' }); finish({ data: 'old' }); await save;
  assert.equal(h.calls.at(-1).p.p_organization, 'org-b'); assert.equal(h.notices.length, 0);
}
{
  const h = harness(); await h.controller.setOrganization({ id: 'org-a' }); let finishOld, finishNew;
  h.write(() => new Promise(resolve => { finishOld = resolve; })); const old = h.save();
  h.controller.reset(); h.changeActor(); await h.controller.setOrganization({ id: 'org-b' });
  h.write(() => new Promise(resolve => { finishNew = resolve; })); const newer = h.save();
  finishOld({ data: 'old' }); await old; await h.save();
  assert.equal(writes(h).length, 2, 'old completion must not release the newer operation');
  finishNew({ data: 'new' }); await newer; assert.equal(h.submit.textContent, 'Создать смену');
}
async function savedWithRefreshHeld(absence) {
  const h = harness({ mutationTimeoutMs: 1000 });
  await h.controller.setOrganization({ id: 'org-a' });
  await h.open(absence);
  const note = absence ? 'absenceNote' : 'shiftNote';
  h.node(note).value = 'Исходный подтверждённый запрос';
  let finishRead;
  h.read(() => new Promise(resolve => { finishRead = resolve; }));
  h.write(async () => ({ data: 'confirmed-old' }));
  const save = h.save(absence);
  for (let i = 0; i < 20 && !finishRead; i++) await Promise.resolve();
  assert.ok(finishRead, 'post-write refresh began');
  h.read(null);
  return { h, save, note, creator: absence ? 'absenceCreator' : 'shiftCreator', finishRead: () => finishRead({ data: { ...h.payload, organization_id: 'org-a' } }) };
}
for (const absence of [false, true]) {
  for (const change of ['actor', 'organization', 'session', 'same-context']) {
    const { h, save, note, creator, finishRead } = await savedWithRefreshHeld(absence);
    if (change === 'actor' || change === 'session') h.controller.reset();
    if (change === 'actor') h.changeActor();
    if (change === 'session') h.renewSession();
    if (change === 'same-context') await h.controller.load();
    else await h.controller.setOrganization({ id: change === 'session' ? 'org-a' : 'org-b' });
    await h.open(absence);
    h.node(note).value = 'Новый несохранённый черновик';
    finishRead(); await save;
    assert.equal(h.node(note).value, 'Новый несохранённый черновик', `${absence}/${change}: old refresh must not clear a new draft`);
    assert.equal(h.node(creator).open, true, `${absence}/${change}: old refresh must not close a new form`);
    assert.equal(writes(h).length, 1, 'no implicit second mutation');
  }
  {
    const { h, save, note, creator, finishRead } = await savedWithRefreshHeld(absence);
    await h.controller.load(); await h.open(absence);
    h.node(note).value = 'Новый запрос ещё сохраняется';
    let finishNewWrite;
    h.write(() => new Promise(resolve => { finishNewWrite = resolve; }));
    const newer = h.save(absence);
    finishRead(); await save;
    assert.equal(h.node(note).value, 'Новый запрос ещё сохраняется');
    assert.equal(h.node(creator).open, true);
    assert.equal(h.submit.textContent, 'Сохраняем…', 'old refresh must not relabel a newer write');
    assert.equal(h.submit.disabled, true);
    finishNewWrite({ data: 'confirmed-new' }); await newer;
    assert.equal(writes(h).length, 2);
    assert.equal(h.node(note).value, ''); assert.equal(h.node(creator).open, false);
  }
  {
    const h = harness(); await h.controller.setOrganization({ id: 'org-a' }); await h.open(absence);
    const note = absence ? 'absenceNote' : 'shiftNote'; h.node(note).value = 'Подтверждённый запрос';
    h.write(async () => ({ data: 'confirmed' })); h.read(async () => ({ error: { message: 'refresh unavailable' } }));
    await h.save(absence);
    assert.equal(h.node(note).value, '', 'confirmed write still completes when its subsequent read fails');
    assert.equal(h.node(absence ? 'absenceCreator' : 'shiftCreator').open, false);
  }
}
console.log('Shift mutation recovery: rejection, timeout, lost response, false cancellation, conflict, session ownership and post-write draft ownership passed');
