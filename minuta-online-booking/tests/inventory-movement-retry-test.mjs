import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual complete inventory controller, including bind/submit/input/change,
// reload/render and request ID generation. DOM and RPC are explicit VM fixtures.
// The synthetic ledger below models ONLY v82:304-341 movement replay,
// quantity guards and response shape. It is NOT executed SQL, locking/RLS proof,
// v113 costing, native browser evidence or a real inventory operation.
// A committed write followed by a lost response is represented by an error
// envelope (ordinary transport shape), not an unexpected rejected SDK promise.
// The safety RED cases concern unchanged canonical payload after unknown, NOT
// deduplication by amount. Explicit new movements of the same amount are legal.
const source = readFileSync(process.env.MINUTA_INVENTORY_SOURCE || new URL('../inventory-management.js', import.meta.url), 'utf8');
const ids = {
  actor:'11111111-1111-4111-8111-111111111111',
  org:'22222222-2222-4222-8222-222222222222',
  warehouse:'33333333-3333-4333-8333-333333333333',
  item:'44444444-4444-4444-8444-444444444444',
  location:'55555555-5555-4555-8555-555555555555',
};
const otherIds = Object.fromEntries(Object.entries(ids).map(([key, value]) => [key, value.replace(/^[0-9]/, '9')]));
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const payloadOf = ({ p_request_id, ...payload }) => payload;
const lostReply = () => ({ data:null, error:{ code:'', message:'TypeError: Failed to fetch', details:'Synthetic response lost after commit' } });

function syntheticLedger(fixture = ids) {
  const rows = [], byRequest = new Map();
  let balance = 10;
  function apply(params) {
    assert.equal(params.p_organization, fixture.org);
    assert.equal(params.p_warehouse, fixture.warehouse);
    assert.equal(params.p_item, fixture.item);
    assert.match(params.p_request_id, /^[0-9a-f-]{36}$/);
    assert.ok(['receipt', 'write_off', 'inventory'].includes(params.p_kind));
    if (params.p_kind === 'inventory') assert.ok(Number.isInteger(params.p_counted_quantity) && params.p_counted_quantity >= 0);
    else assert.ok(Number.isInteger(params.p_quantity) && params.p_quantity > 0, 'small integral quantities isolate identity from numeric rounding');
    const key = `${params.p_organization}:${params.p_request_id}`;
    const existing = byRequest.get(key);
    const delta = params.p_kind === 'inventory' ? params.p_counted_quantity - balance
      : params.p_kind === 'receipt' ? params.p_quantity : -params.p_quantity;
    if (existing) {
      // Actual v82 compares warehouse/item/kind/quantity, but NOT reason on replay.
      if (existing.warehouse_id !== params.p_warehouse || existing.inventory_item_id !== params.p_item
        || existing.movement_type !== params.p_kind
        || (params.p_kind === 'inventory' ? existing.quantity_after !== params.p_counted_quantity : existing.quantity_delta !== delta)) {
        return { data:null, error:{ code:'23505', message:'inventory_request_conflict' } };
      }
      return { data:{ organization_id:fixture.org, id:existing.id, quantity_after:existing.quantity_after }, error:null };
    }
    if (balance + delta < 0) return { data:null, error:{ code:'55000', message:'insufficient_inventory_stock' } };
    if (['write_off', 'inventory'].includes(params.p_kind) && params.p_reason.trim().length < 2)
      return { data:null, error:{ code:'22023', message:'inventory_reason_required' } };
    balance += delta;
    const row = { id:rows.length + 1, organization_id:fixture.org, warehouse_id:fixture.warehouse,
      inventory_item_id:fixture.item, movement_type:params.p_kind, quantity_delta:delta, quantity_after:balance,
      request_id:params.p_request_id, reason:params.p_reason.trim(), actor_id:fixture.actor,
      created_at:'2026-09-06T09:00:00Z' };
    rows.push(row); byRequest.set(key, row);
    return { data:{ organization_id:fixture.org, id:row.id, quantity_after:balance }, error:null };
  }
  const workspace = () => ({ organization_id:fixture.org, current_role:'owner', enabled:true,
    auto_deduct_completed_visits:false,
    locations:[{ id:fixture.location, name:'Синтетический филиал', active:true }], services:[], usage:[], audit:[],
    items:[{ id:fixture.item, name:'Материал', unit:'piece', low_stock_threshold:0, active:true }],
    warehouses:[{ id:fixture.warehouse, location_id:fixture.location, name:'Склад', active:true }],
    balances:[{ warehouse_id:fixture.warehouse, inventory_item_id:fixture.item, quantity:balance }], movements:clone(rows) });
  return { apply, workspace, rows, get balance() { return balance; } };
}

