import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

// Original v450 baseline: 3 PASS / 3 RED. Full actual payroll controller executes;
// DOM/auth and a sequential committed-ledger RPC adapter are local VM fixtures.
// No PostgreSQL, SDK transport, real payroll, remote writes or concurrency proof.
// Adapter models only v72:558-589: each valid adjustment call INSERTs a new UUID,
// recomputes period total, and writes one audit. The five-argument RPC has no
// request ID. This is source-backed simulation, NOT an executed SQL assertion.
// Browser reload/new controller recovery and actual SQL idempotency are NOT proved.
const source = readFileSync(process.env.MINUTA_PAYROLL_SOURCE || new URL('../payroll-management.js', import.meta.url), 'utf8');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const actor = id(1), organization = id(2), performer = id(3), period = id(4), booking = id(5);
const basePayroll = 10000;
const clone = value => JSON.parse(JSON.stringify(value));

async function harness() {
  const elements = new Map(), handlers = new Map(), mutations = [], ledger = [], audit = [], reads = [], notices = [];
  let currentActor = actor, generation = 1, activeOrg = organization, nextRefusal = null, failNextRead = false, deferredRead = null, writesAllowed = true;
  const periodFor = org => org === organization ? period : id(8);
  const writeControls = ['#payrollEnabled', '#adjustmentSubmit'];
  function $(selector) {
    if (selector === '#payrollAdjustmentForm button[type="submit"]') return $('#adjustmentSubmit');
    if (!elements.has(selector)) {
      let html = '', value = '', options = [];
      const select = ['#payrollAdjustmentPeriod', '#payrollAdjustmentPerformer', '#payrollPlanPerformer', '#payrollPeriodLocation'].includes(selector);
      elements.set(selector, {
        id:selector.slice(1), dataset:{}, disabled:false, hidden:false, checked:false, textContent:'', title:'',
        get value(){ return value; },
        set value(next){ value = select && !options.includes(String(next)) ? '' : String(next); },
        get innerHTML(){ return html; },
        set innerHTML(next){
          html = String(next);
          if (select) { options = [...html.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]); value = options[0] || ''; }
        },
        closest:target => target === '#payrollPanel' ? $('#payrollPanel') : null,
        querySelectorAll:target => { assert.equal(target, '[data-payroll-write]'); return writeControls.map($); },
      });
    }
    return elements.get(selector);
  }
  $('#payrollStartDate').value = '2026-09-01'; $('#payrollEndDate').value = '2026-09-30';
  $('#adjustmentSubmit').textContent = 'Добавить';
  const total = (periodId = period) => basePayroll + ledger.filter(row => row.period_id === periodId).reduce((sum, row) => sum + row.amount_rub, 0);
  function workspace(org) {
    const currentPeriod = periodFor(org);
    return {
      organization_id:org, current_role:'owner', can_manage:true, enabled:true,
      members:[{ id:performer, display_name:'Специалист', role:'specialist', is_bookable:true }], locations:[], plans:[],
      periods:[{ id:currentPeriod, name:'Сентябрь', location_id:null, starts_on:'2026-09-01', ends_on:'2026-09-30',
        status:'draft', total_revenue_rub:25000, total_payroll_rub:total(currentPeriod), source_fingerprint:'fixture',
        calculated_at:'2026-09-06T00:00:00Z', approved_at:null, paid_at:null }],
      items:[{ id:id(6), period_id:currentPeriod, performer_id:performer, booking_id:booking, amount_rub:25000,
        rate_bps:4000, payroll_rub:basePayroll, service_name:'Услуга', booking_date:'2026-09-01' }],
      adjustments:ledger.filter(row => row.organization_id === org).map(({ organization_id, created_by, ...row }) => clone(row)),
      audit:clone(audit.filter(entry => ledger.find(row => row.id === entry.subject_id)?.organization_id === org)),
    };
  }
  const db = { rpc(name, params) {
    if (name === 'get_minuta_payroll_workspace') {
      reads.push(clone(params));
      if (failNextRead) { failNextRead = false; return Promise.reject(Error('workspace transport failed')); }
      if (deferredRead) {
        const operation = deferredRead; deferredRead = null;
        return new Promise((resolve, reject) => { operation.resolve = resolve; operation.reject = reject; });
      }
      return Promise.resolve({ data:workspace(params.p_organization), error:null });
    }
    assert.equal(name, 'add_minuta_payroll_adjustment', 'No other mutating RPC belongs to this fixture');
    assert.equal(params.p_period, periodFor(params.p_organization)); assert.equal(params.p_performer, performer);
    if (nextRefusal) {
      const operation = { name, params:clone(params), response:{ data:null, error:nextRefusal } };
      nextRefusal = null; mutations.push(operation);
      return new Promise((resolve, reject) => { operation.resolve = resolve; operation.reject = reject; });
    }
    assert.ok(Number.isInteger(params.p_amount_rub) && params.p_amount_rub !== 0 && Math.abs(params.p_amount_rub) <= 10000000);
    assert.ok(params.p_reason.trim().length >= 3);
    // COMMIT before delivery. There is intentionally no synthetic payload/time
    // deduplication: v72 has no such constraint or replay key on this endpoint.
    const row = { id:id(100 + ledger.length), period_id:params.p_period, organization_id:params.p_organization,
      performer_id:performer, amount_rub:params.p_amount_rub, reason:params.p_reason.trim(),
      created_by:currentActor, created_at:'2026-09-06T12:00:00Z' };
    ledger.push(row);
    audit.push({ id:audit.length + 1, actor_id:currentActor, action:'payroll_adjustment_added', subject_id:row.id,
      details:{ period_id:row.period_id, performer_id:performer, amount_rub:row.amount_rub, reason:row.reason }, created_at:row.created_at });
    const operation = { name, params:clone(params), row:clone(row),
      response:{ data:{ id:row.id, organization_id:row.organization_id, period_id:row.period_id, total_payroll_rub:total(row.period_id) }, error:null } };
    mutations.push(operation);
    return new Promise((resolve, reject) => { operation.resolve = resolve; operation.reject = reject; });
  } };
  const context = vm.createContext({ window:{}, document:{ addEventListener:(name, handler) => handlers.set(name, handler) } });
  vm.runInContext(source, context, { filename:'actual-payroll-management.js' });
  const controller = context.window.MinutaPayroll.createController({ db, $, escapeHtml:value => String(value ?? ''),
    notify:message => notices.push(message), requireWrites:() => writesAllowed, getCurrentUser:() => ({ id:currentActor }),
    getSessionGeneration:() => generation, sessionIsCurrent:(user, version) => user === currentActor && version === generation,
    applyWriteAvailability(){ writeControls.forEach(selector => { $(selector).disabled = !writesAllowed; }); } });
  controller.bind(); assert.equal((await controller.setOrganization({ id:organization })).ok, true);
  function fill(amount = 500, reason = 'Премия за дополнительную смену') {
    $('#payrollAdjustmentPeriod').value = periodFor(activeOrg); $('#payrollAdjustmentPerformer').value = performer;
    $('#payrollAdjustmentAmount').value = amount; $('#payrollAdjustmentReason').value = reason;
  }
  function submit() {
    return handlers.get('submit')({ target:$('#payrollAdjustmentForm'), submitter:$('#adjustmentSubmit'), preventDefault(){} });
  }
  async function deliver(index, kind, pending) {
    const operation = mutations[index];
    if (kind === 'throw') { operation.reject(Error('defensive adjustment transport rejection')); await pending; return; }
    operation.resolve(kind === 'lost' ? { data:null, error:{ message:'TypeError: Failed to fetch', details:'', hint:'', code:'' }, status:0 }
      : kind === 'malformed' ? { data:null, error:null } : operation.response);
    await pending;
  }
  const snapshot = () => clone({ ledger, audit, total:total() });
  fill();
  return { $, controller, mutations, ledger, audit, reads, notices, fill, submit, deliver, snapshot, total,
    input:async () => { if (handlers.has('input')) await handlers.get('input')({ target:$('#payrollAdjustmentAmount') });
      await handlers.get('change')({ target:$('#payrollAdjustmentAmount') }); },
    switchOrg:async org => { activeOrg = org; return controller.setOrganization({ id:org }); },
    resetActor:async next => { currentActor = next; generation += 1; controller.reset(); await controller.setOrganization({ id:activeOrg }); },
    refuseNext:error => { nextRefusal = error; }, failRead:() => { failNextRead = true; },
    deferRead:() => { deferredRead = {}; return deferredRead; },
    disableWrites:() => { writesAllowed = false; writeControls.forEach(selector => { $(selector).disabled = true; }); } };
}

