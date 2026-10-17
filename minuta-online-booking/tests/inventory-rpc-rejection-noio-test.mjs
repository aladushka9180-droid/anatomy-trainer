import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../inventory-management.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function fixture() {
  const nodes = new Map(), listeners = new Map(), notices = [], writes = [];
  let actor = 'synthetic-owner', generation = 1;
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { id, value: '', textContent: '', hidden: false, disabled: false, checked: true, open: true,
      innerHTML: '', dataset: {}, options: [], style: { setProperty() {} },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      querySelectorAll() { return []; }, querySelector() { return null; },
      closest(selector) { return selector === '#inventoryPanel' ? node('inventoryPanel') : null; },
      setAttribute() {}, removeAttribute() {}, setCustomValidity() {}, focus() {}, append() {}, after() {},
      reset() { node('inventoryItemName').value = ''; }
    });
    return nodes.get(id);
  }
  const workspace = id => ({ organization_id: id, current_role: 'owner', enabled: true,
    auto_deduct_completed_visits: false, locations: [], services: [], usage: [], audit: [],
    items: [], warehouses: [], balances: [], movements: [], transfer_documents: [], transfer_version: 130 });
  const box = { console, Date, Intl, Map, Set, WeakMap, Array, Object, Number, String, Boolean, JSON, RegExp, Error, TypeError,
    Uint8Array, TextEncoder, URL, navigator: { onLine: true },
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    location: { origin: 'https://fixture.invalid' }, document: { addEventListener: (name, handler) => listeners.set(name, handler) } };
  box.window = box;
  vm.runInNewContext(source, box, { filename: 'actual-inventory-management.js', timeout: 1000 });
  const controller = box.MinutaInventory.createController({
    db: { async rpc(name, parameters) {
      if (name === 'get_minuta_inventory_workspace_v130') return { data: workspace(parameters.p_organization), error: null };
      assert.equal(name, 'upsert_minuta_inventory_item');
      const gate = deferred(); writes.push({ gate, organization: parameters.p_organization }); return gate.promise;
    } }, $: selector => node(selector.replace(/^#/, '')), escapeHtml: String,
    notify: text => notices.push(text), requireWrites: () => true,
    getCurrentUser: () => ({ id: actor }), getSessionGeneration: () => generation,
    sessionIsCurrent: (user, epoch) => user === actor && epoch === generation, applyWriteAvailability() {}
  });
  controller.bind();
  return { controller, node, notices, writes,
    setOrganization: id => controller.setOrganization({ id, current_role: 'owner' }),
    newSession() { actor = 'synthetic-new-owner'; generation++; controller.reset(); },
    submit() {
      node('inventoryItemName').value = 'Synthetic catalog item'; node('inventoryItemUnit').value = 'piece';
      return listeners.get('submit')({ target: node('inventoryItemForm'), submitter: node('submit'), preventDefault() {} });
    }
  };
}

test('current rejected catalog RPC is contained, reconciled, and never automatically resent', async () => {
  const f = fixture(); await f.setOrganization('synthetic-A');
  const first = f.submit(); assert.equal(f.writes.length, 1);
  f.writes[0].gate.reject(new Error('Synthetic transport rejection'));
  await first;
  assert.equal(f.writes.length, 1, 'failure must not silently retry a mutation');
  assert.ok(f.notices.length || !f.node('inventoryItemError').hidden, 'a contained failure is visible');
  assert.equal(f.node('inventoryItemError').textContent, 'Не удалось подтвердить сохранение. Проверьте обновлённый список перед повтором.');
  assert.doesNotMatch(f.node('inventoryItemError').textContent, /не сохранено|не изменены/, 'a lost response proves neither commit nor rollback');
  const retry = f.submit(); assert.equal(f.writes.length, 2, 'a later explicit submit is not locked permanently');
  f.writes[1].gate.resolve({ data: { organization_id: 'synthetic-A' }, error: null }); await retry;
});

test('retired rejected RPC cannot escape or release a replacement catalog operation', async () => {
  const f = fixture(); await f.setOrganization('synthetic-A');
  const first = f.submit().then(() => null, error => error);
  f.newSession(); await f.setOrganization('synthetic-A');
  const second = f.submit(); assert.equal(f.writes.length, 2);
  const caption = f.node('submit').textContent, notices = f.notices.length;
  f.writes[0].gate.reject(new Error('Synthetic retired rejection'));
  assert.equal(await first, null, 'stale transport failure must be contained before owner checks');
  assert.equal(f.node('submit').textContent, caption); assert.equal(f.notices.length, notices);
  await f.submit(); assert.equal(f.writes.length, 2, 'retired completion must not permit a third operation');
  f.writes[1].gate.resolve({ data: { organization_id: 'synthetic-A' }, error: null }); await second;
});

test('ordinary returned catalog rejection still releases only the current operation', async () => {
  const f = fixture(); await f.setOrganization('synthetic-A');
  const first = f.submit(); f.writes[0].gate.resolve({ data: null, error: { code: '23505', message: 'Synthetic duplicate' } }); await first;
  assert.equal(f.writes.length, 1);
  assert.equal(f.node('inventoryItemError').textContent, 'Изменение не сохранено. Записи и остатки не изменены.', 'existing returned deterministic rejection mapping is retained');
  const retry = f.submit(); assert.equal(f.writes.length, 2);
  f.writes[1].gate.resolve({ data: { organization_id: 'synthetic-A' }, error: null }); await retry;
});
