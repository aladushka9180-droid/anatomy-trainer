import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const wake = createRequire(import.meta.url)('./voice-wake.js');
const root = dirname(fileURLToPath(import.meta.url));
const provider = readFileSync(join(root, 'provider.js'), 'utf8');
const html = readFileSync(join(root, 'provider.html'), 'utf8');
const worker = readFileSync(join(root, 'sw.js'), 'utf8');
const assistant = readFileSync(join(root, 'voice-assistant.js'), 'utf8');
const wakeSource = readFileSync(join(root, 'voice-wake.js'), 'utf8');
assert.match(provider, /loadProviderFeatureScript\('voice-wake\.js'\)/);
assert.match(html, /id="voiceWakeToggle"/);
assert.match(html, /Привет, Альбина/);
assert.match(worker, /voice-wake\.js\?v=709/);
assert.match(assistant, /__minutaAssistantWakeRequest/);
assert.doesNotMatch(wakeSource, /\b(fetch|XMLHttpRequest|WebSocket)\b/, 'wake-слой не должен подключать API или внешнюю модель');
assert.equal(wake.normalizeWakePhrase('  Привет, Ёлка!  '), 'привет елка');
assert.equal(wake.matchesWakePhrase('Эй… привет, Альбина!'), true);
assert.equal(wake.matchesWakePhrase('привет, Алевтина'), false);

const listeners = new Map();
const makeElement = (overrides = {}) => {
  const own = new Map();
  return Object.assign({
    hidden:false, open:false, checked:false, disabled:false, textContent:'', dataset:{},
    classList:{toggle() {}},
    addEventListener(type, listener) { own.set(type, listener); },
    removeEventListener(type) { own.delete(type); },
    emit(type, event = {}) { own.get(type)?.({ target:this, ...event }); },
    setAttribute() {}, click() { this.clicks = (this.clicks || 0) + 1; own.get('click')?.({ target:this }); },
    querySelector() { return null; }
  }, overrides);
};
const toggle = makeElement();
const status = makeElement();
const dialog = makeElement();
const openButton = makeElement();
const dashboard = makeElement({ hidden:false });
const doc = {
  hidden:false,
  querySelector(selector) { return ({ '#voiceWakeToggle':toggle, '#voiceWakeStatus':status, '#voiceAssistantDialog':dialog, '#openVoiceAssistant':openButton, '#dashboard':dashboard })[selector] || null; },
  addEventListener(type, listener) { listeners.set(type, listener); },
  removeEventListener(type) { listeners.delete(type); }
};
const storage = { value:'{"enabled":false}', getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
class FakeRecognition {
  static instances = [];
  constructor() { this.aborted = 0; FakeRecognition.instances.push(this); }
  start() { this.onstart?.(); }
  abort() { this.aborted += 1; }
  emitResult(transcript) { this.onresult?.({ results:[Object.assign([{ transcript }], { isFinal:true })] }); }
}
globalThis.isSecureContext = true;
globalThis.MinutaProviderAssistant = { getReadOnlySnapshot:() => ({ authenticated:true }) };
const timers = [];
const controller = wake.createController({ document:doc, Recognition:FakeRecognition, storage, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
controller.bind();
toggle.checked = true;
toggle.emit('change');
timers.shift()?.();
assert.equal(FakeRecognition.instances.length, 1);
FakeRecognition.instances[0].emitResult('Привет, Альбина');
assert.equal(globalThis.__minutaAssistantWakeRequest, true);
FakeRecognition.instances[0].emitResult('Привет, Альбина');
assert.equal(openButton.clicks, 1, 'повторный результат не должен повторно открыть помощника');
controller.destroy();

globalThis.isSecureContext = false;
const unsupportedToggle = makeElement();
const unsupportedStatus = makeElement();
const unsupportedDoc = {
  hidden:false,
  querySelector(selector) { return ({ '#voiceWakeToggle':unsupportedToggle, '#voiceWakeStatus':unsupportedStatus, '#voiceAssistantDialog':dialog, '#openVoiceAssistant':openButton, '#dashboard':dashboard })[selector] || null; },
  addEventListener() {}, removeEventListener() {}
};
const unsupported = wake.createController({ document:unsupportedDoc, Recognition:null, storage, setTimeout, clearTimeout });
unsupported.bind();
assert.equal(unsupportedToggle.disabled, true);
assert.match(unsupportedStatus.textContent, /не поддерживает/);
unsupported.destroy();
console.log('Voice wake checks passed: normalization, exact phrase guard, explicit enable and single trigger');
