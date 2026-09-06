/* Isolated browser recognition: intentionally no assistant, media capture,
   synthesis, app state, telemetry, storage, SDKs or automatic retries. */
(() => {
  'use strict';
  const button = document.getElementById('start');
  const status = document.getElementById('status');
  const transcript = document.getElementById('transcript');
  const log = document.getElementById('log');
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const environment = `Тест 1; Android: ${/Android/i.test(navigator.userAgent)}; API: ${Boolean(Recognition)}; HTTPS: ${window.isSecureContext}; приложение: ${Boolean(window.matchMedia?.('(display-mode: standalone)').matches)}\n`;
  log.textContent = environment;
  let active = null;
  if (!Recognition) {
    button.disabled = true;
    status.textContent = 'Браузер не предоставляет SpeechRecognition.';
    return;
  }
  button.addEventListener('click', () => {
    if (active) {
      active.note('Остановка пользователем');
      active.outcome = 'Остановлено пользователем.';
      try { active.engine.abort(); } catch {}
      active.finish();
      return;
    }
    log.textContent = environment;
    transcript.textContent = 'Пока нет текста.';
    const began = performance.now();
    const session = { engine:null, timer:null, text:'', final:false, outcome:'', note(message) {
      log.textContent += `${((performance.now() - began) / 1000).toFixed(1)} с: ${message}\n`;
    }, finish() {
      if (active !== session) return;
      clearTimeout(session.timer);
      active = null;
      button.textContent = 'Повторить тест';
      status.textContent = session.outcome || (session.text ? (session.final ? 'Речь распознана.' : 'Получен промежуточный текст.') : 'Сеанс завершён без текста. Пришлите журнал ниже.');
    } };
    active = session;
    button.textContent = 'Остановить тест';
    status.textContent = 'Запускаем распознавание. Разрешите микрофон, если появится запрос.';
    try {
      const engine = new Recognition();
      session.engine = engine;
      engine.lang = 'ru-RU';
      engine.continuous = false;
      engine.interimResults = true;
      engine.maxAlternatives = 1;
      for (const name of ['start','audiostart','soundstart','speechstart','speechend','soundend','audioend','nomatch']) {
        engine[`on${name}`] = () => {
          if (active !== session) return;
          session.note(name);
          if (name === 'audiostart') status.textContent = 'Захват аудио начался. Говорите обычным голосом.';
        };
      }
      engine.onresult = event => {
        if (active !== session) return;
        const results = Array.from(event.results || []);
        session.text = results.map(result => result[0]?.transcript || '').join(' ').slice(0, 500);
        session.final = results.length > 0 && results.every(result => result.isFinal);
        transcript.textContent = session.text || 'Пустой результат.';
        session.note(`result: ${session.final ? 'final' : 'interim'}, символов: ${session.text.length}`);
      };
      engine.onerror = event => {
        if (active !== session) return;
        const code = String(event.error || 'unknown');
        session.note(`error: ${code}`);
        session.outcome = `Ошибка браузерного распознавания: ${code}.`;
        status.textContent = session.outcome;
      };
      engine.onend = () => {
        if (active !== session) return;
        session.note('end');
        session.finish();
      };
      session.note('start() по нажатию');
      // Start synchronously during a normal click, with no prior microphone
      // request, speech synthesis, pointer handlers or deferred callbacks.
      engine.start();
      if (active !== session) return;
      session.timer = setTimeout(() => {
        if (active !== session) return;
        session.note('Лимит 45 секунд: остановка тестовой страницей');
        session.outcome ||= 'Достигнут лимит теста. Пришлите журнал событий.';
        session.finish();
        try { engine.abort(); } catch {}
      }, 45000);
    } catch (error) {
      session.note(`exception: ${String(error?.name || 'Error')}`);
      session.outcome = 'Не удалось запустить распознавание. Пришлите журнал событий.';
      session.finish();
    }
  });
  function stopHidden() {
    const session = active;
    if (!session) return;
    session.note('Страница скрыта: остановка теста');
    session.outcome = 'Тест остановлен при сворачивании страницы.';
    session.finish();
    try { session.engine?.abort(); } catch {}
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopHidden(); });
  window.addEventListener('pagehide', stopHidden);
})();
