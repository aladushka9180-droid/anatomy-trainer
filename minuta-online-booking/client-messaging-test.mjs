import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const script = fs.readFileSync(new URL('./client-messaging.js', import.meta.url), 'utf8');
const requiredIds = ['clientMessagingDialog', 'clientMessagingTitle', 'clientMessagingName', 'clientMessagingPhone', 'clientMessagingText', 'clientMessagingStatus', 'copyClientMessage', 'copyClientPhone'];
for (const id of requiredIds) assert.equal(html.split(`id="${id}"`).length - 1, 1, `Missing or duplicated messaging element: ${id}`);
for (const channel of ['whatsapp', 'telegram', 'max', 'vk', 'sms', 'email']) assert.ok(html.includes(`data-message-channel="${channel}"`), `Missing channel: ${channel}`);
assert.ok(html.indexOf('id="clientMessagingDialog"') < html.indexOf('src="client-messaging.js'), 'Dialog must precede its deferred controller');

function harness(userAgent = 'Android') {
  const links = [], copied = [], listeners = new Map(), nodes = new Map();
  const node = () => ({ value:'', textContent:'', hidden:false, disabled:false, dataset:{}, classList:{ toggle() {} }, focus() {}, addEventListener(type, fn) { this[type] = fn; } });
  for (const id of requiredIds) nodes.set(`#${id}`, node());
  nodes.set('[data-message-channel="email"]', node());
  const presets = ['confirmation','reminder','reschedule','cancellation','custom'].map(kind => ({ ...node(), dataset:{messagePreset:kind} }));
  const dialog = nodes.get('#clientMessagingDialog');
  dialog.querySelector = selector => nodes.get(selector);
  dialog.querySelectorAll = () => presets;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const document = {
    querySelector: selector => nodes.get(selector),
    addEventListener: (type, fn) => listeners.set(type, fn),
    body: { appendChild() {}, append() {} },
    createElement: () => ({ click() { links.push(this.href); }, remove() {} })
  };
  vm.runInNewContext(script, {document,navigator:{userAgent,clipboard:{writeText:async text => { copied.push(text); }}},window:{location:{assign:url=>links.push(url)}}});
  const click = async (selector, target) => {
    listeners.get('click')({target:{closest:s => s === selector ? target : null},preventDefault() {}});
    await new Promise(resolve => setImmediate(resolve));
  };
  return {nodes,dialog,presets,links,copied,click};
}

const h = harness();
const message = 'Test & details\n10:30 + reminder';
const trigger = {dataset:{clientPhone:'8 (999) 000-00-00',clientName:'Test client',messageConfirmation:'Confirmation',messageReminder:message}};
await h.click('[data-message-client]', trigger);
assert.equal(h.dialog.open, true, 'Client action must open the dialog');
assert.equal(h.nodes.get('#clientMessagingPhone').textContent, '+79990000000');
assert.equal(h.nodes.get('#clientMessagingText').value, message);
assert.equal(h.nodes.get('[data-message-channel="email"]').hidden, true);
assert.equal(h.presets.find(p=>p.dataset.messagePreset==='reschedule').disabled, true);

for (const [channel,host] of [['whatsapp','wa.me'],['telegram','t.me'],['max','max.ru'],['vk','vk.com']]) {
  await h.click('[data-message-channel]', {dataset:{messageChannel:channel}});
  const url = new URL(h.links.at(-1));
  assert.equal(url.hostname, host);
  if (channel !== 'vk') assert.equal(url.searchParams.get('text'), message, 'Message must survive URL encoding');
  if (channel === 'whatsapp') assert.equal(url.pathname, '/79990000000');
  if (channel === 'telegram') assert.equal(url.pathname, '/+79990000000');
  if (channel === 'vk' || channel === 'max') assert.equal(h.copied.at(-1), '+79990000000');
}
await h.click('[data-message-channel]', {dataset:{messageChannel:'sms'}});
assert.equal(h.links.at(-1), `sms:+79990000000?body=${encodeURIComponent(message)}`);
await h.click('[data-message-preset]', {dataset:{messagePreset:'confirmation'}});
assert.equal(h.nodes.get('#clientMessagingText').value, 'Confirmation');
await h.click('[data-close-client-messaging]', {});
assert.equal(h.dialog.open, false);
await h.click('[data-message-client]', {dataset:{clientPhone:'+79990000001',clientName:'Second client'}});
assert.equal(h.nodes.get('#clientMessagingText').value, 'Здравствуйте, Second client!', 'Previous recipient text must not leak');

const ios = harness('iPhone');
await ios.click('[data-message-client]', trigger);
await ios.click('[data-message-channel]', {dataset:{messageChannel:'sms'}});
assert.equal(ios.links.at(-1), `sms:+79990000000&body=${encodeURIComponent(message)}`);
console.log('Client messaging: DOM contract, dialog, presets, five channel URLs, encoding and recipient reset passed (no external delivery).');
