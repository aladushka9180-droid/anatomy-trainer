import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'resource-management.js'), 'utf8');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.open = false;
    this.dataset = {};
  }
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
  reset() {}
}

const ids = [
  'resourcesPanel','resourcesLoading','resourcesUnavailable','resourcesUnavailableText','resourcesCount',
  'resourceGroupsCount','resourceGroupsList','resourcesList','resourceGroupCreator','resourceCreator',
  'resourceRequirementsPanel','resourceLocation','resourceGroup','resourceForm','resourceCreateHelp',
  'resourceRequirementService','resourceRequirementsList','resourceRequirementSubmit','resourceRequirementError'
];
function makeDom() {
  const elements = Object.fromEntries(ids.map(id => [id, new MockElement(id)]));
  return { elements, $: selector => elements[selector.replace(/^#/, '')] || new MockElement(selector) };
}

function workspace(organizationId, overrides = {}) {
  return {
    organization_id: organizationId,
    can_manage: true,
    locations: [{ id:`${organizationId}-loc`, name:'Центр', active:true }],
    services: [{ id:`${organizationId}-svc`, name:'Массаж', performer_name:'Анна', active:true }],
    groups: [{ id:`${organizationId}-grp`, name:'Кабинет', kind:'room', description:'', active:true }],
    resources: [{ id:`${organizationId}-res`, name:`Ресурс ${organizationId}`, location_id:`${organizationId}-loc`, location_name:'Центр', group_id:`${organizationId}-grp`, group_name:'Кабинет', kind:'room', active:true }],
    requirements: [],
    ...overrides
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

globalThis.window = {};
globalThis.document = { addEventListener() {} };
await import(`${pathToFileURL(join(root, 'resource-management.js')).href}?test=${Date.now()}`);
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[char]));

{
  const dom = makeDom();
  let calls = 0;
  const controller = window.MinutaResources.createController({
    db: { rpc: async name => { calls += 1; assert.equal(name, 'get_minuta_resource_workspace'); return { data: null, error: { code:'PGRST202', message:'function get_minuta_resource_workspace does not exist' } }; } },
    ...dom, escapeHtml, notify() {}, requireWrites: () => true,
    getCurrentUser: () => ({ id:'owner' }), getSessionGeneration: () => 1,
    sessionIsCurrent: () => true, applyWriteAvailability() {}
  });
  await controller.setOrganization({ id:'org-1', can_manage:true });
  assert.equal(calls, 1);
  assert.equal(controller.availability, 'unsupported');
  assert.equal(dom.elements.resourcesPanel.hidden, true, 'missing v69 must not show a broken panel');
}

{
  const dom = makeDom();
  const controller = window.MinutaResources.createController({
    db: { rpc: async () => ({ data: {
      organization_id:'org-1', can_manage:true,
      locations:[{ id:'loc-1', name:'Центр', active:true }],
      services:[{ id:'svc-1', name:'<Массаж>', performer_name:'Анна', active:true }],
      groups:[{ id:'grp-1', name:'Кабинет', kind:'room', description:'', active:true }],
      resources:[{ id:'res-1', name:'<Кабинет 1>', location_id:'loc-1', location_name:'Центр', group_id:'grp-1', group_name:'Кабинет', kind:'room', active:true }],
      requirements:[]
    }, error:null }) },
    ...dom, escapeHtml, notify() {}, requireWrites: () => true,
    getCurrentUser: () => ({ id:'owner' }), getSessionGeneration: () => 2,
    sessionIsCurrent: (user, generation) => user === 'owner' && generation === 2,
    applyWriteAvailability() {}
  });
  await controller.setOrganization({ id:'org-1', can_manage:true });
  assert.equal(controller.availability, 'ready');
  assert.equal(dom.elements.resourcesPanel.hidden, false);
  assert.match(dom.elements.resourcesList.innerHTML, /&lt;Кабинет 1&gt;/, 'resource names must be escaped');
  assert.doesNotMatch(dom.elements.resourcesList.innerHTML, /<Кабинет 1>/);
}

{
  const dom = makeDom();
  const first = deferred();
  const second = deferred();
  const controller = window.MinutaResources.createController({
    db: { rpc: async (_name, parameters) => parameters.p_organization === 'org-1' ? first.promise : second.promise },
    ...dom, escapeHtml, notify() {}, requireWrites: () => true,
    getCurrentUser: () => ({ id:'owner' }), getSessionGeneration: () => 3,
    sessionIsCurrent: (user, generation) => user === 'owner' && generation === 3,
    applyWriteAvailability() {}
  });
  const oldLoad = controller.setOrganization({ id:'org-1', can_manage:true });
  const currentLoad = controller.setOrganization({ id:'org-2', can_manage:true });
  second.resolve({ data:workspace('org-2'), error:null });
  await currentLoad;
  first.resolve({ data:workspace('org-1'), error:null });
  const staleResult = await oldLoad;
  assert.equal(staleResult.stale, true, 'Ответ предыдущей организации должен быть отброшен');
  assert.match(dom.elements.resourcesList.innerHTML, /Ресурс org-2/);
  assert.doesNotMatch(dom.elements.resourcesList.innerHTML, /Ресурс org-1/);
}

{
  const dom = makeDom();
  const controller = window.MinutaResources.createController({
    db: { rpc: async () => ({ data:workspace('org-specialist', { can_manage:false }), error:null }) },
    ...dom, escapeHtml, notify() {}, requireWrites: () => true,
    getCurrentUser: () => ({ id:'specialist' }), getSessionGeneration: () => 4,
    sessionIsCurrent: () => true, applyWriteAvailability() {}
  });
  await controller.setOrganization({ id:'org-specialist', can_manage:false });
  assert.equal(dom.elements.resourceGroupCreator.hidden, true, 'Специалисту нельзя показывать создание группы');
  assert.equal(dom.elements.resourceCreator.hidden, true, 'Специалисту нельзя показывать создание ресурса');
  assert.equal(dom.elements.resourceRequirementsPanel.hidden, true, 'Специалисту нельзя показывать изменение требований');
  assert.doesNotMatch(dom.elements.resourcesList.innerHTML, /<form/i, 'Read-only карточка специалиста не должна содержать форму');
}

{
  const dom = makeDom();
  const controller = window.MinutaResources.createController({
    db: { rpc: async () => ({ data:null, error:{ code:'08006', message:'connection failed' } }) },
    ...dom, escapeHtml, notify() {}, requireWrites: () => true,
    getCurrentUser: () => ({ id:'owner' }), getSessionGeneration: () => 5,
    sessionIsCurrent: () => true, applyWriteAvailability() {}
  });
  const result = await controller.setOrganization({ id:'org-error', can_manage:true });
  assert.equal(result.ok, false);
  assert.equal(controller.availability, 'error');
  assert.equal(dom.elements.resourcesPanel.hidden, false, 'Ошибка опционального RPC не должна скрывать весь раздел организации');
  assert.equal(dom.elements.resourcesUnavailable.hidden, false);
  assert.match(dom.elements.resourcesUnavailableText.textContent, /Филиалы и команда работают/);
}

{
  const dom = makeDom();
  const pending = deferred();
  let active = true;
  const controller = window.MinutaResources.createController({
    db: { rpc: async () => pending.promise },
    ...dom, escapeHtml, notify() {}, requireWrites: () => true,
    getCurrentUser: () => active ? ({ id:'owner' }) : null, getSessionGeneration: () => 6,
    sessionIsCurrent: () => active, applyWriteAvailability() {}
  });
  const load = controller.setOrganization({ id:'org-session', can_manage:true });
  active = false;
  controller.reset();
  pending.resolve({ data:workspace('org-session'), error:null });
  const result = await load;
  assert.equal(result.stale, true, 'Ответ после выхода должен быть отброшен');
  assert.equal(dom.elements.resourcesPanel.hidden, true);
}

console.log('resource management controller tests passed');
