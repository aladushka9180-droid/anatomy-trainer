(function serviceOffersModule(global) {
  'use strict';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const money = new Intl.NumberFormat('ru-RU', { maximumFractionDigits:2 });
  const isEligibleService = service => service?.active === true && Number(service.duration_minutes) > 1
    && Number.isFinite(Number(service.price_rub)) && Number(service.price_rub) >= 0;
  function previewPrice(price, kind, value) {
    return Math.round(Math.max(0, kind === 'percent' ? price * (100 - value) / 100 : kind === 'rubles' ? price - value : price));
  }
  function validateOffer(offer, services, existing = []) {
    if (offer.enabled === false && offer.id && existing.some(row => row.id === offer.id && row.revision === offer.revision)) return '';
    const candidates = services.filter(isEligibleService);
    const addon = candidates.find(service => service.id === offer.addon_service_id);
    if (!addon || !Array.isArray(offer.primary_service_ids) || !offer.primary_service_ids.length || offer.primary_service_ids.length > 50
      || new Set(offer.primary_service_ids).size !== offer.primary_service_ids.length
      || offer.primary_service_ids.some(id => !UUID.test(id) || id === offer.addon_service_id || !candidates.some(service => service.id === id))) return 'Выберите основную услугу и доступную дополнительную услугу.';
    if (typeof offer.benefit_text !== 'string' || !offer.benefit_text.trim() || offer.benefit_text.length > 160) return 'Кратко опишите пользу: до 160 символов.';
    if (!['none','percent','rubles'].includes(offer.discount_kind) || !Number.isFinite(offer.discount_value)
      || offer.discount_value < 0 || (offer.discount_kind === 'none' && offer.discount_value !== 0)
      || (offer.discount_kind === 'percent' && offer.discount_value > 100)
      || (offer.discount_kind === 'rubles' && (!Number.isInteger(offer.discount_value) || offer.discount_value > Number(addon.price_rub)))) return 'Проверьте скидку: сумма должна быть в целых рублях и не может превышать цену дополнительной услуги.';
    if (!Number.isInteger(offer.additional_minutes) || offer.additional_minutes < 0 || offer.additional_minutes > 480) return 'Дополнительное время должно быть от 0 до 480 минут.';
    if (typeof offer.enabled !== 'boolean' || !Number.isInteger(offer.revision) || offer.revision < 0
      || !Number.isInteger(offer.priority) || offer.priority < 0 || offer.priority > 99
      || (offer.id !== null && !UUID.test(offer.id))) return 'Предложение устарело. Загрузите настройки заново.';
    if (offer.enabled && offer.primary_service_ids.some(id => existing.filter(row => row.id !== offer.id && row.enabled && row.primary_service_ids?.includes(id)).length >= 3)) return 'Для одной основной услуги можно включить не больше трёх предложений.';
    if (offer.enabled && existing.some(row => row.id !== offer.id && row.enabled && row.addon_service_id === offer.addon_service_id
      && row.primary_service_ids?.some(id => offer.primary_service_ids.includes(id)))) return 'Эта дополнительная услуга уже предлагается вместе с выбранной основной.';
    return '';
  }
  function validSavedRow(row) {
    return row && UUID.test(row.id) && Array.isArray(row.primary_service_ids) && row.primary_service_ids.length
      && row.primary_service_ids.every(id => UUID.test(id)) && UUID.test(row.addon_service_id)
      && typeof row.benefit_text === 'string' && row.benefit_text.length <= 160
      && ['none','percent','rubles'].includes(row.discount_kind) && Number.isFinite(Number(row.discount_value))
      && Number.isInteger(row.additional_minutes) && row.additional_minutes >= 0 && row.additional_minutes <= 480
      && typeof row.enabled === 'boolean' && Number.isInteger(row.revision) && row.revision >= 1
      && Number.isInteger(row.priority) && row.priority >= 0 && row.priority <= 99;
  }
  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, getServices } = options;
    const panel = document.querySelector('[data-provider-panel="services"]');
    if (!panel) return { load:async () => false, reset(){}, setServices(){}, open:async () => false };
    const entry = document.createElement('button');
    entry.type = 'button'; entry.className = 'secondary-button compact-button service-offers-entry';
    entry.textContent = 'Дополнительные предложения'; entry.dataset.openServiceOffers = '';
    panel.querySelector('.view-title-actions')?.append(entry);
    const dialog = document.createElement('dialog');
    dialog.id = 'serviceOffersDialog'; dialog.className = 'service-offers-dialog';
    dialog.setAttribute('aria-labelledby', 'serviceOffersTitle');
    dialog.innerHTML = `<div class="service-offers-header"><div><small>Услуги</small><h2 id="serviceOffersTitle">Дополнительные предложения</h2></div><button class="service-offers-close" type="button" aria-label="Закрыть">×</button></div>
      <div class="service-offers-body"><p class="service-offers-intro">Предложите клиенту дополнить визит у вас. Скидка действует только вместе с основной услугой.</p>
      <p class="service-offers-status" id="serviceOffersStatus" role="status" aria-live="polite"></p>
      <div class="service-offers-list" id="serviceOffersList"></div><div class="service-offers-list-actions"><button class="primary service-offers-add" type="button" data-add-service-offer>Добавить предложение</button><button class="secondary-button" type="button" data-reload-service-offers>Обновить список</button></div>
      <form id="serviceOfferForm" hidden novalidate></form>
      <p class="service-offers-note">Поминутные услуги пока не поддерживаются. Для предложения нужна фиксированная цена. Обычные цены в каталоге не меняются.</p></div>`;
    document.body.append(dialog);
    const query = selector => dialog.querySelector(selector);
    const form = query('#serviceOfferForm');
    const status = query('#serviceOffersStatus');
    const list = query('#serviceOffersList');
    const add = query('[data-add-service-offer]');
    let offers = [], loadedContext = '', loadRequest = null, loadRevision = 0, saveRevision = 0, editing = null, saving = false;
    const context = () => `${getCurrentUser()?.id || ''}:${getSessionGeneration()}`;
    const current = (actor, generation, revision, isSave = false) => sessionIsCurrent(actor, generation)
      && revision === (isSave ? saveRevision : loadRevision);
    const services = () => (getServices() || []).filter(service => !service.performer_id || service.performer_id === getCurrentUser()?.id);
    const eligible = () => services().filter(isEligibleService);
    function message(text, failed = false) { status.textContent = text; status.dataset.error = String(failed); }
    function errorText(error) {
      const text = `${error?.code || ''}:${error?.message || ''}`;
      if (/PGRST202|42883/.test(text)) return 'Дополнительные предложения пока недоступны на сервере. Повторите после обновления.';
      if (/42501|PGRST301|unauthorized|permission/i.test(text)) return 'Нет доступа к предложениям. Проверьте вход в кабинет и повторите.';
      if (/revision|conflict|40001|stale/i.test(text)) return 'Предложение изменилось в другом окне. Обновите список и проверьте изменения перед сохранением.';
      if (/limit|maximum|three|too_many/i.test(text)) return 'Для одной основной услуги можно включить не больше трёх предложений.';
      return 'Не удалось сохранить предложение. Проверьте данные и подключение, затем повторите.';
    }
    function renderList() {
      const catalog = services();
      list.innerHTML = offers.length ? offers.map(row => {
        const addon = catalog.find(service => service.id === row.addon_service_id);
        const primaryNames = row.primary_service_ids.map(id => catalog.find(service => service.id === id)?.name || 'Недоступная услуга');
        return `<button class="service-offers-item" type="button" data-edit-service-offer="${escapeHtml(row.id)}"><span><strong>${escapeHtml(addon?.name || 'Недоступная услуга')}</strong><small>К ${escapeHtml(primaryNames.join(', '))}</small><span>${escapeHtml(row.benefit_text)}</span></span><span class="service-offers-state">${row.enabled ? 'Включено' : 'Выключено'}</span></button>`;
      }).join('') : loadedContext ? '<p class="service-offers-empty">Предложений пока нет. Выберите услуги, которые дополняют друг друга.</p>' : '';
      add.disabled = !loadedContext || eligible().length < 2 || saving;
      if (loadedContext && eligible().length < 2 && !offers.length) message('Для предложения нужны хотя бы две активные услуги с фиксированной ценой.');
    }
    async function load({ force = false } = {}) {
      const actor = getCurrentUser()?.id, generation = getSessionGeneration();
      if (!actor) { reset(); return false; }
      if (loadRequest && loadRequest.context === context() && !force) return loadRequest.promise;
      const revision = ++loadRevision;
      loadedContext = ''; offers = []; renderList(); message('Загружаем предложения…');
      const request = { context:context(), promise:null };
      loadRequest = request;
      request.promise = (async () => {
        try {
          const result = await db.rpc('get_minuta_service_offers', { p_performer:actor });
          if (!current(actor, generation, revision)) return false;
          if (result?.error) throw result.error;
          if (!Array.isArray(result?.data?.offers) || !result.data.offers.every(validSavedRow)) throw new Error('invalid_offer_response');
          offers = result.data.offers; loadedContext = context(); message(''); renderList(); return true;
        } catch (error) {
          if (!current(actor, generation, revision)) return false;
          message(/PGRST202|42883|42501|PGRST301/.test(`${error?.code}`) ? errorText(error) : 'Не удалось загрузить предложения. Повторите загрузку.', true);
          list.innerHTML = '<button type="button" class="secondary-button" data-reload-service-offers>Повторить загрузку</button>'; add.disabled = true; return false;
        } finally { if (loadRequest === request) loadRequest = null; }
      })();
      return request.promise;
    }
    function finishEditing() { form.hidden = true; editing = null; list.hidden = false; query('.service-offers-list-actions').hidden = false; }
    function startEditing(row = null) {
      if (loadedContext !== context() || saving) return;
      editing = row ? { ...row, primary_service_ids:[...row.primary_service_ids] } : { id:null, primary_service_ids:[], addon_service_id:'', benefit_text:'', discount_kind:'none', discount_value:0, additional_minutes:0, enabled:true, revision:0, priority:50 };
      const choices = eligible();
      const unavailable = row && (!choices.some(service => service.id === row.addon_service_id) || row.primary_service_ids.some(id => !choices.some(service => service.id === id)));
      form.innerHTML = `<h3>${row ? 'Настройте предложение' : 'Новое предложение'}</h3>
        ${unavailable ? '<p class="service-offers-status">Некоторые услуги больше недоступны. Вы можете выключить это предложение или выбрать активные услуги.</p>' : ''}
        <fieldset class="service-offers-primary"><legend>К каким основным услугам</legend>${choices.map(service => `<label><input type="checkbox" name="primary" value="${escapeHtml(service.id)}" ${editing.primary_service_ids.includes(service.id) ? 'checked' : ''}><span>${escapeHtml(service.name)}</span></label>`).join('')}</fieldset>
        <label>Дополнительная услуга<select name="addon" required><option value="">Выберите услугу</option>${choices.map(service => `<option value="${escapeHtml(service.id)}" ${editing.addon_service_id === service.id ? 'selected' : ''}>${escapeHtml(service.name)}</option>`).join('')}</select></label>
        <label>Польза для клиента<textarea name="benefit" maxlength="160" rows="2" placeholder="Например, снимет напряжение в шее после массажа спины" required>${escapeHtml(editing.benefit_text)}</textarea></label>
        <div class="service-offers-fields"><label>Скидка<select name="discount"><option value="none">Без скидки</option><option value="percent">Проценты, %</option><option value="rubles">Сумма, ₽</option></select></label><label data-discount-value hidden>Размер скидки<input name="discountValue" type="number" min="0" step="0.01" value="${editing.discount_value}"></label><label>Дополнительное время, мин<input name="minutes" type="number" min="0" max="480" step="1" value="${editing.additional_minutes}" required><small>Сколько времени реально добавится к визиту.</small></label></div>
        <label class="service-offers-enable"><input type="checkbox" name="enabled" ${editing.enabled ? 'checked' : ''}><span>Показывать клиентам</span></label><small class="service-offers-disable-hint" hidden>Предложение будет выключено с прежними условиями.</small>
        <section class="service-offers-preview" aria-labelledby="serviceOfferPreviewTitle"><small id="serviceOfferPreviewTitle">Так увидит клиент · предпросмотр</small><div id="serviceOfferPreview" aria-live="polite"></div></section>
        <p class="service-offers-form-error" role="alert" hidden></p>
        <div class="service-offers-footer"><button class="secondary-button" type="button" data-cancel-service-offer>Назад</button><button class="primary" type="submit">Сохранить предложение</button></div>`;
      form.elements.discount.value = editing.discount_kind;
      form.hidden = false; list.hidden = true; query('.service-offers-list-actions').hidden = true; message('');
      updatePreview(); form.querySelector('input')?.focus();
    }
    function readForm() {
      return { ...editing, primary_service_ids:[...form.querySelectorAll('[name="primary"]:checked')].map(input => input.value), addon_service_id:form.elements.addon.value,
        benefit_text:form.elements.benefit.value.trim(), discount_kind:form.elements.discount.value,
        discount_value:form.elements.discount.value === 'none' ? 0 : Number(form.elements.discountValue.value),
        additional_minutes:form.elements.minutes.value === '' ? NaN : Number(form.elements.minutes.value), enabled:form.elements.enabled.checked };
    }
    function updatePreview() {
      if (form.hidden || !editing) return;
      const row = readForm(), addon = eligible().find(service => service.id === row.addon_service_id);
      form.querySelector('[data-discount-value]').hidden = row.discount_kind === 'none';
      form.querySelector('.service-offers-disable-hint').hidden = !editing.id || row.enabled;
      form.elements.discountValue.max = row.discount_kind === 'percent' ? '100' : String(addon?.price_rub || 0);
      form.elements.discountValue.step = row.discount_kind === 'rubles' ? '1' : '0.01';
      form.querySelectorAll('[name="primary"]').forEach(input => { input.disabled = saving || input.value === row.addon_service_id; if (input.value === row.addon_service_id) input.checked = false; });
      query('#serviceOfferPreview').innerHTML = addon ? `<strong>${escapeHtml(addon.name)}</strong><p>${escapeHtml(row.benefit_text || 'Кратко опишите пользу для клиента')}</p><div><b>${money.format(previewPrice(Number(addon.price_rub), row.discount_kind, Number.isFinite(row.discount_value) ? row.discount_value : 0))} ₽</b>${row.discount_kind !== 'none' && row.discount_value > 0 ? `<del>${money.format(Number(addon.price_rub))} ₽</del>` : ''}<span>+${Number.isInteger(row.additional_minutes) ? row.additional_minutes : '—'} мин</span></div><small>Только вместе с основной услугой${row.enabled ? '' : ' · показ выключен'}</small>` : '<p>Выберите дополнительную услугу, чтобы увидеть предложение.</p>';
    }
    async function save(event) {
      event.preventDefault(); if (saving || !editing || !requireWrites()) return;
      const draft = readForm();
      const row = editing.id && !draft.enabled ? { ...editing, primary_service_ids:[...editing.primary_service_ids], enabled:false } : draft;
      const validation = validateOffer(row, services(), offers), errorBox = form.querySelector('.service-offers-form-error');
      if (validation) { errorBox.textContent = validation; errorBox.hidden = false; return; }
      if (loadedContext !== context()) return;
      const actor = getCurrentUser()?.id, generation = getSessionGeneration(), revision = ++saveRevision;
      saving = true; errorBox.hidden = true;
      form.querySelectorAll('input,select,textarea,button').forEach(element => { element.disabled = true; });
      const submit = form.querySelector('[type="submit"]'); submit.textContent = 'Сохраняем…';
      try {
        const result = await db.rpc('save_minuta_service_offer', { p_performer:actor, p_offer:row });
        if (!current(actor, generation, revision, true)) return;
        if (result?.error) throw result.error;
        const saved = result?.data?.offer;
        if (!validSavedRow(saved) || (row.id && saved.id !== row.id) || saved.revision <= row.revision
          || ['addon_service_id','benefit_text','discount_kind','additional_minutes','enabled','priority'].some(key => saved[key] !== row[key])
          || Number(saved.discount_value) !== row.discount_value
          || [...saved.primary_service_ids].sort().join() !== [...row.primary_service_ids].sort().join()) throw new Error('unconfirmed_offer_save');
        offers = [...offers.filter(item => item.id !== saved.id), saved];
        finishEditing(); message('Предложение сохранено'); notify('Предложение сохранено');
      } catch (error) {
        if (!current(actor, generation, revision, true)) return;
        errorBox.textContent = errorText(error); errorBox.hidden = false;
      } finally {
        if (current(actor, generation, revision, true)) {
          saving = false; form.querySelectorAll('input,select,textarea,button').forEach(element => { element.disabled = false; });
          if (submit.isConnected) submit.textContent = 'Сохранить предложение'; updatePreview(); renderList();
        }
      }
    }
    function reset() {
      ++loadRevision; ++saveRevision; loadedContext = ''; loadRequest = null; offers = []; saving = false;
      finishEditing(); form.replaceChildren(); message(''); renderList(); if (dialog.open) dialog.close();
    }
    async function open() {
      if (!getCurrentUser()?.id) return false;
      if (!dialog.open) dialog.showModal();
      if (loadedContext !== context()) return load();
      renderList(); return true;
    }
    dialog.addEventListener('click', event => {
      if (event.target.closest('.service-offers-close')) { if (!saving) dialog.close(); return; }
      if (event.target.closest('[data-reload-service-offers]')) { finishEditing(); void load({ force:true }); }
      if (event.target.closest('[data-add-service-offer]')) startEditing();
      const edit = event.target.closest('[data-edit-service-offer]'); if (edit) startEditing(offers.find(row => row.id === edit.dataset.editServiceOffer));
      if (event.target.closest('[data-cancel-service-offer]') && !saving) { finishEditing(); renderList(); }
    });
    form.addEventListener('submit', save);
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', event => {
      if (event.target.name === 'addon') { const selected = eligible().find(service => service.id === event.target.value); form.elements.minutes.value = selected ? String(selected.duration_minutes) : '0'; }
      updatePreview();
    });
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    dialog.addEventListener('close', () => { if (!saving) { finishEditing(); entry.focus(); } });
    entry.addEventListener('click', () => void open());
    global.addEventListener('minuta:provider-session-reset', reset);
    return { load, reset, open, setServices() { renderList(); updatePreview(); } };
  }
  global.MinutaServiceOffers = Object.freeze({ createController, validateOffer, previewPrice, isEligibleService });
})(window);
