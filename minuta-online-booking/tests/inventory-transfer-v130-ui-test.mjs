import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../inventory-management.js', import.meta.url), 'utf8');
const ids = {
  actor:'11111111-1111-4111-8111-111111111111', org:'22222222-2222-4222-8222-222222222222',
  source:'33333333-3333-4333-8333-333333333333', destination:'44444444-4444-4444-8444-444444444444',
  item:'55555555-5555-4555-8555-555555555555', location:'66666666-6666-4666-8666-666666666666'
};
const clone = value => JSON.parse(JSON.stringify(value));

function createHarness({ legacy = false, firstUnknown = false } = {}) {
  const nodes = new Map(), listeners = new Map(), calls = [], notices = [];
  let balanceSource = 10, balanceDestination = 2, transfer = null, unknown = firstUnknown;
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
      transfer_documents:transfer ? [{ ...transfer, cost_complete:true,total_cost_kopecks:1200,created_at:'2026-09-09T00:00:00Z' }] : [] }),
    locations:[{ id:ids.location,name:'Центр',active:true }],services:[],usage:[],audit:[],
    items:[{ id:ids.item,name:'Масло',unit:'ml',low_stock_threshold:1,active:true }],
    warehouses:[{ id:ids.source,location_id:ids.location,name:'Центр',active:true },{ id:ids.destination,location_id:ids.location,name:'Север',active:true }],
    balances:[{ warehouse_id:ids.source,inventory_item_id:ids.item,quantity:balanceSource },{ warehouse_id:ids.destination,inventory_item_id:ids.item,quantity:balanceDestination }],movements:[] });
  let nonce = 0;
  const context = vm.createContext({ window:{}, document:{ addEventListener:(name, fn) => listeners.set(name, fn) },
    crypto:{ randomUUID:() => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++nonce).padStart(12, '0')}` }, Intl, Date });
  vm.runInContext(source, context, { filename:'inventory-management.js' });
  const controller = context.window.MinutaInventory.createController({
    $:selector => node(selector.slice(1)), escapeHtml:value => String(value ?? ''), notify:message => notices.push(message),
    requireWrites:() => true, getCurrentUser:() => ({ id:ids.actor }), getSessionGeneration:() => 1,
    sessionIsCurrent:(actor, generation) => actor === ids.actor && generation === 1, applyWriteAvailability() {},
    db:{ rpc:async (name, params) => {
      calls.push({ name, params:clone(params) });
      if (name === 'get_minuta_inventory_workspace_v130') return legacy
        ? { data:null,error:{ code:'PGRST202',message:'Could not find the function public.get_minuta_inventory_workspace_v130' } }
        : { data:workspace(),error:null };
      if (name === 'get_minuta_inventory_workspace') return { data:workspace(),error:null };
      if (name !== 'transfer_minuta_inventory_stock_v130') throw new Error(`unexpected RPC ${name}`);
      if (transfer && transfer.request_id !== params.p_request_id) throw new Error('new identity after ambiguous result');
      if (!transfer) {
        balanceSource -= params.p_quantity; balanceDestination += params.p_quantity;
        transfer = { id:1,document_id:1,source_movement_id:2,destination_movement_id:3,organization_id:ids.org,
          source_warehouse_id:ids.source,destination_warehouse_id:ids.destination,inventory_item_id:ids.item,
          quantity:params.p_quantity,reason:params.p_reason,request_id:params.p_request_id,
          source_quantity_after:balanceSource,destination_quantity_after:balanceDestination };
      }
      if (unknown) { unknown = false; return { data:null,error:{ code:'',message:'Failed to fetch' } }; }
      return { data:{ organization_id:ids.org,document_id:1,source_movement_id:2,destination_movement_id:3,
        source_quantity_after:balanceSource,destination_quantity_after:balanceDestination,cost_complete:true },error:null };
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
  return { controller,node,calls,notices,ready,submit,get transfer() { return transfer; } };
}

test('v130 workspace renders one atomic transfer and groups its document', async () => {
  const h = createHarness(); await h.ready(); await h.submit();
  const writes = h.calls.filter(call => call.name === 'transfer_minuta_inventory_stock_v130');
  assert.equal(writes.length, 1); assert.equal(writes[0].params.p_source_warehouse, ids.source);
  assert.equal(writes[0].params.p_destination_warehouse, ids.destination); assert.equal(writes[0].params.p_quantity, 3);
  assert.match(writes[0].params.p_request_id, /^[0-9a-f-]{36}$/);
  assert.match(h.node('inventoryTransferDocumentsList').textContent, /Центр → Север/);
  assert.ok(h.notices.includes('Перемещение сохранено'));
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
