import assert from 'node:assert/strict';

globalThis.window = {};
await import('./organization.js');

const elements = new Map();
function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      hidden: false,
      textContent: '',
      innerHTML: '',
      value: '',
      disabled: false,
      dataset: {},
      setAttribute() {},
      removeAttribute() {},
      querySelector() { return element(`${id}:child`); },
      addEventListener() {},
      reset() {}
    });
  }
  return elements.get(id);
}

let rpcCalls = 0;
const controller = window.MinutaOrganization.createController({
  db: {
    async rpc(name) {
      assert.equal(name, 'get_minuta_workspace');
      rpcCalls += 1;
      return { data: { organizations: [], pending_invitations: [] }, error: null };
    }
  },
  $: selector => element(selector.replace(/^#/, '')),
  $$: () => [],
  escapeHtml: value => String(value),
  notify() {},
  requireWrites: () => true,
  getCurrentUser: () => ({ id: 'test-user' }),
  getSessionGeneration: () => 1,
  sessionIsCurrent: () => true,
  applyWriteAvailability() {}
});

controller.reset();
controller.render();
assert.equal(controller.availability, null, 'render must not turn the initial state into an error');
assert.equal(element('organizationLoading').hidden, false, 'initial view must keep loading visible');

await controller.load();
assert.equal(rpcCalls, 1, 'first organization load must call get_minuta_workspace exactly once');
assert.equal(controller.availability, 'error', 'a user without a team must get a handled empty state');

console.log('organization controller runtime test: OK');
