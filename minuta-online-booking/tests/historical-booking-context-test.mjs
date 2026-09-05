import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Complete actual createNewBooking, its actual submit binding, session guard,
// closeBookingSheet, and draft key/removal. Only the historical single-client
// branch runs. Form rendering/account replacement are explicit VM fixtures, NOT
// actual openNewBookingSheet/auth bootstrap or native browser evidence.
// Color is an explicitly deferred helper boundary. Its own context protection is
// covered elsewhere; returning false here does not undo the created server row.
// No ordinary creation, recurring series, SQL execution or rollback proof.
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start); return source.slice(from, to);
}
const oneLine = name => {
  const declaration = source.match(new RegExp(`^function ${name}[^\\n]+`, 'm'))?.[0];
  assert.ok(declaration, name); return declaration;
};
const submitBinding = source.match(/^  \$\('#newBookingForm'\)\.addEventListener\('submit', createNewBooking\);$/m)?.[0];
assert.ok(submitBinding, 'actual new-booking submit binding');
const actual = between('async function createNewBooking(', 'function closeBookingSheet(')
  + between('function closeBookingSheet(', 'function calendarRangeTitle(')
  + between('function updateNewBookingSubmitCaption(', 'function updateNewBookingConnectivity(')
  + ['sessionIsCurrent', 'bookingDraftKey', 'clearNewBookingDraft'].map(oneLine).join('\n')
  + '\n' + source.match(/^function captureBookingMetadataContext\(\) \{[\s\S]*?^\}/m)[0];
const lifecycle = ['bookingMetadataRevision', 'bookingEditorRevision', 'bookingSeriesCancellationRevision']
  .map(name => source.match(new RegExp(`^let ${name} = .*;$`, 'm'))[0]).join('\n');
const resetHooks = [...source.matchAll(/^window\.addEventListener\('minuta:provider-session-reset', \(\) => (?:\{[\s\S]*?^\}\);|[^\n]*\);)/gm)]
  .map(match => match[0]).join('\n');
const orgHook = between('  onActiveOrganizationChange: organization => {', '    if (clientOrganizationChanged) {')
  .replace('  onActiveOrganizationChange: organization => {', 'function changeOrganization(organization) {') + '\n}';
