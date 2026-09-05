#!/usr/bin/env node
// TEST-ONLY safety regressions, intentionally RED on the current controller.
// Exactly ONE deferred refund invoke per scenario: no lost-reply/new-key duplication.
// Executes actual controller, provider construction, full handleSession and actual
// organization callback. DOM/auth/bootstrap/transport are explicit local fixtures.
// Not native browser, actual JWT login, database, payment or deployment evidence.
// No invented controller session API: options come from actual provider wiring.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

const controllerSource = readFileSync(new URL('../payment-management.js', import.meta.url), 'utf8');
const providerSource = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function between(start, end, includeEnd = false) {
  const from = providerSource.indexOf(start); assert.notEqual(from, -1, start);
  const to = providerSource.indexOf(end, from); assert.notEqual(to, -1, end);
  return providerSource.slice(from, to + (includeEnd ? end.length : 0));
}
const construction = between('const paymentController = ', 'paymentController.bind();', true);
const sessionFunction = between('async function handleSession(session) {', 'async function providerAccessAllowed(');
const orgBlock = between('onActiveOrganizationChange: organization => {', '\n  }\n});\norganizationController.bind();');
const orgCallback = `${orgBlock.slice('onActiveOrganizationChange: '.length)}\n  }`;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actorA = id(1), actorB = id(2), orgA = id(10), orgB = id(11), attemptA = id(20), attemptB = id(21);
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const expectedOptions = ['$', 'db', 'escapeHtml', 'notify', 'refreshNavigation', 'requireWrites'];

