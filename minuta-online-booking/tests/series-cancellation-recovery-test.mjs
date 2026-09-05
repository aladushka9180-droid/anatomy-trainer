import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Real controller functions and lifecycle hooks; DOM, RPC and journal refresh are
// controlled boundaries. No network, SQL, native-browser or production evidence.
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const between = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Source boundary: ${start}`);
  return source.slice(from, to);
};
const controller = between('function openBookingSeriesCancellation(', 'async function saveBookingBlockNote(')
  + between('function closeBookingSheet()', 'function calendarRangeTitle(')
  + source.match(/^function sessionIsCurrent[^\n]+/m)[0];
const resetHook = between("window.addEventListener('minuta:provider-session-reset'", "window.addEventListener('offline'");
const orgHook = between('  onActiveOrganizationChange: organization => {', '    if (clientOrganizationChanged) {')
  .replace('  onActiveOrganizationChange: organization => {', 'function changeOrganization(organization) {') + '\n}';
const revisionDeclaration = source.match(/^let bookingSeriesCancellationRevision = .*;$/m)?.[0] || '';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const success = { data:{ series_id:'series-A', action:'cancel', scope:'following',
  affected:[{ booking_id:'A', occurrence:1 }], affected_count:1 }, error:null };
const denied = { data:null, error:{ code:'42501', message:'booking_access_denied' } };

function harness() {
  const effects = [];
  const rpcQueue = [];
  const hooks = new Map();
  const sheet = { dataset:{}, hidden:true, classList:{ add(){}, remove(){} } };
  const nodes = { '#bookingSheet':sheet };
  nodes['#bookingSheetContent'] = {
    set innerHTML(html) {
      const id = html.match(/id="bookingSeriesCancelForm" data-booking-id="([^"]+)"/)[1];
      nodes['#bookingSeriesCancelForm'] = {
        dataset:{ bookingId:id }, elements:{ cancelBookingSeriesScope:{ value:'following' } },
        addEventListener(name, callback) { this[name] = callback; },
        button:{ disabled:false, textContent:'Отменить выбранные записи' }
      };
    }
  };
  const context = vm.createContext({
    $:selector => nodes[selector], currentUser:{ id:'user-A' }, sessionGeneration:1,
    activeClientOrganizationId:'org-A', editingOfflineBookingId:'', newBookingHistoricalMode:false,
    allBookings:['A', 'B'].map(id => ({ id, series_id:`series-${id}`, status:'confirmed' })),
    bookingOutcome:() => ({ visit_status:'scheduled' }), uiIcon:() => '', bookingSeriesScopeMarkup:() => '',
    window:{ addEventListener:(name, callback) => hooks.set(name, callback) },
    document:{ body:{ classList:{ add(){}, remove(){} } } },
    providerReadFetch:{ cancelPendingReads:() => effects.push(['cancelReads']) },
    applyWriteAvailability(){}, applyClientHighlightClasses(){}, requireWrites:() => true,
    db:{ rpc:(name, params) => {
      effects.push(['rpc', name, JSON.parse(JSON.stringify(params))]);
      const next = deferred(); rpcQueue.push(next); return next.promise;
    } },
    showFormError:(selector, message) => effects.push(['error', selector, message]),
    seriesRpcErrorMessage:() => 'Доступ запрещён',
    notifyTelegramClient:(id, status) => effects.push(['clientNotification', id, status]),
    refreshAfterWrite:async () => { effects.push(['refresh']); },
    notify:message => effects.push(['toast', message]), seriesBookingCountLabel:String
  });
  vm.runInContext(`${revisionDeclaration}\n${resetHook}\n${orgHook}\n${controller}`, context);
  const open = (id = 'A') => { context.openBookingSeriesCancellation(id); return nodes['#bookingSeriesCancelForm']; };
  const submit = (form = nodes['#bookingSeriesCancelForm']) => form.submit({
    preventDefault(){}, currentTarget:form, submitter:form.button
  });
  const changeOrg = id => context.changeOrganization({ id });
  return { context, nodes, sheet, effects, rpcQueue, open, submit, changeOrg,
    reset:() => hooks.get('minuta:provider-session-reset')() };
}

test('current success preserves exact RPC and closes only its form', async () => {
  const h = harness(); h.open(); const pending = h.submit();
  assert.deepEqual(h.effects[0], ['rpc', 'manage_minuta_booking_series', {
    p_booking:'A', p_action:'cancel', p_scope:'following', p_date:null, p_time:null
  }]);
  h.rpcQueue[0].resolve(success); await pending;
  assert.equal(h.sheet.hidden, true);
  assert.deepEqual(h.effects.slice(1), [['clientNotification', 'A', 'cancelled'], ['refresh'], ['toast', 'Отменено: 1']]);
});

for (const outcome of ['error', 'throw']) {
  test(`current ${outcome} restores button and permits retry`, async () => {
    const h = harness(); const form = h.open(); const pending = h.submit();
    if (outcome === 'error') h.rpcQueue[0].resolve(denied);
    else h.rpcQueue[0].reject(Error('lost response'));
    await pending;
    assert.equal(h.sheet.hidden, false);
    assert.equal(form.button.disabled, false);
    assert.equal(form.button.textContent, 'Отменить выбранные записи');
    assert.equal(h.effects.filter(e => e[0] === 'error').length, 1);
    if (outcome === 'throw') assert.match(h.effects.at(-1)[2], /Не удалось подтвердить результат/);
    const retry = h.submit(); assert.equal(h.rpcQueue.length, 2);
    h.rpcQueue[1].resolve(success); await retry;
    assert.equal(h.sheet.hidden, true);
  });
}

test('duplicate current submit sends only one RPC', async () => {
  const h = harness(); h.open(); const first = h.submit(); await h.submit();
  assert.equal(h.rpcQueue.length, 1); h.rpcQueue[0].resolve(success); await first;
});

for (const outcome of ['success', 'error', 'throw']) {
  for (const nextId of ['A', 'B']) {
    test(`late ${outcome} cannot affect reopened ${nextId}`, async () => {
      const h = harness(); h.open(); const first = h.submit();
      h.context.closeBookingSheet(); const fresh = h.open(nextId); const second = h.submit();
      const before = h.effects.length;
      if (outcome === 'throw') h.rpcQueue[0].reject(Error('lost response'));
      else h.rpcQueue[0].resolve(outcome === 'success' ? success : denied);
      await first;
      assert.equal(h.sheet.hidden, false);
      assert.equal(h.sheet.dataset.bookingId, nextId);
      assert.equal(fresh.button.disabled, true, 'old finally must not unlock new pending form');
      assert.equal(h.effects.length, before, 'no old close, error, notification, refresh or toast');
      h.rpcQueue[1].resolve(denied); await second;
      assert.equal(fresh.button.disabled, false);
    });
  }
}

for (const switchContext of ['org', 'org-roundtrip', 'session-reset', 'session-generation', 'logout']) {
  test(`${switchContext} invalidates pending cancellation`, async () => {
    const h = harness(); h.open(); const pending = h.submit();
    if (switchContext.startsWith('org')) {
      h.changeOrg('org-B'); if (switchContext === 'org-roundtrip') h.changeOrg('org-A');
    } else if (switchContext === 'session-reset') h.reset();
    else if (switchContext === 'session-generation') h.context.sessionGeneration += 1;
    else h.context.currentUser = null;
    const before = h.effects.length;
    h.rpcQueue[0].resolve(success); await pending;
    assert.equal(h.effects.length, before);
    assert.equal(h.sheet.hidden, false);
    if (switchContext === 'org-roundtrip' || switchContext === 'session-reset') {
      await h.submit(); assert.equal(h.rpcQueue.length, 1, 'invalidated old form cannot start another cancellation');
    }
  });
}

for (const outcome of ['resolve', 'reject']) {
  test(`late refresh ${outcome} cannot toast or close a new form`, async () => {
    const h = harness(); const refresh = deferred(); const refreshEntered = deferred();
    h.context.refreshAfterWrite = () => { h.effects.push(['refresh']); refreshEntered.resolve(); return refresh.promise; };
    h.open(); const pending = h.submit(); h.rpcQueue[0].resolve(success);
    await refreshEntered.promise;
    assert.equal(h.sheet.hidden, true, 'confirmed cancellation closes its own form');
    const fresh = h.open('B'); const before = h.effects.length;
    if (outcome === 'resolve') refresh.resolve(); else refresh.reject(Error('refresh failed'));
    await pending;
    assert.equal(h.effects.length, before);
    assert.equal(h.sheet.hidden, false);
    assert.equal(fresh.button.disabled, false);
  });
}

test('current failed refresh does not claim confirmed cancellation failed', async () => {
  const h = harness(); h.context.refreshAfterWrite = async () => { throw Error('refresh failed'); };
  h.open(); const pending = h.submit(); h.rpcQueue[0].resolve(success); await pending;
  assert.equal(h.sheet.hidden, true);
  assert.match(h.effects.at(-1)[1], /^Записи отменены\./);
});

test('normal same-organization refresh preserves current completion', async () => {
  const h = harness(); h.context.refreshAfterWrite = async () => h.changeOrg('org-A');
  h.open(); const pending = h.submit(); h.rpcQueue[0].resolve(success); await pending;
  assert.equal(h.sheet.hidden, true);
  assert.deepEqual(h.effects.at(-1), ['toast', 'Отменено: 1']);
});

test('replacement by another booking sheet identity invalidates completion without an open hook', async () => {
  const h = harness(); h.open(); const pending = h.submit();
  delete h.nodes['#bookingSeriesCancelForm']; h.sheet.dataset.bookingId = 'B';
  const before = h.effects.length; h.rpcQueue[0].resolve(success); await pending;
  assert.equal(h.effects.length, before); assert.equal(h.sheet.hidden, false);
});
