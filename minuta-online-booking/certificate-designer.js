(function () {
  'use strict';
  const sourceURL = document.currentScript?.src;
  let detectorLoad;
  function loadDetector() {
    if(window.MinutaCertificateLayoutDetector)return Promise.resolve(window.MinutaCertificateLayoutDetector);
    if(!detectorLoad)detectorLoad=new Promise((resolve,reject)=>{
      if(!sourceURL){reject(new Error('recognition_unavailable'));return;}
      const script=document.createElement('script');script.src=new URL('certificate-layout-detector.js',sourceURL).href;
      script.onload=()=>window.MinutaCertificateLayoutDetector?resolve(window.MinutaCertificateLayoutDetector):reject(new Error('recognition_unavailable'));
      script.onerror=()=>{script.remove();reject(new Error('recognition_unavailable'))};document.head.append(script);
    }).catch(reason=>{detectorLoad=null;throw reason});
    return detectorLoad;
  }
  function createController(options) {
    const root = options.root || options.$?.('#certificateDesignerPanel');
    if (!root) throw new Error('certificate_root_required');
    const R = window.MinutaCertificateRenderer;
    if (!R) throw new Error('certificate_renderer_required');
    const repository = options.repository || (options.db ? createRepository(options.db) : null);
    if (!repository) throw new Error('certificate_repository_required');
    let organization = null, revision = 0, busy = false, workspace = null;
    let template = null, image = null, record = null, intent = null, renderRevision = 0, viewing = false, selectedClient = null, clientRevision = 0, copyValidity = null;
    const loadedFonts = new Map(), loadingFonts = new Map();
    let detectionRevision=0, detectionJob=null, detecting=false;
    let activeDraft=null, draftIntent=null, draftsRevision=0, draftsCursor=null;
    const $ = selector => root.querySelector(selector);
    root.classList.add('certificate-designer');
    root.innerHTML = `<div class="certificate-heading"><h3>Подарочные сертификаты</h3><span data-certificate-demo hidden>Образец</span></div>
      <div class="certificate-tabs" role="tablist" aria-label="Сертификаты"><button type="button" role="tab" aria-selected="true" data-tab="create">Создать</button><button type="button" role="tab" aria-selected="false" data-tab="drafts">Черновики</button><button type="button" role="tab" aria-selected="false" data-tab="history">История</button></div>
      <p class="certificate-message" role="status" data-message></p><p class="certificate-error" role="alert" data-error hidden></p>
      <div data-panel="create"><div class="certificate-layout"><form class="certificate-form" data-form>
        <label>Макет<select data-template aria-label="Макет"></select></label>
        <details data-template-settings><summary>Загрузить и настроить макет</summary><div class="certificate-form">
          <label>Изображение макета<input type="file" accept="image/png,image/jpeg,image/webp" data-image></label>
          <p class="certificate-help">Загрузи пустой макет. Места для процедуры, даты и номера определятся автоматически; проверь их перед сохранением.</p>
          <div class="certificate-buttons"><button type="button" data-detect>Определить места автоматически</button><button type="button" data-cancel-detect hidden>Указать вручную</button></div>
          <p class="certificate-help" data-detection role="status"></p>
          <label>Поле на макете<select data-field><option value="procedure">Процедура</option><option value="date">Дата выдачи</option><option value="number">Номер</option></select></label>
          <p class="certificate-help">Выбери поле и нажми на макет в месте для текста.</p>
          <div class="certificate-pair"><label>По горизонтали, %<input type="number" min="3" max="97" step=".1" data-x></label><label>По вертикали, %<input type="number" min="3" max="97" step=".1" data-y></label></div>
          <div class="certificate-pair"><label>Ширина поля, %<input type="number" min="5" max="94" step=".1" data-width></label><label>Размер шрифта, % высоты<input type="number" min=".5" max="10" step=".1" data-size></label></div>
          <div class="certificate-buttons"><button type="button" data-save-template>Сохранить макет</button></div></div></details>
        <label>Содержание сертификата<select data-content-mode><option value="catalog">Выбрать услугу</option><option value="custom">Свой текст</option></select></label>
        <label data-service-wrapper>Услуга<select data-service required></select></label>
        <label data-custom-wrapper hidden>Текст на сертификате<textarea data-custom-text rows="3" maxlength="260" placeholder="Например: Любая услуга на ваш выбор"></textarea><span class="certificate-help">До 260 символов. Текст появится на макете без добавления длительности и сеансов.</span></label>
        <details data-client-settings><summary data-client-summary>Связать с клиентом (необязательно)</summary><div class="certificate-form">
          <label>Найти клиента<input type="search" data-client-query maxlength="100" placeholder="Имя или телефон"></label>
          <label>Клиент<select data-client><option value="">Без привязки</option></select></label>
          <label data-benefit-wrapper hidden>Учёт сеансов<select data-benefit><option value="">Без учёта остатка</option></select></label>
          <p class="certificate-help">Привязка видна в карточке клиента. Имя и телефон не добавляются на изображение.</p></div></details>
        <div class="certificate-pair"><label data-sessions-wrapper>Количество сеансов<input type="number" data-sessions min="1" max="1000" step="1" value="1" required></label><label>Шрифт<select data-font><option value="Times New Roman">Классический</option><option value="Gabriola">Gabriola</option><option value="History Pro 02">History Pro 02</option></select></label></div>
        <label data-font-upload hidden>Файл выбранного шрифта<input type="file" accept=".ttf,.otf,.woff,.woff2" data-font-file></label>
        <label>Нумерация<select data-number-mode><option value="auto">Автоматически</option><option value="manual">Ввести вручную</option></select></label>
        <div class="certificate-pair"><label>Дата выдачи<input type="date" data-date required></label><label>Номер сертификата<input type="text" data-number maxlength="40" required></label></div>
        <p class="certificate-help" data-number-help></p>
        <div class="certificate-pair"><label>Действует по<input type="date" data-expiry required></label><label>Напомнить за, дней<input type="number" min="0" max="365" step="1" value="7" data-remind required></label></div>
        <div class="certificate-buttons"><button type="submit" class="primary" data-issue>Сохранить выдачу</button><button type="button" data-new hidden>Новый сертификат</button><button type="button" data-similar hidden>Создать похожий</button></div>
        <div class="certificate-buttons"><button type="button" data-save-draft>Сохранить черновик</button><button type="button" data-fresh-draft hidden>Начать новый</button></div>
        <p class="certificate-help" data-draft-help>Сохрани черновик, чтобы продолжить позже с другого устройства в этом кабинете.</p>
        <label>Формат файла<select data-format><option value="png">PNG</option><option value="jpg">JPG</option><option value="pdf">PDF</option><option value="webp">WebP</option></select></label>
        <label>Размер для печати и PDF<select data-paper><option value="a5">A5 — 148 × 210 мм</option><option value="a4">A4 — 210 × 297 мм</option></select></label>
        <p class="certificate-help" data-print-quality></p>
        <div class="certificate-buttons"><button type="button" data-download disabled>Скачать PNG</button><button type="button" data-share disabled>Поделиться</button><button type="button" data-print disabled>Печать</button></div>
        </form><figure class="certificate-preview"><div class="certificate-preview-empty" data-empty>Загрузи макет, чтобы увидеть сертификат</div><canvas data-canvas hidden role="img" aria-label="Предпросмотр подарочного сертификата"></canvas></figure></div></div>
      <div data-panel="history" hidden><p class="certificate-reminder" role="status" data-reminders hidden></p>
        <div class="certificate-history-controls"><input type="search" aria-label="Поиск сертификатов" placeholder="Номер или текст сертификата" data-search maxlength="180"><select aria-label="Срок действия" data-status><option value="all">Все сертификаты</option><option value="active">Действуют</option><option value="expiring">Скоро истекают</option><option value="expired">Истекли</option></select></div>
        <div data-history></div><div class="certificate-buttons"><button type="button" data-more hidden>Показать ещё</button></div></div>
      <div data-panel="drafts" hidden><p class="certificate-help">Твои сохранённые черновики. Номер назначается только при выдаче сертификата.</p><div data-drafts></div><div class="certificate-buttons"><button type="button" data-drafts-more hidden>Показать ещё</button></div></div>`;
    const errorMessages = {
      invalid_date:'Проверь дату.', invalid_procedure:'Выбери услугу и количество сеансов.', invalid_custom_text:'Напиши текст сертификата: от 1 до 260 символов.', invalid_duration:'У выбранной услуги не указана длительность.',
      unsupported_export_format:'Этот браузер не поддерживает выбранный формат. Выбери другой формат файла.',
      print_window_blocked:'Разреши открытие окна печати для этого сайта и попробуй снова.',
      invalid_certificate:'Проверь номер и срок действия.', invalid_layout:'Проверь положение, ширину и размер поля.', invalid_image:'Выбери макет в PNG, JPEG или WebP размером до 8 МБ.',
      invalid_image_size:'Макет должен быть от 200 до 6000 пикселей по каждой стороне и не более 20 мегапикселей.', text_does_not_fit:'Текст не помещается. Увеличь ширину поля или уменьши шрифт.',
      certificate_number_exists:'Этот номер уже есть в истории. Выбери другой.', certificate_request_conflict:'Сохранённая выдача содержит другие данные. Проверь историю перед повтором.',
      font_missing:'Подключи файл выбранного шрифта, чтобы он одинаково выглядел на всех устройствах.', template_not_saved:'Сначала сохрани настройки макета.',
      unavailable:'Раздел ещё не подключён к сохранению в кабинете. Выдача не сохранена.', stale_session:'Контекст кабинета изменился. Открой раздел снова.',
      storage_failed:'Не удалось сохранить защиту от повторной выдачи. Попробуй снова.', image_too_large:'Макет должен быть не больше 8 МБ.', font_too_large:'Файл шрифта должен быть не больше 2 МБ.',
      certificate_number_exhausted:'Достигнут предел автоматической нумерации. Выбери ручной номер.',
      certificate_draft_conflict:'Черновик изменился на другом устройстве. Введённые данные сохранены в форме; открой актуальный черновик или начни новый.',
      certificate_draft_unavailable:'Черновик уже выдан или недоступен в этом кабинете.', invalid_certificate_draft:'Не удалось сохранить черновик. Проверь макет и выбранного клиента.',
      invalid_certificate_client:'Клиент недоступен в этом кабинете. Найди и выбери его снова.', invalid_certificate_benefit:'Выбери подходящий учёт сеансов для этого клиента.', certificate_benefit_already_linked:'Этот абонемент уже связан с другой выдачей.'
    };
    function message(text) { $('[data-message]').textContent = text || ''; }
    function fail(reason) {
      const detail = String(reason?.message || reason || '');
      $('[data-error]').textContent = Object.entries(errorMessages).find(([key]) => detail.includes(key))?.[1] || 'Не удалось выполнить действие. Данные не потеряны; проверь историю перед повтором.';
      $('[data-error]').hidden = false;
    }
    function clearError() { $('[data-error]').hidden = true; $('[data-error]').textContent = ''; }
    function current(scope) { return scope.revision === revision && scope.org === organization?.id && (!options.sessionIsCurrent || options.sessionIsCurrent(scope.user, scope.generation)); }
    function capture() { return { revision, org:organization?.id, user:options.getCurrentUser?.()?.id, generation:options.getSessionGeneration?.() }; }
    function writesAllowed() { return Boolean(workspace && ['owner','admin','specialist'].includes(workspace.current_role) && (!options.requireWrites || options.requireWrites())); }
    function automaticNumber() { return $('[data-number-mode]').value==='auto'; }
    function canExport() { return Boolean(record && (viewing || !automaticNumber()) && !intent && !draftIntent); }
    function numbering() {
      $('[data-number]').readOnly=automaticNumber();
      $('[data-number-help]').textContent=automaticNumber()&&!viewing?'Предварительный номер. Свободный номер назначится при сохранении выдачи; затем можно скачать или поделиться.':'';
    }
    function contentMode() {
      const custom = $('[data-content-mode]').value === 'custom', locked = busy || viewing || Boolean(intent) || Boolean(draftIntent);
      $('[data-service-wrapper]').hidden = custom; $('[data-custom-wrapper]').hidden = !custom; $('[data-sessions-wrapper]').hidden = custom;
      $('[data-service]').required = !custom; $('[data-sessions]').required = !custom; $('[data-custom-text]').required = custom;
      $('[data-service]').disabled = locked || custom; $('[data-sessions]').disabled = locked || custom; $('[data-custom-text]').disabled = locked || !custom;
    }
    function restoreContent(item) {
      const custom = item.content_mode === 'custom'; $('[data-content-mode]').value = custom ? 'custom' : 'catalog';
      $('[data-custom-text]').value = custom ? item.procedure : ''; $('[data-sessions]').value = custom ? '1' : item.sessions;
      if (!custom) {
        const service = workspace.services.find(s => s.id === item.service_id);
        selectOptions($('[data-service]'),service ? workspace.services : [{id:item.service_id,name:item.service_name}],s=>s.name);
        $('[data-service]').value = item.service_id;
      }
      contentMode();
    }
    function lock(value) {
      busy = value;
      $('[data-form]').querySelectorAll('input,select,textarea,button').forEach(node => { node.disabled = value || viewing || Boolean(intent) || Boolean(draftIntent); });
      contentMode(); $('[data-format]').disabled = value; $('[data-paper]').disabled = value;
      $('[data-download]').disabled = value || !canExport();
      $('[data-share]').disabled = value || !canExport();
      $('[data-print]').disabled = value || !canExport();
      $('[data-new]').disabled = value; $('[data-new]').hidden = !viewing; $('[data-issue]').hidden = viewing;
      $('[data-similar]').hidden = !viewing; $('[data-similar]').disabled = value || Boolean(intent);
      $('[data-issue]').disabled = value || viewing || Boolean(draftIntent) || !workspace || !template?.saved;
      $('[data-issue]').textContent = intent ? 'Повторить сохранение' : 'Сохранить выдачу';
      $('[data-detect]').disabled=value||viewing||Boolean(intent)||Boolean(draftIntent)||!image;
      $('[data-cancel-detect]').disabled=false;
      $('[data-save-draft]').hidden=viewing; $('[data-save-draft]').disabled=value||viewing||Boolean(intent)||!writesAllowed()||!repository.saveDraft;
      $('[data-save-draft]').textContent=draftIntent?'Повторить сохранение черновика':'Сохранить черновик';
      $('[data-fresh-draft]').hidden=viewing||!activeDraft; $('[data-fresh-draft]').disabled=value||Boolean(intent)||Boolean(draftIntent);
      $('[data-draft-help]').hidden=viewing; numbering();
    }
    function readRecord() {
      // A retry replays the locked original request even if the live service catalog changed.
      if (intent) return JSON.parse(intent.snapshot);
      const service = workspace?.services?.find(item => String(item.id) === $('[data-service]').value);
      const sessions = Number($('[data-sessions]').value), remind = Number($('[data-remind]').value);
      if (!Number.isInteger(remind) || remind < 0 || remind > 365) throw new Error('invalid_certificate');
      const custom = $('[data-content-mode]').value === 'custom';
      if (!custom && !service) throw new Error('invalid_procedure');
      const value = { service_id:custom?null:service.id, service_name:custom?null:service.name, duration_minutes:custom?null:Number(service.duration_minutes), sessions:custom?null:sessions,
        procedure:custom?R.customText($('[data-custom-text]').value):R.procedureLabel(service.name, sessions, Number(service.duration_minutes)), issued_on:$('[data-date]').value,
        expires_on:$('[data-expiry]').value, number:$('[data-number]').value.trim(), remind_days:remind,
        font_family:$('[data-font]').value, template_id:template?.id, layout:structuredClone(template?.layout || R.fields) };
      if (custom) value.content_mode = 'custom';
      if (automaticNumber()) value.number_mode='auto';
      if (activeDraft?.revision) Object.assign(value,{draft_id:activeDraft.id,draft_revision:activeDraft.revision});
      if (selectedClient) Object.assign(value,{client_phone:selectedClient.phone,client_name:selectedClient.name,client_account_id:selectedClient.account_id || null,benefit_instrument_id:custom?null:$('[data-benefit]').value || null});
      return value;
    }
    function clientSelection(value) {
      selectedClient=value; $('[data-client-summary]').textContent=value ? `Клиент: ${value.name}` : 'Связать с клиентом (необязательно)';
      $('[data-client]').replaceChildren(new Option('Без привязки',''));
      if(value){$('[data-client]').add(new Option(`${value.name} · ${value.phone}`,value.phone));$('[data-client]').value=value.phone;}
      $('[data-benefit]').replaceChildren(new Option('Без учёта остатка',''));$('[data-benefit-wrapper]').hidden=true;
    }
    let clientChoices=[];
    async function searchClients() {
      if(!repository.clients || busy || viewing || intent)return;
      const scope=capture(),ticket=++clientRevision;
      try{
        const data=await repository.clients(scope.org,$('[data-client-query]').value);
        if(!current(scope)||ticket!==clientRevision)return;
        if(data.organization_id!==scope.org||!Array.isArray(data.clients))throw new Error('unavailable');
        clientChoices=data.clients;const chosen=selectedClient;
        $('[data-client]').replaceChildren(new Option('Без привязки',''));
        for(const item of [chosen,...clientChoices].filter((item,index,all)=>item&&all.findIndex(other=>other?.phone===item.phone)===index))$('[data-client]').add(new Option(`${item.name} · ${item.phone}`,item.phone));
        $('[data-client]').value=chosen?.phone||'';
      }catch(reason){if(current(scope)&&ticket===clientRevision)fail(reason);}
    }
    async function chooseClient() {
      if(busy||viewing||intent)return;
      const chosen=clientChoices.find(item=>item.phone===$('[data-client]').value)||(selectedClient?.phone===$('[data-client]').value?selectedClient:null);clientSelection(chosen);
      const scope=capture(),ticket=++clientRevision;await preview();
      if(!chosen || !repository.clientOptions)return;
      try{
        const data=await repository.clientOptions(scope.org,chosen.phone);
        if(!current(scope)||ticket!==clientRevision||viewing||intent)return;
        if(data.organization_id!==scope.org||data.client_phone!==chosen.phone)throw new Error('unavailable');
        chosen.account_id=data.client_account_id||null;chosen.instruments=Array.isArray(data.instruments)?data.instruments:[];benefitOptions();
      }catch(reason){if(current(scope)&&ticket===clientRevision)fail(reason);}
    }
    function benefitOptions() {
      const chosen=$('[data-benefit]').value,service=$('[data-service]').value,sessions=Number($('[data-sessions]').value);
      const items=$('[data-content-mode]').value==='custom'?[]:(selectedClient?.instruments||[]).filter(item=>item.visits_count===sessions&&(!item.services?.length||item.services.some(s=>s.service_id===service)));
      $('[data-benefit]').replaceChildren(new Option('Без учёта остатка',''));
      for(const item of items)$('[data-benefit]').add(new Option(`${item.name} · осталось ${item.remaining_visits} из ${item.visits_count}`,item.id));
      $('[data-benefit]').value=items.some(item=>item.id===chosen)?chosen:'';$('[data-benefit-wrapper]').hidden=!items.length;
    }
    function systemFontAvailable(family) {
      if (family === 'Times New Roman') return true;
      const ctx = document.createElement('canvas').getContext('2d'), sample = 'Массаж швз 012345 ABC';
      return ['serif','monospace'].some(fallback => {
        ctx.font = '32px ' + fallback; const a = ctx.measureText(sample).width;
        ctx.font = `32px "${family}", ${fallback}`; return Math.abs(a - ctx.measureText(sample).width) > .1;
      });
    }
    async function ensureFont(family, file = template?.font_files?.[family]) {
      const scope = capture();
      if (file) {
        const key = family + '\u0000' + file;
        let face = loadedFonts.get(key);
        if (!face) {
          let pending = loadingFonts.get(key);
          if (!pending) {
            const binary=atob(file.slice(file.indexOf(',')+1)), bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
            pending = new FontFace(family, bytes.buffer).load(); loadingFonts.set(key, pending);
          }
          try { face = await pending; }
          finally { if (loadingFonts.get(key) === pending) loadingFonts.delete(key); }
          if (!current(scope)) throw new Error('stale_session');
          loadedFonts.set(key, face);
        }
        // Only the selected version may participate in this family's glyph fallback.
        for (const [source, other] of loadedFonts) if (source !== key && other.family === family) document.fonts.delete(other);
        document.fonts.add(face);
      }
      // A portable template must carry an uploaded font; system-only fonts do not suffice for mobile export.
      return family === 'Times New Roman' || Boolean(file) || systemFontAvailable(family);
    }
    async function preview() {
      const ticket = ++renderRevision; record = null; $('[data-download]').disabled = true; $('[data-share]').disabled = true; $('[data-print]').disabled = true;
      $('[data-empty]').textContent=image?'Заполни данные, чтобы увидеть сертификат':'Загрузи макет, чтобы увидеть сертификат';
      if (!image || !workspace) return;
      if (!intent && $('[data-content-mode]').value==='custom' && !$('[data-custom-text]').value.trim()) {
        clearError(); $('[data-canvas]').hidden=true; $('[data-empty]').hidden=false; return;
      }
      try {
        const value = readRecord();
        const available = await ensureFont(value.font_family);
        if (ticket !== renderRevision) return;
        $('[data-font-upload]').hidden = value.font_family === 'Times New Roman' || Boolean(template?.font_files?.[value.font_family]);
        if (!available) throw new Error('font_missing');
        const incomplete=!value.number;
        clearError(); R.render($('[data-canvas]'), image, incomplete?{...value,number:'—'}:value, value.layout, value.font_family);
        $('[data-canvas]').hidden = false; $('[data-empty]').hidden = true; record = incomplete?null:value;
        $('[data-canvas]').setAttribute('aria-label', `${value.procedure}. Дата ${R.dateLabel(value.issued_on)}. Номер ${value.number||'не указан'}.`);
        $('[data-download]').disabled = busy||incomplete||!canExport(); $('[data-share]').disabled = busy||incomplete||!canExport();
        $('[data-print]').disabled = busy||incomplete||!canExport(); printQuality();
      } catch (reason) { if (ticket === renderRevision) { fail(reason); $('[data-canvas]').hidden = true; $('[data-empty]').hidden = false; } }
    }
    function fieldInputs() {
      const field = template?.layout?.[$('[data-field]').value]; if (!field) return;
      for (const [key, selector] of [['x','[data-x]'],['y','[data-y]'],['width','[data-width]'],['size','[data-size]']]) $(selector).value = String(Math.round(field[key] * 1000) / 10);
    }
    function draftTemplate() {
      if (template?.saved) template={...structuredClone(template),id:crypto.randomUUID(),saved:false};
    }
    async function selectTemplate(id) {
      cancelDetection(); $('[data-detection]').textContent='';
      const ticket = ++renderRevision, scope = capture();
      const selected = workspace.templates.find(item => String(item.id) === id);
      template = selected ? structuredClone(selected) : null; image = null; record = null;
      if (!template) { $('[data-canvas]').hidden = true; $('[data-empty]').hidden = false; lock(false); return; }
      try {
        const source = selected.image_data ? selected : (await repository.template(scope.org, id)).template;
        if (ticket !== renderRevision || !current(scope)) return;
        if (!source || source.id !== id) throw new Error('unavailable');
        const loaded = await R.loadImage(source.image_data);
        if (ticket !== renderRevision || !current(scope)) return;
        image = loaded; template = { ...source, saved:true }; fieldInputs(); lock(false); await preview();
      } catch (reason) { if (current(scope)) fail(reason); }
    }
    function selectOptions(select, rows, label) {
      select.replaceChildren(); for (const item of rows) { const option = document.createElement('option'); option.value = String(item.id); option.textContent = label(item); select.append(option); }
    }
    async function loadWorkspace() {
      const scope = capture(); workspace = null; lock(true); message('Загружаем сертификаты…');
      try {
        const data = await repository.workspace(scope.org);
        if (!current(scope)) return;
        if (!data || data.organization_id !== scope.org || !Array.isArray(data.templates) || !Array.isArray(data.services)) throw new Error('unavailable');
        workspace = data; selectOptions($('[data-template]'), data.templates, t => t.name); selectOptions($('[data-service]'), data.services, s => s.name);
        $('[data-date]').value ||= options.defaultDate || data.today; $('[data-expiry]').value ||= R.addMonths($('[data-date]').value, 6);
        if (automaticNumber()) $('[data-number]').value=data.next_number || '1'; else $('[data-number]').value ||= options.defaultNumber || '';
        const pending = intent ? JSON.parse(intent.snapshot) : null;
        if (pending) {
          clientSelection(pending.client_phone?{phone:pending.client_phone,name:pending.client_name,account_id:pending.client_account_id}:null);
          if(pending.benefit_instrument_id){$('[data-benefit]').add(new Option('Сохранённая привязка',pending.benefit_instrument_id));$('[data-benefit]').value=pending.benefit_instrument_id;$('[data-benefit-wrapper]').hidden=false;}
          restoreContent(pending);
          $('[data-date]').value = pending.issued_on; $('[data-expiry]').value = pending.expires_on;
          $('[data-number]').value = pending.number; $('[data-remind]').value = pending.remind_days; $('[data-font]').value = pending.font_family;
          $('[data-number-mode]').value=pending.number_mode==='auto'?'auto':'manual';
          activeDraft=pending.draft_id?{id:pending.draft_id,revision:pending.draft_revision}:null;
          if (!data.templates.some(t=>t.id===pending.template_id)) {
            const savedTemplate = await repository.template(scope.org,pending.template_id);
            if (!current(scope) || savedTemplate.organization_id!==scope.org) return;
            data.templates.push(savedTemplate.template); selectOptions($('[data-template]'),data.templates,t=>t.name);
          }
          $('[data-template]').value = pending.template_id;
        }
        $('[data-certificate-demo]').hidden = !repository.demo; message(repository.demo ? 'Образец: выдачи сохраняются только в этой демонстрации.' : '');
        await selectTemplate($('[data-template]').value); if (!current(scope)) return;
        await history(false); if (current(scope)) lock(false);
      } catch (reason) { if (current(scope)) { workspace = null; lock(false); message(''); fail(reason); } }
    }
    async function readFile(file, limit, error) {
      if (!file || file.size > limit) throw new Error(error);
      return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).replace(/^data:;base64,/, 'data:application/octet-stream;base64,')); reader.onerror = () => reject(new Error('storage_failed')); reader.readAsDataURL(file); });
    }
    async function uploadImage() {
      if(busy||viewing||intent)return;
      const scope = capture(); const file = $('[data-image]').files[0]; if (!file) return;
      lock(true);clearError();let uploaded=false;
      try {
        const data = await readFile(file, 8 * 1024 * 1024, 'image_too_large'); const loaded = await R.loadImage(data);
        if (!current(scope)) return;
        template = { id:crypto.randomUUID(), name:file.name.replace(/\.[^.]+$/, '').slice(0, 100), image_data:data, layout:structuredClone(R.fields), font_files:{}, saved:false };
        image = loaded; fieldInputs();const draftOption=new Option(template.name+' (не сохранён)',template.id);draftOption.disabled=true;$('[data-template]').add(draftOption);$('[data-template]').value=template.id;
        $('[data-issue]').disabled = true; message('Макет загружен. Проверь места для текста и сохрани настройки.'); await preview();uploaded=true;
      } catch (reason) { if (current(scope)) fail(reason); }
      finally{if(current(scope))lock(false);}
      if(uploaded&&current(scope))await detectLayout();
    }
    function cancelDetection(){
      ++detectionRevision;detectionJob?.cancel();detectionJob=null;
      if(detecting){detecting=false;$('[data-cancel-detect]').hidden=true;lock(false);}
    }
    async function detectLayout(){
      if(busy||viewing||intent||!image||!template)return;
      const scope=capture(),ticket=++detectionRevision;
      detecting=true;lock(true);$('[data-cancel-detect]').hidden=false;$('[data-detection]').textContent='Определяем места для текста…';
      try{
        const D=await loadDetector();if(!current(scope)||ticket!==detectionRevision)return;
        detectionJob=D.createJob(image);const fields=await detectionJob.promise;
        if(!current(scope)||ticket!==detectionRevision)return;
        const names={procedure:'процедура',date:'дата выдачи',number:'номер'},found=Object.keys(fields);
        if(found.length){draftTemplate();Object.assign(template.layout,fields);template.saved=false;fieldInputs();}
        const missing=Object.keys(names).filter(key=>!fields[key]);
        $('[data-detection]').textContent=found.length===3?'Найдены все 3 поля. Проверь текст на макете и сохрани настройки.':
          `Найдено полей: ${found.length} из 3. Укажи вручную: ${missing.map(key=>names[key]).join(', ')}.`;
        await preview();
      }catch(reason){if(current(scope)&&ticket===detectionRevision)$('[data-detection]').textContent='Не удалось определить места. Выбери поле и нажми на макет или задай координаты вручную.';}
      finally{if(current(scope)&&ticket===detectionRevision){detectionJob=null;detecting=false;$('[data-cancel-detect]').hidden=true;lock(false);}}
    }
    async function saveTemplate() {
      if (busy || viewing || intent || !template || !writesAllowed()) return;
      const scope = capture(); lock(true); clearError();
      try {
        // Preserve the old version for previously issued certificates.
        draftTemplate(); const next = { ...structuredClone(template) }; delete next.saved;
        const data = await repository.saveTemplate(scope.org, next);
        if (!current(scope)) return;
        if (data.organization_id !== scope.org) throw new Error('stale_session');
        if (!workspace.templates.some(t=>t.id===next.id)) workspace.templates.push({ ...next, saved:true });
        selectOptions($('[data-template]'), workspace.templates, t => t.name);
        $('[data-template]').value = next.id; template = { ...next, saved:true }; message('Макет сохранён.');
      } catch (reason) { if (current(scope)) fail(reason); }
      finally { if (current(scope)) lock(false); }
    }
    const intentKey = () => `minuta_certificate_intent:${options.getCurrentUser?.()?.id || 'demo'}:${organization?.id}`;
    function persistDispatchIntent() {
      const next={...intent,may_have_dispatched:true},serialized=JSON.stringify(next);
      try {
        localStorage.setItem(intentKey(),serialized);
        if(localStorage.getItem(intentKey())!==serialized)throw new Error('storage_failed');
      }catch{throw new Error('storage_failed')}
      intent=next;
    }
    async function issue(event) {
      event.preventDefault(); if (busy || viewing || draftIntent || !writesAllowed()) return;
      const scope = capture(); clearError();
      // Legacy pending requests may already have committed. An authorization denial cannot disprove that.
      let previouslyDispatched=true, ownsLock=false;
      try {
        await preview(); if (!current(scope) || busy || viewing || !record) return;
        if (!template.saved) throw new Error('template_not_saved');
        if (record.font_family !== 'Times New Roman' && !template.font_files?.[record.font_family]) throw new Error('font_missing');
        const value = structuredClone(record), saved = JSON.stringify(value);
        if (intent && intent.snapshot !== saved) throw new Error('certificate_request_conflict');
        previouslyDispatched=Boolean(intent&&intent.may_have_dispatched!==false);
        if (!intent) intent = { id:crypto.randomUUID(), snapshot:saved,may_have_dispatched:false };
        persistDispatchIntent();
        lock(true); ownsLock=true;const data = await repository.issue(scope.org, value, intent.id);
        if (!current(scope)) return;
        const actual=data.record;
        if (data.organization_id !== scope.org || !actual || typeof actual.number!=='string' || !actual.number || actual.number.length>40
          || (value.number_mode==='auto'?!/^[0-9]+$/.test(actual.number):actual.number!==value.number)
          || Object.keys(value).some(key=>key!=='number'&&canonical(actual[key])!==canonical(value[key]))) throw new Error('stale_session');
        intent = null; try { localStorage.removeItem(intentKey()); } catch {}
        viewing = true; record=structuredClone(actual); activeDraft=null; $('[data-number]').value=actual.number;
        R.render($('[data-canvas]'),image,actual,actual.layout,actual.font_family);
        $('[data-canvas]').setAttribute('aria-label',`${actual.procedure}. Дата ${R.dateLabel(actual.issued_on)}. Номер ${actual.number}.`);
        message(`Сертификат № ${actual.number} сохранён в истории.`); await history(false);
        if(current(scope)&&options.onIssued){try{await options.onIssued(data.record,organization)}catch{if(current(scope))message(`Сертификат № ${actual.number} сохранён. Обнови карточку клиента, чтобы увидеть выдачу.`)}}
      } catch (reason) { if (current(scope)) {
        const detail=String(reason?.message||'');
        // Only a definite rejection of a previously undispatched request permits a new editable issue.
        if (!previouslyDispatched && /certificate_number_exists|certificate_number_exhausted|certificate_draft_conflict|certificate_benefit_already_linked|^invalid_certificate|certificate_template_not_found/.test(detail)) {
          intent=null; try { localStorage.removeItem(intentKey()); } catch {}
        }
        fail(reason);
      } }
      finally { if (ownsLock && current(scope)) lock(false); }
    }
    function filename(format) { return `certificate-${record.number.replace(/[^\p{L}\p{N}_-]/gu, '_')}.${format}`; }
    function canonical(value) { return JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.keys(value).sort().map(key=>[key,JSON.parse(canonical(value[key]))])):value); }
    function saveFile(blob,name) {
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; root.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    function printQuality() {
      if (!image) { $('[data-print-quality]').textContent=''; return; }
      const size=R.printSize($('[data-canvas]'),$('[data-paper]').value);
      $('[data-print-quality]').textContent=`Исходник: ${image.width} × ${image.height} пикселей · ${size.dpi} dpi на ${$('[data-paper]').value.toUpperCase()}. `+(size.dpi>=300?'Подходит для чёткой печати.':'Для чёткой печати желательно 300 dpi: выбери меньшую бумагу или загрузи макет большего разрешения.');
    }
    function printCertificate() {
      if (!canExport() || busy) return;
      // Open within the user gesture; use a lossless full-resolution PNG rather than the on-screen thumbnail.
      const popup=window.open('','_blank'); if(!popup)throw new Error('print_window_blocked');
      try {
        popup.opener=null;const canvas=$('[data-canvas]'),size=R.printSize(canvas,$('[data-paper]').value),doc=popup.document;
        doc.title=`Сертификат № ${record.number}`;const style=doc.createElement('style');
        style.textContent=`@page{size:${size.width}mm ${size.height}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff}body{display:flex;align-items:center;justify-content:center;width:${size.width}mm;height:${size.height}mm}img{display:block;width:${size.imageWidth}mm;height:${size.imageHeight}mm;max-width:100%;object-fit:contain}`;doc.head.append(style);
        const picture=doc.createElement('img');picture.alt='Подарочный сертификат';picture.onload=()=>{popup.focus();popup.print()};picture.src=canvas.toDataURL('image/png');doc.body.append(picture);
      } catch(reason) { popup.close();throw reason; }
    }
    async function download() {
      if (!canExport() || busy) return;
      const scope = capture(), format = $('[data-format]').value, name = filename(format); const blob = await R.exportBlob($('[data-canvas]'),format,$('[data-paper]').value); if (!current(scope)) return;
      saveFile(blob,name);
    }
    async function share() {
      if (!canExport() || busy) return;
      const scope = capture(), format = $('[data-format]').value, name = filename(format); const blob = await R.exportBlob($('[data-canvas]'),format,$('[data-paper]').value); if (!current(scope)) return;
      const file = new File([blob], name, {type:blob.type});
      if (navigator.canShare?.({files:[file]}) && navigator.share) { try { await navigator.share({files:[file], title:'Подарочный сертификат'}); } catch (reason) { if (reason?.name !== 'AbortError') fail(reason); } }
      else { saveFile(blob,name); message('Сертификат скачан. Его можно приложить к сообщению.'); }
    }
    let historyRevision = 0, cursor = null;
    function row(item) {
      const today = workspace.today, state = R.status(item, today, item.remind_days), article = document.createElement('article'); article.className = 'certificate-row';
      const main = document.createElement('div'); main.className = 'certificate-row-main'; const title = document.createElement('strong'); title.textContent = `№ ${item.number} · ${item.procedure}`;
      const dates = document.createElement('span'); dates.className = 'certificate-help'; dates.textContent = `Выдан ${R.dateLabel(item.issued_on)} · действует по ${R.dateLabel(item.expires_on)}`; main.append(title, dates);
      if(item.client_name){const client=document.createElement('span');client.className='certificate-help';client.textContent=`Клиент: ${item.client_name}`;main.append(client);}
      const badge = document.createElement('span'); badge.className = 'certificate-status certificate-status-' + state.code;
      badge.textContent = state.code === 'expired' ? 'Истёк' : state.code === 'expiring' ? state.days === 0 ? 'Истекает сегодня' : `Осталось ${state.days} ${R.plural(state.days,'день','дня','дней')}` : 'Действует';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Открыть'; button.addEventListener('click', () => openRecord(item)); article.append(main, badge, button); return article;
    }
    async function openRecord(item) {
      if (busy) return;
      const scope = capture(); clearError();
      try {
        const data = await repository.template(scope.org, item.template_id);
        if (!current(scope)) return;
        if (data.organization_id !== scope.org || !data.template) throw new Error('unavailable');
        const nextTemplate = { ...data.template, saved:true }, nextImage = await R.loadImage(nextTemplate.image_data);
        if (!current(scope)) return;
        if (!await ensureFont(item.font_family, nextTemplate.font_files?.[item.font_family])) throw new Error('font_missing');
        if (!current(scope)) return;
        template = nextTemplate; image = nextImage; activeDraft=null;
        R.render($('[data-canvas]'), image, item, item.layout, item.font_family); record = structuredClone(item); viewing = true;
        restoreContent(item); $('[data-date]').value=item.issued_on;
        $('[data-number]').value=item.number; $('[data-expiry]').value=item.expires_on; $('[data-remind]').value=item.remind_days; $('[data-font]').value=item.font_family;
        $('[data-number-mode]').value=item.number_mode==='auto'?'auto':'manual';
        clientSelection(item.client_phone?{phone:item.client_phone,name:item.client_name,account_id:item.client_account_id}:null);
        if(item.benefit_instrument_id){$('[data-benefit]').add(new Option('Привязанный учёт сеансов',item.benefit_instrument_id));$('[data-benefit]').value=item.benefit_instrument_id;$('[data-benefit-wrapper]').hidden=false;}
        fieldInputs(); lock(false);
        tab('create'); $('[data-canvas]').hidden = false; $('[data-empty]').hidden = true;
        $('[data-download]').disabled = false; $('[data-share]').disabled = false; $('[data-print]').disabled=false; printQuality(); message(`Просмотр выданного сертификата № ${item.number}.`);
        // An issued snapshot stays immutable. The explicit new action starts a separate issue.
      } catch (reason) { if (current(scope)) fail(reason); }
    }
    async function history(append) {
      if (!workspace) return;
      const scope = capture(), ticket = ++historyRevision, query = $('[data-search]').value.trim(), filter = $('[data-status]').value;
      try {
        const data = await repository.history(scope.org, query, filter, append ? cursor : null);
        if (!current(scope) || ticket !== historyRevision) return;
        if (data.organization_id !== scope.org || !Array.isArray(data.records)) throw new Error('unavailable');
        if (data.today) { R.day(data.today); workspace.today=data.today; }
        if (!append) $('[data-history]').replaceChildren(); data.records.forEach(item => $('[data-history]').append(row(item)));
        if (!$('[data-history]').children.length) { const p = document.createElement('p'); p.textContent = query || filter !== 'all' ? 'Сертификаты не найдены.' : 'Выданных сертификатов пока нет.'; $('[data-history]').append(p); }
        cursor = data.next_cursor || null; $('[data-more]').hidden = !cursor;
        $('[data-reminders]').hidden = !(data.expiring_count > 0);
        $('[data-reminders]').textContent = `Скоро истекают: ${data.expiring_count}. Открой фильтр «Скоро истекают», чтобы проверить сроки.`;
      } catch (reason) { if (current(scope) && ticket === historyRevision) fail(reason); }
    }
    const draftFields=['content-mode','custom-text','service','sessions','font','date','number','number-mode','expiry','remind','benefit','format','paper'];
    function draftBody() {
      return {form:Object.fromEntries(draftFields.map(key=>[key,$(`[data-${key}]`).value])),template:template?structuredClone(template):null,client:selectedClient?{phone:selectedClient.phone,name:selectedClient.name,account_id:selectedClient.account_id||null}:null,copy_validity:copyValidity?structuredClone(copyValidity):null};
    }
    async function saveDraft() {
      if (busy||viewing||intent||!writesAllowed()||!repository.saveDraft)return;
      const scope=capture(); clearError(); lock(true);
      try {
        if (!draftIntent) draftIntent={id:activeDraft?.id||crypto.randomUUID(),expected:activeDraft?.revision||null,revision:crypto.randomUUID(),body:draftBody()};
        const pending=draftIntent,data=await repository.saveDraft(scope.org,pending.id,pending.body,pending.expected,pending.revision);
        if (!current(scope))return;
        if(data.organization_id!==scope.org||data.id!==pending.id||data.revision!==pending.revision)throw new Error('stale_session');
        activeDraft={id:data.id,revision:data.revision};draftIntent=null;
        message('Черновик сохранён. Продолжить можно во вкладке «Черновики».');
        await drafts(false);
      } catch(reason) {if(current(scope)){
        if(/certificate_draft_conflict|certificate_draft_unavailable|^invalid_certificate/.test(String(reason?.message||'')))draftIntent=null;
        fail(reason);
      }} finally {if(current(scope))lock(false);}
    }
    async function drafts(append) {
      if(!workspace||!repository.drafts)return;
      const scope=capture(),ticket=++draftsRevision;
      try {
        const data=await repository.drafts(scope.org,append?draftsCursor:null);
        if(!current(scope)||ticket!==draftsRevision)return;
        if(data.organization_id!==scope.org||!Array.isArray(data.drafts))throw new Error('unavailable');
        if(!append)$('[data-drafts]').replaceChildren();
        for(const item of data.drafts){
          const article=document.createElement('article');article.className='certificate-row';
          const main=document.createElement('div');main.className='certificate-row-main';
          const title=document.createElement('strong');title.textContent=item.content_mode==='custom'?item.text||'Свой текст (не заполнен)':workspace.services.find(s=>s.id===item.service_id)?.name||'Услуга не выбрана или недоступна';
          const detail=document.createElement('span');detail.className='certificate-help';detail.textContent=`${item.template_name||'Без макета'} · сохранён ${new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.updated_at))}`;
          main.append(title,detail);const button=document.createElement('button');button.type='button';button.textContent='Продолжить';button.addEventListener('click',()=>openDraft(item.id));article.append(main,button);$('[data-drafts]').append(article);
        }
        if(!$('[data-drafts]').children.length){const p=document.createElement('p');p.textContent='Сохранённых черновиков пока нет.';$('[data-drafts]').append(p);}
        draftsCursor=data.next_cursor||null;$('[data-drafts-more]').hidden=!draftsCursor;
      }catch(reason){if(current(scope)&&ticket===draftsRevision)fail(reason);}
    }
    async function openDraft(id) {
      if(busy||intent||draftIntent||!repository.draft)return;
      const scope=capture();clearError();lock(true);cancelDetection();++clientRevision;
      try {
        const data=await repository.draft(scope.org,id);
        if(!current(scope))return;
        if(data.organization_id!==scope.org||data.id!==id||!data.revision||!data.body?.form)throw new Error('unavailable');
        const body=data.body,form=body.form,nextTemplate=body.template?structuredClone(body.template):null;
        const nextImage=nextTemplate?await R.loadImage(nextTemplate.image_data):null;
        if(!current(scope))return;
        if(nextTemplate?.saved){
          const stored=await repository.template(scope.org,nextTemplate.id);if(!current(scope))return;
          const candidate=structuredClone(nextTemplate);delete candidate.saved;
          if(stored.organization_id!==scope.org||canonical(candidate)!==canonical(stored.template))nextTemplate.saved=false;
        }
        let client=body.client,clientData=null,unavailableClient=false;
        if(client&&repository.clientOptions){
          try{clientData=await repository.clientOptions(scope.org,client.phone);if(clientData.organization_id!==scope.org||clientData.client_phone!==client.phone)throw new Error('invalid_certificate_client');}
          catch(reason){if(!String(reason?.message||'').includes('invalid_certificate_client'))throw reason;client=null;unavailableClient=true;}
          if(!current(scope))return;
        }
        template=nextTemplate;image=nextImage;viewing=false;record=null;activeDraft={id:data.id,revision:data.revision};
        selectOptions($('[data-service]'),workspace.services,s=>s.name);
        if(form.service&&!workspace.services.some(s=>s.id===form.service)){const option=new Option('Сохранённая услуга недоступна',form.service);option.disabled=true;$('[data-service]').add(option);}
        for(const key of draftFields)if(typeof form[key]==='string')$(`[data-${key}]`).value=form[key];
        if(!['auto','manual'].includes($('[data-number-mode]').value))$('[data-number-mode]').value='auto';
        if(automaticNumber())$('[data-number]').value=workspace.next_number||'1';
        clientSelection(client);
        if(clientData){clientChoices=[client];client.account_id=clientData.client_account_id||null;selectedClient=client;client.instruments=clientData.instruments||[];benefitOptions();$('[data-benefit]').value=form.benefit||'';}
        if(nextTemplate){if(!workspace.templates.some(t=>t.id===nextTemplate.id))$('[data-template]').add(new Option(nextTemplate.name,nextTemplate.id));$('[data-template]').value=nextTemplate.id;fieldInputs();}
        copyValidity=body.copy_validity||null;
        $('[data-download]').textContent='Скачать '+$('[data-format]').selectedOptions[0].textContent;
        tab('create');contentMode();numbering();await preview();
        if(!current(scope))return;
        message(unavailableClient?'Черновик открыт. Клиент недоступен: выбери клиента заново.':'Черновик открыт. Изменения сохраняются кнопкой «Сохранить черновик».');
        if(!image){$('[data-canvas]').hidden=true;$('[data-empty]').hidden=false;}
      }catch(reason){if(current(scope))fail(reason);}finally{if(current(scope))lock(false);}
    }
    async function nextNumber() {
      if(!automaticNumber()||!workspace||intent)return;
      const scope=capture(),data=await repository.workspace(scope.org);
      if(!current(scope)||!automaticNumber()||intent)return;
      if(data.organization_id!==scope.org||!data.next_number)throw new Error('unavailable');
      workspace.next_number=data.next_number;$('[data-number]').value=data.next_number;
    }
    function tab(name) {
      root.querySelectorAll('[data-panel]').forEach(node => { node.hidden = node.dataset.panel !== name; });
      root.querySelectorAll('[data-tab]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.tab === name)));
      if (name === 'history') history(false);
      if (name === 'drafts') drafts(false);
    }
    root.querySelectorAll('[data-tab]').forEach(node => node.addEventListener('click', () => tab(node.dataset.tab)));
    $('[data-template]').addEventListener('change', () => selectTemplate($('[data-template]').value)); $('[data-image]').addEventListener('change', uploadImage);
    $('[data-save-template]').addEventListener('click', saveTemplate); $('[data-field]').addEventListener('change', fieldInputs);
    $('[data-save-draft]').addEventListener('click',saveDraft);
    $('[data-drafts-more]').addEventListener('click',()=>drafts(true));
    $('[data-fresh-draft]').addEventListener('click',()=>{if(busy||intent||draftIntent)return;activeDraft=null;message('Начат новый черновик с текущими данными. Предыдущий сохранён во вкладке «Черновики».');lock(false);});
    $('[data-number-mode]').addEventListener('change',async()=>{if(busy||intent||draftIntent||viewing)return;numbering();if(automaticNumber())$('[data-number]').value=workspace?.next_number||'1';else $('[data-number]').value='';await preview();});
    $('[data-detect]').addEventListener('click',detectLayout);
    $('[data-cancel-detect]').addEventListener('click',()=>{cancelDetection();$('[data-detection]').textContent='Выбери поле и нажми на макет или задай координаты вручную.';preview();});
    for (const selector of ['[data-x]','[data-y]','[data-width]','[data-size]']) $(selector).addEventListener('input', () => {
      if (!template || busy || viewing || intent) return;
      try { const field = R.normalizedField({ ...template.layout[$('[data-field]').value], x:Number($('[data-x]').value)/100, y:Number($('[data-y]').value)/100, width:Number($('[data-width]').value)/100, size:Number($('[data-size]').value)/100 });
        draftTemplate(); template.layout[$('[data-field]').value] = field; template.saved = false; $('[data-issue]').disabled = true; preview();
      } catch (reason) { fail(reason); }
    });
    $('[data-canvas]').addEventListener('click', event => {
      if (!template || busy || viewing || intent || !$('[data-template-settings]').open) return;
      const rect = event.currentTarget.getBoundingClientRect(), key = $('[data-field]').value;
      const x = Math.min(.97, Math.max(.03, (event.clientX - rect.left)/rect.width));
      const y = Math.min(.97, Math.max(.03, (event.clientY - rect.top)/rect.height));
      draftTemplate(); template.layout[key] = R.normalizedField({ ...template.layout[key], x, y }); template.saved = false; $('[data-issue]').disabled = true; fieldInputs(); preview();
    });
    $('[data-content-mode]').addEventListener('change',()=>{contentMode();benefitOptions();preview();});
    $('[data-format]').addEventListener('change',()=>{$('[data-download]').textContent='Скачать '+$('[data-format]').selectedOptions[0].textContent;});
    $('[data-paper]').addEventListener('change',printQuality);
    $('[data-print]').addEventListener('click',()=>{try{printCertificate()}catch(reason){fail(reason)}});
    for (const selector of ['[data-custom-text]','[data-service]','[data-sessions]','[data-date]','[data-number]','[data-expiry]','[data-remind]','[data-font]']) $(selector).addEventListener('input', () => {
      if (busy || draftIntent) return;
      if (selector === '[data-font]') $('[data-font-file]').value = '';
      if(selector==='[data-service]'||selector==='[data-sessions]')benefitOptions();
      if (selector === '[data-date]' && $('[data-date]').value) { try { $('[data-expiry]').value = copyValidity?copiedExpiry($('[data-date]').value,copyValidity):R.addMonths($('[data-date]').value, 6); } catch {} }
      if(selector==='[data-expiry]'&&copyValidity){try{copyValidity=validity($('[data-date]').value,$('[data-expiry]').value)}catch{}}
      preview();
    });
    $('[data-font-file]').addEventListener('change', async () => {
      if (!template || busy) return;
      const scope = capture(), family = $('[data-font]').value, file = $('[data-font-file]').files[0]; if (!file) return;
      try {
        if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error('font_missing');
        const data = await readFile(file, 2 * 1024 * 1024, 'font_too_large'); const available = await ensureFont(family, data);
        if (!current(scope) || !available) return;
        draftTemplate(); template.font_files ||= {}; template.font_files[family] = data; template.saved = false; $('[data-issue]').disabled = true;
        $('[data-template-settings]').open = true; message('Шрифт подключён. Сохрани макет, чтобы использовать его на других устройствах.'); await preview();
      } catch (reason) { if (current(scope)) fail(reason); }
    });
    $('[data-form]').addEventListener('submit', issue); $('[data-download]').addEventListener('click', () => download().catch(fail)); $('[data-share]').addEventListener('click', () => share().catch(fail));
    $('[data-new]').addEventListener('click', async () => {
      if (busy || intent || draftIntent) return;
      const scope=capture();
      viewing=false; activeDraft=null; selectOptions($('[data-service]'),workspace.services,s=>s.name); $('[data-sessions]').value='1'; $('[data-content-mode]').value='catalog'; $('[data-custom-text]').value='';
      clientSelection(null);++clientRevision;copyValidity=null;
      $('[data-date]').value=workspace.today; $('[data-expiry]').value=R.addMonths(workspace.today,6); $('[data-number]').value='';
      $('[data-number-mode]').value=options.defaultNumber?'manual':'auto';lock(true);
      try{await nextNumber();if(current(scope))message(automaticNumber()?'Номер назначится автоматически при выдаче.':'Введи номер нового сертификата.');}catch(reason){if(current(scope))fail(reason);}finally{if(current(scope))lock(false);}if(current(scope))await preview();
    });
    function validity(issued,expires){
      for(let months=1;months<=120;months++)if(R.addMonths(issued,months)===expires)return{months};
      return{days:R.day(expires)-R.day(issued)};
    }
    function copiedExpiry(issued,period){return period.months?R.addMonths(issued,period.months):new Date(R.day(issued)+period.days).toISOString().slice(0,10)}
    $('[data-similar]').addEventListener('click',async()=>{
      if(busy||intent||!viewing||!record)return;
      const scope=capture();
      const source=structuredClone(record);viewing=false;record=null;activeDraft=null;++clientRevision;clientSelection(null);
      template.layout=structuredClone(source.layout);fieldInputs();
      selectOptions($('[data-service]'),workspace.services,s=>s.name);$('[data-service]').value=source.service_id;
      $('[data-sessions]').value=source.sessions;$('[data-font]').value=source.font_family;$('[data-remind]').value=source.remind_days;
      $('[data-content-mode]').value=source.content_mode==='custom'?'custom':'catalog';$('[data-custom-text]').value=source.content_mode==='custom'?source.procedure:'';
      $('[data-date]').value=workspace.today;$('[data-number]').value='';
      copyValidity=validity(source.issued_on,source.expires_on);$('[data-expiry]').value=copiedExpiry(workspace.today,copyValidity);
      message(source.content_mode==='custom'?'Оформление и текст скопированы. Укажи новый номер и при необходимости выбери клиента.':$('[data-service]').value?'Оформление и сеансы скопированы. Укажи новый номер и при необходимости выбери клиента.':'Услуга из старой выдачи недоступна. Выбери актуальную услугу и новый номер.');
      $('[data-number-mode]').value=options.defaultNumber?'manual':'auto';lock(true);
      try{await nextNumber();if(current(scope)&&automaticNumber())message('Оформление скопировано. Номер назначится автоматически при выдаче.');}catch(reason){if(current(scope))fail(reason);}finally{if(current(scope))lock(false);}if(current(scope)){await preview();$('[data-number]').focus();}
    });
    let clientTimer;$('[data-client-query]').addEventListener('input',()=>{clearTimeout(clientTimer);clientTimer=setTimeout(searchClients,200)});
    $('[data-client-settings]').addEventListener('toggle',()=>{if($('[data-client-settings]').open)searchClients()});
    $('[data-client]').addEventListener('change',chooseClient);$('[data-benefit]').addEventListener('change',preview);
    let searchTimer; $('[data-search]').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => history(false), 180); });
    $('[data-status]').addEventListener('change', () => history(false)); $('[data-more]').addEventListener('click', () => history(true));
    async function setOrganization(value) {
      cancelDetection();$('[data-detection]').textContent='';
      ++revision; ++renderRevision; ++historyRevision; ++draftsRevision; activeDraft=null;draftIntent=null;draftsCursor=null;$('[data-drafts]').replaceChildren();organization = value || null; workspace = null; template = null; image = null; record = null; intent = null;
      viewing=false; for (const face of loadedFonts.values()) document.fonts.delete(face); loadedFonts.clear(); loadingFonts.clear();
      ++clientRevision;clientChoices=[];clientSelection(null);copyValidity=null;clearTimeout(clientTimer);$('[data-client-settings]').open=false;
      $('[data-history]').replaceChildren(); $('[data-canvas]').hidden = true; $('[data-empty]').hidden = false; $('[data-message]').textContent = ''; $('[data-print-quality]').textContent=''; clearError();
      $('[data-form]').reset(); $('[data-download]').textContent='Скачать PNG'; root.hidden = !organization;
      $('[data-number-mode]').value=options.defaultNumber?'manual':'auto';
      if (!organization) { lock(false); return; }
      try { const stored = localStorage.getItem(intentKey()); if (stored) intent = JSON.parse(stored); } catch { fail(new Error('storage_failed')); return; }
      await loadWorkspace();
    }
    return { bind() {}, setOrganization, reload:loadWorkspace, openIssued:openRecord };
  }
  function createRepository(db) {
    async function rpc(name, params) { const {data,error} = await db.rpc(name,params); if (error) throw error; return data; }
    return {
      workspace: org => rpc('get_minuta_certificate_design_workspace',{p_organization:org}),
      saveTemplate: (org,value) => rpc('save_minuta_certificate_design',{p_organization:org,p_template:value}),
      saveDraft:(org,id,body,expected,revision)=>rpc('save_minuta_certificate_draft',{p_organization:org,p_id:id,p_body:body,p_expected_revision:expected,p_revision:revision}),
      drafts:(org,cursor)=>rpc('get_minuta_certificate_drafts',{p_organization:org,p_cursor:cursor}),
      draft:(org,id)=>rpc('get_minuta_certificate_draft',{p_organization:org,p_id:id}),
      issue: (org,value,request) => rpc('record_minuta_certificate_issue',{p_organization:org,p_record:value,p_request_id:request}),
      history: (org,query,status,cursor) => rpc('get_minuta_certificate_issue_history',{p_organization:org,p_query:query,p_status:status,p_cursor:cursor}),
      template: (org,id) => rpc('get_minuta_certificate_design',{p_organization:org,p_template:id}),
      clients:(org,query)=>rpc('get_minuta_certificate_clients',{p_organization:org,p_query:query}),
      clientOptions:(org,phone)=>rpc('get_minuta_certificate_client_options',{p_organization:org,p_phone:phone}),
      clientRecords:(org,phone,cursor)=>rpc('get_minuta_client_certificates',{p_organization:org,p_phone:phone,p_cursor:cursor})
    };
  }
  window.MinutaCertificateDesigner = { createController, createRepository };
})();
