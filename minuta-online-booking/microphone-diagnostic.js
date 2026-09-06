/* Local signal test only: no recording, uploads, storage or speech service. */
(() => {
  'use strict';
  const status = document.getElementById('voiceAssistantStatus');
  if (!status) return;
  const dialog = status.closest('dialog');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary-button';
  button.textContent = 'Проверить микрофон';
  const report = document.createElement('p');
  report.className = 'voice-assistant-status';
  report.setAttribute('role', 'status');
  report.setAttribute('aria-live', 'polite');
  report.textContent = 'Тест на 5 секунд: только уровень звука. Аудио не записывается и не отправляется. После теста пришлите результат в чат.';
  status.after(button, report);
  let epoch = 0, stream = null, context = null, timer = null, timeout = null, running = false;
  function stop() {
    epoch += 1;
    running = false;
    clearInterval(timer);
    clearTimeout(timeout);
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    if (context) void context.close().catch(() => {});
    context = null;
    button.textContent = 'Проверить микрофон';
  }
  button.addEventListener('click', async () => {
    if (running) { stop(); report.textContent = 'Тест остановлен. Микрофон выключен.'; return; }
    if (document.getElementById('voiceListenButton')?.getAttribute('aria-pressed') === 'true') {
      report.textContent = 'Сначала остановите диктовку кнопкой «Говорить», затем запустите тест.';
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      report.textContent = 'MIC-UNSUPPORTED: браузер не предоставляет доступ к микрофону.';
      return;
    }
    running = true;
    const current = ++epoch;
    button.textContent = 'Остановить тест';
    report.textContent = 'Разрешите доступ к микрофону, если появится запрос. Затем говорите обычным голосом.';
    timeout = setTimeout(() => {
      if (current !== epoch) return;
      stop();
      report.textContent = 'MIC-TIMEOUT: доступ к микрофону или запуск аудио не завершился. Проверьте разрешение микрофона для браузера.';
    }, 15000);
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) throw new Error('AudioContextUnavailable');
      context = new Audio();
      const audio = context;
      const resumed = audio.resume();
      // Attach a rejection handler immediately while the permission prompt is open.
      const ready = resumed.then(() => null, error => error);
      const captured = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
      if (current !== epoch) { captured.getTracks().forEach(track => track.stop()); return; }
      stream = captured;
      const resumeError = await ready;
      if (current !== epoch) return;
      if (resumeError) throw resumeError;
      if (audio.state !== 'running') throw new Error('AudioContextSuspended');
      clearTimeout(timeout);
      const analyser = audio.createAnalyser();
      analyser.fftSize = 2048;
      audio.createMediaStreamSource(captured).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const started = performance.now();
      let peak = 0;
      report.textContent = 'Говорите 5 секунд. Проверяем уровень звука, не содержание речи.';
      timer = setInterval(() => {
        if (current !== epoch) return;
        analyser.getFloatTimeDomainData(samples);
        const level = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        peak = Math.max(peak, level);
        const seconds = Math.max(0, Math.ceil(5 - (performance.now() - started) / 1000));
        report.textContent = `Тест: осталось ${seconds} с. Уровень сигнала: ${Math.round(level * 100)}%. Говорите обычным голосом.`;
        if (seconds > 0) return;
        const db = peak > 0 ? Math.round(20 * Math.log10(peak)) : '-∞';
        stop();
        report.textContent = peak >= 0.005
          ? `MIC-SIGNAL: звук поступает (${db} dBFS). Это не проверка распознавания речи. Теперь попробуйте «Говорить» и пришлите код ошибки. Микрофон теста выключен.`
          : `MIC-QUIET: звук отсутствует или очень тихий (${db} dBFS). Проверьте микрофон телефона и Bluetooth-гарнитуру. Микрофон теста выключен.`;
      }, 100);
    } catch (error) {
      if (current !== epoch) return;
      stop();
      const code = String(error?.name === 'Error' ? error.message : error?.name || 'UnknownError');
      report.textContent = `MIC-ERROR: ${code}. Тест не запущен. Проверьте разрешение микрофона для браузера и системный доступ Android. Пришлите этот код в чат.`;
    }
  });
  function interrupt() {
    if (!running) return;
    stop();
    report.textContent = 'Тест остановлен при закрытии или сворачивании. Микрофон выключен.';
  }
  dialog?.addEventListener('close', interrupt);
  document.addEventListener('visibilitychange', () => { if (document.hidden) interrupt(); });
  window.addEventListener('pagehide', interrupt);
})();
