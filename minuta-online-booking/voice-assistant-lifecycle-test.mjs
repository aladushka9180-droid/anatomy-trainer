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
globalThis.matchMedia = query => ({ matches:query === '(pointer: coarse)' });

class FakeRecognition {
  static instances = [];
  static throwOnNextStart = false;

  constructor() {
    this.abortCount = 0;
    this.stopCount = 0;
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started = true;
    if (FakeRecognition.throwOnNextStart) {
      FakeRecognition.throwOnNextStart = false;
      throw new Error('recognition_start_failed');
    }
  }

  abort() {
    this.abortCount += 1;
  }

  stop() {
    this.stopCount += 1;
  }
}

globalThis.SpeechRecognition = FakeRecognition;
class FakeUtterance {
  constructor(text) { this.text = text; }
}
const speechSynthesis = {
  cancelCount:0,
  speakCount:0,
  lastUtterance:null,
  voices:[
    { name:'Ting-Ting', lang:'zh-CN', default:true, localService:true },
    { name:'Google русский', lang:'ru-RU', default:false, localService:true }
  ],
  listeners:new Map(),
  cancel() { this.cancelCount += 1; },
  speak(utterance) { this.speakCount += 1; this.lastUtterance = utterance; },
  getVoices() { return this.voices; },
  addEventListener(type, listener) { this.listeners.set(type, listener); },
  removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
};
globalThis.SpeechSynthesisUtterance = FakeUtterance;
globalThis.speechSynthesis = speechSynthesis;

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
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
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
const backButton = createElement({ hidden:true });
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
let speakButton = null;
const result = createElement({
  querySelector(selector) {
    if (selector === '[data-voice-prepare]') return prepareButton;
    if (selector === '[data-voice-speak]') return speakButton;
    return null;
  },
  replaceChildren() {
    resultHtml = '';
    prepareButton = null;
    speakButton = null;
  }
});
Object.defineProperty(result, 'innerHTML', {
  get() { return resultHtml; },
  set(value) {
    resultHtml = String(value);
    prepareButton = resultHtml.includes('data-voice-prepare') ? createElement() : null;
    speakButton = resultHtml.includes('data-voice-speak') ? createElement() : null;
  }
});

