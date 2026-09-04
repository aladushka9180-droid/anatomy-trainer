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
let rpcPayload = { organizations: [], pending_invitations: [] };
const controller = window.MinutaOrganization.createController({
  db: {
    async rpc(name) {
      assert.equal(name, 'get_minuta_workspace');
      rpcCalls += 1;
      return { data: rpcPayload, error: null };
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
assert.deepEqual(controller.getOrganizations(), [], 'пустой workspace не должен создавать фиктивные организации');

rpcPayload = {
  organizations: [
    { id:'demo',name:'Demo',public_slug:'minuta-demo-statistics',current_role:'owner',can_manage:true,locations:[],members:[],invitations:[],audit:[] },
    { id:'work',name:'Рабочая',public_slug:'work',current_role:'owner',can_manage:true,locations:[],members:[],invitations:[],audit:[] }
  ],
  pending_invitations: []
};
await controller.load();
assert.equal(controller.getActiveOrganization()?.id, 'work', 'Рабочая организация должна выбираться вместо demo');
assert.equal(controller.getOrganizations().length, 2, 'Demo должна оставаться доступной для статистики');
assert.doesNotMatch(element('organizationSwitcher').innerHTML, /minuta-demo-statistics|>Demo ·/, 'Demo не должна смешиваться с рабочими организациями в переключателе');

rpcPayload = {
  organizations: [
    { id:'demo',name:'Demo',public_slug:'minuta-demo-statistics',current_role:'owner',can_manage:true,locations:[],members:[],invitations:[],audit:[] }
  ],
  pending_invitations: []
};
await controller.load();
assert.equal(controller.getActiveOrganization(), null, 'Demo не должна становиться рабочей организацией даже без других организаций');
assert.equal(controller.getOrganizations().length, 1, 'Demo должна оставаться доступной источнику аналитики');
assert.equal(element('organizationWorkspace').hidden, true, 'Рабочие контроллеры должны быть скрыты при наличии только demo');
assert.equal(element('organizationUnavailable').hidden, false, 'Пользователь должен увидеть безопасное объяснение отсутствия рабочей организации');

console.log('organization controller runtime test: OK');