const actorA = '11111111-1111-4111-8111-111111111111', actorB = '22222222-2222-4222-8222-222222222222';
const createdId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const serviceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const createdDate = '2026-09-01', destinationDate = '2026-09-04';
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ deferRpc = false, deferRefresh = false, hidden = false } = {}) {
  const effects = [], storage = new Map(), nodes = new Map(), calls = [];
  const resetListeners = [];
  const classList = { remove(){} };
  let resolveColor, rejectColor, resolveRpc, rejectRpc, resolveRefresh, rejectRefresh, colorGuard;
  const color = new Promise((resolve, reject) => { resolveColor = resolve; rejectColor = reject; });
  const rpc = new Promise((resolve, reject) => { resolveRpc = resolve; rejectRpc = reject; });
  const refresh = new Promise((resolve, reject) => { resolveRefresh = resolve; rejectRefresh = reject; });
  const reply = { data:{ booking_id:createdId, booking_code:'MIN-1234567890', duration_minutes:60,
    unit_price_rub:1000, total_price_rub:1000, payment_required:false, notifications_suppressed:true }, error:null };
  const node = value => ({ value, hidden:false, dataset:{}, classList,
    handlers:new Map(), addEventListener(name, handler){ this.handlers.set(name, handler); } });
  function renderFixtureForm(label, date) {
    // The real renderer reuses the sheet host but replaces its form subtree.
    // Keeping that identity prevents a future sheet-only guard from passing.
    if (!nodes.has('#bookingSheet')) nodes.set('#bookingSheet', node(''));
    nodes.get('#bookingSheet').hidden = false;
    nodes.get('#bookingSheet').dataset.assistantContext = 'new-booking';
    for (const [selector, value] of Object.entries({
      '#newBookingForm':'', '#newBookingName':label, '#newBookingPhone':'+79990000001',
      '#newBookingService':serviceId, '#newBookingDate':date, '#newBookingNote':'',
      '#newBookingOccurrences':'1', '#newBookingInterval':'1', '#newBookingSubmit':'',
      '[name="newBookingColor"]:checked':'sky',
    })) nodes.set(selector, node(value));
  }
  renderFixtureForm('Клиент A', createdDate);
  const state = {
    currentUser:{ id:actorA }, sessionGeneration:1, selectedDate:createdDate,
    activeClientOrganizationId:orgId,
    newBookingMode:'client', newBookingTime:'10:00', newBookingHistoricalMode:true,
    newBookingOutsideSchedule:false, editingOfflineBookingId:'',
    ownServices:[{ id:serviceId, active:true, duration_minutes:60, name:'Услуга', price_rub:1000 }],
    BOOKING_COLOR_DEFAULT:'sky', navigator:{ onLine:true },
    $:selector => nodes.get(selector),
    document:{ body:{ classList } }, requireBookingWrites:() => true,
    window:{ addEventListener:(name, callback) => { if (name === 'minuta:provider-session-reset') resetListeners.push(callback); } },
    freeSlotsController:{ invalidateScope(){} }, providerReadFetch:{ cancelPendingReads(){} },
    normalizePhone:phone => String(phone).replace(/\D/g, ''),
    newBookingDurationMinutes:() => 60, businessTodayIso:() => '2026-09-06',
    minutesFromTime:time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
    bookingPlacementIssue:() => '', organizationController:{ getActiveOrganization:() => ({ id:orgId }) },
    applyClientHighlightClasses(){},
    sessionStorage:{ removeItem:key => { effects.push(['clearDraft', key]); storage.delete(key); } },
    selectScheduleDate:date => { state.selectedDate = date; effects.push(['selectDate', date]); },
    refreshAfterWrite:async () => { effects.push(['refresh', state.currentUser.id]); return deferRefresh ? refresh : true; },
    focusCreatedBooking:id => effects.push(['focus', id, state.currentUser.id]),
    notify:message => effects.push(['notify', message, state.currentUser.id]),
    showFormError:(selector, message) => effects.push(['error', selector, message]),
    saveBookingColor:(id, selected, options) => {
      colorGuard = options.isCurrent;
      effects.push(['colorStarted', id, selected, options.rerender, state.currentUser.id]); return color;
    },
    db:{ rpc:async (name, params) => {
      assert.equal(name, 'create_minuta_historical_booking'); calls.push({ name, params:{ ...params } });
      // Full v98:201-209 response shape; no simulated second creation or rollback.
      return deferRpc ? rpc : reply;
    }, from:() => { throw Error('This fixture must not enter notes or ordinary creation'); } },
  };
  const context = vm.createContext(state);
  vm.runInContext(lifecycle + '\n' + resetHooks + '\n' + orgHook + '\n' + actual + '\n' + submitBinding, context);
  const originalForm = nodes.get('#newBookingForm'), button = nodes.get('#newBookingSubmit');
  nodes.get('#bookingSheet').hidden = hidden;
  storage.set(context.bookingDraftKey(actorA), 'original A draft');
  const pending = originalForm.handlers.get('submit')({ preventDefault(){}, currentTarget:originalForm, submitter:button })
    .then(() => null, error => ({ message:error.message }));
  function replaceForm(account = actorA) {
    context.closeBookingSheet(); // Actual close, then explicit replacement-render boundary.
    if (account !== state.currentUser.id) { state.currentUser = { id:account }; state.sessionGeneration += 1; }
    renderFixtureForm('Новый несохранённый черновик', destinationDate);
    state.selectedDate = destinationDate; state.newBookingTime = '12:00'; state.newBookingHistoricalMode = true;
    storage.set(context.bookingDraftKey(account), 'new destination draft');
    vm.runInContext(submitBinding, context);
  }
  const snapshot = () => JSON.stringify({ selectedDate:state.selectedDate,
    sheetHidden:nodes.get('#bookingSheet').hidden, sheetDataset:nodes.get('#bookingSheet').dataset,
    buttonDisabled:nodes.get('#newBookingSubmit').disabled,
    name:nodes.get('#newBookingName').value, date:nodes.get('#newBookingDate').value,
    storage:[...storage], historicalMode:state.newBookingHistoricalMode, effects });
  return { state, context, nodes, storage, effects, calls, pending, resolveColor, rejectColor,
    resolveRpc:(response = reply) => resolveRpc(response), reply, rejectRpc, resolveRefresh, rejectRefresh, replaceForm, snapshot,
    resubmit:() => nodes.get('#newBookingForm').handlers.get('submit')({ preventDefault(){},
      currentTarget:nodes.get('#newBookingForm'), submitter:nodes.get('#newBookingSubmit') }),
    colorGuard:() => colorGuard, reset:() => resetListeners.forEach(callback => callback()) };
}

