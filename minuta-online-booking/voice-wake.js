(function voiceWakeModule(global) {
  'use strict';

  const STORAGE_KEY = 'minuta-assistant-wake-v1';
  const WAKE_PHRASE = 'привет альбина';
  const RESTART_DELAY_MS = 260;
  const QUICK_END_LIMIT = 3;

  function normalizeWakePhrase(value = '') {
    return String(value)
      .toLocaleLowerCase('ru-RU')
      .replace(/ё/g, 'е')
      .replace(/[^а-яa-z0-9]+/gi, ' ')
      .trim()
      .replace(/\s+/g, ' ');
  }

  function matchesWakePhrase(value = '') {
    return normalizeWakePhrase(value).includes(WAKE_PHRASE);
  }

  function createController(options = {}) {
    const doc = options.document || global.document;
    const Recognition = options.Recognition === undefined
      ? (global.SpeechRecognition || global.webkitSpeechRecognition)
      : options.Recognition;
    const storage = options.storage || global.localStorage;
    const setTimer = options.setTimeout || global.setTimeout?.bind(global);
    const clearTimer = options.clearTimeout || global.clearTimeout?.bind(global);
    const toggle = doc?.querySelector?.('#voiceWakeToggle');
    const status = doc?.querySelector?.('#voiceWakeStatus');
    const dialog = doc?.querySelector?.('#voiceAssistantDialog');
    const openButton = doc?.querySelector?.('#openVoiceAssistant');
    const dashboard = doc?.querySelector?.('#dashboard');
    if (!doc || !toggle || !status || !dialog || !openButton || !dashboard) return { bind() {}, destroy() {} };

    const supported = Boolean(Recognition && global.isSecureContext !== false);
    let enabled = false;
    let recognition = null;
    let recognitionEpoch = 0;
    let restartTimer = null;
    let pausedByError = false;
    let wakeTriggered = false;
    let quickEnds = 0;
    let startedAt = 0;
    let bound = false;
    let dashboardObserver = null;
    const handlePageHide = () => stopRecognition();
    const handleSessionReset = () => { stopRecognition(); renderState(); };

    function readEnabled() {
      try { return JSON.parse(storage?.getItem?.(STORAGE_KEY) || '{}').enabled === true; }
      catch { return false; }
    }

    function saveEnabled() {
      try { storage?.setItem?.(STORAGE_KEY, JSON.stringify({ enabled })); } catch {}
    }

    function authenticated() {
      try { return global.MinutaProviderAssistant?.getReadOnlySnapshot?.().authenticated === true; }
      catch { return !dashboard.hidden; }
    }

    function canListen() {
      return supported && enabled && !pausedByError && !wakeTriggered && !doc.hidden
        && !dashboard.hidden && authenticated() && !dialog.open;
    }

    function renderState(message = '') {
      toggle.checked = enabled;
      toggle.disabled = !supported;
      openButton.classList?.toggle?.('is-wake-enabled', supported && enabled);
      openButton.setAttribute?.('data-wake-enabled', supported && enabled ? 'true' : 'false');
      if (message) { status.textContent = message; return; }
      if (!supported) status.textContent = 'Этот браузер не поддерживает ожидание фразы. Открывайте помощника кнопкой.';
      else if (!enabled) status.textContent = 'Выключено. Микрофон не используется.';
      else if (pausedByError) status.textContent = 'Ожидание приостановлено. Выключите и включите его снова.';
      else if (doc.hidden) status.textContent = 'Ожидание приостановлено, пока страница скрыта.';
      else if (dashboard.hidden || !authenticated()) status.textContent = 'Включено. Ожидание начнётся после входа в кабинет.';
      else if (dialog.open) status.textContent = 'Ожидание приостановлено, пока помощник открыт.';
      else status.textContent = 'Ожидаю «Привет, Альбина» только пока эта страница открыта.';
    }

    function clearRestart() {
      if (restartTimer !== null) clearTimer?.(restartTimer);
      restartTimer = null;
    }

    function stopRecognition() {
      recognitionEpoch += 1;
      clearRestart();
      const current = recognition;
      recognition = null;
      try { current?.abort?.(); } catch {}
    }

    function scheduleStart() {
      clearRestart();
      if (!canListen()) { renderState(); return; }
      restartTimer = setTimer?.(() => {
        restartTimer = null;
        startRecognition();
      }, RESTART_DELAY_MS) ?? null;
    }

    function triggerWake() {
      if (wakeTriggered || dialog.open) return;
      wakeTriggered = true;
      stopRecognition();
      renderState('Фраза услышана. Открываю помощника…');
      global.__minutaAssistantWakeRequest = true;
      try { openButton.click(); }
      catch {
        global.__minutaAssistantWakeRequest = false;
        wakeTriggered = false;
        pausedByError = true;
        renderState('Не удалось открыть помощника. Откройте его кнопкой.');
      }
    }

    function startRecognition() {
      if (recognition || !canListen()) { renderState(); return; }
      const epoch = ++recognitionEpoch;
      let current;
      try { current = new Recognition(); }
      catch {
        pausedByError = true;
        renderState('Браузер не смог запустить распознавание. Выключите и включите ожидание снова.');
        return;
      }
      recognition = current;
      current.lang = 'ru-RU';
      current.continuous = true;
      current.interimResults = false;
      current.maxAlternatives = 3;
      current.onstart = () => {
        if (epoch !== recognitionEpoch) return;
        startedAt = Date.now();
        renderState();
      };
      current.onresult = event => {
        if (epoch !== recognitionEpoch || !canListen()) return;
        for (const item of Array.from(event.results || [])) {
          if (item?.isFinal === false) continue;
          for (const alternative of Array.from(item || [])) {
            if (matchesWakePhrase(alternative?.transcript || '')) { triggerWake(); return; }
          }
        }
      };
      current.onerror = event => {
        if (epoch !== recognitionEpoch) return;
        const error = String(event?.error || 'unknown');
        if (error === 'aborted' || error === 'no-speech') return;
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          enabled = false;
          saveEnabled();
          pausedByError = false;
          renderState('Нет доступа к микрофону. Разрешите его для сайта и включите ожидание снова.');
          return;
        }
        pausedByError = true;
        const messages = {
          'audio-capture':'Микрофон не найден или занят другим приложением.',
          network:'Служба распознавания речи сейчас недоступна.',
          'language-not-supported':'Русский язык недоступен для распознавания на этом устройстве.'
        };
        renderState(`${messages[error] || 'Ожидание фразы приостановлено.'} Выключите и включите его снова.`);
      };
      current.onend = () => {
        if (epoch !== recognitionEpoch) return;
        recognition = null;
        if (wakeTriggered || pausedByError || !enabled) return;
        const elapsed = startedAt ? Date.now() - startedAt : 0;
        quickEnds = elapsed && elapsed < 700 ? quickEnds + 1 : 0;
        if (quickEnds >= QUICK_END_LIMIT) {
          pausedByError = true;
          renderState('Браузер несколько раз сразу остановил микрофон. Выключите и включите ожидание снова.');
          return;
        }
        scheduleStart();
      };
      renderState('Включаю микрофон… После разрешения скажите «Привет, Альбина».');
      try { current.start(); }
      catch {
        recognition = null;
        pausedByError = true;
        renderState('Браузер не смог включить микрофон. Выключите и включите ожидание снова.');
      }
    }

    function reconcile() {
      if (!canListen()) stopRecognition();
      renderState();
      if (canListen()) scheduleStart();
    }

    function handleToggle() {
      enabled = Boolean(toggle.checked && supported);
      pausedByError = false;
      wakeTriggered = false;
      quickEnds = 0;
      saveEnabled();
      stopRecognition();
      renderState();
      if (enabled) startRecognition();
    }

    function handleDialogClose() {
      wakeTriggered = false;
      global.__minutaAssistantWakeRequest = false;
      reconcile();
    }

    function bind() {
      if (bound) return;
      bound = true;
      enabled = supported && readEnabled();
      toggle.addEventListener('change', handleToggle);
      doc.addEventListener?.('visibilitychange', reconcile);
      global.addEventListener?.('pagehide', handlePageHide);
      dialog.addEventListener?.('close', handleDialogClose);
      global.addEventListener?.('minuta:provider-session-reset', handleSessionReset);
      if (global.MutationObserver) {
        dashboardObserver = new global.MutationObserver(reconcile);
        dashboardObserver.observe(dashboard, { attributes:true, attributeFilter:['hidden'] });
      }
      renderState();
      if (canListen()) scheduleStart();
    }

    function destroy() {
      stopRecognition();
      dashboardObserver?.disconnect?.();
      dashboardObserver = null;
      toggle.removeEventListener?.('change', handleToggle);
      doc.removeEventListener?.('visibilitychange', reconcile);
      global.removeEventListener?.('pagehide', handlePageHide);
      dialog.removeEventListener?.('close', handleDialogClose);
      global.removeEventListener?.('minuta:provider-session-reset', handleSessionReset);
      bound = false;
    }

    return { bind, destroy, reconcile, startRecognition, stopRecognition };
  }

  const api = Object.freeze({ normalizeWakePhrase, matchesWakePhrase, createController });
  global.MinutaVoiceWake = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (global.document) {
    const boot = () => {
      if (global.__minutaVoiceWakeController) return;
      global.__minutaVoiceWakeController = createController();
      global.__minutaVoiceWakeController.bind();
    };
    if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', boot, { once:true });
    else boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
