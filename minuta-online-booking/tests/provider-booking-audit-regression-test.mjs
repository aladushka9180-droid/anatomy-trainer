import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, basename, dirname } from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { extractFunctionDeclaration } from './source-function-fixture.mjs';

// Read public Source only. Never import the application or use a real browser,
// storage, clock, network, database, worker, or mutation transport.
const providerPath = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL('../provider.js', import.meta.url));
assert.equal(basename(providerPath), 'provider.js');
const bytes = readFileSync(providerPath);
assert.ok(bytes.length > 0 && bytes.length <= 2_000_000);
const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
console.log(`provider Source SHA256 ${createHash('sha256').update(bytes).digest('hex')}`);

function functionSource(name) {
  const matches = [...source.matchAll(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'gm'))];
  assert.equal(matches.length, 1, `one real ${name} declaration`);
  assert.ok(matches[0][0].length < 16_384);
  return matches[0][0];
}

const setJournalMode = functionSource('setJournalMode');
const offlineCandidateSlots = functionSource('offlineCandidateSlots');
const businessClock = functionSource('businessClock');
const businessTodayIso = functionSource('businessTodayIso');
const saveSchedule = functionSource('saveSchedule');
const addDayOff = functionSource('addDayOff');
const toggleMonthlyScheduleDay = functionSource('toggleMonthlyScheduleDay');
const restoreMonthlyScheduleDate = functionSource('restoreMonthlyScheduleDate');
const vmOptions = { codeGeneration: { strings: false, wasm: false } };
const run = (context, script) => new vm.Script(script).runInContext(context, { timeout: 500 });

function checkJournal(mode, storageError, initialFilter, expectedMode, expectedFilter) {
  const calls = [];
  const filterButtons = ['day', 'all'].map(filter => ({
    dataset: { filter },
    classList: { toggle(name, active) { calls.push(['class', filter, name, active]); } },
    setAttribute(name, value) { calls.push(['attribute', filter, name, value]); }
  }));
  const context = vm.createContext({
    localStorage: {
      setItem(key, value) {
        calls.push(['persist', key, value]);
        if (storageError) throw Object.freeze({ name: storageError });
      }
    },
    $$: selector => {
      assert.equal(selector, '[data-filter]');
      return filterButtons;
    },
    updateJournalModeButtons() { calls.push(['buttons']); },
    updateBookingQueryTools() { calls.push(['query']); },
    syncScheduleContextHistory() { calls.push(['history']); },
    renderBookings() { calls.push(['render']); }
  }, vmOptions);
  assert.doesNotThrow(() => run(context, `
    let journalMode = 'timeline', currentFilter = ${JSON.stringify(initialFilter)};
    const JOURNAL_MODE_KEY = 'SYNTHETIC_JOURNAL', SCHEDULE_FILTER_KEY = 'SYNTHETIC_FILTER';
    ${setJournalMode}
    setJournalMode(${JSON.stringify(mode)});
  `), 'storage failure must not interrupt the in-memory mode or render');
  assert.equal(run(context, 'journalMode'), expectedMode);
  assert.equal(run(context, 'currentFilter'), expectedFilter);
  assert.equal(calls.filter(row => row[0] === 'persist').length, 2);
  for (const step of ['buttons', 'query', 'history', 'render']) {
    assert.equal(calls.filter(row => row[0] === step).length, 1, `${step} runs once`);
  }
  for (const filter of ['day', 'all']) {
    assert.ok(calls.some(row => row[0] === 'attribute' && row[1] === filter
      && row[2] === 'aria-pressed' && row[3] === String(filter === expectedFilter)));
  }
}

test('list retains the current filter when persistence succeeds', () => {
  checkJournal('list', null, 'all', 'list', 'all');
});
test('timeline retains its ordinary day-filter behavior', () => {
  checkJournal('timeline', null, 'all', 'timeline', 'day');
});
test('quota failure cannot interrupt list mode or rendering', () => {
  checkJournal('list', 'QuotaExceededError', 'all', 'list', 'all');
});
test('security failure cannot interrupt fallback timeline mode or rendering', () => {
  checkJournal('invalid-mode', 'SecurityError', 'all', 'timeline', 'day');
});