for (const [name, account] of [['account A -> B', actorB], ['same actor closes and replaces form', actorA]]) {
  test(`historical RPC confirmed, color pending: ${name} owns subsequent UI`, async t => {
    const h = harness(); await tick();
    assert.equal(h.calls.length, 1); assert.equal(h.effects[0][0], 'colorStarted');
    h.replaceForm(account); const before = h.snapshot(), effectIndex = h.effects.length;
    // Real metadata helper can return false after account invalidation. Same
    // account replacement still returns true today. Neither is a server rollback.
    h.resolveColor(account === actorB ? false : true);
    assert.equal(await h.pending, null);
    t.diagnostic(JSON.stringify({ lateEffects:h.effects.slice(effectIndex),
      sheetHidden:h.nodes.get('#bookingSheet').hidden, createdRpcCount:h.calls.length }));
    assert.equal(h.snapshot(), before, 'old creation must not select date, clear draft, close, refresh, focus or toast in replacement form');
  });
}

test('current historical form completes its confirmed creation normally', async () => {
  const h = harness(); await tick(); h.resolveColor(true); assert.equal(await h.pending, null);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].params.p_organization, orgId);
  assert.equal(h.calls[0].params.p_date, createdDate);
  assert.equal(h.calls[0].params.p_time, '10:00:00');
  assert.equal(h.nodes.get('#bookingSheet').hidden, true);
  assert.equal(h.storage.has(h.context.bookingDraftKey(actorA)), false);
  assert.deepEqual(h.effects.slice(1), [
    ['selectDate', createdDate], ['clearDraft', h.context.bookingDraftKey(actorA)],
    ['refresh', actorA], ['focus', createdId, actorA],
    ['notify', 'Запись в прошлом создана · отметьте результат и оплату', actorA],
  ]);
});

for (const phase of ['rpc', 'color', 'refresh']) {
  for (const outcome of ['success', 'throw']) {
    test(`replacement after pending ${phase}: late ${outcome} has no UI effects`, async () => {
      const h = harness({ deferRpc:phase === 'rpc', deferRefresh:phase === 'refresh' });
      await tick();
      if (phase === 'refresh') { h.resolveColor(true); await tick(); }
      h.replaceForm(); const before = h.snapshot();
      if (phase === 'rpc') outcome === 'throw' ? h.rejectRpc(Error('unknown RPC outcome')) : h.resolveRpc();
      if (phase === 'color') outcome === 'throw' ? h.rejectColor(Error('color transport')) : h.resolveColor(true);
      if (phase === 'refresh') outcome === 'throw' ? h.rejectRefresh(Error('refresh transport')) : h.resolveRefresh(true);
      assert.equal(await h.pending, null);
      assert.equal(h.snapshot(), before);
      if (phase === 'rpc') assert.equal(h.effects.some(effect => effect[0] === 'colorStarted'), false);
    });
  }
}

for (const transition of ['org-roundtrip', 'session-reset']) {
  for (const phase of ['rpc', 'color']) {
    test(`actual ${transition} epoch invalidates historical ${phase} with unchanged identity`, async () => {
      const h = harness({ deferRpc:phase === 'rpc' }); await tick();
      if (transition === 'org-roundtrip') {
        h.context.changeOrganization({ id:'other-org' }); h.context.changeOrganization({ id:orgId });
      } else h.reset();
      const before = h.snapshot();
      if (phase === 'rpc') h.resolveRpc(); else h.resolveColor(false);
      assert.equal(await h.pending, null); assert.equal(h.snapshot(), before);
      if (phase === 'color') { assert.equal(typeof h.colorGuard(), 'function'); assert.equal(h.colorGuard()(), false); }
    });
  }
}

for (const phase of ['rpc', 'color', 'refresh']) {
  test(`current ${phase} rejection distinguishes unknown creation from confirmed partial completion`, async () => {
    const h = harness({ deferRpc:phase === 'rpc', deferRefresh:phase === 'refresh' }); await tick();
    if (phase === 'refresh') { h.resolveColor(true); await tick(); h.rejectRefresh(Error('refresh transport')); }
    else if (phase === 'rpc') h.rejectRpc(Error('RPC transport'));
    else h.rejectColor(Error('color transport'));
    assert.equal(await h.pending, null);
    const message = h.effects.findLast(effect => ['notify', 'error'].includes(effect[0]));
    assert.ok(message); assert.match(message[0] === 'notify' ? message[1] : message[2],
      phase === 'rpc' ? /Не удалось подтвердить создание/ : /Запись в прошлом создана, но/);
    assert.equal(h.calls.length, 1, 'no compensating create or rollback');
    if (phase !== 'refresh') assert.equal(h.nodes.get('#newBookingSubmit').disabled, true);
    if (phase === 'color') assert.equal(h.nodes.get('#newBookingSubmit').textContent, 'Запись уже создана');
});
}