test('positive acknowledged adjustment adds its exact row, audit and total', async t => {
  const h = await harness(), pending = h.submit(); await h.deliver(0, 'success', pending);
  assert.equal(h.ledger.length, 1); assert.equal(h.audit.length, 1); assert.equal(h.total(), 10500);
  assert.deepEqual(h.ledger[0], h.mutations[0].row);
  assert.deepEqual(h.audit[0].details, { period_id:period, performer_id:performer, amount_rub:500, reason:'Премия за дополнительную смену' });
  assert.deepEqual(h.notices, ['Корректировка добавлена']); assert.equal(h.$('#adjustmentSubmit').disabled, false);
  t.diagnostic(`actual controller sha256=${createHash('sha256').update(source).digest('hex')}`);
});

test('positive two explicitly requested identical adjustments after acknowledgement are legitimate separate rows', async () => {
  const h = await harness(), first = h.submit(); await h.deliver(0, 'success', first);
  // Explicit NEW business action after an acknowledged first operation, not a
  // lost-reply retry. Equal amounts/reasons must not be globally deduplicated.
  h.fill(); assert.equal(h.$('#adjustmentSubmit').disabled, false);
  const next = h.submit(); await h.deliver(1, 'success', next);
  assert.equal(h.ledger.length, 2); assert.notEqual(h.ledger[0].id, h.ledger[1].id);
  assert.deepEqual(h.mutations[0].params, h.mutations[1].params);
  assert.equal(h.total(), 11000); assert.equal(h.audit.length, 2);
  assert.deepEqual(h.notices, ['Корректировка добавлена', 'Корректировка добавлена']);
});

