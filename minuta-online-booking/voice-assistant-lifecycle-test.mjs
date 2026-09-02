import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const globalListeners = new Map();

globalThis.addEventListener = (type, listener) => {
  const listeners = globalListeners.get(type) || new Set();
  listeners.add(listener);
  globalListeners.set(type, listeners);
};
globalThis.removeEventListener = (type, listener) => {
  globalListeners.get(type)?.delete(listener);
};
globalThis.dispatchEvent = event => {
  for (const listener of globalListeners.get(event.type) || []) listener(event);
  return true;
};

class FakeRecognition {
  static instances = [];

  constructor() {
    this.abortCount = 0;
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started = true;
  }

  abort() {
    this.abortCount += 1;
  }
}

globalThis.SpeechRecognition = FakeRecognition;

function createElement(overrides = {}) {
  const listeners = new Map();
  const classes = new Set();
  return Object.assign({
    value:'',
    textContent:'',
    hidden:false,
    open:false,
    className:'',
    dataset:{},
    classList:{
      add(name) { classes.add(name); },
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }
    },
    addEventListener(type, listener) {
      const handlers = listeners.get(type) || [];
      handlers.push(listener);
      listeners.set(type, handlers);
    },
    emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) {
        listener({ preventDefault() {}, ...event });
      }
    },
    setAttribute() {},
    focus() {},
    querySelector() { return null; },
    replaceChildren() {}
  }, overrides);
}

const openButton = createElement();
const closeButton = createElement();
const form = createElement();
const input = createElement();
const status = createElement();
const listenLabel = createElement();
const listenButton = createElement({ querySelector:selector => selector === 'span' ? listenLabel : null });
const dialog = createElement({
  showModal() { this.open = true; },
  close() { this.open = false; }
});

let resultHtml = '';
let prepareButton = null;
const result = createElement({
  querySelector(selector) {
    return selector === '[data-voice-prepare]' ? prepareButton : null;
  },
  replaceChildren() {
    resultHtml = '';
    prepareButton = null;
  }
});
Object.defineProperty(result, 'innerHTML', {
  get() { return resultHtml; },
  set(value) {
    resultHtml = String(value);
    prepareButton = resultHtml.includes('data-voice-prepare') ? createElement() : null;
  }
});

const elements = new Map([
  ['#voiceAssistantDialog', dialog],
  ['#openVoiceAssistant', openButton],
  ['[data-close-voice-assistant]', closeButton],
  ['#voiceAssistantForm', form],
  ['#voiceAssistantInput', input],
  ['#voiceListenButton', listenButton],
  ['#voiceAssistantStatus', status],
  ['#voiceAssistantResult', result]
]);
const documentStub = {
  querySelector:selector => elements.get(selector) || null,
  querySelectorAll:() => []
};

const services = [{ id:'massage', name:'Массаж', durationMinutes:60 }];
let currentSnapshot = {
  authenticated:true,
  synchronized:true,
  sessionGeneration:1,
  today:'2026-09-02',
  services,
  bookings:[{ date:'2026-09-02', time:'09:00', status:'confirmed', clientName:'Клиент А', serviceName:'Массаж' }]
};
let snapshotCalls = 0;
let prepareCalls = 0;
const bridge = {
  getReadOnlySnapshot() {
    snapshotCalls += 1;
    return currentSnapshot;
  },
  prepareBookingDraft() {
    prepareCalls += 1;
    return { ok:true };
  }
};

const voice = require('./voice-assistant.js');
const controller = voice.createController({ document:documentStub, bridge });
controller.bind();

openButton.emit('click');
input.value = 'какие записи';
form.emit('submit');
assert.match(resultHtml, /Клиент А/, 'актуальный снимок должен отображаться до смены сессии');

listenButton.emit('click');
const oldRecognition = FakeRecognition.instances.at(-1);
assert.ok(oldRecognition?.started, 'распознавание должно запускаться только по явному нажатию');
oldRecognition.onstart();

globalThis.dispatchEvent({ type:'minuta:provider-session-reset' });
assert.equal(oldRecognition.abortCount, 1, 'смена сессии должна прерывать распознавание');
assert.equal(dialog.open, false, 'смена сессии должна закрывать диалог');
assert.equal(input.value, '', 'смена сессии должна очищать расшифровку');
assert.equal(result.hidden, true, 'смена сессии должна скрывать прежний результат');
assert.equal(resultHtml, '', 'смена сессии должна удалять прежний снимок из DOM');

const callsBeforeLateResult = snapshotCalls;
oldRecognition.onresult({
  results:[Object.assign([{ transcript:'секрет прежней сессии' }], { isFinal:true })]
});
assert.equal(input.value, '', 'поздний результат после abort не должен возвращать расшифровку');
assert.equal(snapshotCalls, callsBeforeLateResult, 'поздний результат не должен читать новый снимок');

currentSnapshot = {
  authenticated:true,
  synchronized:false,
  sessionGeneration:2,
  today:'2026-09-02',
  services,
  bookings:[{ date:'2026-09-02', time:'10:00', status:'confirmed', clientName:'Устаревший клиент', serviceName:'Массаж' }]
};
openButton.emit('click');
input.value = 'какие записи';
form.emit('submit');
assert.doesNotMatch(resultHtml, /Устаревший клиент/, 'несинхронизированный снимок нельзя показывать');
assert.match(resultHtml, /Данные ещё синхронизируются/);

currentSnapshot = { ...currentSnapshot, synchronized:true, sessionGeneration:3, bookings:[] };
input.value = 'запиши Анну завтра в 10:30 на массаж';
form.emit('submit');
const stalePrepareButton = prepareButton;
assert.ok(stalePrepareButton, 'распознанная команда должна предложить явное открытие черновика');
assert.equal(prepareCalls, 0, 'до явного действия черновик не должен подготавливаться');

currentSnapshot = { ...currentSnapshot, sessionGeneration:4 };
stalePrepareButton.emit('click');
assert.equal(prepareCalls, 0, 'черновик из предыдущего поколения сессии должен быть отклонён');
assert.equal(result.hidden, true, 'устаревшее предложение должно быть удалено');

input.value = 'запиши Анну завтра в 10:30 на массаж';
form.emit('submit');
const currentPrepareButton = prepareButton;
assert.ok(currentPrepareButton);
assert.equal(prepareCalls, 0, 'повторный разбор команды также не должен выполнять действие автоматически');
currentPrepareButton.emit('click');
assert.equal(prepareCalls, 1, 'актуальный черновик должен открываться после явного нажатия');
assert.equal(dialog.open, false, 'после успешной подготовки диалог должен закрываться');

controller.destroy();
assert.equal(globalListeners.get('minuta:provider-session-reset')?.size || 0, 0, 'destroy должен снять глобальный обработчик');

console.log('Voice assistant lifecycle security tests passed');
