import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('./client-messaging.js', import.meta.url), 'utf8');
const requiredIds = ['clientMessagingDialog','clientMessagingTitle','clientMessagingName','clientMessagingPhone','clientMessagingText',
  'clientMessagingPreview','clientMessagingTemplateStatus','clientMessagingStatus','saveClientMessageTemplate','resetClientMessageTemplate',
  'clientMessagingSendChooser','clientMessagingChannels','copyClientMessage','copyClientPhone'];
for (const id of requiredIds) assert.equal(html.split(`id="${id}"`).length - 1, 1, `Missing or duplicated messaging element: ${id}`);
for (const channel of ['whatsapp','telegram','max','vk','sms','email']) assert.ok(html.includes(`data-message-channel="${channel}"`), `Missing channel: ${channel}`);
assert.ok(html.indexOf('id="clientMessagingDialog"') < html.indexOf('src="client-messaging.js'), 'Dialog must precede its deferred controller');

function harness(userAgent = 'Android') {
  const links = [], copied = [], listeners = new Map(), nodes = new Map(), calls = [];
  let saveAttempts = 0;
  const node = () => ({
    value:'', textContent:'', hidden:false, disabled:false, dataset:{}, style:{}, selectionStart:0, selectionEnd:0,
    classList:{ toggle() {} }, focus() {}, setSelectionRange(start,end) { this.selectionStart=start; this.selectionEnd=end; },
    setAttribute(name,value) { this[name]=value; }, addEventListener(type,fn) { this[type]=fn; }, querySelector() { return null; }
  });
  for (const id of requiredIds) nodes.set(`#${id}`, node());
  const emailNote = node();
  const emailButton = node(); emailButton.dataset.messageChannel = 'email'; emailButton.querySelector = selector => selector === '[data-message-channel-note]' ? emailNote : null;
  nodes.set('[data-message-channel="email"]', emailButton);
  const presets = ['reminder','reschedule','cancellation','custom'].map(kind => ({ ...node(), dataset:{ messagePreset:kind } }));
  const channelButtons = ['whatsapp','telegram','max','vk','sms'].map(channel => ({ ...node(), dataset:{ messageChannel:channel } }));
  const dialog = nodes.get('#clientMessagingDialog');
  dialog.querySelector = selector => nodes.get(selector);
  dialog.querySelectorAll = selector => selector === '[data-message-preset]' ? presets : [];
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  nodes.get('#clientMessagingChannels').querySelector = () => channelButtons[0];
  const document = {
    querySelector:selector => nodes.get(selector), addEventListener:(type,fn) => listeners.set(type,fn),
    body:{ appendChild() {}, append() {} }, execCommand:() => true,
    createElement:tag => tag === 'a'
      ? { style:{}, click() { links.push(this.href); }, remove() {} }
      : { style:{}, value:'', select() {}, remove() {} }
  };
  const window = { location:{ assign:url => links.push(url) } };
  const context = { document, navigator:{ userAgent, clipboard:{ writeText:async text => copied.push(text) } }, window,
    crypto:{ randomUUID:() => '30000000-0000-4000-8000-000000000001' }, confirm:() => true, Map, Object, String, Number, Math, Date, Array };
  vm.runInNewContext(script, context);
  const organizationId = '00000000-0000-4000-8000-000000000010';
  const performerId = '00000000-0000-4000-8000-000000000011';
  const db = { rpc:async (name,payload) => {
    calls.push({ name,payload });
    if (name === 'get_provider_message_templates_v161') return { data:{ organization_id:organizationId, performer_id:performerId,
      templates:[{ kind:'reminder', body:'Личный текст для {имя}: {услуга}, {дата} {время}, {адрес}', version:4, updated_at:'2026-09-15T00:00:00Z' }] }, error:null };
    saveAttempts += 1;
    if (saveAttempts === 1) throw new Error('network response lost');
    return { data:{ saved:true, organization_id:organizationId, performer_id:performerId, kind:payload.p_kind, body:payload.p_body, version:payload.p_expected_version + 1, updated_at:'2026-09-15T00:01:00Z' }, error:null };
  } };
  window.MinutaClientMessaging.configure({ db, getOrganization:() => ({ id:organizationId }), getCurrentUser:() => ({ id:performerId }), requireWrites:() => true });
  const click = async (selector,target) => {
    listeners.get('click')({ target:{ closest:s => s === selector ? target : null }, preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  };
  return { nodes,dialog,presets,links,copied,calls,click,emailButton };
}

const h = harness();
const trigger = { dataset:{ clientPhone:'8 (999) 000-00-00', clientName:'Марина', messageService:'Массаж', messageDate:'20 сентября 2026', messageTime:'10:30', messageAddress:'Ижевск' } };
await h.click('[data-message-client]', trigger);
assert.equal(h.dialog.open, true);
assert.equal(h.nodes.get('#clientMessagingPhone').textContent, '+79990000000');
assert.equal(h.nodes.get('#clientMessagingText').value, 'Личный текст для {имя}: {услуга}, {дата} {время}, {адрес}');
assert.equal(h.nodes.get('#clientMessagingPreview').textContent, 'Личный текст для Марина: Массаж, 20 сентября 2026 10:30, Ижевск');
assert.equal(h.emailButton.disabled, true, 'Unavailable email remains visible but disabled');

await h.click('[data-message-preset]', { dataset:{ messagePreset:'reschedule' } });
const editor = h.nodes.get('#clientMessagingText');
editor.value = 'Перенос для {имя} на {дата} в {время}';
editor.input();
await h.click('#saveClientMessageTemplate', h.nodes.get('#saveClientMessageTemplate'));
assert.match(h.nodes.get('#clientMessagingTemplateStatus').textContent, /повтор безопасен/);
await h.click('#saveClientMessageTemplate', h.nodes.get('#saveClientMessageTemplate'));
const saves = h.calls.filter(call => call.name === 'save_provider_message_template_v161');
assert.equal(saves.length, 2);
assert.equal(saves[0].payload.p_idempotency_key, saves[1].payload.p_idempotency_key, 'Lost-response retry must reuse idempotency key');
assert.equal(saves[0].payload.p_expected_version, 0);
assert.match(h.nodes.get('#clientMessagingTemplateStatus').textContent, /сохранён/);

editor.value = 'Разовая правка'; editor.input();
assert.equal(h.nodes.get('#saveClientMessageTemplate').disabled, false, 'One-off edit is dirty but never auto-saved');
assert.equal(saves.length, 2, 'Input must not save implicitly');
await h.click('[data-message-preset]', { dataset:{ messagePreset:'custom' } });
assert.equal(h.nodes.get('#saveClientMessageTemplate').hidden, true, 'Custom text remains one-off');

await h.click('#clientMessagingSendChooser', h.nodes.get('#clientMessagingSendChooser'));
assert.equal(h.nodes.get('#clientMessagingChannels').hidden, false);
await h.click('[data-message-channel]', { dataset:{ messageChannel:'whatsapp' }, disabled:false });
assert.equal(new URL(h.links.at(-1)).hostname, 'wa.me');
assert.match(h.nodes.get('#clientMessagingStatus').textContent, /открыто.*Проверьте/u);

await h.click('[data-close-client-messaging]', {});
assert.equal(h.dialog.open, false);
await h.click('[data-message-client]', { dataset:{ ...trigger.dataset, clientPhone:'+79990000001', clientName:'Анна' } });
assert.match(h.nodes.get('#clientMessagingPreview').textContent, /Анна/);
assert.doesNotMatch(h.nodes.get('#clientMessagingPreview').textContent, /Марина/);

const ios = harness('iPhone');
await ios.click('[data-message-client]', trigger);
await ios.click('[data-message-channel]', { dataset:{ messageChannel:'sms' }, disabled:false });
assert.match(ios.links.at(-1), /^sms:\+79990000000&body=/);
console.log('Client messaging: server templates, exact preview, client isolation, explicit save, idempotent retry and manual channel handoff passed.');
