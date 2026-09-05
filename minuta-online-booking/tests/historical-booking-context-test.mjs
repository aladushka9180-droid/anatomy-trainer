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
  + ['sessionIsCurrent', 'bookingDraftKey', 'clearNewBookingDraft'].map(oneLine).join('\n');
const actorA = '11111111-1111-4111-8111-111111111111', actorB = '22222222-2222-4222-8222-222222222222';
const createdId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const serviceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const createdDate = '2026-09-01', destinationDate = '2026-09-04';
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const effects = [], storage = new Map(), nodes = new Map(), calls = [];
  const classList = { remove(){} };
  let resolveColor;
  const color = new Promise(resolve => { resolveColor = resolve; });
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
    newBookingMode:'client', newBookingTime:'10:00', newBookingHistoricalMode:true,
    newBookingOutsideSchedule:false, editingOfflineBookingId:'',
    bookingSeriesCancellationRevision:0, bookingEditorRevision:0,
    ownServices:[{ id:serviceId, active:true, duration_minutes:60, name:'Услуга', price_rub:1000 }],
    BOOKING_COLOR_DEFAULT:'sky', navigator:{ onLine:true },
    $:selector => nodes.get(selector),
    document:{ body:{ classList } }, requireBookingWrites:() => true,
    normalizePhone:phone => String(phone).replace(/\D/g, ''),
    newBookingDurationMinutes:() => 60, businessTodayIso:() => '2026-09-06',
    minutesFromTime:time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3)),
    bookingPlacementIssue:() => '', organizationController:{ getActiveOrganization:() => ({ id:orgId }) },
    applyClientHighlightClasses(){},
    sessionStorage:{ removeItem:key => { effects.push(['clearDraft', key]); storage.delete(key); } },
    selectScheduleDate:date => { state.selectedDate = date; effects.push(['selectDate', date]); },
    refreshAfterWrite:async () => { effects.push(['refresh', state.currentUser.id]); return true; },
    focusCreatedBooking:id => effects.push(['focus', id, state.currentUser.id]),
    notify:message => effects.push(['notify', message, state.currentUser.id]),
    showFormError:(selector, message) => effects.push(['error', selector, message]),
    updateNewBookingSubmitCaption:() => effects.push(['caption']),
    saveBookingColor:(id, selected, options) => {
      effects.push(['colorStarted', id, selected, options.rerender, state.currentUser.id]); return color;
    },
    db:{ rpc:async (name, params) => {
      assert.equal(name, 'create_minuta_historical_booking'); calls.push({ name, params:{ ...params } });
      // Full v98:201-209 response shape; no simulated second creation or rollback.
      return { data:{ booking_id:createdId, booking_code:'HIST01', duration_minutes:60,
        unit_price_rub:1000, total_price_rub:1000, payment_required:false, notifications_suppressed:true }, error:null };
    }, from:() => { throw Error('This fixture must not enter notes or ordinary creation'); } },
  };
  const context = vm.createContext(state);
  vm.runInContext(actual + '\n' + submitBinding, context);
  const originalForm = nodes.get('#newBookingForm'), button = nodes.get('#newBookingSubmit');
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
    name:nodes.get('#newBookingName').value, date:nodes.get('#newBookingDate').value,
    storage:[...storage], historicalMode:state.newBookingHistoricalMode, effects });
  return { state, context, nodes, storage, effects, calls, pending, resolveColor, replaceForm, snapshot };
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
