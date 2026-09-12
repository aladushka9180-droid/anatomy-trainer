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
assert.match(worker, /voice-wake\.js\?v=728/);
assert.match(assistant, /__minutaAssistantWakeRequest/);
assert.doesNotMatch(wakeSource, /\b(fetch|XMLHttpRequest|WebSocket)\b/, 'wake-слой не должен подключать API или внешнюю модель');
assert.equal(wake.normalizeWakePhrase('  Привет, Ёлка!  '), 'привет елка');
assert.equal(wake.matchesWakePhrase('Эй… привет, Альбина!'), true);
assert.equal(wake.matchesWakePhrase('привет, Алевтина'), false);
assert.equal(wake.extractWakeCommand('Привет, Альбина, какие завтра окошки?'), 'какие завтра окошки?');
assert.equal(wake.extractWakeCommand('Эй, привет Альбина — покажи важное'), 'покажи важное');
assert.equal(wake.extractWakeCommand('Привет, Альбина'), '');

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
const storage = { value:'{"enabled":true}', getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
class FakeRecognition {
  static instances = [];
  constructor() { this.aborted = 0; FakeRecognition.instances.push(this); }
  start() { this.onstart?.(); }
  abort() { this.aborted += 1; }
  finish() { this.onend?.(); }
  emitResult(transcript) { this.onresult?.({ results:[Object.assign([{ transcript }], { isFinal:true })] }); }
}
globalThis.isSecureContext = true;
globalThis.MinutaProviderAssistant = { getReadOnlySnapshot:() => ({ authenticated:true }) };
const timers = [];
const controller = wake.createController({ document:doc, Recognition:FakeRecognition, storage, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
controller.bind();
assert.equal(toggle.checked, false, 'сохранённое включение не должно запускать микрофон после повторного открытия');
assert.equal(FakeRecognition.instances.length, 0, 'микрофон не должен запускаться автоматически');
assert.equal(storage.value, '{"enabled":false}', 'старое постоянное включение должно быть сброшено');
toggle.checked = true;
toggle.emit('change');
timers.shift()?.();
assert.equal(FakeRecognition.instances.length, 1);
FakeRecognition.instances[0].emitResult('Привет, Альбина, какие завтра окошки?');
assert.equal(globalThis.__minutaAssistantWakeRequest, true);
assert.equal(globalThis.__minutaAssistantWakeCommand, 'какие завтра окошки?');
assert.equal(toggle.checked, false, 'после фразы ожидание должно выключиться');
FakeRecognition.instances[0].emitResult('Привет, Альбина');
assert.equal(openButton.clicks, 1, 'повторный результат не должен повторно открыть помощника');
controller.destroy();

const visibilityController = wake.createController({ document:doc, Recognition:FakeRecognition, storage, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
visibilityController.bind();
toggle.checked = true;
toggle.emit('change');
const visibilityRecognition = FakeRecognition.instances.at(-1);
doc.hidden = true;
listeners.get('visibilitychange')?.();
assert.equal(toggle.checked, false, 'скрытие приложения должно выключать ожидание');
assert.equal(visibilityRecognition.aborted, 1, 'скрытие приложения должно останавливать микрофон');
doc.hidden = false;
listeners.get('visibilitychange')?.();
timers.splice(0).forEach(fn => fn());
assert.equal(FakeRecognition.instances.at(-1), visibilityRecognition, 'возврат в приложение не должен запускать микрофон снова');
visibilityController.destroy();

const endController = wake.createController({ document:doc, Recognition:FakeRecognition, storage, setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {} });
endController.bind();
toggle.checked = true;
toggle.emit('change');
const endedRecognition = FakeRecognition.instances.at(-1);
endedRecognition.finish();
timers.splice(0).forEach(fn => fn());
assert.equal(toggle.checked, false, 'завершившееся распознавание не должно циклически перезапускаться');
assert.equal(FakeRecognition.instances.at(-1), endedRecognition, 'после завершения не должно быть нового системного звука запуска');
endController.destroy();

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
console.log('Voice wake checks passed: one-shot enable, no relaunch restart, exact phrase and single trigger');
