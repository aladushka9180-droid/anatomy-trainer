import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Regression specification, not an expected-failure suite. The current runtime
// fails the stale/throw assertions and must exit nonzero until it is repaired.
// Execute real openBookingEditor/saveBookingChanges/sessionIsCurrent functions.
// DOM primitives, auxiliary helpers, SQL transport and final sheet rendering are
// controlled boundaries: this is not browser, SQL, notification or production E2E.
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function between(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Actual source boundary: ${start}`);
  return source.slice(from, to);
}
const realController = between('function openBookingEditor(', 'function offlineCandidateSlots(')
  + between('function seriesRpcErrorMessage(', 'function stackMinuteTimelineItems(')
  + source.match(/^function sessionIsCurrent[^\n]+/m)[0];
const metadataDependencies = between('function captureBookingMetadataContext(', '// Local completion ownership');
const lifecycleDeclarations = ['bookingEditorRevision', 'bookingSeriesCancellationRevision', 'bookingMetadataRevision']
  .map(name => {
    const declaration = source.match(new RegExp(`^let ${name} = .*;$`, 'm'))?.[0];
    assert.ok(declaration, `Actual lifecycle declaration: ${name}`);
    return declaration;
  }).join('\n');
const resetHooks = [...source.matchAll(/^window\.addEventListener\('minuta:provider-session-reset', \(\) => (?:\{[\s\S]*?^\}\);|[^\n]*\);)/gm)]
  .map(match => match[0]).join('\n');
const orgHook = between('  onActiveOrganizationChange: organization => {', '    if (clientOrganizationChanged) {')
  .replace('  onActiveOrganizationChange: organization => {', 'function changeOrganization(organization) {') + '\n}';
const ids = { A:'11111111-1111-4111-8111-111111111111', B:'22222222-2222-4222-8222-222222222222' };
const seriesIds = { A:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const serviceId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const success = { data:{ series_id:seriesIds.A, action:'reschedule', scope:'following',
  affected_count:1, affected:[{ booking_id:ids.A, occurrence:1 }] }, error:null };
const refusal = { data:null, error:{ code:'P0001', message:'series_slot_unavailable' } };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const defaultResult = { rpc:success, color:true, note:{ error:null }, refresh:true };

function harness(pendingStage = null) {
  const gate = deferred(), entered = deferred(), effects = [];
  const resetListeners = [];
  const nodes = {
    '#bookingSheet':{ dataset:{}, hidden:true, classList:{ add(){}, remove(){} } },
    '[name="editBookingColor"]:checked':{ value:'blue' }
  };
  nodes['#bookingSheetContent'] = {
    set innerHTML(html) {
      const bookingId = html.match(/id="bookingEditForm" data-booking-id="([^"]+)"/)[1];
      const date = html.match(/id="editBookingDate"[^>]+value="([^"]+)"/)[1];
      nodes['#bookingEditForm'] = {
        dataset:{ bookingId }, elements:{ editBookingSeriesScope:{ value:'following' } },
        button:{ disabled:false, textContent:'Сохранить изменения' },
        addEventListener(name, listener) { this[name] = listener; }
      };
      nodes['#editBookingService'] = { value:serviceId, addEventListener(){} };
      nodes['#editBookingDate'] = { value:date, addEventListener(){} };
      nodes['#editBookingNote'] = { value:'Исходная заметка A' };
      nodes['#editBookingTimes'] = { innerHTML:'' };
    }
  };
  const stage = (name, payload) => {
    effects.push([name, payload]);
    if (name === pendingStage) { entered.resolve(); return gate.promise; }
    return Promise.resolve(defaultResult[name]);
  };
  const context = vm.createContext({
    $:selector => nodes[selector], $$:() => [],
    currentUser:{ id:userId }, sessionGeneration:7, activeClientOrganizationId:'org-A', writesAllowed:true,pendingClientNotes:new Map(),
    localStorage:{setItem(){},getItem:()=>null},
    editingOfflineBookingId:'', newBookingHistoricalMode:false,
    window:{ addEventListener:(name, callback) => { if (name === 'minuta:provider-session-reset') resetListeners.push(callback); } },
    freeSlotsController:{ invalidateScope(){} }, providerReadFetch:{ cancelPendingReads(){} },
    allBookings:['A', 'B'].map(label => ({ id:ids[label], series_id:seriesIds[label], service_id:serviceId,
      booking_date:'2026-09-15', booking_time:'10:00:00', duration_minutes:60,
      client_phone:label === 'A' ? '+79990000001' : '+79990000002', status:'confirmed' })),
    ownServices:[{ id:serviceId, duration_minutes:60 }], bookingEditTime:'',
    requireWrites:() => true, isScheduleBlock:() => false,
    providerAssistantIsoDate:value => value || '', applyClientHighlightClasses(){}, uiIcon:() => '',
    serviceOptions:() => '', escapeHtml:String, bookingDisplayNote:() => '', bookingColorPicker:() => '',
    bookingColor:() => 'blue', businessTodayIso:() => '2026-09-06', bookingSeriesScopeMarkup:() => '',
    document:{ body:{ classList:{ add(){}, remove(){} } } },
    loadBookingEditSlots:async id => { effects.push(['loadSlots', id]); },
    showFormError:(selector, message) => effects.push(['error', selector, message]),
    db:{
      rpc:(name, params) => stage('rpc', { name, params:JSON.parse(JSON.stringify(params)) }),
      from:table => ({ upsert:params => {
        assert.equal(table, 'client_notes');
        return stage('note', JSON.parse(JSON.stringify(params)));
      } })
    },
    notifyTelegramClient:(id, kind) => effects.push(['notification', id, kind]),
    saveBookingColor:(id, color, options) => stage('color', { id, color, options:JSON.parse(JSON.stringify(options)) }),
    normalizePhone:String,
    clientNotes:{ set:(phone, note) => effects.push(['cacheNote', phone, note]) },
    selectScheduleDate:date => effects.push(['selectDate', date]),
    refreshAfterWrite:() => stage('refresh', null),
    notify:message => effects.push(['toast', message]), seriesBookingCountLabel:String,
    openBookingSheet:id => {
      effects.push(['openBookingSheet', id]);
      // Presentation boundary mirrors only the visible identity change at the
      // start of the real renderer; the renderer's full HTML is not exercised.
      nodes['#bookingSheet'].dataset.bookingId = id;
      nodes['#bookingSheet'].dataset.assistantContext = 'booking';
      delete nodes['#bookingEditForm'];
    }
  });
  vm.runInContext(lifecycleDeclarations + '\n' + resetHooks + '\n' + orgHook + '\n' + metadataDependencies + '\n' + realController
    + between('function closeBookingSheet()', 'function calendarRangeTitle('), context);
  const open = (label = 'A') => {
    context.openBookingEditor(ids[label], { date:'2026-09-20', time:'12:00' });
    return nodes['#bookingEditForm'];
  };
  const submit = form => {
    const operation = form.submit({ preventDefault(){}, currentTarget:form, submitter:form.button });
    // Observe unexpected rejections immediately so the test runner reports the
    // assertion failure rather than an unrelated unhandled-rejection warning.
    return operation.then(() => ({ error:null }), error => ({ error }));
  };
  return { context, nodes, effects, gate, entered, open, submit,
    reset:() => resetListeners.forEach(listener => listener()) };
}

test('current editor completes the real series RPC and auxiliary writes', async () => {
  const h = harness(); const form = h.open(); const result = await h.submit(form);
  assert.equal(result.error, null);
  assert.deepEqual(h.effects.find(e => e[0] === 'rpc')[1], {
    name:'manage_minuta_booking_series', params:{ p_booking:ids.A, p_action:'reschedule',
      p_scope:'following', p_date:'2026-09-20', p_time:'12:00:00' }
  });
  assert.deepEqual(h.effects.filter(e => ['color', 'note', 'refresh'].includes(e[0])).map(e => e[0]), ['color', 'note', 'refresh']);
  assert.deepEqual(h.effects.at(-1), ['openBookingSheet', ids.A]);
  assert.equal(h.effects.find(e => e[0] === 'note')[1].note, 'Исходная заметка A');
  assert.equal(h.effects.filter(e => e[0] === 'toast').length, 1);
});

test('current explicit RPC refusal restores the editor button', async () => {
  const h = harness('rpc'); const form = h.open(); const pending = h.submit(form);
  await h.entered.promise; h.gate.resolve(refusal); const result = await pending;
  assert.equal(result.error, null); assert.equal(form.button.disabled, false);
  assert.equal(form.button.textContent, 'Сохранить изменения');
  assert.equal(h.nodes['#bookingEditForm'], form);
  assert.equal(h.effects.filter(e => e[0] === 'error').length, 1);
  assert.equal(h.effects.some(e => ['color', 'note', 'refresh', 'toast', 'openBookingSheet'].includes(e[0])), false);
});

for (const phase of ['rpc', 'color', 'note', 'refresh']) {
  test(`late ${phase} completion must leave newly opened editor B unchanged`, async () => {
    const h = harness(phase); const formA = h.open(); const pending = h.submit(formA);
    await h.entered.promise; const formB = h.open('B'); const effectsBeforeReply = h.effects.length;
    assert.equal(h.context.currentUser.id, userId); assert.equal(h.context.sessionGeneration, 7);
    h.gate.resolve(defaultResult[phase]); const result = await pending;
    assert.equal(result.error, null);
    assert.deepEqual(h.effects.slice(effectsBeforeReply), [], 'stale continuation must not start new writes or mutate the new UI');
    assert.equal(h.nodes['#bookingEditForm'], formB);
    assert.equal(h.nodes['#bookingSheet'].dataset.bookingId, ids.B);
    assert.equal(formB.button.disabled, false);
  });
}

test('duplicate submit on the same editor sends one RPC', async () => {
  const h = harness('rpc'); const form = h.open(); const pending = h.submit(form);
  await h.entered.promise; assert.equal((await h.submit(form)).error, null);
  assert.equal(h.effects.filter(e => e[0] === 'rpc').length, 1);
  h.gate.resolve(success); assert.equal((await pending).error, null);
});

for (const phase of ['rpc', 'color', 'note', 'refresh']) {
  for (const change of ['org-roundtrip', 'session-reset', 'logout', 'close']) {
    test(`${change} invalidates editor awaiting ${phase}`, async () => {
      const h = harness(phase); const form = h.open(); const pending = h.submit(form);
      await h.entered.promise;
      if (change === 'org-roundtrip') {
        h.context.changeOrganization({ id:'org-B' }); h.context.changeOrganization({ id:'org-A' });
      } else if (change === 'session-reset') h.reset();
      else if (change === 'logout') { h.context.currentUser = null; h.context.sessionGeneration += 1; }
      else h.context.closeBookingSheet();
      const before = h.effects.length;
      h.gate.resolve(defaultResult[phase]); const result = await pending;
      assert.equal(result.error, null);
      assert.deepEqual(h.effects.slice(before), []);
    });
  }
}

test('same-organization refresh leaves current editor completion valid', async () => {
  const h = harness('refresh'); const pending = h.submit(h.open());
  await h.entered.promise; h.context.changeOrganization({ id:'org-A' });
  h.gate.resolve(true); assert.equal((await pending).error, null);
  assert.deepEqual(h.effects.at(-1), ['openBookingSheet', ids.A]);
});

for (const data of [null, {}, { ...success.data, action:'cancel' },
  { ...success.data, affected:[{ booking_id:'not-a-uuid', occurrence:1 }] }]) {
  test(`malformed reschedule acknowledgement cannot start auxiliary writes: ${JSON.stringify(data)}`, async () => {
    const h = harness('rpc'); const form = h.open(); const pending = h.submit(form);
    await h.entered.promise; h.gate.resolve({ data, error:null }); const result = await pending;
    assert.equal(result.error, null); assert.equal(form.button.disabled, false);
    assert.equal(h.effects.some(e => ['notification', 'color', 'note', 'refresh', 'toast', 'openBookingSheet'].includes(e[0])), false);
    assert.match(h.effects.at(-1)[2], /Не удалось подтвердить результат/);
  });
}

test('fulfilled transport error does not claim unchanged series', async () => {
  const h = harness('rpc'); const pending = h.submit(h.open());
  await h.entered.promise; h.gate.resolve({ data:null, error:{ message:'network series_slot_unavailable' } });
  assert.equal((await pending).error, null);
  assert.match(h.effects.at(-1)[2], /Не удалось подтвердить результат/);
  assert.doesNotMatch(h.effects.at(-1)[2], /без изменений/);
});

test('auxiliary rejection distinguishes confirmed primary save from unknown', async () => {
  const h = harness('color'); const pending = h.submit(h.open());
  await h.entered.promise; h.gate.reject(Error('color failed'));
  assert.equal((await pending).error, null);
  assert.match(h.effects.at(-1)[2], /Основное изменение сохранено/);
  assert.doesNotMatch(h.effects.at(-1)[2], /без изменений/);
});

test('fulfilled unsuccessful refresh does not reopen a stale booking summary', async () => {
  const h = harness('refresh'); const form = h.open(); const pending = h.submit(form);
  await h.entered.promise; h.gate.resolve(false); assert.equal((await pending).error, null);
  assert.equal(h.nodes['#bookingEditForm'], form); assert.equal(form.button.disabled, false);
  assert.match(h.effects.at(-1)[2], /Основное изменение сохранено, но журнал не обновлён/);
  assert.equal(h.effects.some(e => e[0] === 'openBookingSheet'), false);
});

// Exercise actual shared helper internals, rather than the controller harness's
// auxiliary spies, to verify writes into a replacement account's cache cannot occur.
function helperHarness() {
  const gate = deferred(), effects = [];
  const state = {
    currentUser:{ id:userId }, sessionGeneration:1, activeClientOrganizationId:'org-A', allBookings:[{ id:ids.A }], writesAllowed:true,
    bookingColors:new Map(), pendingBookingColors:new Set(),
    bookingNotes:new Map(), pendingBookingNotes:new Set(),
    validBookingColor:value => value,
    db:{ rpc:(name, params) => { effects.push(['rpc', name, params]); return gate.promise; } },
    renderBookingData:() => effects.push(['render']),
    persistBookingColors:() => effects.push(['persistColors', state.currentUser.id, [...state.bookingColors], [...state.pendingBookingColors]]),
    persistBookingNotes:() => effects.push(['persistNotes', state.currentUser.id, [...state.bookingNotes], [...state.pendingBookingNotes]])
  };
  const context = vm.createContext(state);
  vm.runInContext(lifecycleDeclarations + '\n' + source.match(/^function sessionIsCurrent[^\n]+/m)[0]
    + '\n' + between('function captureBookingMetadataContext(', 'async function loadRemoteBookingColors('), context);
  const replaceAccount = () => Object.assign(state, {
    currentUser:{ id:'new-account' }, allBookings:[{ id:ids.A, color_key:'green', provider_note:'new note' }],
    bookingColors:new Map([[ids.A, 'green']]), pendingBookingColors:new Set([ids.A]),
    bookingNotes:new Map([[ids.A, 'new note']]), pendingBookingNotes:new Set([ids.A])
  });
  return { state, context, gate, effects, replaceAccount };
}

for (const kind of ['Color', 'Note']) {
  test(`real saveBooking${kind} checks ownership before any side effects`, async () => {
    const h = helperHarness();
    const result = await h.context[`saveBooking${kind}`](ids.A, 'blue', { rerender:false, isCurrent:() => false });
    assert.equal(result, false); assert.deepEqual(h.effects, []);
    assert.equal(h.state.bookingColors.size, 0); assert.equal(h.state.bookingNotes.size, 0);
  });

  for (const reply of [{ data:'blue',error:null }, { data:null,error:{ message:'failed' } }]) {
    test(`real saveBooking${kind} does not persist or mutate replacement account after ${reply.error ? 'error' : 'success'}`, async () => {
      const h = helperHarness();
      const pending = h.context[`saveBooking${kind}`](ids.A, 'blue', { rerender:false, isCurrent:() => h.state.currentUser.id === userId });
      assert.equal(h.effects.filter(e => e[0] === 'rpc').length, 1);
      h.replaceAccount(); const before = h.effects.length;
      h.gate.resolve(reply); assert.equal(await pending, false);
      assert.deepEqual(h.effects.slice(before), []);
      assert.deepEqual([...h.state.bookingColors], [[ids.A, 'green']]);
      assert.deepEqual([...h.state.bookingNotes], [[ids.A, 'new note']]);
      assert.deepEqual([...h.state.pendingBookingColors], [ids.A]);
      assert.deepEqual([...h.state.pendingBookingNotes], [ids.A]);
    });
  }

  test(`real saveBooking${kind} keeps default current-caller contract`, async () => {
    const h = helperHarness(); const pending = h.context[`saveBooking${kind}`](ids.A, 'blue', { rerender:false });
    h.gate.resolve({ data:'blue',error:null }); assert.equal(await pending, true);
    assert.equal(h.effects.filter(e => e[0].startsWith('persist')).length, 2);
  });
}

const turn = () => new Promise(resolve => setImmediate(resolve));
function slotsHarness() {
  const h = harness(); const reads = [];
  h.context.getProviderAvailableSlots = params => {
    const gate = deferred(); reads.push({ ...gate, params }); return gate.promise;
  };
  vm.runInContext(between('async function loadBookingEditSlots(', 'function sessionServiceOptions('), h.context);
  return { ...h, reads };
}

test('real late slot load cannot replace new editor selection or holder', async () => {
  const h = slotsHarness();
  h.context.allBookings[1].booking_time = '14:00:00';
  h.context.openBookingEditor(ids.A); h.context.openBookingEditor(ids.B);
  const holder = h.nodes['#editBookingTimes'];
  assert.equal(h.context.bookingEditTime, '14:00');
  h.reads[0].resolve({ data:[{ booking_time:'10:00:00' }], error:null }); await turn();
  assert.equal(h.context.bookingEditTime, '14:00');
  assert.equal(holder.innerHTML, '<span>Ищем свободное время…</span>');
  h.reads[1].resolve({ data:[{ booking_time:'14:00:00' }], error:null }); await turn();
  assert.match(holder.innerHTML, /data-edit-booking-time="14:00"/);
});

test('real same-editor out-of-order slot loads preserve the latest date response', async () => {
  const h = slotsHarness(); h.context.openBookingEditor(ids.A);
  h.nodes['#editBookingDate'].value = '2026-09-21';
  const second = h.context.loadBookingEditSlots(ids.A);
  h.reads[1].resolve({ data:[{ booking_time:'13:00:00' }], error:null }); await second;
  const html = h.nodes['#editBookingTimes'].innerHTML;
  h.reads[0].resolve({ data:[{ booking_time:'10:00:00' }], error:null }); await turn();
  assert.equal(h.nodes['#editBookingTimes'].innerHTML, html);
});

test('real rejected slot load is handled and a later read recovers', async () => {
  const h = slotsHarness(); h.context.openBookingEditor(ids.A);
  h.reads[0].reject(Error('slots failed')); await turn();
  assert.match(h.nodes['#editBookingTimes'].innerHTML, /Не удалось загрузить/);
  const retry = h.context.loadBookingEditSlots(ids.A);
  h.reads[1].resolve({ data:[{ booking_time:'13:00:00' }], error:null }); await retry;
  assert.match(h.nodes['#editBookingTimes'].innerHTML, /data-edit-booking-time="13:00"/);
});

test('late RPC refusal must not paint an error or reload slots in editor B', async () => {
  const h = harness('rpc'); const pending = h.submit(h.open());
  await h.entered.promise; const formB = h.open('B'); const effectsBeforeReply = h.effects.length;
  h.gate.resolve(refusal); const result = await pending;
  assert.equal(result.error, null);
  assert.deepEqual(h.effects.slice(effectsBeforeReply), []);
  assert.equal(h.nodes['#bookingEditForm'], formB);
});

test('reopening the same booking still replaces the old editor identity', async () => {
  const h = harness('rpc'); const formA = h.open(); const pending = h.submit(formA);
  await h.entered.promise; const freshA = h.open(); assert.notEqual(freshA, formA);
  const effectsBeforeReply = h.effects.length;
  h.gate.resolve(success); const result = await pending;
  assert.equal(result.error, null);
  assert.deepEqual(h.effects.slice(effectsBeforeReply), []);
  assert.equal(h.nodes['#bookingEditForm'], freshA);
});

for (const phase of ['rpc', 'color', 'note', 'refresh']) {
  test(`current ${phase} rejection must be handled and restore a usable editor`, async () => {
    const h = harness(phase); const form = h.open(); const pending = h.submit(form);
    await h.entered.promise; h.gate.reject(Error(`unexpected_${phase}_rejection`)); const result = await pending;
    assert.equal(result.error, null, 'unexpected rejected Promise must not escape the submit handler');
    assert.equal(h.nodes['#bookingEditForm'], form);
    assert.equal(form.button.disabled, false);
    assert.notEqual(form.button.textContent, 'Сохраняем…');
  });
}
