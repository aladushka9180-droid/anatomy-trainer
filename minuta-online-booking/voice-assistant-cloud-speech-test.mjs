import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const globalListeners = new Map();
globalThis.addEventListener = (type, listener) => {
  const listeners = globalListeners.get(type) || new Set();
  listeners.add(listener);
  globalListeners.set(type, listeners);
};
globalThis.removeEventListener = (type, listener) => globalListeners.get(type)?.delete(listener);
globalThis.matchMedia = query => ({ matches:query === '(pointer: coarse)' });
Object.defineProperty(globalThis, 'navigator', { configurable:true, value:{ onLine:true, userAgent:'Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile' } });

let savedSpeech = JSON.stringify({ voiceKey:'Microsoft Pavel', rate:1.25, volume:0.5 });
globalThis.localStorage = {
  getItem:() => savedSpeech,
  setItem:(_key, value) => { savedSpeech = value; }
};

const speechSynthesis = {
  cancelCount:0,
  speakCount:0,
  listeners:new Map(),
  voices:[
    { name:'Microsoft Irina', lang:'ru-RU', voiceURI:'irina' },
    { name:'Microsoft Pavel', lang:'ru-RU', voiceURI:'pavel' },
    { name:'Google русский', lang:'ru_RU', voiceURI:'google' }
  ],
  cancel() { this.cancelCount += 1; },
  speak() { this.speakCount += 1; },
  getVoices() { return this.voices; },
  addEventListener(type, listener) { this.listeners.set(type, listener); },
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
};
globalThis.speechSynthesis = speechSynthesis;
globalThis.SpeechSynthesisUtterance = class {};

const audioInstances = [];
class FakeAudio {
  constructor(url) { this.url = url; this.pauseCount = 0; audioInstances.push(this); }
  play() { this.played = true; return Promise.resolve(); }
  pause() { this.pauseCount += 1; }
  removeAttribute() {}
  load() {}
}
globalThis.Audio = FakeAudio;
let objectUrlIndex = 0;
const revokedUrls = [];
globalThis.URL.createObjectURL = () => `blob:test-${++objectUrlIndex}`;
globalThis.URL.revokeObjectURL = url => revokedUrls.push(url);

function createElement(overrides = {}) {
  const listeners = new Map();
  const classes = new Set();
  return Object.assign({
    value:'', textContent:'', hidden:false, open:false, disabled:false, dataset:{},
    classList:{
      add:name => classes.add(name), remove:name => classes.delete(name), contains:name => classes.has(name),
      toggle:(name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    },
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener); listeners.set(type, handlers);
    },
    emit(type, event = {}) { for (const listener of listeners.get(type) || []) listener({ preventDefault() {}, ...event }); },
    setAttribute() {}, focus() {}, querySelector() { return null; }, replaceChildren() {}, scrollIntoView() {}
  }, overrides);
}

const openButton = createElement();
const closeButton = createElement();
const backButton = createElement({ hidden:true });
const form = createElement();
const input = createElement();
const status = createElement();
const listenLabel = createElement();
const listenButton = createElement({ querySelector:selector => selector === 'span' ? listenLabel : null });
const voiceSelect = createElement({ children:[], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } });
const voicePreviewButton = createElement();
const rateInput = createElement();
const rateValue = createElement();
const volumeInput = createElement();
const volumeValue = createElement();
const speechSettings = createElement();
const settings = createElement();
const dialog = createElement({ showModal() { this.open = true; }, close() { this.open = false; } });

let speakButton = null;
let resultHtml = '';
const result = createElement({
  querySelector(selector) { return selector === '[data-voice-speak]' ? speakButton : null; },
  replaceChildren() { resultHtml = ''; speakButton = null; }
});
Object.defineProperty(result, 'innerHTML', {
  get:() => resultHtml,
  set(value) {
    resultHtml = String(value);
    speakButton = resultHtml.includes('data-voice-speak') ? createElement() : null;
  }
});

const elements = new Map([
  ['#voiceAssistantDialog', dialog], ['#openVoiceAssistant', openButton], ['[data-close-voice-assistant]', closeButton],
  ['[data-voice-back]', backButton], ['#voiceAssistantForm', form], ['#voiceAssistantInput', input],
  ['#voiceListenButton', listenButton], ['#voiceAssistantStatus', status], ['#voiceAssistantResult', result],
  ['#voiceAssistantVoice', voiceSelect], ['#voiceAssistantVoicePreview', voicePreviewButton], ['#voiceAssistantRate', rateInput],
  ['#voiceAssistantRateValue', rateValue], ['#voiceAssistantVolume', volumeInput], ['#voiceAssistantVolumeValue', volumeValue],
  ['#voiceAssistantSpeechSettings', speechSettings], ['#voiceAssistantSettings', settings]
]);
const documentStub = {
  hidden:false,
  createElement:() => createElement(),
  querySelector:selector => elements.get(selector) || null,
  querySelectorAll:() => [],
  addEventListener() {}
};