async function harness({ deferFirstReply = true, deferAllReplies = false, firstRefusal = null } = {}) {
  const ledger = syntheticLedger(), otherLedger = syntheticLedger(otherIds), calls = [], effects = [], listeners = new Map(), nodes = new Map();
  const readResponses = [];
  const auth = { actor:ids.actor, generation:1 };
  let nonce = 0, releaseFirstReply, rejectFirstReply;
  const firstReply = new Promise((resolve, reject) => { releaseFirstReply = resolve; rejectFirstReply = reject; });
  const movementFields = ['inventoryMovementWarehouse', 'inventoryMovementItem', 'inventoryMovementKind',
    'inventoryMovementQuantity', 'inventoryCountedQuantity', 'inventoryMovementReason'];
  const selectIds = new Set(['inventoryMovementWarehouse', 'inventoryMovementItem', 'inventoryUsageService',
    'inventoryUsageItem', 'inventoryWarehouseLocation']);
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const element = { id, value:'', disabled:false, hidden:false, checked:false, dataset:{}, textContent:'',
      closest(selector) {
        if (selector === '#inventoryPanel') return node('inventoryPanel');
        if (selector === '#inventoryMovementForm' && (id === 'inventoryMovementForm' || movementFields.includes(id)))
          return node('inventoryMovementForm');
        return null;
      },
      querySelectorAll(selector) {
        assert.equal(id, 'inventoryPanel'); assert.equal(selector, '[data-inventory-write]');
        // Actual provider.html movement fields lack this attribute; its button has it.
        return [node('movementSubmit')];
      },
      reset() {
        assert.equal(id, 'inventoryMovementForm'); effects.push(['formReset']);
        node('inventoryMovementKind').value = 'receipt'; node('inventoryMovementQuantity').value = '';
        node('inventoryCountedQuantity').value = '0'; node('inventoryMovementReason').value = '';
      },
    };
    let html = '';
    if (selectIds.has(id)) {
      let selected = '';
      Object.defineProperty(element, 'value', { get:() => selected, set:value => {
        const values = [...html.matchAll(/<option value="([^"]*)"/g)].map(match => match[1]);
        selected = values.includes(String(value)) ? String(value) : '';
      } });
    }
    Object.defineProperty(element, 'innerHTML', { get:() => html, set:value => {
      html = String(value);
      element.textContent = html.replace(/<[^>]*>/g, '');
      // Actual render replaces select options; emulate first-option selection.
      // Selection restoration is tested separately from the one-target ledger.
      if (selectIds.has(id)) element.value = html.match(/<option value="([^"]*)"/)?.[1] || '';
    } });
    nodes.set(id, element); return element;
  }
  const context = vm.createContext({ window:{}, document:{ addEventListener:(name, callback) => {
    assert.equal(listeners.has(name), false); listeners.set(name, callback);
  } }, crypto:{ randomUUID:() => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++nonce).padStart(12, '0')}` }, Intl, Date });
  vm.runInContext(source, context, { filename:'actual-inventory-management.js' });
  const controller = context.window.MinutaInventory.createController({
    $:selector => { assert.match(selector, /^#[A-Za-z]+$/); return node(selector.slice(1)); },
    escapeHtml:value => String(value ?? ''), notify:message => effects.push(['notify', message]),
    requireWrites:() => true, getCurrentUser:() => ({ id:auth.actor }), getSessionGeneration:() => auth.generation,
    sessionIsCurrent:(actor, generation) => actor === auth.actor && generation === auth.generation,
    applyWriteAvailability() {},
    db:{ rpc:async (name, params) => {
      if (name === 'get_minuta_inventory_workspace') {
        assert.ok([ids.org, otherIds.org].includes(params.p_organization)); effects.push(['workspaceRead']);
        if (readResponses.length) return readResponses.shift()();
        return { data:(params.p_organization === ids.org ? ledger : otherLedger).workspace(), error:null };
      }
      assert.equal(name, 'apply_minuta_stock_movement');
      const call = { name, params:clone(params) }; calls.push(call);
      const committedReply = calls.length === 1 && firstRefusal ? { data:null, error:firstRefusal }
        : (params.p_organization === ids.org ? ledger : otherLedger).apply(call.params);
      call.committedReply = clone(committedReply);
      // Apply the synthetic server effect BEFORE waiting for client delivery.
      if (calls.length === 1 && deferFirstReply) { call.resolve = releaseFirstReply; call.reject = rejectFirstReply; return firstReply; }
      if (deferAllReplies) return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
      return committedReply;
    } },
  });
  controller.bind(); await controller.setOrganization({ id:ids.org, current_role:'owner' });
  assert.equal(controller.availability, 'ready');
  function fill({ quantity = '2', reason = 'Списание испорченного материала', kind = 'write_off', fixture = ids } = {}) {
    node('inventoryMovementWarehouse').value = fixture.warehouse; node('inventoryMovementItem').value = fixture.item;
    node('inventoryMovementKind').value = kind; node('inventoryMovementQuantity').value = quantity;
    node('inventoryMovementReason').value = reason; node('inventoryCountedQuantity').value = '0';
  }
  fill();
  function submit() {
    return listeners.get('submit')({ target:node('inventoryMovementForm'), submitter:node('movementSubmit'), preventDefault() {} });
  }
  async function event(type, id, value = node(id).value) {
    assert.ok(['input', 'change'].includes(type)); node(id).value = value;
    await listeners.get(type)?.({ target:node(id) });
  }
  async function loseFirstReply() {
    const pending = submit(); await tick(); assert.equal(calls.length, 1);
    assert.equal(ledger.rows.length, 1); assert.equal(ledger.balance, 8);
    releaseFirstReply(lostReply()); await pending;
    assert.equal(effects.some(effect => effect[0] === 'formReset'), false, 'unknown did not acknowledge/reset the form');
    return pending;
  }
  const restore = () => listeners.get('click')({ target:{ closest:selector => selector === '[data-inventory-restore-movement]' ? {} : null } });
  const reload = () => listeners.get('click')({ target:{ closest:selector => selector === '#reloadInventory' ? {} : null } });
  return { ledger, otherLedger, readResponses, calls, effects, controller, node, fill, submit, event, loseFirstReply, auth, restore, reload,
    acknowledgeFirst:() => releaseFirstReply(calls[0].committedReply) };
}

test('control: single acknowledged movement creates one document and updates balance', async () => {
  const h = await harness({ deferFirstReply:false }); await h.submit();
  assert.equal(h.ledger.rows.length, 1); assert.equal(h.ledger.balance, 8);
  assert.equal(h.effects.filter(effect => effect[0] === 'formReset').length, 1);
});

test('pending duplicate submit starts no second RPC', async () => {
  const h = await harness(), pending = h.submit(); await tick(); await h.submit();
  assert.equal(h.calls.length, 1); h.acknowledgeFirst(); await pending;
  assert.equal(h.ledger.rows.length, 1);
});

test('lost reply without input/change: retry is blocked or reuses the committed document', async t => {
  const h = await harness(); await h.loseFirstReply(); await h.submit();
  assert.ok(h.calls.length === 1 || h.calls.length === 2);
  if (h.calls.length === 2) {
    assert.deepEqual(h.calls[1].params, h.calls[0].params);
    assert.equal(h.calls[1].committedReply.data.id, h.calls[0].committedReply.data.id);
  }
  assert.equal(h.ledger.rows.length, 1); assert.equal(h.ledger.balance, 8);
  t.diagnostic(JSON.stringify({ rpcCount:h.calls.length, requestIds:h.calls.map(call => call.params.p_request_id), movementCount:h.ledger.rows.length }));
});

for (const [label, type, field, replacement] of [
  ['no-op input', 'input', 'inventoryMovementQuantity', '2'],
  ['no-op change', 'change', 'inventoryMovementKind', 'write_off'],
  ['numeric equivalent input', 'input', 'inventoryMovementQuantity', '2.0'],
  ['trim-equivalent reason change', 'change', 'inventoryMovementReason', 'Списание испорченного материала '],
]) {
  test(`SAFETY: unknown then ${label} must not turn retry into a second stock movement`, async t => {
    const h = await harness(); await h.loseFirstReply();
    const errorBeforeRetry = h.node('inventoryMovementError').textContent;
    await h.event(type, field, replacement); await h.submit();
    // A safe implementation can block the retry or replay its frozen same key.
    for (const call of h.calls) assert.deepEqual(payloadOf(call.params), payloadOf(h.calls[0].params), 'no effectful input changed');
    t.diagnostic(JSON.stringify({ requestIds:h.calls.map(call => call.params.p_request_id),
      movementIds:h.ledger.rows.map(row => row.id), quantityAfter:h.ledger.balance,
      errorBeforeRetry }));
    assert.equal(h.ledger.rows.length, 1, 'unchanged unacknowledged intent must have at most one stock effect');
    assert.equal(h.ledger.balance, 8);
  });
}

test('control: acknowledged movement then explicitly new same-payload movement is legal', async () => {
  const h = await harness({ deferFirstReply:false }); await h.submit();
  // First operation acknowledged/reset. User fills a fresh operation and submits.
  h.fill(); await h.event('input', 'inventoryMovementQuantity'); await h.submit();
  assert.equal(h.calls.length, 2); assert.deepEqual(payloadOf(h.calls[1].params), payloadOf(h.calls[0].params));
  assert.notEqual(h.calls[1].params.p_request_id, h.calls[0].params.p_request_id);
  assert.equal(h.ledger.rows.length, 2); assert.equal(h.ledger.balance, 6);
});

test('changed actual quantity after unknown is a different payload, not duplicate-intent proof', async t => {
  const h = await harness(); await h.loseFirstReply();
  await h.event('input', 'inventoryMovementQuantity', '3'); await h.submit();
  // Unknown-intent policy may conservatively block, replay the original, or
  // require explicit resolution before permitting a genuinely new operation.
  // This characterization does NOT label all changed-amount new keys a defect.
  for (const call of h.calls.slice(1)) {
    if (call.params.p_quantity === 3) assert.notEqual(call.params.p_request_id, h.calls[0].params.p_request_id);
    else assert.deepEqual(call.params, h.calls[0].params, 'only an exact frozen replay may retain the original key');
  }
  const applied = h.ledger.rows.reduce((sum, row) => sum + row.quantity_delta, 0);
  assert.equal(h.ledger.balance, 10 + applied);
  t.diagnostic(JSON.stringify({ calls:h.calls.map(call => ({ request:call.params.p_request_id, quantity:call.params.p_quantity })),
    movementCount:h.ledger.rows.length, quantityAfter:h.ledger.balance }));
});

test('synthetic SQL boundary: same-key changed quantity refuses, replay does not rewrite reason', () => {
  const ledger = syntheticLedger();
  const original = { p_organization:ids.org, p_warehouse:ids.warehouse, p_item:ids.item, p_kind:'write_off',
    p_quantity:2, p_counted_quantity:null, p_reason:'first reason', p_request_id:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' };
  const first = ledger.apply(original);
  assert.equal(ledger.apply({ ...original, p_quantity:3 }).error.code, '23505');
  assert.deepEqual(ledger.apply({ ...original, p_reason:'different reason' }), first);
  assert.equal(ledger.rows[0].reason, 'first reason'); assert.equal(ledger.rows.length, 1); assert.equal(ledger.balance, 8);
});

test('changed unresolved payload is blocked; restore action permits exact-key replay', async () => {
  const h = await harness(); await h.loseFirstReply();
  await h.event('input', 'inventoryMovementQuantity', '3'); await h.submit();
  assert.equal(h.calls.length, 1); assert.equal(h.node('inventoryMovementQuantity').value, '3');
  assert.match(h.node('inventoryMovementError').textContent, /исходной операции.*Изменённые данные не отправлены/);
  assert.match(h.node('inventoryMovementError').innerHTML, /data-inventory-restore-movement/);
  await h.restore(); assert.equal(Number(h.node('inventoryMovementQuantity').value), 2);
  await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
  assert.equal(h.ledger.rows.length, 1);
});

test('editing then reverting and explicit workspace reload keep the original request', async () => {
  const h = await harness(); await h.loseFirstReply();
  await h.event('input', 'inventoryMovementQuantity', '3');
  await h.event('input', 'inventoryMovementQuantity', '2'); await h.controller.load();
  await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
  assert.equal(h.ledger.balance, 8);
});

for (const [name, transform] of [
  ['null envelope', () => null],
  ['null data', () => ({ data:null, error:null })],
  ['missing error field', reply => ({ data:reply.data })],
  ['foreign organization', reply => ({ ...reply, data:{ ...reply.data, organization_id:ids.actor } })],
  ['string movement id', reply => ({ ...reply, data:{ ...reply.data, id:'1' } })],
  ['nonpositive movement id', reply => ({ ...reply, data:{ ...reply.data, id:0 } })],
  ['unsafe movement id', reply => ({ ...reply, data:{ ...reply.data, id:Number.MAX_SAFE_INTEGER + 1 } })],
  ['string quantity', reply => ({ ...reply, data:{ ...reply.data, quantity_after:'8' } })],
  ['negative quantity', reply => ({ ...reply, data:{ ...reply.data, quantity_after:-1 } })],
  ['excess scale quantity', reply => ({ ...reply, data:{ ...reply.data, quantity_after:0.0001 } })],
]) {
  test(`malformed ACK ${name} keeps original identity and reports unknown`, async () => {
    const h = await harness(), pending = h.submit(); await tick();
    h.calls[0].resolve(transform(h.calls[0].committedReply)); await pending;
    assert.equal(h.effects.some(effect => effect[0] === 'formReset'), false);
    assert.doesNotMatch(h.node('inventoryMovementError').textContent, /не изменены|не сохранено/);
    assert.match(h.node('inventoryMovementError').textContent, /подтвержден|подтверждение/);
    await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
    assert.equal(h.ledger.rows.length, 1);
  });
}

test('defensive rejected RPC restores controls but not permission to change unresolved intent', async () => {
  const h = await harness(), pending = h.submit(); await tick();
  h.calls[0].reject(Error('defensive unexpected rejection')); await pending;
  assert.equal(h.node('movementSubmit').disabled, false);
  assert.match(h.node('inventoryMovementError').textContent, /Остаток мог измениться/);
  await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
  assert.equal(h.ledger.rows.length, 1);
});

test('exact first-invocation v82 refusal permits corrected new intent', async () => {
  const h = await harness({ firstRefusal:{ code:'55000', message:'insufficient_inventory_stock' } });
  const pending = h.submit(); await tick(); h.calls[0].resolve(h.calls[0].committedReply); await pending;
  assert.equal(h.ledger.rows.length, 0);
  await h.event('input', 'inventoryMovementQuantity', '3'); await h.submit();
  assert.notEqual(h.calls[1].params.p_request_id, h.calls[0].params.p_request_id);
  assert.equal(h.ledger.rows.length, 1); assert.equal(h.ledger.balance, 7);
});

test('refusal text with wrong SQL code does not discard an unknown committed identity', async () => {
  const h = await harness(), pending = h.submit(); await tick();
  h.calls[0].resolve({ data:null, error:{ code:'08006', message:'insufficient_inventory_stock' } }); await pending;
  await h.event('input', 'inventoryMovementQuantity', '3'); await h.submit();
  assert.equal(h.calls.length, 1);
  await h.restore(); await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
});

test('definite refusal on retry cannot disprove the previous unknown commit', async () => {
  const h = await harness({ deferAllReplies:true }); await h.loseFirstReply();
  const retry = h.submit(); await tick();
  h.calls[1].resolve({ data:null, error:{ code:'55000', message:'inventory_disabled' } }); await retry;
  await h.event('change', 'inventoryMovementQuantity', '3'); await h.submit();
  assert.equal(h.calls.length, 2, 'changed payload still blocked after replay refusal');
  await h.restore(); const recovered = h.submit(); await tick();
  h.calls[2].resolve(h.calls[2].committedReply); await recovered;
  for (const call of h.calls) assert.deepEqual(call.params, h.calls[0].params);
  assert.equal(h.ledger.rows.length, 1);
});

for (const outcome of ['success', 'error', 'throw']) {
  test(`reset/account replacement: late A ${outcome} cannot release B pending or reset its form`, async () => {
    const h = await harness({ deferAllReplies:true }), a = h.submit(); await tick();
    h.controller.reset(); h.auth.actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; h.auth.generation += 1;
    await h.controller.setOrganization({ id:ids.org, current_role:'owner' }); h.fill({ quantity:'3' });
    const b = h.submit(); await tick(); const before = JSON.stringify(h.effects);
    if (outcome === 'throw') h.calls[0].reject(Error('old rejection'));
    else h.calls[0].resolve(outcome === 'success' ? h.calls[0].committedReply : lostReply());
    await a; assert.equal(JSON.stringify(h.effects), before);
    assert.equal(h.node('movementSubmit').disabled, true);
    await h.submit(); assert.equal(h.calls.length, 2, 'late A does not release B single-flight');
    h.calls[1].resolve(h.calls[1].committedReply); await b;
    assert.equal(h.ledger.rows.length, 2); assert.equal(h.ledger.balance, 5);
    // A's unresolved snapshot is private to its actor scope and remains replayable.
    h.controller.reset(); h.auth.actor = ids.actor; h.auth.generation += 1;
    await h.controller.setOrganization({ id:ids.org, current_role:'owner' }); h.fill();
    const aRecovery = h.submit(); await tick();
    assert.deepEqual(h.calls[2].params, h.calls[0].params);
    h.calls[2].resolve(h.calls[2].committedReply); await aRecovery;
    assert.equal(h.ledger.rows.length, 2);
  });
}

test('same organization refresh while movement pending does not invalidate its acknowledgement', async () => {
  const h = await harness(), pending = h.submit(); await tick();
  await h.controller.setOrganization({ id:ids.org, current_role:'owner' });
  h.acknowledgeFirst(); await pending;
  assert.equal(h.effects.filter(effect => effect[0] === 'formReset').length, 1);
  h.fill(); await h.submit(); assert.equal(h.ledger.rows.length, 2);
  assert.notEqual(h.calls[1].params.p_request_id, h.calls[0].params.p_request_id);
});

test('organization switch keeps unresolved snapshots separate and A roundtrip replays A key', async () => {
  const h = await harness(); await h.loseFirstReply();
  await h.controller.setOrganization({ id:otherIds.org, current_role:'owner' }); h.fill({ fixture:otherIds });
  await h.submit(); assert.equal(h.otherLedger.rows.length, 1); assert.equal(h.ledger.rows.length, 1);
  assert.notEqual(h.calls[1].params.p_request_id, h.calls[0].params.p_request_id);
  await h.controller.setOrganization({ id:ids.org, current_role:'owner' }); h.fill(); await h.submit();
  assert.deepEqual(h.calls[2].params, h.calls[0].params); assert.equal(h.ledger.rows.length, 1);
});

test('write role revoked while pending does not clear the unresolved operation', async () => {
  const h = await harness(), pending = h.submit(); await tick();
  await h.controller.setOrganization({ id:ids.org, current_role:'specialist' });
  h.acknowledgeFirst(); await pending;
  assert.equal(h.node('inventoryPanel').hidden, true); assert.equal(h.effects.some(e => e[0] === 'formReset'), false);
  await h.controller.setOrganization({ id:ids.org, current_role:'owner' }); h.fill(); await h.submit();
  assert.deepEqual(h.calls[1].params, h.calls[0].params); assert.equal(h.ledger.rows.length, 1);
});

test('confirmed movement then workspace rejection reports confirmed write and permits read recovery', async () => {
  const h = await harness({ deferFirstReply:false });
  h.readResponses.push(() => Promise.reject(Error('workspace unavailable'))); await h.submit();
  assert.equal(h.ledger.rows.length, 1); assert.equal(h.node('inventoryLoading').hidden, true);
  assert.equal(h.node('inventoryUnavailable').hidden, false); assert.equal(h.controller.availability, 'error');
  assert.match(h.effects.at(-1)[1], /Движение сохранено, но обновление журнала/);
  await h.controller.load(); h.fill(); await h.submit();
  assert.equal(h.ledger.rows.length, 2, 'acknowledged write does not poison explicit new movement');
});

test('old confirmed-write refresh rejection cannot affect a new actor pending write', async () => {
  const h = await harness({ deferAllReplies:true });
  let rejectRead; h.readResponses.push(() => new Promise((resolve, reject) => { rejectRead = reject; }));
  const a = h.submit(); await tick(); h.acknowledgeFirst(); await tick();
  h.controller.reset(); h.auth.actor = otherIds.actor; h.auth.generation += 1;
  await h.controller.setOrganization({ id:otherIds.org, current_role:'owner' }); h.fill({ fixture:otherIds });
  const b = h.submit(); await tick(); const before = JSON.stringify(h.effects);
  rejectRead(Error('late old load failure')); await a;
  assert.equal(JSON.stringify(h.effects), before); assert.equal(h.node('movementSubmit').disabled, true);
  await h.submit(); assert.equal(h.calls.length, 2);
  h.calls[1].resolve(h.calls[1].committedReply); await b;
  assert.equal(h.ledger.rows.length, 1); assert.equal(h.otherLedger.rows.length, 1);
});

test('queued organization load rejection does not leave an eternal loading state', async () => {
  const h = await harness(), pending = h.submit(); await tick();
  await h.controller.setOrganization({ id:otherIds.org, current_role:'owner' });
  h.readResponses.push(() => Promise.reject(Error('queued workspace failure')));
  h.calls[0].resolve(lostReply()); await pending;
  assert.equal(h.controller.availability, 'error'); assert.equal(h.node('inventoryLoading').hidden, true);
  await h.controller.load(); h.fill({ fixture:otherIds }); await h.submit();
  assert.equal(h.otherLedger.rows.length, 1);
});

test('zero inventory-count acknowledgement is valid and replay keeps null quantity/original count', async () => {
  const h = await harness(); h.fill({ kind:'inventory' });
  const pending = h.submit(); await tick(); h.calls[0].resolve(lostReply()); await pending;
  assert.equal(h.ledger.balance, 0); await h.submit();
  assert.equal(h.calls[1].params.p_quantity, null); assert.equal(h.calls[1].params.p_counted_quantity, 0);
  assert.deepEqual(h.calls[1].params, h.calls[0].params); assert.equal(h.ledger.rows.length, 1);
  assert.equal(h.effects.filter(e => e[0] === 'formReset').length, 1);
});

test('receipt remains supported and acknowledged new receipt can use identical payload', async () => {
  const h = await harness({ deferFirstReply:false }); h.fill({ kind:'receipt', reason:'' }); await h.submit();
  h.fill({ kind:'receipt', reason:'' }); await h.submit();
  assert.equal(h.ledger.balance, 14); assert.equal(h.ledger.rows.length, 2);
});

test('unresolved original-description message is not displayed in a different organization', async () => {
  const h = await harness(); await h.loseFirstReply();
  await h.event('input', 'inventoryMovementQuantity', '3'); await h.submit();
  assert.match(h.node('inventoryMovementError').textContent, /Списание испорченного материала/);
  await h.controller.setOrganization({ id:otherIds.org, current_role:'owner' });
  assert.equal(h.node('inventoryMovementError').textContent, ''); assert.equal(h.node('inventoryMovementError').hidden, true);
});

test('unknown automatically reads committed journal/balance without ACK or changing raw form', async () => {
  const h = await harness(); h.fill({ quantity:'2.0', reason:'  Исходная причина  ' });
  await h.loseFirstReply();
  assert.equal(h.controller.payload.movements.length, 1);
  assert.equal(h.controller.payload.balances[0].quantity, 8);
  assert.equal(h.node('inventoryMovementsCount').textContent, '1');
  assert.equal(h.node('inventoryMovementQuantity').value, '2.0');
  assert.equal(h.node('inventoryMovementReason').value, '  Исходная причина  ');
  assert.equal(h.node('inventoryMovementError').hidden, false);
  assert.match(h.node('inventoryMovementError').textContent, /мог измениться/);
  assert.equal(h.calls.length, 1); assert.equal(h.effects.some(e => e[0] === 'notify'), false);
  await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
});

test('initial definite refusal reads workspace and preserves corrected draft without mutation', async () => {
  const h = await harness({ firstRefusal:{ code:'55000', message:'insufficient_inventory_stock' } });
  const pending = h.submit(); await tick();
  h.node('inventoryMovementQuantity').value = '3.0';
  h.calls[0].resolve(h.calls[0].committedReply); await pending;
  assert.equal(h.effects.filter(e => e[0] === 'workspaceRead').length, 2);
  assert.equal(h.node('inventoryMovementQuantity').value, '3.0');
  assert.match(h.node('inventoryMovementError').textContent, /Сервер отклонил/);
  assert.equal(h.calls.length, 1); assert.equal(h.ledger.rows.length, 0);
});

for (const failure of ['error', 'throw', 'malformed']) {
  test(`unknown then read ${failure}: visible read retry preserves frozen intent and journal warning`, async () => {
    const h = await harness();
    const failRead = () => failure === 'throw' ? Promise.reject(Error('read transport'))
      : failure === 'error' ? { data:null, error:{ code:'42883', message:'get_minuta_inventory_workspace missing' } }
        : { data:{ organization_id:otherIds.org }, error:null };
    h.readResponses.push(failRead); await h.loseFirstReply();
    assert.equal(h.node('inventoryPanel').hidden, false);
    assert.equal(h.node('inventoryUnavailable').hidden, false);
    assert.equal(h.node('inventoryLoading').hidden, true);
    assert.match(h.node('inventoryUnavailableText').textContent, /ещё не подтверждён/);
    assert.match(h.node('inventoryUnavailableText').textContent, /Повторить/);
    h.readResponses.push(failRead); await h.reload();
    assert.equal(h.node('inventoryLoading').hidden, true); assert.equal(h.calls.length, 1);
    await h.reload();
    assert.equal(h.controller.availability, 'ready'); assert.equal(h.controller.payload.movements.length, 1);
    assert.equal(h.node('inventoryMovementError').hidden, false);
    assert.equal(h.node('inventoryMovementQuantity').value, '2');
    await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
    assert.equal(h.ledger.rows.length, 1);
  });
}

test('reconciliation preserves edits made during read and selected target when options reorder', async () => {
  const h = await harness(); let resolveRead;
  h.readResponses.push(() => new Promise(resolve => { resolveRead = resolve; }));
  const pending = h.submit(); await tick(); h.calls[0].resolve(lostReply()); await tick();
  h.node('inventoryMovementQuantity').value = '3.0'; h.node('inventoryMovementReason').value = '  Новая причина  ';
  const data = h.ledger.workspace();
  data.items.unshift({ ...data.items[0], id:otherIds.item });
  data.warehouses.unshift({ ...data.warehouses[0], id:otherIds.warehouse });
  resolveRead({ data, error:null }); await pending;
  assert.equal(h.node('inventoryMovementWarehouse').value, ids.warehouse);
  assert.equal(h.node('inventoryMovementItem').value, ids.item);
  assert.equal(h.node('inventoryMovementQuantity').value, '3.0');
  assert.equal(h.node('inventoryMovementReason').value, '  Новая причина  ');
  await h.submit(); assert.equal(h.calls.length, 1, 'changed draft is not silently sent after read');
  await h.restore(); await h.submit(); assert.deepEqual(h.calls[1].params, h.calls[0].params);
});

test('read removing original target leaves selection empty instead of silently choosing another', async () => {
  const h = await harness();
  h.readResponses.push(() => {
    const data = h.ledger.workspace(); data.items[0].id = otherIds.item;
    return { data, error:null };
  });
  await h.loseFirstReply(); assert.equal(h.node('inventoryMovementItem').value, '');
  await h.submit(); await h.restore(); await h.submit();
  assert.equal(h.calls.length, 1); assert.equal(h.ledger.rows.length, 1);
});

for (const outcome of ['success', 'error', 'throw']) {
  test(`late unknown reconciliation ${outcome} cannot render over B or release B pending write`, async () => {
    const h = await harness({ deferAllReplies:true }); let resolveRead, rejectRead;
    h.readResponses.push(() => new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; }));
    const a = h.submit(); await tick(); h.calls[0].resolve(lostReply()); await tick();
    h.controller.reset(); h.auth.actor = otherIds.actor; h.auth.generation += 1;
    await h.controller.setOrganization({ id:otherIds.org, current_role:'owner' }); h.fill({ fixture:otherIds });
    const b = h.submit(); await tick(); const before = JSON.stringify(h.effects);
    if (outcome === 'throw') rejectRead(Error('late read reject'));
    else resolveRead(outcome === 'success' ? { data:h.ledger.workspace(), error:null } : lostReply());
    await a;
    assert.equal(JSON.stringify(h.effects), before); assert.equal(h.node('movementSubmit').disabled, true);
    assert.equal(h.controller.payload.organization_id, otherIds.org);
    assert.equal(h.node('inventoryMovementItem').value, otherIds.item);
    await h.submit(); assert.equal(h.calls.length, 2);
    h.calls[1].resolve(h.calls[1].committedReply); await b;
  });
}