async function harness() {
  const elements = new Map(), handlers = new Map(), windowHandlers = new Map();
  const rpcCalls = [], invokeCalls = [], notifications = [], resetEvents = [], deviceClears = [];
  let formResets = 0, navigationRenders = 0, optionsKeys, nextUuid = 100;
  let resolveInvoke, rejectInvoke;
  const deferred = new Promise((resolve, reject) => { resolveInvoke = resolve; rejectInvoke = reject; });
  const controlIds = ['#paymentRefundAttempt', '#paymentRefundAmount', '#paymentRefundReason', '#refundSubmit', '#reloadPaymentProvider'];
  function $(selector) {
    if (!elements.has(selector)) {
      let markup = '', value = '', optionIds = [];
      const element = {
        id: selector.slice(1), hidden: false, disabled: false, checked: false, textContent: '', dataset: {}, max: '',
        get value() { return value; },
        set value(next) { value = selector === '#paymentRefundAttempt' && !optionIds.includes(String(next)) ? '' : String(next); },
        get innerHTML() { return markup; },
        set innerHTML(next) {
          markup = String(next);
          if (selector === '#paymentRefundAttempt') {
            optionIds = [...markup.matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
            value = optionIds[0] || ''; // Browser select default after options replacement.
          }
        },
        querySelectorAll: () => controlIds.map($),
        addEventListener(name, callback) { handlers.set(`${selector}:${name}`, callback); },
        reset() {
          assert.equal(selector, '#paymentRefundForm'); formResets += 1;
          $('#paymentRefundAmount').value = ''; $('#paymentRefundReason').value = '';
          const select = $('#paymentRefundAttempt');
          select.value = /<option value="([^"]+)"/.exec(select.innerHTML)?.[1] || '';
        },
      };
      elements.set(selector, element);
    }
    return elements.get(selector);
  }
  const noOp = () => {};
  const controllerStub = () => ({ reset() {}, setOrganization() {}, refreshAvailability: async () => {} });
  const ctx = {
    $, $$: () => [], Map, Set, Promise, Date, Intl,
    currentUser: { id: actorA }, sessionGeneration: 1, activeClientOrganizationId: '', bookingSeriesCancellationRevision: 0,
    displayPreferencesSaveRevision: 0, displayPreferencesSaveTimer: null, synchronizationRetryTimer: null,
    notificationTimer: null, bookingsChannel: null, recoveryMode: false, bookingCreationReady: true,
    DEFAULT_DISPLAY_PREFERENCES: {}, DEFAULT_TELEGRAM_CLIENT_SETTINGS: {},
    providerCacheMaintenance: Promise.resolve(), ownServices: [], allBookings: [],
    bookingOutcomes: new Map(), bookingSessionItems: new Map(), bookingColors: new Map(), clientNotes: new Map(),
    navigator: { onLine: true }, writesAllowed: true,
    setTimeout: noOp, clearTimeout: noOp, setInterval: () => 1, clearInterval: noOp,
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: { addEventListener: (name, callback) => handlers.set(name, callback) },
    window: {
      crypto: { randomUUID: () => id(++nextUuid) },
      addEventListener: (type, callback) => {
        if (!windowHandlers.has(type)) windowHandlers.set(type, []);
        windowHandlers.get(type).push(callback);
      },
      dispatchEvent(event) {
        resetEvents.push(event.type);
        for (const callback of windowHandlers.get(event.type) || []) callback(event);
      },
    },
    escapeHtml: value => String(value ?? ''),
    notify: message => notifications.push(message),
    refreshSectionNavigation: () => { navigationRenders += 1; },
    requireWrites: () => ctx.writesAllowed,
    sessionIsCurrent: (user, generation) => ctx.currentUser?.id === user && ctx.sessionGeneration === generation,
    setWritesAllowed: value => { ctx.writesAllowed = value; },
    setBookingCreationReady: value => { ctx.bookingCreationReady = value; },
    providerAccessAllowed: async () => true,
    clearProviderDeviceData: async (...args) => { deviceClears.push(clone(args)); },
    restoreDisplayPreferences: () => ({ pending: false }),
    hydrateCachedBookings: async () => null,
    hydrateOfflineBookingInputs: async () => {}, loadOfflineBookingQueue: async () => {},
    providerViewFromLocation: () => 'bookings',
    synchronizeProvider: async () => {
      // Explicit replacement data fixture, NOT actual synchronizeProvider internals.
      ctx.allBookings = [{ id: `booking-${ctx.currentUser.id}`, actor: ctx.currentUser.id }];
      ctx.bookingOutcomes = new Map([['current', { actor: ctx.currentUser.id }]]);
      ctx.bookingSessionItems = new Map([['current', { actor: ctx.currentUser.id }]]);
      ctx.writesAllowed = true;
    },
    freeSlotsController: { invalidateScope() {} }, REPORT_DEMO_SLUG: 'fixture-demo',
  };
  for (const name of ['teamCalendarController', 'groupBookingsController', 'notificationCenterController', 'providerFeedbackController',
    'clientFieldsController', 'clientImportController', 'organizationController', 'resourceController', 'shiftController',
    'payrollController', 'benefitController', 'loyaltyController', 'inventoryController', 'retentionController',
    'batchBookingsController', 'bookingPolicyController', 'dataGovernanceController']) ctx[name] = controllerStub();
  for (const name of ['renderProviderVerification', 'resetReportSessionState', 'stopLiveUpdates', 'restoreTelegramClientSettings',
    'renderTelegramClientSettings', 'renderProviderPhoneState', 'renderProviderSocialState', 'setAuthTabImmediate', 'showFormError',
    'finishProviderBoot', 'loadBookingColors', 'loadBookingNotes', 'loadLocalClientLabels', 'restoreServiceDurationDefaults',
    'applyDisplayPreferences', 'renderDisplayPreferencesForm', 'queueDisplayPreferencesSync', 'updateScheduleSaveState',
    'renderNotifications', 'startTopbarClock', 'stopTopbarClock', 'showRecoveryReset', 'closeBookingSheet',
    'renderOfflineBookingQueue', 'setSyncState', 'renderTopbarDateTime', 'renderDateStrip', 'renderNotificationTemplates',
    'renderBookingPolicyForm', 'renderVisitorNotificationForm', 'flushOfflineBookings', 'startLiveUpdates',
    'setProviderView', 'syncScheduleContextHistory', 'renderReportDataSourceControl', 'updateProviderClientLinks',
    'loadBookingSettings', 'renderWaitlist', 'loadWaitlist']) ctx[name] = noOp;
  function payload(organization) {
    assert.ok([orgA, orgB].includes(organization));
    return { organization_id: organization, current_role: 'owner', settings: { enabled: true, environment: 'test' },
      recent_attempts: [{ id: organization === orgA ? attemptA : attemptB, status: 'succeeded', amount_minor: 10000,
        captured_amount_minor: 10000, refunded_amount_minor: 0, created_at: '2026-09-05T00:00:00Z' }] };
  }
  ctx.db = {
    rpc: async (name, params) => {
      assert.equal(name, 'get_minuta_payment_workspace');
      rpcCalls.push({ name, params: clone(params), actor: ctx.currentUser?.id ?? null });
      return { data: payload(params.p_organization), error: null };
    },
    functions: { invoke: (name, params) => {
      assert.equal(name, 'yookassa-refund'); invokeCalls.push({ name, params: clone(params), actor: ctx.currentUser?.id ?? null });
      return deferred;
    } },
    auth: { signOut: async () => {} },
    from: name => {
      assert.equal(name, 'performer_profiles');
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { display_name: 'Fixture' } }) }) }) };
    },
  };
  const vm = createContext(ctx);
  runInContext(controllerSource, vm, { filename: 'actual-payment-management.js' });
  const actualCreate = ctx.window.MinutaPayments.createController;
  ctx.window.MinutaPayments.createController = options => {
    optionsKeys = Object.keys(options).sort(); return actualCreate(options);
  };
  runInContext(`${construction}\n${sessionFunction}\nvar onOrgChange = ${orgCallback};`, vm, { filename: 'actual-provider-excerpts.js' });
  async function switchOrg(organization) {
    ctx.onOrgChange({ id: organization, current_role: 'owner', public_slug: `fixture-${organization}` });
    // Actual callback does not await setOrganization; drain its fulfilled mock RPC.
    await tick(); await tick();
  }
  await switchOrg(orgA);
  async function session(user) { await ctx.handleSession(user ? { user: { id: user } } : null); await tick(); }
  function maps() { return { bookings: clone(ctx.allBookings), outcomes: clone([...ctx.bookingOutcomes]), sessions: clone([...ctx.bookingSessionItems]) }; }
  function ui() {
    return { panelHidden: $('#paymentProviderPanel').hidden, formHidden: $('#paymentRefundForm').hidden,
      amount: $('#paymentRefundAmount').value, reason: $('#paymentRefundReason').value,
      attempt: $('#paymentRefundAttempt').value, controls: controlIds.map(selector => [selector, $(selector).disabled]),
      formResets, navigationRenders };
  }
  let pending;
  function submit() {
    $('#paymentRefundAmount').value = '10.00'; $('#paymentRefundReason').value = 'Возврат из контекста A';
    pending = Promise.resolve(handlers.get('submit')({ target: $('#paymentRefundForm'), preventDefault() {} }))
      .then(() => null, error => ({ name: error.name, message: error.message }));
    assert.equal(invokeCalls.length, 1);
    assert.equal(invokeCalls[0].params.body.organization_id, orgA);
    assert.equal(invokeCalls[0].params.body.attempt_id, attemptA);
  }
  async function settle(kind) {
    if (kind === 'success') resolveInvoke({ data: { ok: true, refund_id: id(90), status: 'succeeded', amount_minor: 1000 }, error: null });
    else if (kind === 'error') resolveInvoke({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function' } });
    else rejectInvoke(new Error('defensive_unexpected_invoke_rejection'));
    const escaped = await pending; await tick(); return escaped;
  }
  return { ctx, optionsKeys, invokeCalls, rpcCalls, notifications, resetEvents, deviceClears,
    ui, maps, submit, settle, switchOrg, session };
}

test('fixture evidence: options originate from actual provider construction, not invented session APIs', async t => {
  const h = await harness();
  for (const key of expectedOptions) assert.ok(h.optionsKeys.includes(key));
  t.diagnostic(`actual controller option keys=${JSON.stringify(h.optionsKeys)}`);
  t.diagnostic(`controller sha256=${createHash('sha256').update(controllerSource).digest('hex')}; provider sha256=${createHash('sha256').update(providerSource).digest('hex')}`);
});

for (const kind of ['success', 'error']) {
  test(`positive same actor/org: current ${kind} may update its own form`, async () => {
    const h = await harness(); h.submit(); const before = h.rpcCalls.length;
    assert.equal(await h.settle(kind), null);
    assert.equal(h.invokeCalls.length, 1);
    assert.equal(h.rpcCalls.length - before, 1);
    assert.equal(h.notifications.length, 1);
    assert.equal(h.ui().formResets, kind === 'success' ? 1 : 0);
    assert.equal(h.ui().controls.every(([, disabled]) => !disabled), true);
  });
}
test('positive actual same-user token refresh does not reset session generation', async () => {
  const h = await harness(); h.submit(); const generation = h.ctx.sessionGeneration;
  await h.session(actorA);
  assert.equal(h.ctx.sessionGeneration, generation); assert.equal(h.resetEvents.length, 0);
  assert.equal(await h.settle('success'), null); assert.equal(h.ui().formResets, 1);
});
test('positive same-org callback refresh keeps the current refund attached', async () => {
  const h = await harness(); h.submit(); await h.switchOrg(orgA);
  const beforeRpc = h.rpcCalls.length;
  assert.equal(await h.settle('success'), null);
  assert.equal(h.invokeCalls.length, 1); assert.equal(h.rpcCalls.length - beforeRpc, 1);
  assert.equal(h.ui().formResets, 1); assert.deepEqual(h.notifications, ['Возврат выполнен']);
});
test('SAFETY organization switch must release the previous context busy state', async t => {
  const h = await harness(); h.submit(); await h.switchOrg(orgB);
  const controlsBeforeLateReply = h.ui().controls;
  // Resolve transport so the fixture leaves no pending operation behind; this
  // assertion concerns B's state BEFORE that late reply, not its later cleanup.
  await h.settle('error');
  t.diagnostic(JSON.stringify({ controlsBeforeLateReply }));
  assert.equal(controlsBeforeLateReply.every(([, disabled]) => !disabled), true,
    'Organization B cannot inherit organization A refund busy lock');
});

const transitions = {
  'organization A -> organization B': async h => { await h.switchOrg(orgB); },
  'logout': async h => { await h.session(null); assert.equal(h.ctx.currentUser, null); },
  'logout -> same actor fresh session -> reopen A': async h => {
    const generation = h.ctx.sessionGeneration;
    await h.session(null); await h.session(actorA); await h.switchOrg(orgA);
    assert.equal(h.ctx.currentUser.id, actorA); assert.equal(h.ctx.sessionGeneration, generation + 2);
  },
  'account A -> account B with replaced maps -> reopen B': async h => {
    const oldOutcomes = h.ctx.bookingOutcomes, oldBookings = h.ctx.allBookings;
    await h.session(actorB); await h.switchOrg(orgB);
    assert.notEqual(h.ctx.bookingOutcomes, oldOutcomes); assert.notEqual(h.ctx.allBookings, oldBookings);
    assert.equal(h.ctx.bookingOutcomes.get('current').actor, actorB);
    assert.ok(h.deviceClears.some(([user]) => user === actorA));
  },
};
for (const [name, transition] of Object.entries(transitions)) {
  for (const kind of ['success', 'error', 'unexpected-reject']) {
    test(`SAFETY ${name}: late ${kind} must not affect the replacement context`, async t => {
      const h = await harness(); h.submit(); await transition(h);
      const beforeUi = h.ui(), beforeMaps = h.maps(), beforeRpc = h.rpcCalls.length, beforeNotifications = h.notifications.length;
      const escaped = await h.settle(kind);
      const observed = { escaped, additionalRpc: h.rpcCalls.slice(beforeRpc),
        notifications: h.notifications.slice(beforeNotifications), beforeUi, afterUi: h.ui(),
        mapsUnchanged: JSON.stringify(h.maps()) === JSON.stringify(beforeMaps), invokeCount: h.invokeCalls.length };
      t.diagnostic(JSON.stringify(observed));
      assert.equal(h.invokeCalls.length, 1, 'This is NOT a repeat-submit/duplicate-refund scenario');
      assert.deepEqual(h.maps(), beforeMaps, 'Current-account maps must remain unchanged');
      assert.equal(escaped, null, 'Defensive adapter rejection must be contained even after context disposal');
      assert.deepEqual(h.notifications.slice(beforeNotifications), [], 'Old refund must not toast in another context');
      assert.deepEqual(h.rpcCalls.slice(beforeRpc), [], 'Old completion must not reload the replacement organization');
      assert.deepEqual(h.ui(), beforeUi, 'Old completion must not reset/unlock/render another form');
    });
  }
}
