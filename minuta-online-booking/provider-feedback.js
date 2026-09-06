(function (global) {
  'use strict';

  const OUTPUT_LIMIT = 4 * 1024 * 1024;
  const MAX_EDGE = 1600;

  function createId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  async function decodeImage(file) {
    if ('createImageBitmap' in global) {
      try { return await createImageBitmap(file, { imageOrientation:'from-image' }); } catch {}
    }
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_decode_failed')); };
      image.src = url;
    });
  }

  async function prepareScreenshot(file) {
    const image = await decodeImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha:false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    image.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
    if (!blob || blob.size > OUTPUT_LIMIT) throw new Error('image_too_large');
    return blob;
  }

  function clientVersion() {
    const asset = document.querySelector('link[href*="styles.css?v="]')?.getAttribute('href') || '';
    return new URL(asset, location.href).searchParams.get('v') || 'unknown';
  }

  function deviceSummary() {
    const device = matchMedia('(max-width: 760px)').matches ? 'mobile' : 'desktop';
    const platform = navigator.userAgentData?.platform || navigator.platform || 'unknown';
    return `${device}; ${String(platform).slice(0, 80)}; ${innerWidth}x${innerHeight}`.slice(0, 300);
  }

  function createTextController({ db, $, notify, requireWrites, getCurrentUser, getOrganization }) {
    let available = false, bound = false, busy = false, epoch = 0, revision = 0, owner = '';
    const unresolved = new Set();
    const scope = () => `${getCurrentUser()?.id || ''}:${getOrganization?.()?.id || 'personal'}`;
    const storageKey = value => `minuta-feedback-text-unconfirmed:${value}`;
    const current = token => token.epoch === epoch && token.owner === owner && owner === scope();
    function setAvailable(value) {
      available = Boolean(value);
      document.querySelectorAll('[data-open-product-feedback]').forEach(button => { button.hidden = !available; });
    }
    function setError(message = '') {
      $('#productFeedbackError').textContent = message;
      $('#productFeedbackError').hidden = !message;
    }
    function isUnresolved() {
      try { if (sessionStorage.getItem(storageKey(owner))) unresolved.add(owner); } catch { unresolved.add(owner); }
      return unresolved.has(owner);
    }
    function syncLock() {
      const blocked = busy || isUnresolved();
      $('#productFeedbackForm').querySelectorAll('input,textarea').forEach(node => { node.disabled = blocked; });
      $('#productFeedbackSubmit').disabled = blocked;
      $('#productFeedbackSubmit').textContent = busy ? 'Отправляем…' : 'Отправить';
    }
    function updateType() {
      $('#productFeedbackExpectedField').hidden = true;
      $('#productFeedbackMessageLabel').textContent = 'Расскажите подробнее';
      $('#productFeedbackMessage').placeholder = 'Что произошло или что хотите улучшить?';
    }
    function resetForm() {
      ++epoch; owner = scope(); busy = false;
      $('#productFeedbackForm').reset();
      $('#productFeedbackForm').hidden = false; $('#productFeedbackSuccess').hidden = true;
      $('#productFeedbackFileField').hidden = true;
      $('#productFeedbackAttachments').replaceChildren();
      $('#productFeedbackUploadProgress').hidden = true;
      $('#productFeedbackUploadStatus').textContent = '';
      $('#productFeedbackDraftStatus').textContent = 'Сейчас доступно текстовое обращение без вложений.';
      setError(isUnresolved() ? 'Результат предыдущей отправки не подтверждён. Повтор заблокирован: проверьте обращение перед новой отправкой.' : '');
      updateType(); syncLock();
    }
    function open() {
      if (!available || !getCurrentUser()) return;
      if (owner !== scope() || !owner) resetForm();
      $('#productFeedbackDialog').showModal();
    }
    async function refreshAvailability() {
      const token = ++revision, actorScope = scope();
      if (!getCurrentUser() || !navigator.onLine) { setAvailable(false); return; }
      try {
        const result = await db.rpc('get_minuta_feedback_capability');
        if (token === revision && actorScope === scope()) setAvailable(!result.error && result.data === true);
      } catch { if (token === revision && actorScope === scope()) setAvailable(false); }
    }
    async function submit(event) {
      event.preventDefault();
      if (busy || isUnresolved() || !available || !getCurrentUser() || owner !== scope() || !navigator.onLine || !requireWrites()) return;
      const message = $('#productFeedbackMessage').value.trim();
      if (message.length < 10 || message.length > 4000) { setError('Напишите от 10 до 4000 символов.'); return; }
      const token = { epoch, owner }, key = storageKey(owner);
      const payload = { p_organization:getOrganization?.()?.id || null,
        p_kind:$('#productFeedbackKindProblem').checked ? 'problem' : 'suggestion', p_message:message,
        p_expected_result:null, p_page_path:location.pathname, p_client_version:clientVersion(),
        p_device_summary:deviceSummary(), p_screenshot_path:null };
      // v109 has no request key: a lost reply must not silently become a second INSERT.
      try { sessionStorage.setItem(key,'1'); } catch {
        setError('Браузер не разрешил сохранить состояние отправки. Обращение не отправлено.'); return;
      }
      unresolved.add(token.owner); busy = true; setError(); syncLock();
      try {
        const result = await db.rpc('create_minuta_feedback', payload);
        const refused = result.error && new Set(['42501:authentication_required','42501:feedback_organization_denied',
          '22023:invalid_feedback','P0001:feedback_daily_limit']).has(`${result.error.code}:${result.error.message}`);
        const number = result.data?.request_number;
        const ack = !result.error && result.data && !Array.isArray(result.data)
          && (typeof number === 'string' || (typeof number === 'number' && Number.isSafeInteger(number)))
          && /^[1-9][0-9]*$/.test(String(number)) && BigInt(number) <= 9223372036854775807n;
        if (refused || ack) {
          try { sessionStorage.removeItem(key); unresolved.delete(token.owner); } catch {}
        }
        if (!current(token)) return;
        if (refused) { setError('Сервер отклонил обращение. Текст сохранён — исправьте его и отправьте снова.'); return; }
        if (!ack) throw new Error('unconfirmed');
        $('#productFeedbackRequestNumber').textContent = String(result.data.request_number);
        $('#productFeedbackForm').hidden = true; $('#productFeedbackSuccess').hidden = false;
        notify('Сообщение отправлено');
      } catch {
        if (current(token)) setError('Результат не подтверждён. Не отправляйте повторно: проверьте обращение перед новой отправкой.');
      } finally { if (current(token)) { busy = false; syncLock(); } }
    }
    function bind() {
      if (bound) return; bound = true;
      document.addEventListener('click', event => {
        if (event.target.closest('[data-open-product-feedback]')) open();
        if (event.target.closest('[data-close-product-feedback]')) $('#productFeedbackDialog').close();
        if (event.target.closest('[data-new-product-feedback]') && !busy && !isUnresolved()) resetForm();
      });
      document.querySelectorAll('input[name="productFeedbackKind"]').forEach(input => input.addEventListener('change', updateType));
      $('#productFeedbackForm').addEventListener('submit', submit);
      global.addEventListener('online', refreshAvailability);
      global.addEventListener('offline', () => setAvailable(false));
    }
    return { bind, refreshAvailability, reset() {
      ++epoch; ++revision; setAvailable(false); busy = false; owner = '';
      $('#productFeedbackForm').reset(); $('#productFeedbackDialog').close();
    } };
  }

  function createController(options) {
    // One engine per page lifetime: never attach both sets of form listeners,
    // and never turn an uncertain media request into a legacy INSERT.
    let engine = null, selecting = null, selectionRevision = 0, bound = false;
    const scope = () => `${options.getCurrentUser()?.id || ''}:${options.getOrganization?.()?.id || 'personal'}`;
    const hide = () => document.querySelectorAll('[data-open-product-feedback]').forEach(node => { node.hidden = true; });
    async function refreshAvailability() {
      if (engine) return engine.refreshAvailability();
      if (!options.getCurrentUser() || !navigator.onLine) { hide(); return; }
      if (selecting) return selecting;
      const revision = selectionRevision, actorScope = scope();
      const selection = (async () => {
        let capability = null;
        try {
          const result = await options.db.rpc('get_minuta_feedback_media_capability');
          if (!result.error) capability = result.data;
        } catch {}
        if (revision !== selectionRevision || actorScope !== scope()) return;
        const confirmed = capability?.version === 3 && Number.isInteger(capability.max_files) && capability.max_files >= 1 && capability.max_files <= 5
          && Number.isSafeInteger(capability.video_bytes) && capability.video_bytes > 0 && capability.video_bytes <= 50 * 1048576
          && Number.isSafeInteger(capability.total_bytes) && capability.total_bytes >= capability.video_bytes && capability.total_bytes <= 250 * 1048576;
        // Reload must not convert a durable unknown media request into a fresh legacy INSERT.
        let hasMediaIntent = true, hasLegacyIntent = true;
        try {
          hasMediaIntent = Boolean(JSON.parse(sessionStorage.getItem(`minuta-feedback-v3:${actorScope}`) || 'null')?.pending);
          hasLegacyIntent = Boolean(sessionStorage.getItem(`minuta-feedback-text-unconfirmed:${actorScope}`));
        } catch {}
        if (hasMediaIntent && (!confirmed || !global.MinutaFeedbackMediaV3?.createController)) { hide(); return; }
        engine = confirmed && !hasLegacyIntent && global.MinutaFeedbackMediaV3?.createController
          ? global.MinutaFeedbackMediaV3.createController(options, { createId, prepareScreenshot, clientVersion, deviceSummary })
          : createTextController(options);
        if (bound) engine.bind();
        await engine.refreshAvailability();
      })();
      selecting = selection;
      try { await selection; } finally { if (selecting === selection) selecting = null; }
    }
    return { bind() {
      if (bound) return; bound = true; engine?.bind();
      global.addEventListener('online', () => { if (!engine) void refreshAvailability(); });
    },
      refreshAvailability,
      reset() { ++selectionRevision; selecting = null; engine?.reset(); hide(); }
    };
  }

  global.MinutaProviderFeedback = Object.freeze({ createController });
})(window);