const elements = new Map([
  ['#voiceAssistantDialog', dialog],
  ['#openVoiceAssistant', openButton],
  ['[data-close-voice-assistant]', closeButton],
  ['[data-voice-back]', backButton],
  ['#voiceAssistantForm', form],
  ['#voiceAssistantInput', input],
  ['#voiceListenButton', listenButton],
  ['#voiceAssistantStatus', status],
  ['#voiceAssistantResult', result]
]);
const documentListeners = new Map();
const documentStub = {
  hidden:false,
  querySelector:selector => elements.get(selector) || null,
  querySelectorAll:() => [],
  addEventListener(type, listener) {
    const listeners = documentListeners.get(type) || [];
    listeners.push(listener);
    documentListeners.set(type, listeners);
  },
  emit(type) {
    for (const listener of documentListeners.get(type) || []) listener({ type });
  }
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
assert.ok(speakButton, 'для ответа должна быть доступна отдельная кнопка озвучивания');
speakButton.emit('click');
assert.equal(speechSynthesis.speakCount, 1, 'озвучивание должно запускаться только по явному нажатию');
assert.equal(speechSynthesis.lastUtterance.voice.lang, 'ru-RU', 'озвучивание должно явно выбирать русский голос');
assert.equal(speechSynthesis.lastUtterance.lang, 'ru-RU');
assert.equal(speakButton.textContent, 'Остановить голос', 'во время речи кнопка должна предлагать остановку');
speakButton.emit('click');
assert.equal(speakButton.textContent, 'Озвучить ответ', 'повторное нажатие должно останавливать голос');
assert.match(status.textContent, /остановлено/i);
assert.equal(backButton.hidden, false, 'после ответа должна появляться кнопка возврата в основное меню');
backButton.emit('click');
assert.equal(dialog.open, true, 'возврат в меню не должен закрывать помощника');
assert.equal(backButton.hidden, true, 'в основном меню кнопка назад не должна занимать место');
assert.equal(result.hidden, true, 'возврат в меню должен скрывать предыдущий ответ');
assert.equal(resultHtml, '', 'возврат в меню должен удалять данные предыдущего ответа из DOM');
assert.equal(input.value, '', 'возврат в меню должен очищать предыдущую команду');

const originalDateNow = Date.now;
let fakeNow = 1000;
Date.now = () => fakeNow;
const cancelCountBeforeRecognition = speechSynthesis.cancelCount;
listenButton.emit('pointerdown', { pointerType:'touch', pointerId:1, isPrimary:true });
const oldRecognition = FakeRecognition.instances.at(-1);
assert.ok(oldRecognition?.started, 'распознавание должно запускаться только по явному нажатию');
assert.equal(oldRecognition.continuous, true, 'Android-режим не должен завершаться после первой короткой паузы');
assert.equal(speechSynthesis.cancelCount, cancelCountBeforeRecognition + 1, 'перед включением микрофона озвучивание должно останавливаться');
oldRecognition.onstart();
const recognitionCountBeforeSecondFinger = FakeRecognition.instances.length;
listenButton.emit('pointerdown', { pointerType:'touch', pointerId:2, isPrimary:false });
assert.equal(FakeRecognition.instances.length, recognitionCountBeforeSecondFinger, 'второй палец не должен переключать микрофон');
assert.equal(oldRecognition.stopCount, 0, 'второй палец не должен останавливать текущую запись');
listenButton.emit('pointercancel', { pointerType:'touch', pointerId:2, isPrimary:false });
fakeNow = 2500;
listenButton.emit('pointerup', { pointerType:'touch', pointerId:1, isPrimary:true });
const recognitionCountAfterTouch = FakeRecognition.instances.length;
listenButton.emit('click', { pointerType:'touch' });
assert.equal(FakeRecognition.instances.length, recognitionCountAfterTouch, 'click после длительного касания не должен перезапускать микрофон');
assert.equal(oldRecognition.stopCount, 0, 'отпускание после удержания дольше 900 мс не должно останавливать запись');
Date.now = originalDateNow;
assert.equal(oldRecognition.maxAlternatives, 5, 'мобильное распознавание должно запрашивать несколько вариантов фразы');
const snapshotCallsBeforeRecognitionResult = snapshotCalls;
oldRecognition.onresult({
  results:{ 0:Object.assign([
    { transcript:'какие зарисовки сегодня', confidence:0.9 },
    { transcript:'какие записи сегодня', confidence:0.6 }
  ], { isFinal:true }), length:1 }
});
assert.equal(input.value, 'какие записи сегодня', 'мобильный array-like результат распознавания должен обрабатываться без iterator');
assert.equal(snapshotCalls, snapshotCallsBeforeRecognitionResult + 1, 'финальная часть непрерывной мобильной записи не должна выполняться до повторного касания');
assert.match(status.textContent, /остаётся включённым/i, 'после финальной части микрофон должен оставаться включённым');

listenButton.emit('pointerdown', { pointerType:'touch', pointerId:3, isPrimary:true });
assert.equal(oldRecognition.stopCount, 1, 'повторное касание должно завершать запись с получением результата, а не отбрасывать её через abort');
assert.equal(oldRecognition.abortCount, 0);
listenButton.emit('pointerup', { pointerType:'touch', pointerId:3, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });
oldRecognition.onend();
assert.equal(snapshotCalls, snapshotCallsBeforeRecognitionResult + 2, 'команда должна обрабатываться после явного завершения мобильной записи');

listenButton.emit('pointerdown', { pointerType:'touch', pointerId:4, isPrimary:true });
const sessionRecognition = FakeRecognition.instances.at(-1);
sessionRecognition.onstart();
listenButton.emit('pointerup', { pointerType:'touch', pointerId:4, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });

globalThis.dispatchEvent({ type:'minuta:provider-session-reset' });
assert.equal(sessionRecognition.abortCount, 1, 'смена сессии должна прерывать распознавание');
assert.equal(dialog.open, false, 'смена сессии должна закрывать диалог');
assert.equal(input.value, '', 'смена сессии должна очищать расшифровку');
assert.equal(result.hidden, true, 'смена сессии должна скрывать прежний результат');
assert.equal(resultHtml, '', 'смена сессии должна удалять прежний снимок из DOM');

const callsBeforeLateResult = snapshotCalls;
sessionRecognition.onresult({
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

currentSnapshot = {
  authenticated:true,
  synchronized:false,
  offline:true,
  offlineReadable:true,
  lastUpdatedAt:'2026-09-02T14:40:00+04:00',
  sessionGeneration:3,
  today:'2026-09-02',
  services,
  bookings:[{ date:'2026-09-02', time:'10:00', status:'confirmed', clientName:'Клиент', serviceName:'Массаж' }]
};
input.value = 'какие записи сегодня';
form.emit('submit');
assert.match(resultHtml, /Офлайн · сведения могут быть устаревшими/, 'офлайн-копия должна быть явно помечена');
assert.match(resultHtml, /сохранённая копия/i, 'должно отображаться время сохранённой копии');

input.value = 'запиши Анну завтра в 10:30 на массаж';
form.emit('submit');
const offlinePrepareButton = prepareButton;
assert.ok(offlinePrepareButton, 'офлайн-команда должна разрешать только явное открытие черновика');
offlinePrepareButton.emit('click');
assert.equal(prepareCalls, 1, 'офлайн-черновик должен открываться только после явного нажатия');

openButton.emit('click');
prepareCalls = 0;

currentSnapshot = { ...currentSnapshot, synchronized:true, offline:false, offlineReadable:false, sessionGeneration:4, bookings:[] };
input.value = 'запиши Анну завтра в 10:30 на массаж';
form.emit('submit');
const stalePrepareButton = prepareButton;
assert.ok(stalePrepareButton, 'распознанная команда должна предложить явное открытие черновика');
assert.equal(prepareCalls, 0, 'до явного действия черновик не должен подготавливаться');

currentSnapshot = { ...currentSnapshot, sessionGeneration:5 };
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

openButton.emit('click');
listenButton.emit('pointerdown', { pointerType:'touch', pointerId:5, isPrimary:true });
const noSpeechRecognition = FakeRecognition.instances.at(-1);
noSpeechRecognition.onstart();
listenButton.emit('pointerup', { pointerType:'touch', pointerId:5, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });
noSpeechRecognition.onerror({ error:'no-speech' });
noSpeechRecognition.onend();
await new Promise(resolve => setTimeout(resolve, 260));
const retriedRecognition = FakeRecognition.instances.at(-1);
assert.notEqual(retriedRecognition, noSpeechRecognition, 'после no-speech мобильная запись должна продолжиться в новой сессии движка');
assert.ok(retriedRecognition.started, 'продолжение записи должно запускать ровно одну новую сессию');
retriedRecognition.onstart();
assert.equal(listenLabel.textContent, 'Остановить запись', 'кнопка должна оставаться нажатой после внутреннего перезапуска');
assert.match(status.textContent, /продолжает слушать/i, 'пользователь должен видеть, что запись не завершилась');

listenButton.emit('pointerdown', { pointerType:'touch', pointerId:6, isPrimary:true });
assert.equal(retriedRecognition.stopCount, 1, 'повторное касание должно остановить продолженную запись');
listenButton.emit('pointerup', { pointerType:'touch', pointerId:6, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });
retriedRecognition.onend();

listenButton.emit('pointerdown', { pointerType:'touch', pointerId:7, isPrimary:true });
const earlyEndRecognition = FakeRecognition.instances.at(-1);
earlyEndRecognition.onstart();
listenButton.emit('pointerup', { pointerType:'touch', pointerId:7, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });
const recognitionCountBeforeEarlyEnd = FakeRecognition.instances.length;
earlyEndRecognition.onend();
await new Promise(resolve => setTimeout(resolve, 260));
const continuedAfterEarlyEnd = FakeRecognition.instances.at(-1);
assert.equal(FakeRecognition.instances.length, recognitionCountBeforeEarlyEnd + 1, 'самопроизвольный onend должен создать ровно одну продолжающую сессию');
assert.notEqual(continuedAfterEarlyEnd, earlyEndRecognition);
continuedAfterEarlyEnd.onstart();
assert.equal(listenLabel.textContent, 'Остановить запись', 'раннее завершение движка не должно визуально отжимать кнопку');
listenButton.emit('pointerdown', { pointerType:'touch', pointerId:8, isPrimary:true });
listenButton.emit('pointerup', { pointerType:'touch', pointerId:8, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });
continuedAfterEarlyEnd.onend();

FakeRecognition.throwOnNextStart = true;
const recognitionCountBeforeStartFailure = FakeRecognition.instances.length;
listenButton.emit('pointerdown', { pointerType:'touch', pointerId:9, isPrimary:true });
listenButton.emit('pointerup', { pointerType:'touch', pointerId:9, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });
assert.equal(FakeRecognition.instances.length, recognitionCountBeforeStartFailure + 1, 'ошибка запуска не должна превращать одно касание в две попытки');
assert.match(status.textContent, /Микрофон уже используется/i, 'повторный compatibility click не должен перезаписывать ошибку запуска');

listenButton.emit('pointerdown', { pointerType:'touch', pointerId:10, isPrimary:true });
const hiddenRecognition = FakeRecognition.instances.at(-1);
hiddenRecognition.onstart();
documentStub.hidden = true;
documentStub.emit('visibilitychange');
assert.equal(hiddenRecognition.abortCount, 1, 'скрытие вкладки должно прекращать захват микрофона');
documentStub.hidden = false;
documentStub.emit('visibilitychange');
const recognitionCountAfterVisibilityAbort = FakeRecognition.instances.length;
listenButton.emit('pointerdown', { pointerType:'touch', pointerId:11, isPrimary:true });
assert.equal(FakeRecognition.instances.length, recognitionCountAfterVisibilityAbort + 1, 'первое касание после возврата на вкладку не должно теряться из-за старого pointerId');
listenButton.emit('pointerup', { pointerType:'touch', pointerId:11, isPrimary:true });
listenButton.emit('click', { pointerType:'touch' });

controller.destroy();
assert.equal(globalListeners.get('minuta:provider-session-reset')?.size || 0, 0, 'destroy должен снять глобальный обработчик');

console.log('Voice assistant lifecycle security tests passed');
