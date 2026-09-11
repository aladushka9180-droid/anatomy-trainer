import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../notification-center.js', import.meta.url), 'utf8');

class Element {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.textContent = '';
    this.innerHTML = '';
    this.listeners = new Map();
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  querySelectorAll() { return []; }
  matches() { return false; }
  closest() { return null; }
}

function workspace(organizationId, overrides = {}) {
  return {
    organization_id:organizationId,
    current_role:'owner',
    settings:{ organization_id:organizationId, enabled:true },
    channels:[{ organization_id:organizationId, audience:'provider', channel:'telegram', enabled:true }],
    endpoints:[{ audience:'provider', subject_key:'owner-a', channel:'telegram', active:true, configured:true }],
    outbox:[],
    ...overrides
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(handler) {
  const ids = [
    'unifiedNotificationPanel', 'unifiedNotificationUnavailable', 'unifiedNotificationWorkspace',
    'unifiedNotificationUnavailableText', 'unifiedNotificationsEnabled', 'unifiedNotificationState',
    'unifiedNotificationChannels', 'unifiedNotificationDeliveries', 'reloadUnifiedNotifications'
  ];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const listeners = new Map();
  const notifications = [];
  const rpcCalls = [];
  let rpcHandler = handler;
  let navigationRefreshes = 0;
  const document = {
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  const window = {
    MINUTA_CONFIG:{ supabaseUrl:'https://status.test', supabaseKey:'public-test-key' },
    refreshSectionNavigation() { navigationRefreshes += 1; }
  };
  const context = vm.createContext({
    window,
    document,
    URL,
    fetch:async () => ({
      ok:true,
      json:async () => ({ ok:true, configured_channels:['telegram'], provider_telegram_fallback:false })
    })
  });
  vm.runInContext(source, context, { filename:'notification-center.js' });
  const db = {
    auth:{ getUser:async () => ({ data:{ user:{ id:'owner-a' } } }) },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return rpcHandler(name, args);
    }
  };
  const controller = window.MinutaNotificationCenter.createController({
    db,
    $:selector => elements[selector.slice(1)] || null,
    escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[character]),
    notify:message => notifications.push(message),
    requireWrites:() => true
  });
  return {
    controller,
    elements,
    listeners,
    notifications,
    rpcCalls,
    setHandler(next) { rpcHandler = next; },
    navigationRefreshes:() => navigationRefreshes
  };
}

async function test(name, body) {
  try {
    await body();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await test('valid scoped workspace renders delivery state and cancellation reason', async () => {
  const f = fixture(() => ({
    data:workspace('organization-a', {
      outbox:[{
        id:'cancelled-a', kind:'booking_reminder', audience:'client', channel:'telegram',
        performer_id:'owner-a', status:'cancelled', attempts:0, last_error:'Событие устарело после переноса записи',
        context:{ client_name:'Ирина' }
      }]
    }),
    error:null
  }));
  await f.controller.setOrganization({ id:'organization-a' });
  assert.equal(f.elements.unifiedNotificationPanel.hidden, false);
  assert.equal(f.elements.unifiedNotificationWorkspace.hidden, false);
  assert.equal(f.elements.unifiedNotificationUnavailable.hidden, true);
  assert.match(f.elements.unifiedNotificationDeliveries.innerHTML, /отменено/);
  assert.match(f.elements.unifiedNotificationDeliveries.innerHTML, /Событие устарело после переноса записи/);
});

await test('foreign organization workspace is rejected without rendering or write authority', async () => {
  const f = fixture(() => ({ data:workspace('organization-b'), error:null }));
  await f.controller.setOrganization({ id:'organization-a' });
  assert.equal(f.elements.unifiedNotificationPanel.hidden, false);
  assert.equal(f.elements.unifiedNotificationWorkspace.hidden, true);
  assert.equal(f.elements.unifiedNotificationUnavailable.hidden, false);
  assert.match(f.elements.unifiedNotificationUnavailableText.textContent, /другой организации/);
  assert.equal(f.elements.unifiedNotificationChannels.innerHTML, '');
});

for (const [label, result] of [
  ['empty RPC envelope', undefined],
  ['malformed collection', { data:workspace('organization-a', { outbox:[null] }), error:null }],
  ['duplicate delivery identity', { data:workspace('organization-a', { outbox:[
    { id:'same', performer_id:'owner-a', kind:'booking_created', audience:'provider', channel:'telegram', status:'pending', attempts:0 },
    { id:'same', performer_id:'owner-a', kind:'booking_cancelled', audience:'provider', channel:'telegram', status:'failed', attempts:1 }
  ] }), error:null }]
]) {
  await test(`${label} fails closed and remains retryable`, async () => {
    const f = fixture(() => result);
    await f.controller.setOrganization({ id:'organization-a' });
    assert.equal(f.elements.unifiedNotificationPanel.hidden, false);
    assert.equal(f.elements.unifiedNotificationWorkspace.hidden, true);
    assert.equal(f.elements.unifiedNotificationUnavailable.hidden, false);
    assert.match(f.elements.unifiedNotificationUnavailableText.textContent, /неполн/);
  });
}

await test('missing optional server schema hides only the unified panel', async () => {
  const f = fixture(() => ({
    data:null,
    error:{ code:'PGRST202', message:'Could not find get_minuta_notification_workspace in the schema cache' }
  }));
  await f.controller.setOrganization({ id:'organization-a' });
  assert.equal(f.elements.unifiedNotificationPanel.hidden, true);
  assert.ok(f.navigationRefreshes() >= 1);
  assert.deepEqual(f.notifications, []);
});

await test('foreign mutation acknowledgement is not announced and authoritative reload recovers', async () => {
  let workspaceLoads = 0;
  const f = fixture((name) => {
    if (name === 'set_minuta_notification_master') return { data:workspace('organization-b'), error:null };
    workspaceLoads += 1;
    return { data:workspace('organization-a', { settings:{ organization_id:'organization-a', enabled:workspaceLoads === 1 } }), error:null };
  });
  f.controller.bind();
  await f.controller.setOrganization({ id:'organization-a' });
  f.elements.unifiedNotificationsEnabled.checked = false;
  await f.listeners.get('change')({ target:f.elements.unifiedNotificationsEnabled });
  assert.deepEqual(f.rpcCalls.map(call => call.name), [
    'get_minuta_notification_workspace', 'set_minuta_notification_master', 'get_minuta_notification_workspace'
  ]);
  assert.deepEqual(f.notifications, ['Сервер не подтвердил изменение центра уведомлений']);
  assert.equal(f.elements.unifiedNotificationWorkspace.hidden, false);
  assert.equal(f.elements.unifiedNotificationsEnabled.checked, false);
});

await test('retry is single-flight and requires the exact pending acknowledgement', async () => {
  const gate = deferred();
  let workspaceLoads = 0;
  const f = fixture((name) => {
    if (name === 'retry_notification_outbox') return gate.promise;
    workspaceLoads += 1;
    return {
      data:workspace('organization-a', { outbox:workspaceLoads === 1 ? [{
        id:'failed-a', kind:'booking_created', audience:'provider', channel:'telegram',
        performer_id:'owner-a', status:'failed', attempts:2, last_error:'gateway_timeout'
      }] : [] }),
      error:null
    };
  });
  f.controller.bind();
  await f.controller.setOrganization({ id:'organization-a' });
  const target = {
    closest:selector => selector === '[data-unified-retry]' ? { dataset:{ unifiedRetry:'failed-a' } } : null
  };
  const first = f.listeners.get('click')({ target });
  const second = f.listeners.get('click')({ target });
  assert.equal(f.rpcCalls.filter(call => call.name === 'retry_notification_outbox').length, 1);
  gate.resolve({ data:'pending', error:null });
  await Promise.all([first, second]);
  assert.equal(f.rpcCalls.filter(call => call.name === 'retry_notification_outbox').length, 1);
  assert.deepEqual(f.notifications, ['Уведомление возвращено в очередь']);
});

await test('retry without an exact acknowledgement never reports success', async () => {
  const f = fixture(name => name === 'retry_notification_outbox'
    ? { data:null, error:null }
    : { data:workspace('organization-a'), error:null });
  f.controller.bind();
  await f.controller.setOrganization({ id:'organization-a' });
  await f.listeners.get('click')({
    target:{ closest:() => ({ dataset:{ unifiedRetry:'failed-a' } }) }
  });
  assert.deepEqual(f.notifications, ['Сервер не подтвердил повтор уведомления']);
});

await test('specialist workspace rejects another recipient or performer', async () => {
  const foreignEndpoint = workspace('organization-a', {
    current_role:'specialist',
    endpoints:[{ audience:'provider', subject_key:'specialist-b', channel:'telegram', active:true, configured:true }]
  });
  const f = fixture(() => ({ data:foreignEndpoint, error:null }));
  await f.controller.setOrganization({ id:'organization-a' });
  assert.equal(f.elements.unifiedNotificationWorkspace.hidden, true);
  assert.match(f.elements.unifiedNotificationUnavailableText.textContent, /неполные данные/);

  f.setHandler(() => ({ data:workspace('organization-a', {
    current_role:'specialist',
    endpoints:[{ audience:'provider', subject_key:'owner-a', channel:'telegram', active:true, configured:true }],
    outbox:[{ id:'foreign-delivery', performer_id:'specialist-b', kind:'booking_created', audience:'provider', channel:'telegram', status:'pending', attempts:0 }]
  }), error:null }));
  await f.controller.load();
  assert.equal(f.elements.unifiedNotificationWorkspace.hidden, true);
  assert.match(f.elements.unifiedNotificationUnavailableText.textContent, /неполные данные/);
});

console.log('Notification center context, schema fallback and retry recovery checks passed.');
