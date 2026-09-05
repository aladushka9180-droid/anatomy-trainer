import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual complete inventory controller, including bind/submit/input/change,
// reload/render and request ID generation. DOM and RPC are explicit VM fixtures.
// The synthetic ledger below models ONLY v82:304-341 receipt/write_off replay,
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
const tick = () => new Promise(resolve => setImmediate(resolve));
const clone = value => JSON.parse(JSON.stringify(value));
const payloadOf = ({ p_request_id, ...payload }) => payload;
const lostReply = () => ({ data:null, error:{ code:'', message:'TypeError: Failed to fetch', details:'Synthetic response lost after commit' } });

function syntheticLedger() {
  const rows = [], byRequest = new Map();
  let balance = 10;
  function apply(params) {
    assert.equal(params.p_organization, ids.org);
    assert.equal(params.p_warehouse, ids.warehouse);
    assert.equal(params.p_item, ids.item);
    assert.match(params.p_request_id, /^[0-9a-f-]{36}$/);
    assert.ok(['receipt', 'write_off'].includes(params.p_kind), 'fixture intentionally excludes inventory counts');
    assert.ok(Number.isInteger(params.p_quantity) && params.p_quantity > 0, 'small integral quantities isolate identity from numeric rounding');
    const key = `${params.p_organization}:${params.p_request_id}`;
    const existing = byRequest.get(key);
    const delta = params.p_kind === 'receipt' ? params.p_quantity : -params.p_quantity;
    if (existing) {
      // Actual v82 compares warehouse/item/kind/quantity, but NOT reason on replay.
      if (existing.warehouse_id !== params.p_warehouse || existing.inventory_item_id !== params.p_item
        || existing.movement_type !== params.p_kind || existing.quantity_delta !== delta) {
        return { data:null, error:{ code:'23505', message:'inventory_request_conflict' } };
      }
      return { data:{ organization_id:ids.org, id:existing.id, quantity_after:existing.quantity_after }, error:null };
    }
    if (balance + delta < 0) return { data:null, error:{ code:'55000', message:'insufficient_inventory_stock' } };
    if (params.p_kind === 'write_off' && params.p_reason.trim().length < 2)
      return { data:null, error:{ code:'22023', message:'inventory_reason_required' } };
    balance += delta;
    const row = { id:rows.length + 1, organization_id:ids.org, warehouse_id:ids.warehouse,
      inventory_item_id:ids.item, movement_type:params.p_kind, quantity_delta:delta, quantity_after:balance,
      request_id:params.p_request_id, reason:params.p_reason.trim(), actor_id:ids.actor,
      created_at:'2026-09-06T09:00:00Z' };
    rows.push(row); byRequest.set(key, row);
    return { data:{ organization_id:ids.org, id:row.id, quantity_after:balance }, error:null };
  }
  const workspace = () => ({ organization_id:ids.org, current_role:'owner', enabled:true,
    auto_deduct_completed_visits:false,
    locations:[{ id:ids.location, name:'Синтетический филиал', active:true }], services:[], usage:[], audit:[],
    items:[{ id:ids.item, name:'Материал', unit:'piece', low_stock_threshold:0, active:true }],
    warehouses:[{ id:ids.warehouse, location_id:ids.location, name:'Склад', active:true }],
    balances:[{ warehouse_id:ids.warehouse, inventory_item_id:ids.item, quantity:balance }], movements:clone(rows) });
  return { apply, workspace, rows, get balance() { return balance; } };
}

async function harness({ deferFirstReply = true } = {}) {
  const ledger = syntheticLedger(), calls = [], effects = [], listeners = new Map(), nodes = new Map();
  let nonce = 0, releaseFirstReply;
  const firstReply = new Promise(resolve => { releaseFirstReply = resolve; });
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
    Object.defineProperty(element, 'innerHTML', { get:() => html, set:value => {
      html = String(value);
      // Actual render replaces select options; emulate first-option selection.
      // One warehouse/item deliberately avoids conflating target-switch defects.
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
    requireWrites:() => true, getCurrentUser:() => ({ id:ids.actor }), getSessionGeneration:() => 1,
    sessionIsCurrent:(actor, generation) => actor === ids.actor && generation === 1,
    applyWriteAvailability() {},
    db:{ rpc:async (name, params) => {
      if (name === 'get_minuta_inventory_workspace') {
        assert.equal(params.p_organization, ids.org); effects.push(['workspaceRead']);
        return { data:ledger.workspace(), error:null };
      }
      assert.equal(name, 'apply_minuta_stock_movement');
      const call = { name, params:clone(params) }; calls.push(call);
      const committedReply = ledger.apply(call.params); call.committedReply = clone(committedReply);
      // Apply the synthetic server effect BEFORE waiting for client delivery.
      if (calls.length === 1 && deferFirstReply) return firstReply;
      return committedReply;
    } },
  });
  controller.bind(); await controller.setOrganization({ id:ids.org, current_role:'owner' });
  assert.equal(controller.availability, 'ready');
  function fill({ quantity = '2', reason = 'Списание испорченного материала', kind = 'write_off' } = {}) {
    node('inventoryMovementWarehouse').value = ids.warehouse; node('inventoryMovementItem').value = ids.item;
    node('inventoryMovementKind').value = kind; node('inventoryMovementQuantity').value = quantity;
    node('inventoryMovementReason').value = reason; node('inventoryCountedQuantity').value = '0';
  }
  fill();
  function submit() {
    return listeners.get('submit')({ target:node('inventoryMovementForm'), submitter:node('movementSubmit'), preventDefault() {} });
  }
  async function event(type, id, value = node(id).value) {
    assert.ok(['input', 'change'].includes(type)); node(id).value = value;
    await listeners.get(type)({ target:node(id) });
  }
  async function loseFirstReply() {
    const pending = submit(); await tick(); assert.equal(calls.length, 1);
    assert.equal(ledger.rows.length, 1); assert.equal(ledger.balance, 8);
    releaseFirstReply(lostReply()); await pending;
    assert.equal(effects.some(effect => effect[0] === 'formReset'), false, 'unknown did not acknowledge/reset the form');
    return pending;
  }
  return { ledger, calls, effects, controller, node, fill, submit, event, loseFirstReply,
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
