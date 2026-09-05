(function (global) {
  'use strict';
  const BUCKET = 'product-feedback-media';
  const IMAGE_LIMIT = 12 * 1024 * 1024;
  const VIDEO_LIMIT = 100 * 1024 * 1024;
  const TYPES = new Set(['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime']);
  const DAY = 86400000;

  function createController({ db, $, notify, requireWrites, getCurrentUser, getOrganization }, helpers) {
    let available = false, media = false, bound = false, busy = false, revision = 0;
    let owner = '', files = [], requestId = '', pending = null, restored = false;
    const draftKey = () => `minuta-feedback-draft:${getCurrentUser()?.id || ''}:${getOrganization?.()?.id || 'personal'}`;
    const scope = () => `${getCurrentUser()?.id || ''}:${getOrganization?.()?.id || 'personal'}`;
    function error(message = '') { $('#productFeedbackError').textContent = message; $('#productFeedbackError').hidden = !message; }
    function text(id, value) { $(id).textContent = value; }
    function status(message) { text('#productFeedbackUploadStatus', message); }
    function discardFiles() { files.forEach(item => URL.revokeObjectURL(item.url)); files = []; }
    function saveDraft() {
      if (!getCurrentUser() || owner !== scope()) return;
      try {
        sessionStorage.setItem(draftKey(), JSON.stringify({ at:Date.now(), requestId, pending,
          message:$('#productFeedbackMessage').value, kind:$('#productFeedbackKindProblem').checked ? 'problem' : 'suggestion' }));
        text('#productFeedbackDraftStatus', 'Текст сохранён в этой вкладке. После перезагрузки неотправленные файлы нужно выбрать заново.');
      } catch { text('#productFeedbackDraftStatus', 'Черновик остаётся до закрытия страницы: браузер не разрешил сохранение.'); }
    }
    function clearDraft() { try { sessionStorage.removeItem(draftKey()); } catch {} }
    function lock(value) {
      busy = value;
      $('#productFeedbackForm').querySelectorAll('input,textarea,button').forEach(node => { node.disabled = value; });
      // An uncertain server response must be retried with exactly the same payload.
      if (!value && pending) $('#productFeedbackForm').querySelectorAll('input,textarea,[data-feedback-remove]').forEach(node => { node.disabled = true; });
    }
    function updateType() {
      $('#productFeedbackExpectedField').hidden = true;
      text('#productFeedbackMessageLabel', 'Расскажите подробнее');
      $('#productFeedbackMessage').placeholder = $('#productFeedbackKindProblem').checked
        ? 'Что вы делали, что произошло и как должно было работать?'
        : 'Что хотите улучшить и в какой ситуации это пригодится?';
    }
    function configureFiles() {
      const input = $('#productFeedbackScreenshot');
      input.multiple = media;
      input.accept = media ? [...TYPES].join(',') : 'image/png,image/jpeg,image/webp';
      text('#productFeedbackAttachmentLabel', media ? 'Фото или видео' : 'Фото');
      text('#productFeedbackFileStatus', media
        ? 'До 5 файлов: фото до 12 МБ; MP4, WebM или MOV до 100 МБ. Всего до 200 МБ.'
        : 'Пока доступно одно фото PNG, JPEG или WebP до 12 МБ. Видео появится после обновления сервера.');
      $('#productFeedbackHistory').hidden = !media;
    }
    function renderFiles() {
      const list = $('#productFeedbackAttachments');
      list.replaceChildren();
      files.forEach((item, index) => {
        const card = document.createElement('figure'); card.className = 'feedback-media-item';
        const preview = document.createElement(item.file.type.startsWith('video/') ? 'video' : 'img');
        preview.src = item.url;
        if (preview.tagName === 'VIDEO') { preview.controls = true; preview.preload = 'metadata'; preview.playsInline = true; }
        else preview.alt = `Вложение ${index + 1}`;
        const caption = document.createElement('figcaption'); caption.textContent = `${item.file.name} · ${(item.file.size / 1048576).toFixed(1)} МБ`;
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Удалить';
        remove.dataset.feedbackRemove = String(index); remove.setAttribute('aria-label', `Удалить ${item.file.name}`);
        remove.disabled = busy || Boolean(pending);
        card.append(preview, caption, remove); list.append(card);
      });
    }
    function addFiles(event) {
      if (busy || pending) return;
      const chosen = Array.from(event.target.files || []); event.target.value = '';
      const max = media ? 5 : 1;
      if (files.length + chosen.length > max) { error(`Можно приложить не больше ${max} ${max === 1 ? 'фото' : 'файлов'}.`); return; }
      if (chosen.some(file => !TYPES.has(file.type) || (!media && file.type.startsWith('video/')) || file.size === 0 || file.size > (file.type.startsWith('video/') ? VIDEO_LIMIT : IMAGE_LIMIT))) {
        error('Неподдерживаемый или слишком большой файл. Выберите фото до 12 МБ или видео до 100 МБ.'); return;
      }
      if ([...files.map(item => item.file), ...chosen].reduce((sum, file) => sum + file.size, 0) > 200 * 1048576) { error('Общий размер вложений не должен превышать 200 МБ.'); return; }
      chosen.forEach(file => files.push({ file, url:URL.createObjectURL(file), uploaded:null }));
      renderFiles(); error();
    }
    function resetForm() {
      discardFiles(); pending = null; requestId = helpers.createId(); owner = scope();
      $('#productFeedbackForm').reset(); $('#productFeedbackKindProblem').checked = true;
      $('#productFeedbackForm').hidden = false; $('#productFeedbackSuccess').hidden = true;
      $('#productFeedbackUploadProgress').hidden = true;
      text('#productFeedbackSubmit', 'Отправить'); text('#productFeedbackDraftStatus', '');
      status(''); error(); lock(false); updateType(); renderFiles(); configureFiles();
    }
    function open() {
      if (!available || !getCurrentUser()) return;
      if (!restored || owner !== scope()) {
        resetForm(); restored = true;
        try {
          const draft = JSON.parse(sessionStorage.getItem(draftKey()) || 'null');
          if (draft && Date.now() - draft.at < DAY) {
            $('#productFeedbackMessage').value = String(draft.message || '').slice(0,4000);
            if (draft.kind === 'suggestion') $('#productFeedbackForm').querySelector('input[value="suggestion"]').checked = true;
            requestId = /^[0-9a-f-]{36}$/.test(draft.requestId || '') ? draft.requestId : requestId;
            pending = draft.pending || null;
            updateType(); lock(false); text('#productFeedbackDraftStatus', 'Черновик восстановлен. Неотправленные файлы выберите заново.');
            if (pending) text('#productFeedbackSubmit', 'Повторить отправку');
          } else clearDraft();
        } catch { clearDraft(); }
      }
      $('#productFeedbackDialog').showModal();
      if (media) loadHistory();
    }
    function close() { if (!$('#productFeedbackForm').hidden) saveDraft(); $('#productFeedbackDialog').close(); }
    function setAvailable(value) { available = Boolean(value); document.querySelectorAll('[data-open-product-feedback]').forEach(button => { button.hidden = !available; }); }
    async function refreshAvailability() {
      const current = ++revision;
      if (!getCurrentUser() || !navigator.onLine) { setAvailable(false); return; }
      try {
        const capability = await db.rpc('get_minuta_feedback_media_capability');
        if (current !== revision) return;
        media = !capability.error && capability.data?.version === 2;
        const legacy = media ? { data:true } : await db.rpc('get_minuta_feedback_capability');
        if (current !== revision) return;
        setAvailable(!legacy.error && legacy.data === true); configureFiles();
      } catch { if (current === revision) setAvailable(false); }
    }
    function success(data) {
      clearDraft(); pending = null; requestId = helpers.createId(); discardFiles(); renderFiles();
      text('#productFeedbackRequestNumber', String(data.request_number));
      $('#productFeedbackForm').hidden = true; $('#productFeedbackSuccess').hidden = false;
      $('#productFeedbackUploadProgress').hidden = true; status('');
      notify('Сообщение отправлено'); if (media) loadHistory();
    }
    async function findRequest() {
      const result = await db.rpc('get_my_minuta_feedback_request', { p_request_id:requestId });
      if (result.error) throw result.error;
      return result.data;
    }
    async function submit(event) {
      event.preventDefault();
      if (busy || !available || !getCurrentUser() || !requireWrites()) return;
      const message = $('#productFeedbackMessage').value.trim();
      if (message.length < 10) { error('Добавьте немного подробностей: хотя бы 10 символов.'); return; }
      const currentOwner = owner; const actor = getCurrentUser().id;
      lock(true); saveDraft(); error(); text('#productFeedbackSubmit', 'Отправляем…');
      const progress = $('#productFeedbackUploadProgress'); progress.hidden = false; progress.removeAttribute('value');
      let legacyPath = '';
      try {
        if (media) {
          status('Проверяем, не было ли обращение уже отправлено…');
          const existing = await findRequest();
          if (owner !== currentOwner || scope() !== currentOwner) return;
          if (existing) { success(existing); return; }
        }
        if (!pending) {
          const attachments = [];
          for (let i = 0; i < files.length; i++) {
            const item = files[i];
            status(`Загружаем файл ${i + 1} из ${files.length}: ${item.file.name}`);
            if (!item.uploaded) {
              const video = item.file.type.startsWith('video/');
              const blob = video ? item.file : await helpers.prepareScreenshot(item.file);
              const ext = video ? ({ 'video/mp4':'mp4', 'video/webm':'webm', 'video/quicktime':'mov' })[item.file.type] : 'webp';
              const path = `${actor}/${helpers.createId()}.${ext}`;
              const result = await db.storage.from(media ? BUCKET : 'product-feedback').upload(path, blob, { contentType:blob.type, upsert:false });
              if (result.error) throw result.error;
              item.uploaded = { path, name:item.file.name.slice(0,200), mime:blob.type, size:blob.size };
            }
            attachments.push(item.uploaded);
            if (owner !== currentOwner || scope() !== currentOwner) return;
          }
          const base = { p_organization:getOrganization?.()?.id || null,
            p_kind:$('#productFeedbackKindProblem').checked ? 'problem' : 'suggestion', p_message:message,
            p_expected_result:null, p_page_path:location.pathname, p_client_version:helpers.clientVersion(), p_device_summary:helpers.deviceSummary() };
          pending = media ? { ...base, p_request_id:requestId, p_attachments:attachments }
            : { ...base, p_screenshot_path:attachments[0]?.path || null };
          saveDraft();
        }
        status('Вложения загружены. Сохраняем обращение…'); progress.max = 1; progress.value = 1;
        legacyPath = pending.p_screenshot_path || '';
        const result = await db.rpc(media ? 'create_minuta_feedback_media' : 'create_minuta_feedback', pending);
        if (result.error) throw result.error;
        if (owner !== currentOwner || scope() !== currentOwner) return;
        success(result.data);
      } catch (failure) {
        if (owner !== currentOwner || scope() !== currentOwner) return;
        if (!media && legacyPath) {
          // Legacy endpoint has no idempotency contract; do not remove a possibly committed attachment.
          status('Сервер не подтвердил результат. Проверьте обращение перед повторной отправкой.');
        } else status('Черновик и выбранные файлы сохранены. Можно повторить отправку.');
        error(/image_too_large|image_decode/.test(String(failure?.message)) ? 'Не удалось обработать фото. Выберите другое изображение.' : 'Не удалось завершить отправку. Проверьте подключение и повторите попытку.');
        text('#productFeedbackSubmit', 'Повторить отправку'); saveDraft();
      } finally {
        if (owner === currentOwner) { lock(false); progress.hidden = true; if ($('#productFeedbackForm').hidden) text('#productFeedbackSubmit', 'Отправить'); }
      }
    }
    async function loadHistory() {
      const currentOwner = scope();
      const list = $('#productFeedbackHistoryList'); list.textContent = 'Загружаем обращения…';
      try {
        const result = await db.rpc('list_my_minuta_feedback');
        if (scope() !== currentOwner) return;
        if (result.error) throw result.error;
        list.replaceChildren();
        if (!result.data?.length) list.textContent = 'Здесь появятся ваши обращения и ответы поддержки.';
        const states = { new:'Получено',in_review:'На рассмотрении',planned:'Запланировано',resolved:'Решено',closed:'Закрыто' };
        for (const row of result.data || []) {
          const article = document.createElement('article');
          const title = document.createElement('strong'); title.textContent = `№ ${row.request_number} · ${states[row.status] || row.status}`;
          const body = document.createElement('p'); body.textContent = row.message;
          article.append(title, body);
          for (const reply of row.replies || []) {
            const quote = document.createElement('blockquote'); quote.textContent = `Поддержка · ${new Date(reply.created_at).toLocaleDateString('ru-RU')}\n${reply.message}`; article.append(quote);
          }
          if (row.attachments?.length) {
            const mediaList = document.createElement('div'); mediaList.className = 'feedback-history-media';
            for (const attachment of row.attachments) {
              const button = document.createElement('button'); button.type = 'button'; button.textContent = attachment.name || 'Вложение';
              button.addEventListener('click', async () => {
                button.disabled = true;
                try {
                  const signed = await db.storage.from(BUCKET).createSignedUrl(attachment.path,60);
                  if (signed.error) throw signed.error;
                  if (scope() !== currentOwner) return;
                  const link = document.createElement('a'); link.href = signed.data.signedUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Открыть вложение'; button.replaceWith(link);
                } catch { button.disabled = false; button.textContent = 'Повторить открытие'; }
              }); mediaList.append(button);
            } article.append(mediaList);
          }
          list.append(article);
        }
      } catch { if (scope() === currentOwner) list.textContent = 'Не удалось загрузить обращения. Нажмите «Обновить». '; }
    }
    function bind() {
      if (bound) return; bound = true;
      document.addEventListener('click', event => {
        if (event.target.closest('[data-open-product-feedback]')) open();
        if (event.target.closest('[data-close-product-feedback]')) close();
        if (event.target.closest('[data-new-product-feedback]') && !busy) { clearDraft(); resetForm(); }
        const remove = event.target.closest('[data-feedback-remove]');
        if (remove && !busy && !pending) { const index = Number(remove.dataset.feedbackRemove); URL.revokeObjectURL(files[index].url); files.splice(index,1); renderFiles(); }
      });
      $('#productFeedbackForm').addEventListener('input', () => { updateType(); saveDraft(); });
      $('#productFeedbackScreenshot').addEventListener('change', addFiles);
      $('#productFeedbackForm').addEventListener('submit', submit);
      $('#productFeedbackHistoryRefresh').addEventListener('click', loadHistory);
      $('#productFeedbackDialog').addEventListener('cancel', saveDraft);
      global.addEventListener('pagehide', () => { if (!$('#productFeedbackForm').hidden) saveDraft(); });
      global.addEventListener('online', refreshAvailability);
      global.addEventListener('offline', () => { status('Нет подключения. Черновик сохранён; отправьте его после восстановления связи.'); saveDraft(); });
    }
    return { bind, refreshAvailability, reset() { ++revision; setAvailable(false); saveDraft(); discardFiles(); pending = null; owner = ''; restored = false; busy = false; $('#productFeedbackDialog').close(); $('#productFeedbackHistoryList').replaceChildren(); } };
  }
  global.MinutaFeedbackMedia = Object.freeze({ createController });
})(window);
