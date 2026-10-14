import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { recoveryFixture } from './inventory-recovery-fixture.mjs';

const source = readFileSync(new URL('../inventory-management.js', import.meta.url), 'utf8');
const ids = {
  actor:'11111111-1111-4111-8111-111111111111', org:'22222222-2222-4222-8222-222222222222',
  source:'33333333-3333-4333-8333-333333333333', destination:'44444444-4444-4444-8444-444444444444',
  item:'55555555-5555-4555-8555-555555555555', location:'66666666-6666-4666-8666-666666666666',
  document:'77777777-7777-4777-8777-777777777777'
};
const clone = value => JSON.parse(JSON.stringify(value));

function createHarness({ legacy = false, firstUnknown = false, confirmResult = true, acknowledgement = {},
  recovery = recoveryFixture(), state = { source:10, destination:2, transfer:null }, nonceStart = 0 } = {}) {
  const nodes = new Map(), listeners = new Map(), calls = [], notices = [], prompts = [];
  let unknown = firstUnknown;
  const selectIds = new Set(['inventoryMovementWarehouse','inventoryMovementItem','inventoryUsageService','inventoryUsageItem','inventoryWarehouseLocation','inventoryTransferDestination']);
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const element = { id, value:'', checked:false, disabled:false, hidden:false, dataset:{}, textContent:'', required:false,
      closest(selector) {
        if (selector === '#inventoryPanel') return node('inventoryPanel');
        if (selector === '#inventoryMovementForm' && id === 'inventoryMovementForm') return this;
        return null;
      },
      querySelector(selector) {
        if (id === 'inventoryMovementKind' && selector === 'option[value="transfer"]') return node('transferOption');
        if (id === 'inventoryMovementForm' && selector === '[type=submit]') return node('movementSubmit');
        return null;
      },
      querySelectorAll(selector) {
        if (id === 'inventoryPanel' && selector === '[data-inventory-write]') return [node('movementSubmit'), node('inventoryTransfersEnabled'), node('enableInventoryTransfers')];
        return [];
      },
      reset() {
        node('inventoryMovementKind').value = 'receipt'; node('inventoryMovementQuantity').value = '';
        node('inventoryCountedQuantity').value = '0'; node('inventoryMovementReason').value = '';
      }
    };
    let html = '';
    if (selectIds.has(id)) {
      let selected = '';
      Object.defineProperty(element, 'value', { get:() => selected, set:value => { selected = String(value); } });
    }
    Object.defineProperty(element, 'innerHTML', { get:() => html, set:value => {
      html = String(value); element.textContent = html.replace(/<[^>]*>/g, '');
      if (selectIds.has(id)) element.value = html.match(/<option value="([^"]*)"/)?.[1] || '';
    } });
    nodes.set(id, element); return element;
  }
  node('inventoryMovementKind').value = 'receipt';
  const workspace = () => ({ organization_id:ids.org,current_role:'owner',enabled:true,auto_deduct_completed_visits:false,
    ...(legacy ? {} : { transfer_version:130,transfers_enabled:true,transfers_initialized_at:'2026-09-09T00:00:00Z',transfers_suspended_at:null,
      transfer_documents:state.transfer ? [{ ...state.transfer, cost_complete:true,total_cost_kopecks:1200,created_at:'2026-09-09T00:00:00Z' }] : [] }),
    locations:[{ id:ids.location,name:'Центр',active:true }],services:[],usage:[],audit:[],
    items:[{ id:ids.item,name:'Масло',unit:'ml',low_stock_threshold:1,active:true }],
    warehouses:[{ id:ids.source,location_id:ids.location,name:'Центр',active:true },{ id:ids.destination,location_id:ids.location,name:'Север',active:true }],
    balances:[{ warehouse_id:ids.source,inventory_item_id:ids.item,quantity:state.source },{ warehouse_id:ids.destination,inventory_item_id:ids.item,quantity:state.destination }],movements:[] });
  let nonce = nonceStart;
  const context = vm.createContext({ window:{}, document:{ addEventListener:(name, fn) => listeners.set(name, fn) },
    crypto:{ randomUUID:() => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++nonce).padStart(12, '0')}` }, Intl, Date });
  vm.runInContext(source, context, { filename:'inventory-management.js' });
  const controller = context.window.MinutaInventory.createController({
    recoveryStorage:recovery.storage, recoveryLocks:recovery.locks,
    $:selector => node(selector.slice(1)), escapeHtml:value => String(value ?? ''), notify:message => notices.push(message),
    requireWrites:() => true, getCurrentUser:() => ({ id:ids.actor }), getSessionGeneration:() => 1,
    sessionIsCurrent:(actor, generation) => actor === ids.actor && generation === 1, applyWriteAvailability() {}, requestConfirmation:async options => { prompts.push(options); return confirmResult; },
    db:{ rpc:async (name, params) => {
      calls.push({ name, params:clone(params) });
      if (name === 'get_minuta_inventory_workspace_v130') return legacy
        ? { data:null,error:{ code:'PGRST202',message:'Could not find the function public.get_minuta_inventory_workspace_v130' } }
        : { data:workspace(),error:null };
      if (name === 'get_minuta_inventory_workspace') return { data:workspace(),error:null };
      if (name !== 'transfer_minuta_inventory_stock_v130') throw new Error(`unexpected RPC ${name}`);
      if (state.transfer && state.transfer.request_id !== params.p_request_id) throw new Error('new identity after ambiguous result');
      if (!state.transfer) {
        state.source -= params.p_quantity; state.destination += params.p_quantity;
        state.transfer = { id:ids.document,document_id:ids.document,source_movement_id:2,destination_movement_id:3,organization_id:ids.org,
          source_warehouse_id:ids.source,destination_warehouse_id:ids.destination,inventory_item_id:ids.item,
          quantity:params.p_quantity,reason:params.p_reason,request_id:params.p_request_id,
          source_quantity_after:state.source,destination_quantity_after:state.destination };
      }
      if (unknown) { unknown = false; return { data:null,error:{ code:'',message:'Failed to fetch' } }; }
      return { data:{ organization_id:ids.org,document_id:ids.document,source_movement_id:2,destination_movement_id:3,
        source_quantity_after:state.source,destination_quantity_after:state.destination,cost_complete:true, ...acknowledgement },error:null };
    } }
  });
  controller.bind();
  async function ready() {
    await controller.setOrganization({ id:ids.org,current_role:'owner' });
    node('inventoryMovementWarehouse').value = ids.source; node('inventoryMovementItem').value = ids.item;
    node('inventoryMovementKind').value = 'transfer'; node('inventoryTransferDestination').value = ids.destination;
    node('inventoryMovementQuantity').value = '3'; node('inventoryMovementReason').value = 'Пополнение филиала';
    await listeners.get('change')({ target:node('inventoryMovementKind') });
  }
  const submit = () => listeners.get('submit')({ target:node('inventoryMovementForm'),submitter:node('movementSubmit'),preventDefault() {} });
  return { controller,node,calls,notices,prompts,ready,submit,recovery,state,get transfer() { return state.transfer; } };
}

test('O22 transfer preview names both warehouses and cancellation makes no movement', async () => {
  const h = createHarness({ confirmResult:false }); await h.ready();
  assert.match(h.node('inventoryMovementImpact').textContent, /Центр 10 → 7 мл; Север 2 → 5 мл/);
  await h.submit();
  assert.equal(h.calls.filter(call => call.name === 'transfer_minuta_inventory_stock_v130').length, 0);
  assert.equal(h.transfer, null);
  assert.match(h.prompts[0].message, /Центр 10 → 7 мл; Север 2 → 5 мл/);
  assert.equal(h.prompts[0].initialFocus, 'cancel');
});

test('v130 workspace renders one atomic transfer and groups its document', async () => {
  const h = createHarness(); await h.ready(); await h.submit();
  const writes = h.calls.filter(call => call.name === 'transfer_minuta_inventory_stock_v130');
  assert.equal(writes.length, 1); assert.equal(writes[0].params.p_source_warehouse, ids.source);
  assert.equal(writes[0].params.p_destination_warehouse, ids.destination); assert.equal(writes[0].params.p_quantity, 3);
  assert.match(writes[0].params.p_request_id, /^[0-9a-f-]{36}$/);
  assert.match(h.node('inventoryTransferDocumentsList').textContent, /Центр → Север/);
  assert.ok(h.notices.includes('Перемещение сохранено'));
  assert.equal(h.recovery.storage.entries.size, 0);
});

for (const documentId of [1, 'not-a-uuid', '77777777-7777-4777-8777-77777777777x', null]) {
  test(`malformed transfer document ID ${documentId} keeps original request`, async () => {
    const h = createHarness({ acknowledgement:{ document_id:documentId } }); await h.ready(); await h.submit();
    assert.equal(h.notices.length, 0); assert.equal(h.recovery.storage.entries.size, 1);
    assert.match(h.node('inventoryTransferError').textContent, /не подтверждён/);
    await h.submit(); const writes = h.calls.filter(call => call.name === 'transfer_minuta_inventory_stock_v130');
    assert.equal(writes[0].params.p_request_id, writes[1].params.p_request_id);
    assert.equal(h.state.source, 7); assert.equal(h.state.destination, 5);
  });
}

test('transfer lost reply survives full controller restart with UUID document ACK', async () => {
  const h = createHarness({ firstUnknown:true }); await h.ready(); await h.submit();
  const restarted = createHarness({ recovery:h.recovery, state:h.state, nonceStart:100 });
  await restarted.controller.setOrganization({ id:ids.org,current_role:'owner' });
  assert.equal(restarted.node('inventoryMovementKind').value, 'transfer');
  assert.equal(restarted.node('inventoryTransferDestination').value, ids.destination);
  await restarted.submit();
  const first = h.calls.find(call => call.name === 'transfer_minuta_inventory_stock_v130');
  const replay = restarted.calls.find(call => call.name === 'transfer_minuta_inventory_stock_v130');
  assert.equal(first.params.p_request_id, replay.params.p_request_id);
  assert.equal(h.state.source, 7); assert.equal(h.state.destination, 5);
  assert.ok(restarted.notices.includes('Перемещение сохранено')); assert.equal(h.recovery.storage.entries.size, 0);
});

test('restored transfer can replay even when committed source stock is now below original quantity', async () => {
  const state = { source:3, destination:2, transfer:null };
  const h = createHarness({ firstUnknown:true, state }); await h.ready(); await h.submit();
  const restarted = createHarness({ recovery:h.recovery, state, nonceStart:100 });
  await restarted.controller.setOrganization({ id:ids.org,current_role:'owner' }); await restarted.submit();
  assert.equal(state.source, 0); assert.equal(state.destination, 5);
  assert.ok(restarted.notices.includes('Перемещение сохранено'));
});

test('F1: transfer accepts harmless trailing zeroes with original quantity', async () => {
  const h = createHarness(); await h.ready(); h.node('inventoryMovementQuantity').value = '3.000000'; await h.submit();
  assert.equal(h.transfer.quantity,3); assert.ok(h.notices.includes('Перемещение сохранено'));
});
test('F1: transfer retains rejection of non-thousandth raw quantity', async () => {
  const h = createHarness(); await h.ready(); h.node('inventoryMovementQuantity').value = '3.0000000000000001'; await h.submit();
  assert.equal(h.transfer,null); assert.equal(h.recovery.storage.entries.size,0);
});
test('F1: trailing-zero pending transfer retry preserves exact RPC payload and request ID', async () => {
  const h = createHarness({ firstUnknown:true }); await h.ready(); await h.submit();
  const first = h.calls.find(call => call.name === 'transfer_minuta_inventory_stock_v130');
  h.node('inventoryMovementQuantity').value = '3.000000'; await h.submit();
  const replay = h.calls.filter(call => call.name === 'transfer_minuta_inventory_stock_v130').at(-1);
  assert.deepEqual(replay,first); assert.equal(h.state.source,7); assert.equal(h.state.destination,5);
  assert.equal(h.recovery.storage.entries.size,0);
});

test('inventory operation scanner names the item without changing its mode', async () => {
  const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
  assert.match(html, /id="inventoryMovementScan"[^>]*>Сканировать товар<\/button>/);
  assert.match(html, /id="inventoryMovementScan"[^>]*data-code-scan-mode="sale"[^>]*data-code-scan-title="Товар для операции"/);
  const h = createHarness(); await h.ready();
  assert.equal(h.node('inventoryMovementScan').textContent, 'Сканировать товар');
  assert.equal(h.node('inventoryMovementScan').dataset.codeScanMode, 'inventory');
  assert.equal(h.node('inventoryMovementScan').dataset.codeScanTitle, 'Позиция для перемещения');
});

test('ambiguous transfer blocks drift and exact retry reuses request id', async () => {
  const h = createHarness({ firstUnknown:true }); await h.ready(); await h.submit();
  const first = h.calls.find(call => call.name === 'transfer_minuta_inventory_stock_v130');
  h.node('inventoryMovementQuantity').value = '4'; await h.submit();
  assert.equal(h.calls.filter(call => call.name === 'transfer_minuta_inventory_stock_v130').length, 1);
  h.node('inventoryMovementQuantity').value = '3'; await h.submit();
  const writes = h.calls.filter(call => call.name === 'transfer_minuta_inventory_stock_v130');
  assert.equal(writes.length, 2); assert.equal(writes[1].params.p_request_id, first.params.p_request_id);
});

test('legacy workspace fallback keeps inventory but hides transfer controls', async () => {
  const h = createHarness({ legacy:true }); await h.ready();
  assert.equal(h.controller.availability, 'ready'); assert.equal(h.node('inventoryTransfersSetting').hidden, true);
  assert.equal(h.node('transferOption').disabled, true);
  assert.deepEqual(h.calls.slice(0,2).map(call => call.name), ['get_minuta_inventory_workspace_v130','get_minuta_inventory_workspace']);
});
