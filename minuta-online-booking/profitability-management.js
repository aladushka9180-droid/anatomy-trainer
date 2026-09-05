(function () {
  'use strict';

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, applyWriteAvailability, refreshInventory } = options;
    const select = typeof options.$ === 'function' ? options.$ : selector => document.querySelector(selector);
    const $ = selector => select(selector);
    let organization = null;
    let inventory = null;
    let payload = null;
    let revision = 0;
    let writing = false;
    let bound = false;

    function iso(date) { return date.toISOString().slice(0, 10); }
    function defaultStart() { const date = new Date(); date.setDate(date.getDate() - 29); return iso(date); }
    function money(value) { return value == null ? 'Не указана' : new Intl.NumberFormat('ru-RU', { style:'currency', currency:'RUB', maximumFractionDigits:2 }).format(Number(value) / 100); }
    function rublesToKopecks(value) { const amount = Number(String(value ?? '').replace(',', '.')); return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null; }
    function serviceSetting(id) { return inventory?.service_cost_settings?.find(row => row.service_id === id)?.material_mode || ''; }
    function serviceHasUsage(id) { return Boolean(inventory?.usage?.some(row => row.service_id === id)); }
    function unavailable(value) { return value == null ? ' is-missing' : ''; }

    function ensureUi() {
      const movementForm = $('#inventoryMovementForm');
      if (movementForm && !$('#inventoryPurchaseCostField')) {
        const field = document.createElement('label');
        field.id = 'inventoryPurchaseCostField';
        field.innerHTML = 'Стоимость партии, ₽<input id="inventoryPurchaseCost" type="number" min="0" max="10000000000" step="0.01" inputmode="decimal" placeholder="Не указана"><small>Фактическая сумма за весь приход. Без неё себестоимость останется «не указана».</small>';
        const reason = $('#inventoryMovementReason')?.closest('label');
        movementForm.insertBefore(field, reason || $('#inventoryMovementError'));
      }
      if (!$('#profitabilityPanel') && $('#inventoryMovementsPanel')) {
        const section = document.createElement('section');
        section.className = 'profitability-panel'; section.id = 'profitabilityPanel'; section.hidden = true;
        section.innerHTML = `
          <div class="resource-subhead profitability-heading"><div><small>Фактические затраты без домыслов</small><strong>Доходность визитов</strong></div><button class="secondary-button" id="reloadProfitability" type="button">Обновить</button></div>
          <p class="profitability-note">Остаток считается только из фактической выручки, зафиксированной себестоимости, подтверждённых комиссий и выплаченной части зарплаты, привязанной к визиту. Общие корректировки выплат и другие общие расходы не распределяются по визитам.</p>
          <div class="profitability-opt-in" id="profitabilityOptIn"><div><strong>Учёт себестоимости выключен</strong><small>До включения все движения склада работают как прежде. При включении текущий остаток один раз будет зафиксирован с неизвестной стоимостью; новые партии получат свою цену.</small></div><button class="primary" id="enableInventoryCosting" type="button" data-inventory-write>Включить себестоимость</button></div>
          <div class="profitability-active" id="profitabilityActive" hidden>
          <div class="profitability-toolbar"><label>С даты<input id="profitabilityStart" type="date"></label><label>По дату<input id="profitabilityEnd" type="date"></label><label>Услуга<select id="profitabilityService"><option value="">Все услуги</option></select></label></div>
          <div class="loading-state compact" id="profitabilityLoading" hidden><i></i><span>Считаем по зафиксированным данным…</span></div>
          <div class="resource-inline-error" id="profitabilityUnavailable" role="status" hidden><div><strong>Расчёт временно недоступен</strong><small>Склад, записи и выплаты не изменены.</small></div></div>
          <div id="profitabilityWorkspace" hidden><div class="profitability-summary" id="profitabilitySummary"></div><div class="profitability-services" id="profitabilityServices"></div><details class="profitability-visits"><summary><span><small>Проверка каждого расчёта</small><strong>Отдельные визиты</strong></span><span id="profitabilityVisitsCount">0</span></summary><div class="profitability-visit-list" id="profitabilityVisits"></div></details></div>
          </div>
        `;
        $('#inventoryMovementsPanel').before(section);
      }
    }

    function reset() {
      revision += 1; organization = null; inventory = null; payload = null; writing = false;
      if ($('#profitabilityPanel')) $('#profitabilityPanel').hidden = true;
      if ($('#inventoryPurchaseCostField')) $('#inventoryPurchaseCostField').hidden = true;
    }

    async function setOrganization(next, nextInventory) {
      ensureUi(); organization = next?.id ? { ...next } : null; inventory = nextInventory || null; payload = null;
      const supported = Boolean(organization && Number(inventory?.costing_version) === 113);
      const enabled = supported && inventory?.costing_enabled === true;
      $('#profitabilityPanel').hidden = !supported; $('#profitabilityOptIn').hidden = enabled; $('#profitabilityActive').hidden = !enabled;
      $('#reloadProfitability').hidden = !enabled; $('#inventoryPurchaseCostField').hidden = !enabled || $('#inventoryMovementKind')?.value !== 'receipt';
      $('#enableInventoryCosting').disabled = inventory?.current_role !== 'owner';
      $('#enableInventoryCosting').title = inventory?.current_role === 'owner' ? '' : 'Включить учёт себестоимости может только владелец';
      if (!supported) return;
      if (!enabled) { $('#profitabilityLoading').hidden = true; $('#profitabilityWorkspace').hidden = true; applyWriteAvailability(); return; }
      const serviceSelect = $('#profitabilityService'), selected = serviceSelect.value;
      serviceSelect.innerHTML = `<option value="">Все услуги</option>${(inventory.services || []).filter(row => row.active !== false).map(row => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}</option>`).join('')}`;
      serviceSelect.value = (inventory.services || []).some(row => row.id === selected) ? selected : '';
      if (!$('#profitabilityStart').value) $('#profitabilityStart').value = defaultStart();
      if (!$('#profitabilityEnd').value) $('#profitabilityEnd').value = iso(new Date());
      await load();
    }

    async function load() {
      const organizationId = organization?.id;
      if (!organizationId || Number(inventory?.costing_version) !== 113 || inventory?.costing_enabled !== true || writing) return;
      const current = ++revision;
      $('#profitabilityLoading').hidden = false; $('#profitabilityUnavailable').hidden = true; $('#profitabilityWorkspace').hidden = true;
      const { data, error } = await db.rpc('get_minuta_profitability_v113', {
        p_organization:organizationId,p_start:$('#profitabilityStart').value,p_end:$('#profitabilityEnd').value,
        p_service:$('#profitabilityService').value || null,p_booking:null
      });
      if (current !== revision || organization?.id !== organizationId) return;
      $('#profitabilityLoading').hidden = true;
      if (error || String(data?.organization_id || '') !== String(organizationId)) { $('#profitabilityUnavailable').hidden = false; return; }
      payload = data; if (!Array.isArray(payload.services)) payload.services = []; if (!Array.isArray(payload.visits)) payload.visits = [];
      render();
    }

    function metric(label, value, primary) { return `<article${primary ? ' class="is-primary"' : ''}><small>${escapeHtml(label)}</small><strong class="${unavailable(value).trim()}">${escapeHtml(money(value))}</strong></article>`; }
    function costs(row) { return `${metric('Выручка', row.revenue_kopecks)}${metric('Материалы', row.material_cost_kopecks)}${metric('Комиссии', row.commission_kopecks)}${metric('Выплаты', row.payout_kopecks)}${metric('Остаток до общих расходов', row.remainder_before_overhead_kopecks, true)}`; }

    function serviceCard(row) {
      const mode = serviceSetting(row.service_id), usage = serviceHasUsage(row.service_id);
      const missing = Number(row.missing_material_cost_count || 0) + Number(row.missing_commission_count || 0) + Number(row.missing_payout_count || 0);
      const nextMode = mode === 'none' ? 'tracked' : 'none';
      const modeLabel = mode === 'none' ? 'Учитывать материалы' : 'Материалы не используются';
      const hint = mode === 'none' ? 'Явно указано: материалы 0 ₽.' : usage ? 'Себестоимость берётся из списанных партий.' : 'Без нормы или явного нуля затраты не указаны.';
      return `<article class="profitability-service-card"><header><div><strong>${escapeHtml(row.service_name)}</strong><small>${escapeHtml(String(row.visit_count))} визитов · ${escapeHtml(hint)}</small></div><span class="profitability-completeness ${missing ? 'is-missing' : ''}">${missing ? `Не хватает данных: ${missing}` : 'Всё указано'}</span></header><div class="profitability-cost-grid">${costs(row)}</div><button class="text-button" type="button" data-service-material-mode="${nextMode}" data-service-id="${escapeHtml(row.service_id)}" data-inventory-write>${escapeHtml(modeLabel)}</button></article>`;
    }

    function visitCard(row) {
      const commission = row.commission_kopecks == null ? '' : (Number(row.commission_kopecks) / 100).toFixed(2);
      const materialHelp = row.material_cost_kopecks == null
        ? row.material_mode === 'unspecified' ? 'Нет нормы или явного признака «без материалов».' : 'В истории списания нет цены партии.'
        : '';
      return `<article class="profitability-visit-card"><header><div><strong>${escapeHtml(row.service_name)}</strong><small>${escapeHtml(new Date(`${row.booking_date}T12:00:00`).toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' }))} · ${escapeHtml(row.performer_name || 'Специалист')}</small></div><b class="${unavailable(row.remainder_before_overhead_kopecks).trim()}">${escapeHtml(money(row.remainder_before_overhead_kopecks))}</b></header><div class="profitability-cost-grid compact">${costs(row)}</div>${materialHelp ? `<p class="profitability-missing-reason">${escapeHtml(materialHelp)}</p>` : ''}<form class="profitability-commission-form" data-booking-commission="${escapeHtml(row.booking_id)}"><label>Подтверждённая комиссия, ₽<input type="number" min="0" max="10000000000" step="0.01" inputmode="decimal" value="${escapeHtml(commission)}" placeholder="Не указана" required></label><button class="secondary-button" type="submit" data-inventory-write>Подтвердить</button><small>Укажите 0, если комиссии точно нет. Система её не выдумывает.</small></form></article>`;
    }

    function render() {
      const summary = payload.summary || {};
      $('#profitabilityWorkspace').hidden = false; $('#profitabilityUnavailable').hidden = true;
      $('#profitabilitySummary').innerHTML = costs(summary);
      $('#profitabilityServices').innerHTML = payload.services.length ? payload.services.map(serviceCard).join('') : '<div class="provider-empty compact-empty"><strong>Завершённых визитов нет</strong><small>Измените период или выберите другую услугу.</small></div>';
      $('#profitabilityVisitsCount').textContent = String(payload.visits.length);
      $('#profitabilityVisits').innerHTML = payload.visits.length ? payload.visits.map(visitCard).join('') : '<div class="provider-empty compact-empty"><strong>Визитов нет</strong></div>';
      applyWriteAvailability();
    }

    async function mutate(rpc, parameters, button, success) {
      if (!requireWrites() || writing || !organization?.id) return false;
      writing = true; const old = button?.textContent, wasDisabled = Boolean(button?.disabled); if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      const organizationId = organization.id;
      let response;
      try { response = await db.rpc(rpc, parameters); }
      catch (error) { response = { data:null,error }; }
      const { data, error } = response || {};
      writing = false;
      if (button) { button.textContent = old; button.disabled = wasDisabled; }
      applyWriteAvailability();
      if (error || String(data?.organization_id || '') !== String(organizationId)) { notify('Данные не сохранены. Расчёт и склад не изменены.'); return false; }
      if (rpc === 'set_minuta_service_material_mode_v113') {
        const rows = inventory.service_cost_settings || (inventory.service_cost_settings = []);
        const current = rows.find(row => row.service_id === data.service_id);
        if (current) current.material_mode = data.material_mode;
        else rows.push({ service_id:data.service_id,material_mode:data.material_mode });
      }
      notify(success);
      if (rpc === 'enable_minuta_inventory_costing_v113' && typeof refreshInventory === 'function') await refreshInventory();
      else await load();
      return true;
    }

    async function submit(event) {
      const form = event.target.closest('[data-booking-commission]'); if (!form) return;
      event.preventDefault(); const amount = rublesToKopecks(form.querySelector('input').value);
      if (amount == null) { notify('Укажите фактическую комиссию или 0, если её не было.'); return; }
      await mutate('save_minuta_booking_commission_v113', { p_organization:organization.id,p_booking:form.dataset.bookingCommission,p_amount_kopecks:amount,p_note:'' }, event.submitter, 'Комиссия подтверждена');
    }

    async function click(event) {
      if (event.target.closest('#reloadProfitability')) { await load(); return; }
      const enable = event.target.closest('#enableInventoryCosting');
      if (enable) {
        if (!confirm('Включить учёт себестоимости? Текущий остаток будет один раз зафиксирован с неизвестной ценой.')) return;
        await mutate('enable_minuta_inventory_costing_v113', { p_organization:organization.id }, enable, 'Учёт себестоимости включён'); return;
      }
      const mode = event.target.closest('[data-service-material-mode]');
      if (mode) await mutate('set_minuta_service_material_mode_v113', { p_organization:organization.id,p_service:mode.dataset.serviceId,p_material_mode:mode.dataset.serviceMaterialMode }, mode, mode.dataset.serviceMaterialMode === 'none' ? 'Для услуги зафиксировано: материалы не используются' : 'Услуга снова считается по складским списаниям');
    }

    function bind() {
      if (bound) return; bound = true; ensureUi();
      $('#profitabilityPanel')?.addEventListener('submit', submit);
      $('#profitabilityPanel')?.addEventListener('click', click);
      $('#profitabilityPanel')?.addEventListener('change', event => { if (event.target.matches('#profitabilityStart,#profitabilityEnd,#profitabilityService')) void load(); });
    }

    return { bind, load, reset, setOrganization };
  }

  window.MinutaProfitability = Object.freeze({ createController });
})();