test('positive pending single-flight blocks a second submit before first response', async () => {
  const h = await harness(), first = h.submit();
  assert.equal(h.$('#adjustmentSubmit').disabled, true); await h.submit();
  assert.equal(h.mutations.length, 1); await h.deliver(0, 'success', first);
  assert.equal(h.ledger.length, 1); assert.equal(h.total(), 10500);
});

for (const outcome of ['lost', 'malformed']) {
  test(`SAFETY committed adjustment + ${outcome} response + same-form retry must not double the ledger`, async t => {
    const h = await harness(), pending = h.submit();
    const committed = h.snapshot(); // Server fixture already committed; client awaits delivery.
    await h.deliver(0, outcome, pending);
    assert.equal(h.controller.payload.adjustments.length, 1, 'post-error reload exposes the first committed adjustment, not a fake empty ledger');
    const retryAvailable = !h.$('#adjustmentSubmit').disabled;
    const firstReply = { errorText:h.$('#payrollAdjustmentError').textContent, notices:[...h.notices] };
    if (retryAvailable) {
      const retry = h.submit();
      if (h.mutations.length === 2) await h.deliver(1, 'success', retry); else await retry;
    }
    t.diagnostic(JSON.stringify({ retryAvailable, mutationParams:h.mutations.map(operation => operation.params),
      firstReply, actual:h.snapshot() }));
    assert.deepEqual(h.snapshot(), committed, 'An ambiguous operation must be resolved or blocked before retry; a second INSERT/audit/amount is unsafe');
  });
}

test('SAFETY lost committed reply cannot assert that the adjustment was not saved', async () => {
  const h = await harness(), pending = h.submit(); await h.deliver(0, 'lost', pending);
  assert.equal(h.ledger.length, 1); assert.equal(h.controller.payload.periods[0].total_payroll_rub, 10500);
  assert.doesNotMatch(h.$('#payrollAdjustmentError').textContent, /не сохранено/i,
    'a transport failure does not prove absence of the committed payroll adjustment');
});

test('pending parameters stay frozen while input/change and direct duplicate submit occur', async () => {
  const h = await harness(), pending = h.submit(), submitted = clone(h.mutations[0].params);
  h.fill(900, 'Изменённая причина'); await h.input(); await h.submit();
  assert.equal(h.mutations.length, 1); assert.deepEqual(h.mutations[0].params, submitted);
  await h.deliver(0, 'lost', pending);
  await h.controller.load(); await h.input(); await h.submit();
  assert.equal(h.mutations.length, 1); assert.equal(h.$('#adjustmentSubmit').disabled, true);
  assert.equal(h.$('#payrollAdjustmentForm').dataset.adjustmentState, 'unknown');
});