const speechCalls = [];
const speechSignals = [];
let synthesize = async (payload, signal) => {
  speechCalls.push(payload);
  speechSignals.push(signal);
  return { ok:true, audio:new Blob([new Uint8Array([1, 2, 3])], { type:'audio/mpeg' }) };
};
const snapshot = {
  authenticated:true, synchronized:true, sessionGeneration:1, today:'2026-09-13', services:[],
  bookings:[{ id:'HIDDEN_BOOKING_ID', phone:'HIDDEN_PHONE', date:'2026-09-13', time:'10:00', clientName:'Анна', serviceName:'Массаж', status:'confirmed' }]
};
const bridge = {
  cloudSpeechEnabled:true,
  getReadOnlySnapshot:() => snapshot,
  synthesizeSpeech:(payload, signal) => synthesize(payload, signal)
};

const voice = require('./voice-assistant.js');
const controller = voice.createController({ document:documentStub, bridge });
controller.bind();

assert.deepEqual(voiceSelect.children.map(option => option.textContent), ['Дмитрий', 'Светлана']);
assert.deepEqual(voiceSelect.children.map(option => option.value), ['dmitry', 'svetlana']);
assert.ok(voiceSelect.children.every(option => option.disabled === false));
assert.equal(voiceSelect.value, 'svetlana', 'старый выбор Павла должен безопасно перейти на Светлану');
assert.equal(JSON.parse(savedSpeech).voiceKey, 'svetlana');

openButton.emit('click');
input.value = 'какие записи сегодня';
form.emit('submit');
assert.ok(speakButton, 'облачная озвучка должна быть доступна и на мобильном браузере без системных голосов');
speakButton.emit('click');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(speechCalls.length, 1);
assert.deepEqual(Object.keys(speechCalls[0]).sort(), ['text', 'voice']);
assert.equal(speechCalls[0].voice, 'svetlana');
assert.match(speechCalls[0].text, /Анна/);
assert.doesNotMatch(JSON.stringify(speechCalls[0]), /HIDDEN_BOOKING_ID|HIDDEN_PHONE/);
assert.equal(speechSynthesis.speakCount, 0, 'Ирина, Павел и Google не должны использоваться как скрытая подмена');
assert.equal(audioInstances.at(-1).playbackRate, 1.25);
assert.equal(audioInstances.at(-1).volume, 0.5);
assert.equal(speakButton.textContent, 'Остановить голос');
const playingAudio = audioInstances.at(-1);
speakButton.emit('click');
assert.equal(playingAudio.pauseCount, 1, 'повторное нажатие должно останавливать облачное аудио');
assert.equal(speakButton.textContent, 'Озвучить ответ');
assert.ok(revokedUrls.includes(playingAudio.url));

voiceSelect.value = 'dmitry';
voiceSelect.emit('change');
voicePreviewButton.emit('click');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(speechCalls.at(-1).voice, 'dmitry', 'Дмитрий должен работать через тот же мобильный серверный путь');
audioInstances.at(-1).onended();
assert.match(status.textContent, /Настройки озвучки сохранены/);

let aborted = false;
synthesize = async (payload, signal) => {
  speechCalls.push(payload);
  speechSignals.push(signal);
  return await new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ ok:false, reason:'cancelled' }); }, { once:true }));
};
voicePreviewButton.emit('click');
input.value = 'Привет';
form.emit('submit');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(aborted, true, 'новый ответ должен отменять незавершённый запрос озвучки');

synthesize = async payload => {
  speechCalls.push(payload);
  return { ok:false, reason:'not_configured' };
};
voicePreviewButton.emit('click');
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(status.textContent, /Ответ доступен текстом/);
assert.match(status.textContent, /другой голос не подставлен/);
assert.equal(speechSynthesis.speakCount, 0);

controller.destroy();
assert.equal(speechSynthesis.listeners.has('voiceschanged'), false);
console.log('Assistant cloud speech checks passed: two voices on mobile, safe payload, stop/replace and text-only fallback');