const fixedInstant = '2026-10-17T08:00:00.000Z'; // Samara business time 12:00.
function checkOfflineSlots(deviceOffset) {
  const NativeDate = Date;
  class SyntheticDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixedInstant])); }
    getHours() { return (super.getUTCHours() + deviceOffset + 24) % 24; }
    getMinutes() { return super.getUTCMinutes(); }
  }
  const context = vm.createContext({
    Date: SyntheticDate, Intl,
    ownServices: [{ id: 'SYNTHETIC_SERVICE', active: true, duration_minutes: 60 }],
    parseLocalIsoDate: date => date === '2026-10-17' ? { getDay: () => 6 } : null,
    scheduleRows: [{ weekday: 6, enabled: true, start_time: '10:00', end_time: '16:00' }],
    minutesFromTime: value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)),
    timeFromMinutes: value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`,
    NEW_BOOKING_GRID_MINUTES: 30,
    bookingPlacementIssue: () => '',
    offlineBookingQueue: [], editingOfflineBookingId: null
  }, vmOptions);
  const result = run(context, `${businessTodayIso}\n${businessClock}\n${offlineCandidateSlots}
    offlineCandidateSlots('SYNTHETIC_SERVICE', '2026-10-17');`);
  assert.deepEqual(Array.from(result), ['12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00']);
}

for (const offset of [0, 4, 7]) {
  test(`offline today uses the business clock with synthetic device UTC+${offset}`, () => {
    checkOfflineSlots(offset);
  });
}

test('the real businessClock keeps its explicit Date parameter', () => {
  const context = vm.createContext({ Intl, Date }, vmOptions);
  const actual = run(context, `${businessClock}
    [businessClock(new Date('2026-10-17T08:17:00Z')),
     businessClock(new Date('2026-10-17T10:42:00Z'))];`);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), [
    { minutes: 737, label: '12:17' }, { minutes: 882, label: '14:42' }
  ]);
});

async function checkScheduleCacheContinuation(rotateSession) {
  let releaseCache, cacheEntered;
  const entered = new Promise(resolve => { cacheEntered = resolve; });
  const cache = new Promise(resolve => { releaseCache = resolve; });
  const rows = Array.from({ length: 7 }, (_, index) => ({
    weekday: index + 1, enabled: true, start_time: '10:00', end_time: '18:00',
    break_start: null, break_end: null, slot_interval_minutes: 5,
    performer_id: 'SYNTHETIC_ACTOR_A'
  }));
  const button = { dataset: {}, textContent: 'Сохранить' };
  const status = { dataset: {}, textContent: 'CURRENT_CONTEXT_UNSAVED' };
  let renders = 0, notifications = 0, scopeCurrent = true;
  const context = vm.createContext({
    requireWrites: () => true,
    currentUser: { id: 'SYNTHETIC_ACTOR_A' }, sessionGeneration: 1,
    clearFormError() {}, scheduleRowsFromForm: () => rows,
    $: selector => {
      if (selector === '#saveSchedule') return button;
      if (selector === '#scheduleQuickStatus') return status;
      throw new Error('UNEXPECTED_SYNTHETIC_SELECTOR');
    },
    updateScheduleSaveState() {}, setScheduleSaveError() {}, showFormError() {},
    db: { from(relation) {
      assert.equal(relation, 'provider_schedule');
      return {
        select: () => ({ eq: () => ({ order: async () => ({ data: rows, error: null }) }) }),
        upsert: async () => ({ error: null })
      };
    } },
    sessionIsCurrent: () => scopeCurrent,
    comparableSchedule: value => value,
    scheduleRows: rows, setScheduleDirty() {},
    saveProviderCache(name, savedRows, actor) {
      assert.equal(name, 'schedule');
      assert.equal(actor, 'SYNTHETIC_ACTOR_A');
      assert.equal(savedRows.length, 7);
      cacheEntered();
      return cache;
    },
    renderMonthlySchedule() { renders += 1; },
    notify() { notifications += 1; }
  }, vmOptions);
  const pending = run(context, `${saveSchedule}\nsaveSchedule();`);
  await entered;
  assert.equal(renders, 0);
  if (rotateSession) scopeCurrent = false;
  releaseCache(null);
  await pending;
  assert.equal(renders, rotateSession ? 0 : 1, 'a stale cache continuation must not render the current calendar');
  assert.equal(status.textContent, rotateSession ? 'CURRENT_CONTEXT_UNSAVED' : 'Расписание сохранено.');
  assert.equal(notifications, rotateSession ? 0 : 1);
}

test('schedule cache continuation retains the current-session success', async () => {
  await checkScheduleCacheContinuation(false);
});
test('schedule cache continuation cannot mark or render a new session', async () => {
  await checkScheduleCacheContinuation(true);
});

async function checkBatchClientContinuation(change = 'none', afterCallback = false) {
  // Extract the actual two controller functions, retaining their shared lexical
  // client/organization/request state. All DOM and transport objects are fake.
  const batchBytes = readFileSync(resolve(dirname(providerPath), 'batch-bookings.js'));
  assert.ok(batchBytes.length > 0 && batchBytes.length < 100_000);
  const batchSource = new TextDecoder('utf-8', { fatal: true }).decode(batchBytes);
  const extract = name => extractFunctionDeclaration(batchSource, name);
  let releaseRpc, requestEntered, releaseCallback, callbackEntered;
  const entered = new Promise(resolve => { requestEntered = resolve; });
  const rpc = new Promise(resolve => { releaseRpc = resolve; });
  const callbackStarted = new Promise(resolve => { callbackEntered = resolve; });
  const callback = new Promise(resolve => { releaseCallback = resolve; });
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: true, innerHTML: '', textContent: '', value: '' });
    return nodes.get(id);
  };
  const inputRow = index => ({
    dataset: { requestId: `SYNTHETIC_ITEM_${index}` },
    querySelector: selector => ({ value: ({
      '[data-batch-date]': `2026-10-${20 + index}`,
      '[data-batch-time]': '13:00', '[data-batch-comment]': ''
    })[selector] })
  });
  node('#batchBookingRows').querySelectorAll = () => [inputRow(0), inputRow(1)];
  node('#batchBookingLocation').value = 'SYNTHETIC_LOCATION';
  node('#batchBookingService').value = 'SYNTHETIC_SERVICE';
  node('#batchBookingComment').value = 'SYNTHETIC_DRAFT_A';
  let resets = 0, notified = 0, onCreatedCalls = 0, loads = 0;
  let actor = 'SYNTHETIC_ACTOR_A', generation = 1;
  const context = vm.createContext({
    requireWrites: () => true,
    getCurrentUser: () => ({ id: actor }),
    getSessionGeneration: () => generation,
    sessionIsCurrent: (userId, session) => actor === userId && generation === session,
    $: node, escapeHtml: value => String(value),
    db: { rpc(name, parameters) {
      assert.equal(name, 'create_minuta_batch_bookings');
      assert.equal(parameters.p_client_name, 'SYNTHETIC_CLIENT_A');
      requestEntered();
      return rpc;
    } },
    resetRows() { resets += 1; },
    render() {}, notify() { notified += 1; },
    onCreated: async () => {
      onCreatedCalls += 1;
      if (afterCallback) { callbackEntered(); await callback; }
    },
    load: async () => { loads += 1; },
    event: { preventDefault() {}, submitter: { dataset: {}, disabled: false, textContent: 'Создать весь пакет' } }
  }, vmOptions);
  run(context, `
    let client = {name:'SYNTHETIC_CLIENT_A',phone:'SYNTHETIC_PHONE_A'},
      organization = {id:'SYNTHETIC_ORGANIZATION'}, revision = 1,
      requestId = 'SYNTHETIC_DRAFT_ID_A';
    ${extract('setClient')}
    ${extract('createBatch')}
  `);
  const changeScope = () => {
    if (change === 'client') run(context, "setClient({name:'SYNTHETIC_CLIENT_B',phone:'SYNTHETIC_PHONE_B'});");
    if (change === 'actor') { actor = 'SYNTHETIC_ACTOR_B'; generation += 1; }
    if (change === 'organization') run(context, "organization = {id:'SYNTHETIC_ORGANIZATION_B'};");
    if (change === 'draft') run(context, "requestId = 'SYNTHETIC_DRAFT_ID_B';");
    if (change !== 'none') node('#batchBookingComment').value = 'SYNTHETIC_NEW_DRAFT_B';
  };
  const pending = run(context, 'createBatch(event);');
  await entered;
  if (!afterCallback) changeScope();
  let resetsBeforeCompletion = resets;
  releaseRpc({ data: { created_count: 2, created: [
    { date: '2026-10-20', time: '13:00' }, { date: '2026-10-21', time: '13:00' }
  ] }, error: null });
  if (afterCallback) {
    await callbackStarted;
    changeScope();
    resetsBeforeCompletion = resets;
    releaseCallback();
  }
  await pending;
  const obsolete = change !== 'none';
  assert.equal(onCreatedCalls, obsolete && !afterCallback ? 0 : 1, 'a stale response must not trigger the new scope completion');
  assert.equal(notified, obsolete && !afterCallback ? 0 : 1);
  assert.equal(loads, obsolete ? 0 : 1);
  assert.equal(resets - resetsBeforeCompletion, obsolete ? 0 : 1);
  assert.equal(node('#batchBookingResult').hidden, afterCallback ? change === 'client' : obsolete);
  assert.equal(node('#batchBookingComment').value, obsolete ? 'SYNTHETIC_NEW_DRAFT_B' : '');
  if (change === 'draft') assert.equal(run(context, 'event.submitter.disabled'), false, 'a changed draft must retain a usable owned submit control');
}

test('batch client continuation retains the current-client success', async () => {
  await checkBatchClientContinuation();
});
test('batch client continuation cannot overwrite a different client draft', async () => {
  await checkBatchClientContinuation('client');
});
for (const change of ['actor', 'organization', 'draft']) {
  test(`batch client continuation rejects changed ${change} before result effects`, async () => {
    await checkBatchClientContinuation(change);
  });
}
for (const change of ['client', 'draft']) {
  test(`batch client continuation preserves a changed ${change} after its callback await`, async () => {
    await checkBatchClientContinuation(change, true);
  });
}

async function checkDayOffContinuation(action, rotateSession) {
  let release, entered;
  const suspended = new Promise(resolve => { entered = resolve; });
  const continuation = new Promise(resolve => { release = resolve; });
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', checked: false, hidden: false, textContent: 'CURRENT_SCOPE_STATE', dataset: {} });
    return nodes.get(selector);
  };
  node('#dayOffAllDay').checked = true;
  node('#dayOffDate').value = '2026-10-20';
  node('#dayOffNote').value = 'SYNTHETIC_DRAFT_A';
  let resets = 0, notified = 0, refreshes = 0, renders = 0, freeSlotRefreshes = 0;
  let actor = 'SYNTHETIC_ACTOR_A', generation = 1;
  const button = { disabled: false, dataset: {} };
  const context = vm.createContext({
    currentUser: { id: actor }, sessionGeneration: generation,
    sessionIsCurrent: (userId, session) => userId === actor && session === generation,
    requireWrites: () => true, $: node,
    clearFormError() {}, showFormError() { throw new Error('UNEXPECTED_SYNTHETIC_FORM_ERROR'); },
    businessTodayIso: () => '2026-10-17',
    scheduleStateForDate: () => ({ weekly: { enabled: true }, fullDayOff: null }),
    db: { from(relation) {
      assert.equal(relation, 'provider_days_off');
      return {
        insert(parameters) {
          assert.equal(parameters.performer_id, 'SYNTHETIC_ACTOR_A');
          if (action === 'add') { entered(); return continuation; }
          return Promise.resolve({ error: null });
        },
        delete: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) })
      };
    } },
    loadDaysOff() { entered(); return continuation; },
    renderBookings() { renders += 1; },
    freeSlotsController: { refresh() { freeSlotRefreshes += 1; } },
    notify() { notified += 1; },
    refreshAfterWrite: async () => { refreshes += 1; },
    button,
    event: { preventDefault() {}, submitter: button, target: { reset() { resets += 1; node('#dayOffNote').value = ''; } } }
  }, vmOptions);
  const actualFunction = action === 'add' ? addDayOff : action === 'toggle' ? toggleMonthlyScheduleDay : restoreMonthlyScheduleDate;
  const invocation = action === 'add' ? 'addDayOff(event)' : action === 'toggle'
    ? "toggleMonthlyScheduleDay('2026-10-20', button)"
    : "restoreMonthlyScheduleDate('2026-10-20', button)";
  const pending = run(context, `${actualFunction}\n${invocation};`);
  await suspended;
  if (rotateSession) {
    actor = 'SYNTHETIC_ACTOR_B'; generation = 2;
    context.currentUser = { id: actor }; context.sessionGeneration = generation;
    node('#dayOffNote').value = 'SYNTHETIC_NEW_DRAFT_B';
    node('#monthlyScheduleStatus').textContent = 'CURRENT_SCOPE_STATE';
  }
  release(action === 'add' ? { error: null } : { ok: !rotateSession, stale: rotateSession });
  await pending;
  if (action === 'add') {
    assert.equal(resets, rotateSession ? 0 : 1, 'old day-off completion must not reset the new actor form');
    assert.equal(notified, rotateSession ? 0 : 1);
    assert.equal(refreshes, rotateSession ? 0 : 1);
    assert.equal(node('#dayOffNote').value, rotateSession ? 'SYNTHETIC_NEW_DRAFT_B' : '');
  } else {
    assert.equal(renders, rotateSession ? 0 : 1, 'old day-off reload must not render a new actor calendar');
    assert.equal(freeSlotRefreshes, rotateSession ? 0 : 1);
    assert.equal(node('#monthlyScheduleStatus').textContent, rotateSession ? 'CURRENT_SCOPE_STATE'
      : action === 'toggle' ? 'День закрыт.' : 'Обычный график восстановлен.');
  }
}

for (const action of ['add', 'toggle', 'restore']) {
  test(`days off continuation ${action} retains the current-session success`, async () => {
    await checkDayOffContinuation(action, false);
  });
  test(`days off continuation ${action} rejects the old-session completion`, async () => {
    await checkDayOffContinuation(action, true);
  });
}
