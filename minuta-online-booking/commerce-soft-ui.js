(() => {
  'use strict';

  // Presentation only. The existing controllers own permissions, RPCs and totals.
  const paths = {
    box: '<path d="m4 7 8-4 8 4v10l-8 4-8-4Z"/><path d="m4 7 8 4 8-4M12 11v10M8 5l8 4"/>',
    bottle: '<path d="M9 3h6v4H9zM9 7l-2 4v9h10v-9l-2-4M7 13h10"/>',
    glove: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v6-2a1.5 1.5 0 0 1 3 0v6l-3 5H9l-5-7a1.5 1.5 0 0 1 2-2l2 2Z"/>',
    roll: '<path d="M7 4h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6Zm-3 3v13h13V10M8 4v6M8 17h5"/>',
    spray: '<path d="M9 3h7v4H9zM9 7l-3 5v9h12v-9l-2-5M16 3h4M20 3v3M6 13h12"/>',
    ticket: '<path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4Zm11 0v3m0 3v2m0 3v3"/>',
    gift: '<path d="M3 8h18v5H3zM5 13v8h14v-8M12 8v13"/><path d="M12 8H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>'
  };
  function iconName(item = {}) {
    if (item.kind === 'certificate') return 'gift';
    if (item.kind === 'visit_pass') return 'ticket';
    if (item.kind === 'package') return 'box';
    const name = String(item.name || '').toLocaleLowerCase('ru-RU');
    if (/перчат|glove/.test(name)) return 'glove';
    if (/простын|салфет|рулон|towel|roll/.test(name)) return 'roll';
    if (/антисепт|спрей|spray|санитайз/.test(name)) return 'spray';
    if (/масло|флакон|шампун|лосьон|oil|lotion/.test(name)) return 'bottle';
    return 'box';
  }
  const iconMarkup = item => `<span class="cs-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${paths[iconName(item)]}</svg></span>`;
  function stepQuantity(value, delta, min = .001, max = 1000000) {
    const current = Number(String(value).replace(',', '.'));
    return Math.min(max, Math.max(min, Math.round(((Number.isFinite(current) ? current : 1) + delta) * 1000) / 1000));
  }
  function previewText(template, organizationName = 'Название организации') {
    const replacements = { имя: 'Имя клиента', организация: organizationName, ссылка: '[ссылка на запись]' };
    return String(template || '').replace(/\{(имя|организация|ссылка)\}/g, (_, key) => replacements[key]);
  }
  function insertVariable(value, start, end, variable, maxLength = 1000) {
    if (!['{имя}', '{организация}', '{ссылка}'].includes(variable)) return null;
    const next = value.slice(0, start) + variable + value.slice(end);
    return next.length <= maxLength ? { value:next, cursor:start + variable.length } : null;
  }

  const $ = selector => document.querySelector(selector);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, className = 'secondary-button') => {
    const node = element('button', className, label);
    node.type = 'button';
    return node;
  };
  let saleItems = [], itemButton, itemDialog, itemList, itemSearch, quantityMinus, quantityPlus;
  let organizationName = '', previewBody, variableButtons = [];

  function renderPicker() {
    if (!itemList) return;
    const query = itemSearch.value.trim().toLocaleLowerCase('ru-RU');
    const select = $('#commerceItem');
    itemList.replaceChildren();
    const options = [...select.options].filter(option => option.value && !option.disabled && option.textContent.toLocaleLowerCase('ru-RU').includes(query));
    for (const option of options) {
      const item = saleItems.find(row => row.id === option.value) || { name:option.textContent };
      const row = button('', 'cs-picker-row');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(option.value === select.value));
      row.innerHTML = iconMarkup(item);
      row.append(element('span', '', option.textContent));
      row.addEventListener('click', () => {
        if (select.disabled || itemButton.disabled || ![...select.options].some(current => current.value === option.value && !current.disabled)) return;
        itemDialog.close();
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles:true }));
        syncSale();
      });
      itemList.append(row);
    }
    if (!options.length) itemList.append(element('p', 'cs-picker-empty', 'Подходящих позиций нет'));
  }

  function syncSale(items) {
    if (items) saleItems = items;
    const select = $('#commerceItem');
    if (!select || !itemButton) return;
    const option = select.selectedOptions[0];
    const item = saleItems.find(row => row.id === select.value) || { name:option?.textContent };
    itemButton.querySelector('.cs-item-icon').outerHTML = iconMarkup(item);
    itemButton.querySelector('strong').textContent = option?.textContent || 'Выберите позицию';
    itemButton.querySelector('small').textContent = $('#commerceItemKind')?.value === 'benefit_product' ? 'Абонемент, пакет или сертификат' : 'Товар';
    const itemDisabled = select.disabled || ![...select.options].some(row => row.value && !row.disabled);
    if (itemButton.disabled !== itemDisabled) itemButton.disabled = itemDisabled;
    itemButton.setAttribute('aria-label', `Изменить позицию: ${option?.textContent || 'нет доступных позиций'}`);
    const quantity = $('#commerceQuantity');
    if (quantityMinus && quantity) {
      const minusDisabled = quantity.disabled || Number(quantity.value) <= Number(quantity.min || .001);
      const plusDisabled = quantity.disabled || Number(quantity.value) >= Number(quantity.max || 1000000);
      if (quantityMinus.disabled !== minusDisabled) quantityMinus.disabled = minusDisabled;
      if (quantityPlus.disabled !== plusDisabled) quantityPlus.disabled = plusDisabled;
    }
    if (itemDialog?.open && (items || itemButton.disabled || $('#commercePanel')?.hidden)) itemDialog.close();
  }
  function resetSale() {
    saleItems = [];
    if (itemDialog?.open) itemDialog.close();
  }
  function focusItem() {
    itemButton?.focus({ preventScroll:true });
  }

  function enhanceSale() {
    const form = $('#commerceSaleForm'), select = $('#commerceItem');
    if (!form || !select || itemButton) return;
    const bookingLabel = $('#commerceBooking')?.closest('label');
    if (bookingLabel) $('#commerceSaleOptions .commerce-sale-options-fields')?.prepend(bookingLabel);
    $('#commerceSaleOptions > summary span').textContent = 'Дополнительные параметры';
    const notice = form.querySelector(':scope > .organization-invite-help');
    if (notice) { notice.classList.add('cs-payment-note'); notice.textContent = 'Ручной учёт оплаты. Деньги с карты не списываются.'; $('#commerceSaleSubmit').after(notice); }
    select.closest('label').classList.add('cs-native-item');
    select.tabIndex = -1;
    itemButton = button('', 'cs-product-choice');
    itemButton.setAttribute('aria-haspopup', 'dialog');
    itemButton.innerHTML = `${iconMarkup({})}<span class="cs-product-copy"><small>Товар</small><strong>Выберите позицию</strong></span><span class="cs-change-label">Изменить</span>`;
    select.closest('label').after(itemButton);
    itemDialog = element('dialog', 'cs-product-dialog');
    itemDialog.setAttribute('aria-label', 'Выбор позиции для продажи');
    const head = element('div', 'cs-picker-head');
    const close = button('Закрыть', 'secondary-button compact-button');
    close.addEventListener('click', () => itemDialog.close());
    head.append(element('h3', '', 'Выбрать позицию'), close);
    itemSearch = element('input', 'cs-picker-search');
    itemSearch.type = 'search'; itemSearch.placeholder = 'Название или артикул'; itemSearch.setAttribute('aria-label', 'Поиск позиции');
    itemList = element('div', 'cs-picker-list'); itemList.setAttribute('role', 'listbox'); itemList.setAttribute('aria-label', 'Доступные позиции');
    itemDialog.append(head, itemSearch, itemList); document.body.append(itemDialog);
    itemSearch.addEventListener('input', renderPicker);
    itemSearch.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); itemList.querySelector('[role="option"]')?.focus(); }
    });
    itemList.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const rows = [...itemList.querySelectorAll('[role="option"]')];
      if (!rows.length) return;
      event.preventDefault();
      const current = rows.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows[next].focus();
    });
    itemButton.addEventListener('click', () => {
      if (itemButton.disabled) return;
      itemSearch.value = ''; renderPicker(); itemDialog.showModal(); itemSearch.focus();
    });
    itemDialog.addEventListener('close', () => { if (!$('#commercePanel')?.hidden) itemButton.focus({ preventScroll:true }); });
    select.addEventListener('invalid', event => { event.preventDefault(); itemButton.focus(); });
    const quantity = $('#commerceQuantity');
    const counter = element('span', 'cs-quantity'); quantity.before(counter);
    quantityMinus = button('−', 'cs-quantity-button'); quantityMinus.setAttribute('aria-label', 'Уменьшить количество');
    quantityPlus = button('+', 'cs-quantity-button'); quantityPlus.setAttribute('aria-label', 'Увеличить количество');
    for (const [control, delta] of [[quantityMinus, -1], [quantityPlus, 1]]) control.addEventListener('click', () => {
      if (quantity.disabled) return;
      quantity.value = String(stepQuantity(quantity.value, delta, Number(quantity.min || .001), Number(quantity.max || 1000000)));
      quantity.dispatchEvent(new Event('input', { bubbles:true })); syncSale();
    });
    counter.append(quantityMinus, quantity, quantityPlus);
    form.addEventListener('input', () => syncSale()); form.addEventListener('change', () => syncSale()); form.addEventListener('reset', () => setTimeout(syncSale, 0));
    // Writes and permission changes must be mirrored by the presentation controls.
    new MutationObserver(() => syncSale()).observe(form, { subtree:true, attributes:true, attributeFilter:['disabled'] });
    syncSale();
  }

  function syncRetention(name) {
    if (name !== undefined) organizationName = name;
    const field = $('#retentionMessageTemplate');
    if (!field || !previewBody) return;
    previewBody.textContent = previewText(field.value, organizationName || 'Название организации');
    variableButtons.forEach(control => { control.disabled = field.disabled || field.readOnly; });
  }
  function enhanceRetention() {
    const form = $('#retentionSettingsForm'), field = $('#retentionMessageTemplate');
    if (!form || !field || previewBody) return;
    const labels = form.querySelectorAll('.retention-number-field strong');
    if (labels[0]) labels[0].textContent = 'После последнего визита';
    if (labels[1]) { labels[1].textContent = 'Повторное предложение'; labels[1].after(element('small', '', 'Не раньше чем через')); }
    const label = field.closest('label');
    const hint = label.querySelector('small'); if (hint) hint.textContent = 'Переменные подставятся в сообщение для клиента.';
    const toolbar = element('div', 'cs-message-toolbar'), chips = element('div', 'cs-variable-chips');
    for (const token of ['{имя}', '{организация}', '{ссылка}']) {
      const control = button(token, 'cs-variable-chip');
      control.setAttribute('aria-label', `Вставить ${token}`);
      control.addEventListener('mousedown', event => event.preventDefault());
      control.addEventListener('click', () => {
        if (field.disabled || field.readOnly) return;
        const next = insertVariable(field.value, field.selectionStart ?? field.value.length, field.selectionEnd ?? field.value.length, token, field.maxLength > 0 ? field.maxLength : 1000);
        if (!next) return;
        field.value = next.value; field.focus(); field.setSelectionRange(next.cursor, next.cursor);
        field.dispatchEvent(new Event('input', { bubbles:true })); syncRetention();
      });
      variableButtons.push(control); chips.append(control);
    }
    const preview = element('aside', 'cs-message-preview'); preview.id = 'retentionMessagePreview'; preview.hidden = true;
    preview.append(element('strong', '', 'Предпросмотр сообщения'), element('small', '', 'Пример подстановки · сообщение не отправлено'));
    previewBody = element('p'); preview.append(previewBody);
    const toggle = button('Предпросмотр', 'cs-preview-toggle'); toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', preview.id);
    toggle.addEventListener('click', () => { preview.hidden = !preview.hidden; toggle.setAttribute('aria-expanded', String(!preview.hidden)); form.classList.toggle('cs-preview-open', !preview.hidden); syncRetention(); });
    toolbar.append(chips, toggle); label.after(toolbar, preview);
    field.addEventListener('input', () => syncRetention());
    new MutationObserver(() => syncRetention()).observe(field, { attributes:true, attributeFilter:['disabled', 'readonly'] });
    syncRetention();
  }

  function enhanceBenefits() {
    const panel = $('#benefitsPanel');
    if (!panel) return;
    const guide = panel.querySelector('.benefit-guide');
    const lastStep = guide?.querySelector('li:last-child');
    if (lastStep) lastStep.textContent = 'После завершения визита нажмите «Погасить». При отмене верните резерв на баланс: это не возврат денег.';
    const scan = panel.querySelector('[data-code-scan-target="benefitInstrumentSearch"]');
    if (scan && !scan.querySelector('svg')) scan.insertAdjacentHTML('afterbegin', '<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><path d="M4 8V4h4m8 0h4v4M4 16v4h4m8 0h4v-4M8 8v8m4-8v8m4-8v8"/></svg>');
  }
  function enhance() {
    for (const id of ['commercePanel', 'retentionPanel', 'benefitsPanel']) $(`#${id}`)?.classList.add('commerce-soft-panel');
    enhanceSale(); enhanceRetention(); enhanceBenefits();
  }
  window.MinutaCommerceSoftUI = { iconName, iconMarkup, stepQuantity, previewText, insertVariable, enhance, syncSale, resetSale, focusItem, syncRetention };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance, { once:true });
  else enhance();
})();
