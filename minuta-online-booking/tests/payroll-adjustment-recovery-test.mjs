import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';

// TEST-ONLY, intentionally RED on v450. Full actual payroll controller executes;
// DOM/auth and a sequential committed-ledger RPC adapter are local VM fixtures.
// No PostgreSQL, SDK transport, real payroll, remote writes or concurrency proof.
// Adapter models only v72:558-589: each valid adjustment call INSERTs a new UUID,
// recomputes period total, and writes one audit. The five-argument RPC has no
// request ID. This is source-backed simulation, NOT an executed SQL assertion.
// Do not add this RED diagnostic suite to green release CI without a real fix.
const source = readFileSync(process.env.MINUTA_PAYROLL_SOURCE || new URL('../payroll-management.js', import.meta.url), 'utf8');
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const actor = id(1), organization = id(2), performer = id(3), period = id(4), booking = id(5);
const basePayroll = 10000;
const clone = value => JSON.parse(JSON.stringify(value));

async function harness() {
  const elements = new Map(), handlers = new Map(), mutations = [], ledger = [], audit = [], reads = [], notices = [];
  const writeControls = ['#payrollEnabled', '#adjustmentSubmit'];
  function $(selector) {
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
  const total = () => basePayroll + ledger.reduce((sum, row) => sum + row.amount_rub, 0);
  function workspace() {
    return {
      organization_id:organization, current_role:'owner', can_manage:true, enabled:true,
      members:[{ id:performer, display_name:'Специалист', role:'specialist', is_bookable:true }], locations:[], plans:[],
      periods:[{ id:period, name:'Сентябрь', location_id:null, starts_on:'2026-09-01', ends_on:'2026-09-30',
        status:'draft', total_revenue_rub:25000, total_payroll_rub:total(), source_fingerprint:'fixture',
        calculated_at:'2026-09-06T00:00:00Z', approved_at:null, paid_at:null }],
      items:[{ id:id(6), period_id:period, performer_id:performer, booking_id:booking, amount_rub:25000,
        rate_bps:4000, payroll_rub:basePayroll, service_name:'Услуга', booking_date:'2026-09-01' }],
      adjustments:ledger.map(({ organization_id, created_by, ...row }) => clone(row)), audit:clone(audit),
    };
  }
  const db = { rpc(name, params) {
    if (name === 'get_minuta_payroll_workspace') {
      assert.equal(params.p_organization, organization); reads.push(clone(params));
      return Promise.resolve({ data:workspace(), error:null });
    }
    assert.equal(name, 'add_minuta_payroll_adjustment', 'No other mutating RPC belongs to this fixture');
    assert.equal(params.p_organization, organization); assert.equal(params.p_period, period); assert.equal(params.p_performer, performer);
    assert.ok(Number.isInteger(params.p_amount_rub) && params.p_amount_rub !== 0 && Math.abs(params.p_amount_rub) <= 10000000);
    assert.ok(params.p_reason.trim().length >= 3);
    // COMMIT before delivery. There is intentionally no synthetic payload/time
    // deduplication: v72 has no such constraint or replay key on this endpoint.
    const row = { id:id(100 + ledger.length), period_id:period, organization_id:organization,
      performer_id:performer, amount_rub:params.p_amount_rub, reason:params.p_reason.trim(),
      created_by:actor, created_at:'2026-09-06T12:00:00Z' };
    ledger.push(row);
    audit.push({ id:audit.length + 1, actor_id:actor, action:'payroll_adjustment_added', subject_id:row.id,
      details:{ period_id:period, performer_id:performer, amount_rub:row.amount_rub, reason:row.reason }, created_at:row.created_at });
    const operation = { name, params:clone(params), row:clone(row),
      response:{ data:{ id:row.id, organization_id:organization, period_id:period, total_payroll_rub:total() }, error:null } };
    mutations.push(operation);
    return new Promise(resolve => { operation.resolve = resolve; });
  } };
  const context = vm.createContext({ window:{}, document:{ addEventListener:(name, handler) => handlers.set(name, handler) } });
  vm.runInContext(source, context, { filename:'actual-payroll-management.js' });
  const controller = context.window.MinutaPayroll.createController({ db, $, escapeHtml:value => String(value ?? ''),
    notify:message => notices.push(message), requireWrites:() => true, getCurrentUser:() => ({ id:actor }),
    getSessionGeneration:() => 1, sessionIsCurrent:(user, generation) => user === actor && generation === 1,
    applyWriteAvailability(){} });
  controller.bind(); assert.equal((await controller.setOrganization({ id:organization })).ok, true);
  function fill(amount = 500, reason = 'Премия за дополнительную смену') {
    $('#payrollAdjustmentPeriod').value = period; $('#payrollAdjustmentPerformer').value = performer;
    $('#payrollAdjustmentAmount').value = amount; $('#payrollAdjustmentReason').value = reason;
  }
  function submit() {
    return handlers.get('submit')({ target:$('#payrollAdjustmentForm'), submitter:$('#adjustmentSubmit'), preventDefault(){} });
  }
  async function deliver(index, kind, pending) {
    const operation = mutations[index];
    operation.resolve(kind === 'lost' ? { data:null, error:{ message:'TypeError: Failed to fetch', details:'', hint:'', code:'' }, status:0 }
      : kind === 'malformed' ? { data:null, error:null } : operation.response);
    await pending;
  }
  const snapshot = () => clone({ ledger, audit, total:total() });
  fill();
  return { $, controller, mutations, ledger, audit, reads, notices, fill, submit, deliver, snapshot, total };
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
  assert.doesNotMatch(h.$('#payrollAdjustmentError').textContent, /не сохранено|деньги не затронуты/i,
    'a transport failure does not prove absence of the committed payroll adjustment');
});