for (const outcome of ['lost', 'throw', 'malformed']) {
  test(`unresolved ${outcome} survives controller reset with the same actor/org`, async () => {
    const h = await harness(), pending = h.submit(); await h.deliver(0, outcome, pending);
    const committed = h.snapshot(); await h.resetActor(actor); h.fill(); await h.submit();
    assert.deepEqual(h.snapshot(), committed); assert.equal(h.mutations.length, 1);
    assert.equal(h.$('#adjustmentSubmit').disabled, true);
  });
}

test('an unresolved organization A does not prevent an independent B operation, but remains locked on return', async () => {
  const h = await harness(), pending = h.submit(); await h.deliver(0, 'lost', pending);
  await h.switchOrg(id(9)); h.fill(); assert.equal(h.$('#adjustmentSubmit').disabled, false);
  const b = h.submit(); await h.deliver(1, 'success', b);
  await h.switchOrg(organization); h.fill(); await h.submit();
  assert.equal(h.mutations.length, 2); assert.equal(h.ledger.filter(row => row.organization_id === organization).length, 1);
  assert.equal(h.$('#adjustmentSubmit').disabled, true);
});

for (const outcome of ['success', 'lost', 'throw']) {
  test(`old A ${outcome} after reset cannot release independently pending actor B`, async () => {
    const h = await harness(), pending = h.submit(); await h.resetActor(id(7)); h.fill();
    const b = h.submit(); const notices = clone(h.notices), label = h.$('#adjustmentSubmit').textContent;
    await h.deliver(0, outcome, pending);
    assert.equal(h.$('#adjustmentSubmit').disabled, true); assert.equal(h.$('#adjustmentSubmit').textContent, label);
    assert.deepEqual(h.notices, notices); await h.deliver(1, 'success', b);
    assert.equal(h.$('#adjustmentSubmit').disabled, false); assert.equal(h.ledger.length, 2);
  });
}

test('a failed post-write read followed by manual reload does not resolve unknown intent', async () => {
  const h = await harness(), pending = h.submit(); h.failRead(); await h.deliver(0, 'lost', pending);
  assert.equal(h.controller.availability, 'error'); await h.controller.load(); await h.submit();
  assert.equal(h.mutations.length, 1); assert.equal(h.$('#adjustmentSubmit').disabled, true);
});

test('exact current SQL refusal with no committed row allows corrected explicit submission', async () => {
  const h = await harness(); h.fill(0); h.refuseNext({ code:'22023', message:'invalid_payroll_adjustment' });
  const pending = h.submit(); await h.deliver(0, 'success', pending);
  assert.equal(h.ledger.length, 0); assert.equal(h.$('#adjustmentSubmit').disabled, false);
  h.fill(); const corrected = h.submit(); await h.deliver(1, 'success', corrected);
  assert.equal(h.ledger.length, 1); assert.equal(h.total(), 10500);
});

for (const [label, reply] of [
  ['organization only', { data:{ organization_id:organization }, error:null }],
  ['missing error property', { data:{ id:id(100), organization_id:organization, period_id:period, total_payroll_rub:10500 } }],
  ['wrong period', { data:{ id:id(100), organization_id:organization, period_id:id(99), total_payroll_rub:10500 }, error:null }],
  ['array ID', { data:{ id:[id(100)], organization_id:organization, period_id:period, total_payroll_rub:10500 }, error:null }],
  ['no-code refusal text', { data:null, error:{ message:'invalid_payroll_adjustment' } }],
  ['transport-code refusal text', { data:null, error:{ code:'08006', message:'invalid_payroll_adjustment' } }],
]) {
  test(`non-confirming ${label} cannot release an unresolved committed adjustment`, async () => {
    const h = await harness(), pending = h.submit(); h.mutations[0].resolve(reply); await pending;
    await h.submit(); assert.equal(h.mutations.length, 1);
    assert.equal(h.$('#payrollAdjustmentForm').dataset.adjustmentState, 'unknown');
    assert.equal(h.notices.length, 0);
  });
}

test('a thrown SQL-looking exception is unknown, not proof of a server rollback', async () => {
  const h = await harness(), pending = h.submit();
  h.mutations[0].reject(Object.assign(Error('invalid_payroll_adjustment'), { code:'22023' })); await pending;
  await h.submit(); assert.equal(h.mutations.length, 1);
  assert.equal(h.$('#payrollAdjustmentForm').dataset.adjustmentState, 'unknown');
});

