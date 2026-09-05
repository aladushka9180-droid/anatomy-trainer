(function (global) {
  'use strict';
  // Unconnected candidate. Requires the reviewed v3 server contract, not the old v2 draft.
  const BUCKET = 'product-feedback-media';
  const TYPES = new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime']);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const DAY = 86400000;
  function createController({ db, $, notify, requireWrites, getCurrentUser, getOrganization }, helpers) {
    let owner = '', epoch = 0, availabilityRevision = 0, available = false, busy = false, bound = false;
    let limits = null, files = [], pending = null, requestId = '';
    const scope = () => `${getCurrentUser()?.id || ''}:${getOrganization?.()?.id || 'personal'}`;
    const key = () => `minuta-feedback-v3:${owner}`;
    const text = (selector, value) => { $(selector).textContent = value; };
    const error = (message = '') => { text('#productFeedbackError', message); $('#productFeedbackError').hidden = !message; };
    const status = message => text('#productFeedbackUploadStatus', message);
    const current = token => token.epoch === epoch && token.owner === owner && owner === scope() && Boolean(getCurrentUser());
    function requireCurrentWrite(token) {
      if (!current(token) || !navigator.onLine || !requireWrites()) throw new Error('write_context_changed');
    }
    function lock(value) {
      busy = value;
      $('#productFeedbackForm').querySelectorAll('input,textarea,button').forEach(node => { node.disabled = value; });
      if (!value && pending) $('#productFeedbackForm').querySelectorAll('input,textarea,[data-feedback-remove]').forEach(node => { node.disabled = true; });
    }
    function saveDraft() {
      if (!getCurrentUser() || owner !== scope()) return false;
      try {
        sessionStorage.setItem(key(), JSON.stringify({ at:Date.now(), requestId, pending,
          message:$('#productFeedbackMessage').value, kind:$('#productFeedbackKindProblem').checked ? 'problem' : 'suggestion' }));
        text('#productFeedbackDraftStatus', 'Текст сохранён в этой вкладке. Незагруженные файлы после перезагрузки выберите заново.');
        return true;
      } catch {
        text('#productFeedbackDraftStatus', 'Браузер не разрешил сохранить черновик. Отправка приостановлена; текст остаётся на странице.');
        return false;
      }
    }
    function clearDraft() { try { sessionStorage.removeItem(key()); } catch {} }
    function discardFiles() { files.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); }); files = []; }
    function renderFiles() {
      const list = $('#productFeedbackAttachments'); list.replaceChildren();
      files.forEach((item, index) => {
        const card = document.createElement('figure'); card.className = 'feedback-media-item';
        if (item.url) {
          const preview = document.createElement(item.file.type.startsWith('video/') ? 'video' : 'img');
          preview.src = item.url;
          if (preview.tagName === 'VIDEO') { preview.controls = true; preview.preload = 'metadata'; preview.playsInline = true; }
          else preview.alt = `Вложение ${index + 1}`;
          card.append(preview);
        }
        const caption = document.createElement('figcaption'); caption.textContent = item.file?.name || item.uploaded?.name || 'Вложение';
        const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.feedbackRemove = String(index);
        remove.textContent = 'Убрать из обращения'; remove.disabled = busy || Boolean(pending);
        card.append(caption, remove); list.append(card);
      });
    }
    function updateType() {
      $('#productFeedbackExpectedField').hidden = true;
      text('#productFeedbackMessageLabel', 'Расскажите подробнее');
      $('#productFeedbackMessage').placeholder = $('#productFeedbackKindProblem').checked
        ? 'Что вы делали, что произошло и как должно было работать?' : 'Что хотите улучшить и в какой ситуации это пригодится?';
    }
    function resetForm() {
      ++epoch; owner = scope(); discardFiles(); pending = null; requestId = helpers.createId();
      $('#productFeedbackForm').reset(); $('#productFeedbackKindProblem').checked = true;
      $('#productFeedbackForm').hidden = false; $('#productFeedbackSuccess').hidden = true;
      text('#productFeedbackSubmit', 'Отправить'); text('#productFeedbackDraftStatus', '');
      status(''); error(); lock(false); renderFiles(); updateType();
    }
    function validPayload(value) {
      return value && UUID.test(value.p_request_id || '') && value.p_request_id === requestId
        && value.p_organization === (getOrganization?.()?.id || null)
        && ['problem','suggestion'].includes(value.p_kind) && typeof value.p_message === 'string'
        && value.p_message.length >= 10 && value.p_message.length <= 4000
        && Array.isArray(value.p_attachments) && value.p_attachments.length <= 5
        && value.p_attachments.every(item => item && typeof item.path === 'string'
          && item.path.startsWith(`${getCurrentUser().id}/${requestId}/`) && !item.path.includes('..')
          && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 200);
    }
    function open() {
      if (!available || !getCurrentUser()) return;
      if (owner !== scope() || !requestId) {
        resetForm();
        try {
          const draft = JSON.parse(sessionStorage.getItem(key()) || 'null');
          if (draft && Number.isFinite(draft.at) && Date.now() - draft.at >= 0 && Date.now() - draft.at < DAY) {
            $('#productFeedbackMessage').value = String(draft.message || '').slice(0,4000);
            if (draft.kind === 'suggestion') $('#productFeedbackForm').querySelector('input[value="suggestion"]').checked = true;
            if (UUID.test(draft.requestId || '')) requestId = draft.requestId;
            if (draft.pending && validPayload(draft.pending)) {
              pending = draft.pending;
              $('#productFeedbackMessage').value = pending.p_message;
              $('#productFeedbackKindProblem').checked = pending.p_kind === 'problem';
              $('#productFeedbackForm').querySelector('input[value="suggestion"]').checked = pending.p_kind === 'suggestion';
              files = pending.p_attachments.map(uploaded => ({ uploaded, file:null, url:'' }));
              text('#productFeedbackSubmit', 'Проверить и повторить');
            }
            updateType(); renderFiles(); lock(false);
            text('#productFeedbackDraftStatus', 'Черновик восстановлен. Незагруженные файлы выберите заново.');
          } else clearDraft();
        } catch { clearDraft(); }
      }
      $('#productFeedbackDialog').showModal();
    }
    function setAvailable(value) {
      available = Boolean(value);
      document.querySelectorAll('[data-open-product-feedback]').forEach(node => { node.hidden = !available; });
    }
    async function refreshAvailability() {
      const revision = ++availabilityRevision, actor = getCurrentUser()?.id, organization = scope();
      if (!actor || !navigator.onLine) { setAvailable(false); return; }
      try {
        const result = await db.rpc('get_minuta_feedback_media_capability');
        if (revision !== availabilityRevision || actor !== getCurrentUser()?.id || organization !== scope()) return;
        const c = result.data;
        // Limits are supplied by the server; the controller never promises 100 MB.
        if (result.error || c?.version !== 3 || !Number.isInteger(c.max_files) || c.max_files < 1 || c.max_files > 5
          || !Number.isSafeInteger(c.video_bytes) || c.video_bytes < 1 || c.video_bytes > 50 * 1048576
          || !Number.isSafeInteger(c.total_bytes) || c.total_bytes < c.video_bytes || c.total_bytes > 250 * 1048576) { setAvailable(false); return; }
        limits = c; setAvailable(true);
        $('#productFeedbackScreenshot').multiple = true; $('#productFeedbackScreenshot').accept = [...TYPES].join(',');
        text('#productFeedbackAttachmentLabel', 'Фото или видео');
        text('#productFeedbackFileStatus', `До ${c.max_files} файлов: фото до 12 МБ, видео до ${(c.video_bytes / 1048576).toFixed(1)} МБ. Всего до ${(c.total_bytes / 1048576).toFixed(1)} МБ.`);
      } catch { if (revision === availabilityRevision && organization === scope()) setAvailable(false); }
    }
    function addFiles(event) {
      const chosen = Array.from(event.target.files || []); event.target.value = '';
      if (busy || pending || !available || owner !== scope()) return;
      if (files.length + chosen.length > limits.max_files || chosen.some(file => !TYPES.has(file.type) || file.size < 1
        || file.size > (file.type.startsWith('video/') ? limits.video_bytes : 12 * 1048576))) { error('Проверьте формат, размер и количество файлов.'); return; }
      if ([...files.map(item => item.file || item.uploaded), ...chosen].reduce((sum,item) => sum + item.size, 0) > limits.total_bytes) { error('Превышен общий размер вложений.'); return; }
      chosen.forEach(file => files.push({ file, url:URL.createObjectURL(file), uploaded:null, id:helpers.createId() }));
      renderFiles(); error();
    }
    function acknowledged(data) {
      return data && data.request_id === requestId && /^[1-9][0-9]*$/.test(String(data.request_number || ''))
        && data.organization_id === (getOrganization?.()?.id || null);
    }
    function success(data) {
      clearDraft(); pending = null; discardFiles(); renderFiles();
      text('#productFeedbackRequestNumber', String(data.request_number));
      $('#productFeedbackForm').hidden = true; $('#productFeedbackSuccess').hidden = false;
      status(''); notify('Сообщение отправлено');
    }
    async function submit(event) {
      event.preventDefault();
      if (busy || !available || !getCurrentUser() || owner !== scope() || !requireWrites()) return;
      const message = $('#productFeedbackMessage').value.trim();
      if (message.length < 10 || message.length > 4000) { error('Напишите от 10 до 4000 символов.'); return; }
      const token = { epoch, owner }, actor = getCurrentUser().id, organization = getOrganization?.()?.id || null;
      lock(true); error(); const progress = $('#productFeedbackUploadProgress'); progress.hidden = false; progress.removeAttribute('value');
      let definiteRefusal = false;
      try {
        if (!saveDraft()) throw new Error('draft_unavailable');
        if (pending) {
          status('Проверяем результат предыдущей отправки…');
          const lookup = await db.rpc('get_my_minuta_feedback_request_v3', { p_request_id:requestId, p_payload:pending });
          if (!current(token)) return;
          if (lookup.error) throw lookup.error;
          if (lookup.data !== null) {
            if (!acknowledged(lookup.data)) throw new Error('invalid_ack');
            success(lookup.data); return;
          }
        } else {
          const attachments = [];
          for (const item of files) {
            if (!current(token)) return;
            if (!item.uploaded) {
              status(`Загружаем: ${item.file.name}`);
              const blob = item.file.type.startsWith('video/') ? item.file : await helpers.prepareScreenshot(item.file);
              if (!current(token)) return;
              requireCurrentWrite(token);
              const allocation = await db.rpc('reserve_minuta_feedback_upload_v3', { p_request_id:requestId, p_attachment_id:item.id, p_name:item.file.name.slice(0,200), p_mime:blob.type, p_bytes:blob.size });
              if (!current(token)) return;
              if (allocation.error) throw allocation.error;
              const path = allocation.data?.path;
              if (typeof path !== 'string' || !path.startsWith(`${actor}/${requestId}/`) || path.includes('..') || typeof allocation.data.uploaded !== 'boolean') throw new Error('invalid_upload_ack');
              if (!allocation.data.uploaded) {
                requireCurrentWrite(token);
                const upload = await db.storage.from(BUCKET).upload(path, blob, { contentType:blob.type, upsert:false });
                if (!current(token)) return;
                if (upload.error) throw upload.error;
                if (upload.data?.path !== path) throw new Error('invalid_upload_ack');
              }
              item.uploaded = { path, name:item.file.name.slice(0,200), size:blob.size, mime:blob.type };
            }
            attachments.push(item.uploaded);
          }
          pending = { p_request_id:requestId, p_organization:organization,
            p_kind:$('#productFeedbackKindProblem').checked ? 'problem' : 'suggestion', p_message:message,
            p_expected_result:null, p_page_path:location.pathname, p_client_version:helpers.clientVersion(), p_device_summary:helpers.deviceSummary(), p_attachments:attachments };
          if (!saveDraft()) { pending = null; throw new Error('draft_unavailable'); }
        }
        if (!current(token)) return;
        status('Сохраняем обращение…');
        requireCurrentWrite(token);
        const result = await db.rpc('create_minuta_feedback_media_v3', pending);
        if (!current(token)) return;
        if (result.error) {
          // Only an explicit atomic PostgreSQL refusal unlocks editing. Network errors remain uncertain.
          definiteRefusal = ['22023','42501','P0001'].includes(result.error.code)
            && /^(invalid_feedback|feedback_daily_limit|feedback_organization_denied|feedback_attachment_missing|feedback_attachments_too_large)$/.test(result.error.message || '');
          throw result.error;
        }
        if (!acknowledged(result.data)) throw new Error('invalid_ack');
        success(result.data);
      } catch (failure) {
        if (!current(token)) return;
        if (definiteRefusal) pending = null;
        error(definiteRefusal ? 'Сервер отклонил обращение. Текст и файлы сохранены — можно исправить и отправить снова.'
          : failure.message === 'draft_unavailable' ? 'Сначала разрешите сохранение черновика в браузере.'
          : pending ? 'Результат не подтверждён. Кнопка проверит обращение и безопасно повторит ту же отправку.' : 'Не удалось загрузить вложение. Текст и файлы сохранены, попробуйте снова.');
        text('#productFeedbackSubmit', pending ? 'Проверить и повторить' : 'Отправить'); status(''); saveDraft();
      } finally { if (current(token)) { lock(false); progress.hidden = true; } }
    }
    function bind() {
      if (bound) return; bound = true;
      document.addEventListener('click', event => {
        if (event.target.closest('[data-open-product-feedback]')) open();
        if (event.target.closest('[data-close-product-feedback]')) { if (!$('#productFeedbackForm').hidden) saveDraft(); $('#productFeedbackDialog').close(); }
        if (event.target.closest('[data-new-product-feedback]') && !busy && !pending) { clearDraft(); resetForm(); }
        const remove = event.target.closest('[data-feedback-remove]');
        if (remove && !busy && !pending && owner === scope()) {
          const index = Number(remove.dataset.feedbackRemove), item = files[index];
          if (!item) return; if (item.url) URL.revokeObjectURL(item.url); files.splice(index,1); renderFiles();
          // Unlinked reservations are reclaimed by the server's guarded Storage-API cleanup.
        }
      });
      $('#productFeedbackForm').addEventListener('input', () => { if (!busy && !pending && owner === scope()) { updateType(); saveDraft(); } });
      $('#productFeedbackForm').addEventListener('submit', submit);
      $('#productFeedbackScreenshot').addEventListener('change', addFiles);
      $('#productFeedbackDialog').addEventListener('cancel', () => { if (!$('#productFeedbackForm').hidden) saveDraft(); });
      global.addEventListener('pagehide', () => { if (!$('#productFeedbackForm').hidden) saveDraft(); });
      global.addEventListener('online', refreshAvailability);
      global.addEventListener('offline', () => { setAvailable(false); if (!$('#productFeedbackForm').hidden) saveDraft(); });
    }
    return { bind, refreshAvailability, reset() {
      ++epoch; ++availabilityRevision; setAvailable(false); discardFiles(); pending = null; requestId = ''; owner = ''; busy = false;
      $('#productFeedbackForm').reset(); $('#productFeedbackDialog').close(); $('#productFeedbackAttachments').replaceChildren();
    } };
  }
  global.MinutaFeedbackMediaV3 = Object.freeze({ createController });
})(window);
