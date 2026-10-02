(function () {
  'use strict';
  function createController(options) {
    const root = options.root || options.$?.('#certificateDesignerPanel');
    if (!root) throw new Error('certificate_root_required');
    const R = window.MinutaCertificateRenderer;
    if (!R) throw new Error('certificate_renderer_required');
    const repository = options.repository || (options.db ? createRepository(options.db) : null);
    if (!repository) throw new Error('certificate_repository_required');
    let organization = null, revision = 0, busy = false, workspace = null;
    let template = null, image = null, record = null, intent = null, renderRevision = 0, viewing = false;
    const loadedFonts = new Map(), loadingFonts = new Map();
    const $ = selector => root.querySelector(selector);
    root.classList.add('certificate-designer');
    root.innerHTML = `<div class="certificate-heading"><h3>Подарочные сертификаты</h3><span data-certificate-demo hidden>Образец</span></div>
      <div class="certificate-tabs" role="tablist" aria-label="Сертификаты"><button type="button" role="tab" aria-selected="true" data-tab="create">Создать</button><button type="button" role="tab" aria-selected="false" data-tab="history">История</button></div>
      <p class="certificate-message" role="status" data-message></p><p class="certificate-error" role="alert" data-error hidden></p>
      <div data-panel="create"><div class="certificate-layout"><form class="certificate-form" data-form>
        <label>Макет<select data-template aria-label="Макет"></select></label>
        <details data-template-settings><summary>Загрузить и настроить макет</summary><div class="certificate-form">
          <label>Изображение макета<input type="file" accept="image/png,image/jpeg,image/webp" data-image></label>
          <label>Поле на макете<select data-field><option value="procedure">Процедура</option><option value="date">Дата выдачи</option><option value="number">Номер</option></select></label>
          <p class="certificate-help">Выбери поле и нажми на макет в месте для текста.</p>
          <div class="certificate-pair"><label>По горизонтали, %<input type="number" min="3" max="97" step=".1" data-x></label><label>По вертикали, %<input type="number" min="3" max="97" step=".1" data-y></label></div>
          <div class="certificate-pair"><label>Ширина поля, %<input type="number" min="5" max="94" step=".1" data-width></label><label>Размер шрифта, % высоты<input type="number" min=".5" max="10" step=".1" data-size></label></div>
          <div class="certificate-buttons"><button type="button" data-save-template>Сохранить макет</button></div></div></details>
        <label>Название массажа<select data-service required></select></label>
        <div class="certificate-pair"><label>Количество сеансов<input type="number" data-sessions min="1" max="1000" step="1" value="1" required></label><label>Шрифт<select data-font><option value="Times New Roman">Классический</option><option value="Gabriola">Gabriola</option><option value="History Pro 02">History Pro 02</option></select></label></div>
        <label data-font-upload hidden>Файл выбранного шрифта<input type="file" accept=".ttf,.otf,.woff,.woff2" data-font-file></label>
        <div class="certificate-pair"><label>Дата выдачи<input type="date" data-date required></label><label>Номер сертификата<input type="text" data-number maxlength="40" required></label></div>
        <div class="certificate-pair"><label>Действует по<input type="date" data-expiry required></label><label>Напомнить за, дней<input type="number" min="0" max="365" step="1" value="7" data-remind required></label></div>
        <div class="certificate-buttons"><button type="submit" class="primary" data-issue>Сохранить выдачу</button><button type="button" data-new hidden>Новый сертификат</button></div>
        <div class="certificate-buttons"><button type="button" data-download disabled>Скачать PNG</button><button type="button" data-share disabled>Поделиться</button></div>
        </form><figure class="certificate-preview"><div class="certificate-preview-empty" data-empty>Загрузи макет, чтобы увидеть сертификат</div><canvas data-canvas hidden role="img" aria-label="Предпросмотр подарочного сертификата"></canvas></figure></div></div>
      <div data-panel="history" hidden><p class="certificate-reminder" role="status" data-reminders hidden></p>
        <div class="certificate-history-controls"><input type="search" aria-label="Поиск сертификатов" placeholder="Номер или название массажа" data-search maxlength="180"><select aria-label="Срок действия" data-status><option value="all">Все сертификаты</option><option value="active">Действуют</option><option value="expiring">Скоро истекают</option><option value="expired">Истекли</option></select></div>
        <div data-history></div><div class="certificate-buttons"><button type="button" data-more hidden>Показать ещё</button></div></div>`;
    const errorMessages = {
      invalid_date:'Проверь дату.', invalid_procedure:'Выбери массаж и количество сеансов.', invalid_duration:'У выбранной услуги не указана длительность.',
      invalid_certificate:'Проверь номер и срок действия.', invalid_layout:'Проверь положение, ширину и размер поля.', invalid_image:'Выбери макет в PNG, JPEG или WebP размером до 8 МБ.',
      invalid_image_size:'Макет должен быть от 200 до 6000 пикселей по каждой стороне и не более 20 мегапикселей.', text_does_not_fit:'Текст не помещается. Увеличь ширину поля или уменьши шрифт.',
      certificate_number_exists:'Этот номер уже есть в истории. Выбери другой.', certificate_request_conflict:'Сохранённая выдача содержит другие данные. Проверь историю перед повтором.',
      font_missing:'Подключи файл выбранного шрифта, чтобы он одинаково выглядел на всех устройствах.', template_not_saved:'Сначала сохрани настройки макета.',
      unavailable:'Раздел ещё не подключён к сохранению в кабинете. Выдача не сохранена.', stale_session:'Контекст кабинета изменился. Открой раздел снова.',
      storage_failed:'Не удалось сохранить защиту от повторной выдачи. Попробуй снова.', image_too_large:'Макет должен быть не больше 8 МБ.', font_too_large:'Файл шрифта должен быть не больше 2 МБ.'
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
    function lock(value) {
      busy = value;
      $('[data-form]').querySelectorAll('input,select,button').forEach(node => { node.disabled = value || viewing || Boolean(intent); });
      $('[data-download]').disabled = value || !record;
      $('[data-share]').disabled = value || !record;
      $('[data-new]').disabled = value; $('[data-new]').hidden = !viewing; $('[data-issue]').hidden = viewing;
      $('[data-issue]').disabled = value || viewing || !workspace || !template?.saved;
      $('[data-issue]').textContent = intent ? 'Повторить сохранение' : 'Сохранить выдачу';
    }
    function readRecord() {
      // A retry replays the locked original request even if the live service catalog changed.
      if (intent) return JSON.parse(intent.snapshot);
      const service = workspace?.services?.find(item => String(item.id) === $('[data-service]').value);
      const sessions = Number($('[data-sessions]').value), remind = Number($('[data-remind]').value);
      if (!Number.isInteger(remind) || remind < 0 || remind > 365) throw new Error('invalid_certificate');
      if (!service) throw new Error('invalid_procedure');
      return { service_id:service.id, service_name:service.name, duration_minutes:Number(service.duration_minutes), sessions,
        procedure:R.procedureLabel(service.name, sessions, Number(service.duration_minutes)), issued_on:$('[data-date]').value,
        expires_on:$('[data-expiry]').value, number:$('[data-number]').value.trim(), remind_days:remind,
        font_family:$('[data-font]').value, template_id:template?.id, layout:structuredClone(template?.layout || R.fields) };
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
      const ticket = ++renderRevision; record = null; $('[data-download]').disabled = true; $('[data-share]').disabled = true;
      if (!image || !workspace) return;
      try {
        const value = readRecord();
        const available = await ensureFont(value.font_family);
        if (ticket !== renderRevision) return;
        $('[data-font-upload]').hidden = value.font_family === 'Times New Roman' || Boolean(template?.font_files?.[value.font_family]);
        if (!available) throw new Error('font_missing');
        clearError(); R.render($('[data-canvas]'), image, value, value.layout, value.font_family);
        $('[data-canvas]').hidden = false; $('[data-empty]').hidden = true; record = value;
        $('[data-canvas]').setAttribute('aria-label', `${value.procedure}. Дата ${R.dateLabel(value.issued_on)}. Номер ${value.number}.`);
        $('[data-download]').disabled = busy; $('[data-share]').disabled = busy;
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
        $('[data-date]').value ||= options.defaultDate || data.today; $('[data-expiry]').value ||= R.addMonths($('[data-date]').value, 6); $('[data-number]').value ||= options.defaultNumber || '';
        const pending = intent ? JSON.parse(intent.snapshot) : null;
        if (pending) {
          selectOptions($('[data-service]'), [{ id:pending.service_id, name:pending.service_name }], s=>s.name);
          $('[data-service]').value = pending.service_id; $('[data-sessions]').value = pending.sessions;
          $('[data-date]').value = pending.issued_on; $('[data-expiry]').value = pending.expires_on;
          $('[data-number]').value = pending.number; $('[data-remind]').value = pending.remind_days; $('[data-font]').value = pending.font_family;
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
      const scope = capture(); const file = $('[data-image]').files[0]; if (!file) return;
      try {
        const data = await readFile(file, 8 * 1024 * 1024, 'image_too_large'); const loaded = await R.loadImage(data);
        if (!current(scope)) return;
        template = { id:crypto.randomUUID(), name:file.name.replace(/\.[^.]+$/, '').slice(0, 100), image_data:data, layout:structuredClone(R.fields), font_files:{}, saved:false };
        image = loaded; fieldInputs(); $('[data-issue]').disabled = true; message('Укажи места для текста и сохрани макет.'); await preview();
      } catch (reason) { if (current(scope)) fail(reason); }
    }
    async function saveTemplate() {
      if (busy || !template || !writesAllowed()) return;
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
    async function issue(event) {
      event.preventDefault(); if (busy || !writesAllowed()) return;
      const scope = capture(); clearError();
      try {
        await preview(); if (!current(scope) || !record) return;
        if (!template.saved) throw new Error('template_not_saved');
        if (record.font_family !== 'Times New Roman' && !template.font_files?.[record.font_family]) throw new Error('font_missing');
        const value = structuredClone(record), saved = JSON.stringify(value);
        if (intent && intent.snapshot !== saved) throw new Error('certificate_request_conflict');
        if (!intent) { intent = { id:crypto.randomUUID(), snapshot:saved }; try { localStorage.setItem(intentKey(), JSON.stringify(intent)); } catch { intent = null; throw new Error('storage_failed'); } }
        lock(true); const data = await repository.issue(scope.org, value, intent.id);
        if (!current(scope)) return;
        if (data.organization_id !== scope.org || data.record?.number !== value.number) throw new Error('stale_session');
        intent = null; try { localStorage.removeItem(intentKey()); } catch {}
        viewing = true; message(`Сертификат № ${value.number} сохранён в истории.`); await history(false);
      } catch (reason) { if (current(scope)) {
        const detail=String(reason?.message||'');
        if (/certificate_number_exists|^invalid_certificate|certificate_template_not_found|certificate_access_denied|authentication_required/.test(detail)) {
          intent=null; try { localStorage.removeItem(intentKey()); } catch {}
        }
        fail(reason);
      } }
      finally { if (current(scope)) lock(false); }
    }
    function fileBlob() { return new Promise((resolve, reject) => $('[data-canvas]').toBlob(blob => blob ? resolve(blob) : reject(new Error('invalid_image')), 'image/png')); }
    function filename() { return `certificate-${record.number.replace(/[^\p{L}\p{N}_-]/gu, '_')}.png`; }
    async function download() {
      if (!record || busy) return;
      const scope = capture(), name = filename(); const blob = await fileBlob(); if (!current(scope)) return;
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; root.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    async function share() {
      if (!record || busy) return;
      const scope = capture(), name = filename(); const blob = await fileBlob(); if (!current(scope)) return;
      const file = new File([blob], name, {type:'image/png'});
      if (navigator.canShare?.({files:[file]}) && navigator.share) { try { await navigator.share({files:[file], title:'Подарочный сертификат'}); } catch (reason) { if (reason?.name !== 'AbortError') fail(reason); } }
      else { await download(); message('Сертификат скачан. Его можно приложить к сообщению.'); }
    }
    let historyRevision = 0, cursor = null;
    function row(item) {
      const today = workspace.today, state = R.status(item, today, item.remind_days), article = document.createElement('article'); article.className = 'certificate-row';
      const main = document.createElement('div'); main.className = 'certificate-row-main'; const title = document.createElement('strong'); title.textContent = `№ ${item.number} · ${item.procedure}`;
      const dates = document.createElement('span'); dates.className = 'certificate-help'; dates.textContent = `Выдан ${R.dateLabel(item.issued_on)} · действует по ${R.dateLabel(item.expires_on)}`; main.append(title, dates);
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
        template = nextTemplate; image = nextImage;
        R.render($('[data-canvas]'), image, item, item.layout, item.font_family); record = structuredClone(item); viewing = true;
        const service = workspace.services.find(s=>s.id===item.service_id);
        selectOptions($('[data-service]'), service ? workspace.services : [{id:item.service_id,name:item.service_name}], s=>s.name);
        $('[data-service]').value=item.service_id; $('[data-sessions]').value=item.sessions; $('[data-date]').value=item.issued_on;
        $('[data-number]').value=item.number; $('[data-expiry]').value=item.expires_on; $('[data-remind]').value=item.remind_days; $('[data-font]').value=item.font_family;
        fieldInputs(); lock(false);
        tab('create'); $('[data-canvas]').hidden = false; $('[data-empty]').hidden = true;
        $('[data-download]').disabled = false; $('[data-share]').disabled = false; message(`Просмотр выданного сертификата № ${item.number}.`);
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
    function tab(name) {
      root.querySelectorAll('[data-panel]').forEach(node => { node.hidden = node.dataset.panel !== name; });
      root.querySelectorAll('[data-tab]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.tab === name)));
      if (name === 'history') history(false);
    }
    root.querySelectorAll('[data-tab]').forEach(node => node.addEventListener('click', () => tab(node.dataset.tab)));
    $('[data-template]').addEventListener('change', () => selectTemplate($('[data-template]').value)); $('[data-image]').addEventListener('change', uploadImage);
    $('[data-save-template]').addEventListener('click', saveTemplate); $('[data-field]').addEventListener('change', fieldInputs);
    for (const selector of ['[data-x]','[data-y]','[data-width]','[data-size]']) $(selector).addEventListener('input', () => {
      if (!template || busy) return;
      try { const field = R.normalizedField({ ...template.layout[$('[data-field]').value], x:Number($('[data-x]').value)/100, y:Number($('[data-y]').value)/100, width:Number($('[data-width]').value)/100, size:Number($('[data-size]').value)/100 });
        draftTemplate(); template.layout[$('[data-field]').value] = field; template.saved = false; $('[data-issue]').disabled = true; preview();
      } catch (reason) { fail(reason); }
    });
    $('[data-canvas]').addEventListener('click', event => {
      if (!template || busy || !$('[data-template-settings]').open) return;
      const rect = event.currentTarget.getBoundingClientRect(), key = $('[data-field]').value;
      const x = Math.min(.97, Math.max(.03, (event.clientX - rect.left)/rect.width));
      const y = Math.min(.97, Math.max(.03, (event.clientY - rect.top)/rect.height));
      draftTemplate(); template.layout[key] = R.normalizedField({ ...template.layout[key], x, y }); template.saved = false; $('[data-issue]').disabled = true; fieldInputs(); preview();
    });
    for (const selector of ['[data-service]','[data-sessions]','[data-date]','[data-number]','[data-expiry]','[data-remind]','[data-font]']) $(selector).addEventListener('input', () => {
      if (busy) return;
      if (selector === '[data-font]') $('[data-font-file]').value = '';
      if (selector === '[data-date]' && $('[data-date]').value) { try { $('[data-expiry]').value = R.addMonths($('[data-date]').value, 6); } catch {} } preview();
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
      if (busy || intent) return;
      viewing=false; selectOptions($('[data-service]'),workspace.services,s=>s.name); $('[data-sessions]').value='1';
      $('[data-date]').value=workspace.today; $('[data-expiry]').value=R.addMonths(workspace.today,6); $('[data-number]').value='';
      message('Введи номер нового сертификата.'); lock(false); await preview();
    });
    let searchTimer; $('[data-search]').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => history(false), 180); });
    $('[data-status]').addEventListener('change', () => history(false)); $('[data-more]').addEventListener('click', () => history(true));
    async function setOrganization(value) {
      ++revision; ++renderRevision; ++historyRevision; organization = value || null; workspace = null; template = null; image = null; record = null; intent = null;
      viewing=false; for (const face of loadedFonts.values()) document.fonts.delete(face); loadedFonts.clear(); loadingFonts.clear();
      $('[data-history]').replaceChildren(); $('[data-canvas]').hidden = true; $('[data-empty]').hidden = false; $('[data-message]').textContent = ''; clearError();
      $('[data-form]').reset(); root.hidden = !organization;
      if (!organization) { lock(false); return; }
      try { const stored = localStorage.getItem(intentKey()); if (stored) intent = JSON.parse(stored); } catch { fail(new Error('storage_failed')); return; }
      await loadWorkspace();
    }
    return { bind() {}, setOrganization, reload:loadWorkspace };
  }
  function createRepository(db) {
    async function rpc(name, params) { const {data,error} = await db.rpc(name,params); if (error) throw error; return data; }
    return {
      workspace: org => rpc('get_minuta_certificate_design_workspace',{p_organization:org}),
      saveTemplate: (org,value) => rpc('save_minuta_certificate_design',{p_organization:org,p_template:value}),
      issue: (org,value,request) => rpc('record_minuta_certificate_issue',{p_organization:org,p_record:value,p_request_id:request}),
      history: (org,query,status,cursor) => rpc('get_minuta_certificate_issue_history',{p_organization:org,p_query:query,p_status:status,p_cursor:cursor}),
      template: (org,id) => rpc('get_minuta_certificate_design',{p_organization:org,p_template:id})
    };
  }
  window.MinutaCertificateDesigner = { createController, createRepository };
})();