test('pending historical submit remains single-flight after actual caption recalculation', async () => {
  const h = harness({ deferRpc:true }); await tick();
  h.nodes.get('#newBookingName').value = 'Изменённое имя';
  h.context.updateNewBookingSubmitCaption();
  assert.equal(h.nodes.get('#newBookingSubmit').disabled, true);
  await h.resubmit(); assert.equal(h.calls.length, 1);
  h.resolveRpc(); await tick(); h.resolveColor(true); assert.equal(await h.pending, null);
});

for (const [label, result] of [
  ['null', { data:null, error:null }],
  ['partial', { data:{ booking_id:createdId }, error:null }],
  ['transport', { data:null, error:{ code:'08006', message:'slot_unavailable' } }],
  ['no-code refusal text', { data:null, error:{ message:'slot_unavailable' } }],
]) {
  test(`unknown ${label} cannot be retried through caption/input or direct submit`, async () => {
    const h = harness({ deferRpc:true }); await tick(); h.resolveRpc(result); assert.equal(await h.pending, null);
    assert.equal(h.nodes.get('#newBookingForm').dataset.historicalCreateState, 'unknown');
    h.nodes.get('#newBookingDate').value = destinationDate; h.state.newBookingHistoricalMode = false;
    h.context.updateNewBookingSubmitCaption(); assert.equal(h.nodes.get('#newBookingSubmit').disabled, true);
    await h.resubmit(); assert.equal(h.calls.length, 1);
    assert.equal(h.effects.some(effect => effect[0] === 'colorStarted'), false);
  });
}

test('confirmed created row with color failure cannot be blindly created again', async () => {
  const h = harness(); await tick(); h.rejectColor(Error('color failed')); assert.equal(await h.pending, null);
  h.context.updateNewBookingSubmitCaption(); await h.resubmit();
  assert.equal(h.nodes.get('#newBookingForm').dataset.historicalCreateState, 'created');
  assert.equal(h.nodes.get('#newBookingSubmit').disabled, true); assert.equal(h.calls.length, 1);
});

test('exact v98 refusal releases the form for correction', async () => {
  const h = harness({ deferRpc:true }); await tick();
  h.resolveRpc({ data:null, error:{ code:'23P01', message:'slot_unavailable' } }); assert.equal(await h.pending, null);
  assert.equal(h.nodes.get('#newBookingForm').dataset.historicalCreateState, undefined);
  h.context.updateNewBookingSubmitCaption(); assert.equal(h.nodes.get('#newBookingSubmit').disabled, false);
  await h.resubmit(); assert.equal(h.calls.length, 2);
});

test('historical submission from a hidden form starts no RPC or UI operation', async () => {
  const h = harness({ hidden:true }); assert.equal(await h.pending, null);
  assert.equal(h.calls.length, 0); assert.deepEqual(h.effects, []);
  assert.equal(h.nodes.get('#newBookingSubmit').disabled, undefined);
});

test('closing without replacement invalidates the pending color caller guard', async () => {
  const h = harness(); await tick(); h.context.closeBookingSheet(); const before = h.snapshot();
  assert.equal(h.colorGuard()(), false); h.resolveColor(false);
  assert.equal(await h.pending, null); assert.equal(h.snapshot(), before);
});

test('post-close pending refresh cannot focus or toast after account replacement', async () => {
  const h = harness({ deferRefresh:true }); await tick(); h.resolveColor(true); await tick();
  h.replaceForm(actorB); const before = h.snapshot(); h.resolveRefresh(true);
  assert.equal(await h.pending, null); assert.equal(h.snapshot(), before);
});

for (const phase of ['color', 'refresh']) {
  test(`confirmed historical creation with fulfilled ${phase} false reports partial completion and remains latched`, async () => {
    const h = harness({ deferRefresh:phase === 'refresh' }); await tick();
    h.resolveColor(phase === 'refresh');
    if (phase === 'refresh') { await tick(); h.resolveRefresh(false); }
    assert.equal(await h.pending, null);
    assert.equal(h.nodes.get('#newBookingForm').dataset.historicalCreateState, 'created');
    h.context.updateNewBookingSubmitCaption();
    assert.equal(h.nodes.get('#newBookingSubmit').disabled, true);
    await h.resubmit(); assert.equal(h.calls.length, 1);
    const message = h.effects.findLast(effect => ['notify', 'error'].includes(effect[0]));
    assert.ok(message); assert.match(message[0] === 'notify' ? message[1] : message[2], /Запись в прошлом создана, но/);
    assert.equal(h.effects.some(effect => effect[0] === 'focus'), false);
    assert.equal(h.effects.some(effect => effect[0] === 'notify' && effect[1] === 'Запись в прошлом создана · отметьте результат и оплату'), false);
  });
}
