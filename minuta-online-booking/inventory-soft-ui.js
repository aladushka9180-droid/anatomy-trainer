(() => {
  'use strict';

  // Presentation only: the inventory controller keeps ownership of all writes.
  const paths = {
    box:'<path d="m4 7 8-4 8 4v10l-8 4-8-4Z"/><path d="m4 7 8 4 8-4M12 11v10M8 5l8 4"/>',
    bottle:'<path d="M9 3h6v4H9zM9 7l-2 4v9h10v-9l-2-4M7 13h10"/>',
    oil:'<path d="M12 3C9 7 6 10 6 14a6 6 0 0 0 12 0c0-4-3-7-6-11Z"/><path d="M9 14a3 3 0 0 0 3 3"/>',
    glove:'<path d="M9.5 21.5h8.2c.45 0 .8-.35.8-.8v-2.3c0-.7.2-1.3.55-1.9l1.7-3.1c.55-1 .85-2.15.85-3.35V8.2c0-1.65-2.5-1.65-2.5 0v1.5c0 .45-.65.45-.65 0V5.7c0-1.75-2.5-1.75-2.5 0v3.15c0 .5-.8.5-.8 0V3.65c0-1.8-2.6-1.8-2.6 0v5.2c0 .5-.8.5-.8 0V5.1c0-1.75-2.5-1.75-2.5 0v7.1c0 .4-.35.55-.65.25L6.75 10.7c-1.25-1.2-2.95.35-2 1.75l3.1 4.45c.6.85.85 1.5.85 2.4v1.4c0 .45.35.8.8.8Z"/><path d="M8.7 18.65c3.2.3 6.6.3 9.8 0"/>',
    roll:'<path d="M7 4h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6Zm-3 3v13h13V10M8 4v6M8 17h5"/>',
    spray:'<path d="M9 3h7v4H9zM9 7l-3 5v9h12v-9l-2-5M16 3h4M20 3v3M6 13h12"/>',
    edit:'<path d="m14 5 5 5M4 20l4-1 12-12a2.1 2.1 0 0 0-3-3L5 16Z"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    chevron:'<path d="m6 9 6 6 6-6"/>'
  };
  const units = { piece:'шт.', ml:'мл', g:'г', kg:'кг', l:'л', pack:'упак.' };
  const format = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits:3 }).format(Number(value || 0));
  const $ = selector => document.querySelector(selector);
  let panel, settings, settingsStatus, warehouses, warehouseStatus, lastOrganization = null;
  const editors = new Map();
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function iconName(item = {}) {
    const name = String(item.name || '').toLocaleLowerCase('ru-RU');
    if (/перчат|glove/.test(name)) return 'glove';
    if (/простын|салфет|рулон|полотен|towel|roll/.test(name)) return 'roll';
    if (/антисепт|спрей|spray|санитайз/.test(name)) return 'spray';
    if (/масло.*(домашн|уход)|oil.*(home|care)/.test(name)) return 'oil';
    if (/масло|флакон|шампун|лосьон|гель|крем|oil|lotion/.test(name)) return 'bottle';
    return 'box';
  }
  function icon(name, className = 'is-icon') {
    const holder = element('span', className);
    holder.setAttribute('aria-hidden', 'true');
    holder.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths[name] || paths.box}</svg>`;
    return holder;
  }
  function closeEditor(kind, restoreFocus = true) {
    const editor = editors.get(kind);
    if (!editor) return;
    editor.creator.open = false;
    if (editor.dialog.open) editor.dialog.close();
    if (restoreFocus && editor.trigger?.isConnected && !editor.trigger.disabled) editor.trigger.focus({ preventScroll:true });
  }
  function reset() {
    for (const kind of editors.keys()) closeEditor(kind, false);
    lastOrganization = null;
    if (settings) settings.open = false;
  }
  function setScope(organizationId) {
    if (lastOrganization && lastOrganization !== organizationId) reset();
  }
  function updatePreview() {
    const preview = $('#inventoryIconPreview');
    if (!preview) return;
    const name = iconName({ name:$('#inventoryItemName').value });
    preview.replaceChildren(icon(name, 'is-item-icon'), element('span', '', 'Иконка подбирается по названию'));
  }
  function openEditor(kind, trigger) {
    init();
    const editor = editors.get(kind);
    if (!editor || panel.hidden || $('#inventoryWorkspace').hidden || $('#inventoryControls').hidden) return;
    editor.trigger = trigger || document.activeElement;
    for (const [other] of editors) if (other !== kind) closeEditor(other, false);
    editor.creator.open = true;
    const editing = Boolean($(`#inventory${kind === 'item' ? 'Item' : 'Warehouse'}Id`).value);
    editor.title.textContent = kind === 'item' ? editing ? 'Изменить позицию' : 'Новая позиция' : editing ? 'Изменить склад' : 'Новый склад';
    const error = $(`#inventory${kind === 'item' ? 'Item' : 'Warehouse'}Error`);
    error.hidden = true;
    if (kind === 'item') {
      editor.extra.open = Boolean(editing && $('#inventoryItemSku').value);
      updatePreview();
    }
    if (!editor.dialog.open) editor.dialog.showModal();
    $(`#inventory${kind === 'item' ? 'Item' : 'Warehouse'}Name`).focus({ preventScroll:true });
  }
  function enhanceEditor(kind) {
    const suffix = kind === 'item' ? 'Item' : 'Warehouse';
    const creator = $(`#inventory${suffix}Creator`), form = $(`#inventory${suffix}Form`);
    if (!creator || !form) return;
    const dialog = element('dialog', 'is-editor');
    dialog.id = `inventory${suffix}Dialog`;
    const header = element('div', 'is-editor-head');
    const title = element('h3', '', kind === 'item' ? 'Новая позиция' : 'Новый склад');
    title.id = `inventory${suffix}DialogTitle`;
    dialog.setAttribute('aria-labelledby', title.id);
    const close = element('button', 'is-icon-button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Закрыть форму');
    close.setAttribute(`data-inventory-cancel-${kind}`, '');
    close.append(icon('close'));
    header.append(title, close);
    dialog.append(header, form);
    // Keep forms inside the inventory panel: delegated write guards remain intact.
    creator.append(dialog);
    const editor = { creator, form, dialog, title, trigger:null };
    if (kind === 'item') {
      const firstRow = $('#inventoryItemName').closest('.form-row');
      const scan = $('#inventoryItemSku').closest('.scan-field');
      firstRow.classList.add('is-name-field');
      editor.extra = element('details', 'is-form-extra');
      editor.extra.id = 'inventoryItemExtra';
      const summary = element('summary', '', 'Дополнительно');
      summary.append(icon('chevron'));
      editor.extra.append(summary, scan, $('#inventoryItemActive').closest('label'));
      const preview = element('div', 'is-icon-preview');
      preview.id = 'inventoryIconPreview';
      form.querySelector('.inventory-form-actions').before(preview, editor.extra);
      form.querySelector('.inventory-form-actions').before($('#inventoryItemError'));
      $('#inventoryItemName').addEventListener('input', updatePreview);
    }
    creator.querySelector(':scope > summary').addEventListener('click', event => {
      event.preventDefault();
      if (event.currentTarget.getAttribute('aria-disabled') !== 'true') openEditor(kind, event.currentTarget);
    });
    creator.addEventListener('toggle', () => { if (!creator.open && dialog.open) closeEditor(kind); });
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      close.click();
    });
    form.querySelector(`[data-inventory-cancel-${kind}]`).addEventListener('click', () => closeEditor(kind));
    close.addEventListener('click', () => closeEditor(kind));
    // Closing a hidden pane/org prevents an editor from outliving its data scope.
    editors.set(kind, editor);
  }
  function init() {
    if (panel) return;
    panel = $('#inventoryPanel');
    if (!panel) return;
    panel.classList.add('inventory-soft-ui');
    const oldSettings = panel.querySelector('.inventory-settings');
    settings = element('details', 'is-settings');
    settings.id = 'inventorySettingsDetails';
    const settingsSummary = element('summary');
    const settingsCopy = element('span', 'is-summary-copy');
    settingsStatus = element('small');
    settingsCopy.append(element('strong', '', 'Настройки учёта'), settingsStatus);
    settingsSummary.append(settingsCopy, icon('chevron'));
    oldSettings.before(settings);
    settings.append(settingsSummary, oldSettings);
    const grid = panel.querySelector('[data-inventory-pane="catalog"]');
    grid.classList.add('is-catalog-grid');
    const catalog = grid.querySelector(':scope > section');
    catalog.classList.add('is-catalog');
    const itemCreator = $('#inventoryItemCreator');
    catalog.querySelector('.resource-subhead').append(itemCreator);
    const oldWarehouses = $('#inventoryWarehousesList').closest('section');
    warehouses = element('details', 'is-warehouses');
    warehouses.id = 'inventoryWarehousesDetails';
    warehouses.open = !window.matchMedia('(max-width: 760px)').matches;
    const warehouseSummary = element('summary');
    const warehouseCopy = element('span', 'is-summary-copy');
    warehouseStatus = element('small');
    warehouseCopy.append(element('strong', '', 'Склады'), warehouseStatus);
    warehouseSummary.append(warehouseCopy, $('#inventoryWarehousesCount'), icon('chevron'));
    oldWarehouses.querySelector('.resource-subhead').remove();
    oldWarehouses.before(warehouses);
    warehouses.append(warehouseSummary, oldWarehouses);
    oldWarehouses.classList.add('is-warehouse-body');
    enhanceEditor('item');
    enhanceEditor('warehouse');
    new MutationObserver(() => {
      if (panel.hidden || $('#inventoryControls').hidden) {
        for (const kind of editors.keys()) closeEditor(kind, false);
      }
    }).observe(panel, { subtree:true, attributes:true, attributeFilter:['hidden'] });
  }
  function sync(payload) {
    init();
    if (!panel || !payload) return;
    if (lastOrganization !== payload.organization_id) {
      for (const kind of editors.keys()) closeEditor(kind, false);
      settings.open = !payload.enabled;
      lastOrganization = payload.organization_id;
    }
    const transferState = payload.transfers_suspended_at ? 'остановлены до сверки' : payload.transfers_enabled ? 'включены' : 'выключены';
    settingsStatus.textContent = `Учёт ${payload.enabled ? 'включён' : 'выключен'} · Автосписание ${payload.enabled && payload.auto_deduct_completed_visits ? 'включено' : 'выключено'}`
      + (Number(payload.transfer_version) === 130 ? ` · Перемещения ${transferState}` : '');
    warehouseStatus.textContent = `${payload.warehouses.filter(row => row.active).length} активных · по филиалам`;
    for (const row of $('#inventoryItemsList').querySelectorAll('.organization-row')) {
      const edit = row.querySelector('[data-inventory-edit-item]');
      const item = payload.items.find(entry => entry.id === edit?.dataset.inventoryEditItem);
      if (!item) continue;
      const total = payload.balances.filter(balance => balance.inventory_item_id === item.id).reduce((sum, balance) => sum + Number(balance.quantity || 0), 0);
      const low = item.active && total <= Number(item.low_stock_threshold || 0);
      const unit = units[item.unit] || item.unit;
      const main = element('div', 'is-item-copy');
      const name = element('button', 'is-item-name', item.name);
      name.type = 'button';
      name.dataset.inventoryEditItem = item.id;
      name.setAttribute('data-inventory-write', '');
      name.setAttribute('aria-label', `Изменить позицию: ${item.name}`);
      main.append(name, element('small', 'is-item-meta', payload.usage.some(usage => usage.inventory_item_id === item.id) ? 'Для услуг · расход по нормам' : 'Складская позиция'));
      const stock = element('div', 'is-item-stock', `${format(total)} ${unit}`);
      stock.append(element('small', low ? 'is-low-stock' : 'is-item-meta', !item.active ? 'Скрыта' : low ? 'Ниже минимума' : `Минимум ${format(item.low_stock_threshold)} ${unit}`));
      edit.className = 'is-icon-button is-item-edit';
      edit.replaceChildren(icon('edit'));
      edit.setAttribute('aria-label', `Изменить позицию: ${item.name}`);
      row.classList.add('is-item-row');
      row.replaceChildren(icon(iconName(item), 'is-item-icon'), main, stock, edit);
    }
    $('#inventoryWarehousesList').querySelectorAll('.organization-row').forEach(row => row.classList.add('is-warehouse-row'));
  }
  window.MinutaInventorySoftUI = { init, sync, reset, setScope, openEditor, closeEditor, iconName };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
