import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'team-calendar.js'), 'utf8');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|MinutaReliability|\.put\(/i, 'Командный календарь не должен сохранять персональные данные на устройстве');

class MockElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = '';
    const classes = new Set();
    this.classList = {
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
      contains: name => classes.has(name)
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { return this.listeners.get(type)?.({ target: this }); }
}

function makeDom() {
  const elements = Object.fromEntries([
    'teamCalendarToolbar', 'teamCalendarFilters', 'teamCalendarStatus',
    'teamCalendarLocation', 'teamCalendarPerformer', 'teamCalendarResourceField',
    'teamCalendarResource', 'providerBookings'
  ].map(id => [id, new MockElement(id)]));
  const personal = new MockElement();
  personal.dataset.calendarMode = 'personal';
  const team = new MockElement();
  team.dataset.calendarMode = 'team';
  return {
    elements,
    modes: [personal, team],
    $: selector => elements[selector.replace(/^#/, '')] || null,
    $$: selector => selector === '[data-calendar-mode]' ? [personal, team] : []
  };
}

globalThis.window = {};
await import(`${pathToFileURL(join(root, 'team-calendar.js')).href}?test=${Date.now()}`);
const { createController } = window.MinutaTeamCalendar;
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const ownerOrganization = { id: 'org-1', current_role: 'owner', can_manage: true };

{
  const dom = makeDom();
  const calls = [];
  const modeChanges = [];
  const controller = createController({
    db: { rpc: async (name, parameters) => {
      calls.push({ name, parameters });
      return { data: {
        organization_id: 'org-1', current_role: 'owner', can_view_team: true,
        locations: [{ id: 'loc-1', name: 'Центр', active: true }],
        performers: [{ id: 'user-a', display_name: 'Анна', role: 'specialist' }, { id: 'user-b', display_name: 'Борис', role: 'specialist' }],
        resources: [
          { id: 'resource-1', name: 'Кабинет 1', location_id: 'loc-1', group_name: 'Кабинеты', active: true },
          { id: 'resource-2', name: 'Кабинет 2', location_id: 'loc-1', group_name: 'Кабинеты', active: true }
        ],
        bookings: [
          { id: 'booking-1', performer_id: 'user-a', performer_name: 'Анна', location_id: 'loc-1', location_name: 'Центр', service_name: 'Массаж', client_name: '<Анна>', client_phone: '+70000000000', booking_date: '2026-09-02', booking_time: '10:00:00', duration_minutes: 60, status: 'confirmed', resources: [{ id: 'resource-1', name: 'Кабинет 1' }] },
          { id: 'booking-2', performer_id: 'user-b', performer_name: 'Борис', location_id: 'loc-1', location_name: 'Центр', service_name: 'Массаж', client_name: 'Иван', client_phone: '', booking_date: '2026-09-02', booking_time: '11:00:00', duration_minutes: 30, status: 'no_show', resources: [{ id: 'resource-2', name: 'Кабинет 2' }] }
        ]
      }, error: null };
    } },
    ...dom,
    escapeHtml,
    getCurrentUser: () => ({ id: 'owner-1' }),
    getSessionGeneration: () => 7,
    sessionIsCurrent: (userId, generation) => userId === 'owner-1' && generation === 7,
    getSelectedDate: () => '2026-09-02',
    getHolder: () => dom.elements.providerBookings,
    onModeChange: active => modeChanges.push(active),
    renderLegacy: () => {}
  });
  controller.bind();
  controller.setOrganization(ownerOrganization);
  await controller.setMode('team');
  assert.equal(calls.length, 1, 'Вход в командный режим должен выполнить ровно один RPC');
  assert.deepEqual(calls[0], { name: 'get_minuta_team_calendar_v2', parameters: { p_organization: 'org-1', p_start: '2026-09-02', p_end: '2026-09-02', p_location: null, p_performer: null, p_resource: null } });
  assert.equal(controller.isTeamMode, true);
  assert.equal(dom.elements.teamCalendarToolbar.hidden, false);
  assert.equal(dom.elements.teamCalendarFilters.hidden, false);
  assert.match(dom.elements.providerBookings.innerHTML, /Анна/);
  assert.match(dom.elements.providerBookings.innerHTML, /Борис/);
  assert.match(dom.elements.providerBookings.innerHTML, /&lt;Анна&gt;/, 'Данные клиента должны экранироваться');
  assert.match(dom.elements.providerBookings.innerHTML, /10:00<small>до 11:00<\/small>/, 'Командная карточка должна показывать время окончания');
  assert.match(dom.elements.providerBookings.innerHTML, /status-no-show/, 'Статус неявки должен использовать общий CSS-класс кабинета');
  assert.match(dom.elements.providerBookings.innerHTML, /Кабинет 1/, 'Карточка должна показывать назначенный ресурс');
  assert.equal(dom.elements.teamCalendarResourceField.hidden, false, 'Фильтр ресурсов должен появиться только для v69-календаря');
  assert.doesNotMatch(dom.elements.providerBookings.innerHTML, /data-open-booking|data-booking-action/, 'Чужая запись не должна получать действия личного журнала');
  dom.elements.teamCalendarPerformer.value = 'user-a';
  dom.elements.teamCalendarPerformer.dispatch('change');
  assert.match(dom.elements.providerBookings.innerHTML, /Анна/);
  assert.doesNotMatch(dom.elements.providerBookings.innerHTML, /Борис/);
  dom.elements.teamCalendarPerformer.value = '';
  dom.elements.teamCalendarPerformer.dispatch('change');
  dom.elements.teamCalendarResource.value = 'resource-2';
  dom.elements.teamCalendarResource.dispatch('change');
  assert.doesNotMatch(dom.elements.providerBookings.innerHTML, /Анна/);
  assert.match(dom.elements.providerBookings.innerHTML, /Борис/);
  assert.equal(modeChanges.at(-1), true);
}

{
  const dom = makeDom();
  let rpcCalls = 0;
  const controller = createController({
    db: { rpc: async name => {
      rpcCalls += 1;
      if (name === 'get_minuta_team_calendar_v2') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function get_minuta_team_calendar_v2' } };
      return { data: { organization_id:'org-1', current_role:'owner', can_view_team:true, locations:[], performers:[], bookings:[] }, error:null };
    } },
    ...dom,
    escapeHtml,
    getCurrentUser: () => ({ id: 'owner-1' }),
    getSessionGeneration: () => 1,
    sessionIsCurrent: () => true,
    getSelectedDate: () => '2026-09-02',
    getHolder: () => dom.elements.providerBookings,
    onModeChange: () => {},
    renderLegacy: () => {}
  });
  controller.bind();
  controller.setOrganization(ownerOrganization);
  await controller.setMode('team');
  assert.equal(rpcCalls, 2, 'При отсутствии v69 должен быть ровно один fallback к v68');
  assert.equal(controller.isTeamMode, true, 'Отсутствие v69 не должно ломать командный календарь v68');
  assert.equal(dom.elements.teamCalendarResourceField.hidden, true, 'На fallback v68 нельзя показывать неработающий фильтр ресурсов');
}

{
  const dom = makeDom();
  let rpcCalls = 0;
  let legacyCalls = 0;
  const controller = createController({
    db: { rpc: async () => { rpcCalls += 1; return { data:null, error:{ code:'PGRST202', message:'function does not exist' } }; } },
    ...dom, escapeHtml,
    getCurrentUser: () => ({ id:'owner-1' }), getSessionGeneration: () => 1,
    sessionIsCurrent: () => true, getSelectedDate: () => '2026-09-02',
    getHolder: () => dom.elements.providerBookings, onModeChange: () => {},
    renderLegacy: () => { legacyCalls += 1; }
  });
  controller.bind();
  controller.setOrganization(ownerOrganization);
  await controller.setMode('team');
  assert.equal(rpcCalls, 2);
  assert.equal(controller.isTeamMode, false, 'При отсутствии v68 и v69 должен остаться личный режим');
  assert.equal(dom.elements.teamCalendarToolbar.hidden, true);
  assert.ok(legacyCalls > 0);
}

{
  const dom = makeDom();
  let rpcCalls = 0;
  const controller = createController({
    db: { rpc: async () => { rpcCalls += 1; return { data: {}, error: null }; } },
    ...dom,
    escapeHtml,
    getCurrentUser: () => ({ id: 'specialist-1' }),
    getSessionGeneration: () => 1,
    sessionIsCurrent: () => true,
    getSelectedDate: () => '2026-09-02',
    getHolder: () => dom.elements.providerBookings,
    onModeChange: () => {},
    renderLegacy: () => {}
  });
  controller.bind();
  controller.setOrganization({ id: 'org-1', current_role: 'specialist', can_manage: false });
  await controller.setMode('team');
  assert.equal(rpcCalls, 0, 'Специалист не должен запрашивать календарь команды');
  assert.equal(controller.isTeamMode, false);
  assert.equal(dom.elements.teamCalendarToolbar.hidden, true);
}

console.log('team calendar controller tests passed');