for (const outcome of ['success', 'lost', 'throw']) {
  test(`queued organization B is loaded after old adjustment ${outcome}`, async () => {
    const h = await harness(), pending = h.submit(); await h.switchOrg(id(9));
    await h.deliver(0, outcome, pending);
    assert.equal(h.controller.payload.organization_id, id(9));
    assert.equal(h.controller.availability, 'ready'); assert.equal(h.$('#adjustmentSubmit').disabled, false);
    assert.equal(h.notices.length, 0, 'old A result cannot toast in queued B');
    h.fill(); const b = h.submit(); await h.deliver(1, 'success', b);
    assert.equal(h.ledger.length, 2);
  });
}

test('settled intent cannot override an independent write-availability restriction', async () => {
  const h = await harness(), pending = h.submit(); h.disableWrites(); await h.deliver(0, 'success', pending);
  assert.equal(h.$('#adjustmentSubmit').disabled, true); await h.submit(); assert.equal(h.mutations.length, 1);
});

test('queued B workspace rejection is recoverable and does not release unresolved A', async () => {
  const h = await harness(), pending = h.submit(); await h.switchOrg(id(9)); h.failRead();
  await assert.doesNotReject(h.deliver(0, 'lost', pending));
  assert.equal(h.controller.availability, 'error'); assert.equal(h.$('#payrollLoading').hidden, true);
  assert.equal(h.$('#payrollWorkspace').hidden, true); assert.equal(h.$('#payrollUnavailable').hidden, false);
  assert.match(h.$('#payrollUnavailableText').textContent, /обновить|загрузить/i);
  assert.equal(h.notices.length, 0);
  await h.controller.load(); assert.equal(h.controller.payload.organization_id, id(9));
  h.fill(); const b = h.submit(); await h.deliver(1, 'success', b);
  await h.switchOrg(organization); h.fill(); await h.submit();
  assert.equal(h.mutations.length, 2); assert.equal(h.$('#adjustmentSubmit').disabled, true);
});

test('late queued B workspace rejection cannot hide or change ready C', async () => {
  const h = await harness(), pending = h.submit(); await h.switchOrg(id(9));
  const readB = h.deferRead(); h.mutations[0].resolve(h.mutations[0].response);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof readB.reject, 'function', 'actual queued B read started');
  await h.switchOrg(id(10));
  const before = clone({ payload:h.controller.payload, availability:h.controller.availability,
    loading:h.$('#payrollLoading').hidden, workspace:h.$('#payrollWorkspace').hidden,
    unavailable:h.$('#payrollUnavailable').hidden, text:h.$('#payrollUnavailableText').textContent, notices:h.notices });
  readB.reject(Error('late B workspace transport failure')); await assert.doesNotReject(pending);
  assert.deepEqual(clone({ payload:h.controller.payload, availability:h.controller.availability,
    loading:h.$('#payrollLoading').hidden, workspace:h.$('#payrollWorkspace').hidden,
    unavailable:h.$('#payrollUnavailable').hidden, text:h.$('#payrollUnavailableText').textContent, notices:h.notices }), before);
  h.fill(); const c = h.submit(); await h.deliver(1, 'success', c);
  assert.equal(h.ledger[1].organization_id, id(10));
});

for (const context of ['organization', 'actor']) {
  test(`completed unknown warning follows its ${context} without changing the latch`, async () => {
    const h = await harness(), pending = h.submit(); await h.deliver(0, 'lost', pending);
    assert.equal(h.$('#payrollAdjustmentError').hidden, false);
    if (context === 'organization') await h.switchOrg(id(9));
    else await h.resetActor(id(7));
    assert.equal(h.$('#adjustmentSubmit').disabled, false);
    assert.equal(h.$('#payrollAdjustmentError').hidden, true);
    assert.equal(h.$('#payrollAdjustmentError').textContent, '');
    h.fill(); const b = h.submit(); await h.deliver(1, 'success', b);
    if (context === 'organization') await h.switchOrg(organization);
    else await h.resetActor(actor);
    await h.controller.load(); await h.submit();
    assert.equal(h.mutations.length, 2);
    assert.equal(h.$('#adjustmentSubmit').disabled, true);
    assert.equal(h.$('#payrollAdjustmentForm').dataset.adjustmentState, 'unknown');
    assert.equal(h.$('#payrollAdjustmentError').hidden, false);
    assert.match(h.$('#payrollAdjustmentError').textContent, /Результат корректировки не подтверждён/);
  });
}
