(function () {
  'use strict';

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const select = typeof options.$ === 'function' ? options.$ : selector => document.querySelector(selector);
    function $(selector) { return select(selector); }
    let organization = null;
    let payload = null;
    let availability = null;
    let revision = 0;
    let writing = false;
    let pendingOrganization;
    let adjustmentRequestId = '';
    let redemptionRequestId = '';
    let promoRequestId = '';

    function uuid() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, symbol => {
        const value = Math.floor(Math.random() * 16);
        return (symbol === 'x' ? value : (value & 3) | 8).toString(16);
      });
    }
    function unsupported(error) {
      return /PGRST202|42883|get_minuta_loyalty_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function scopeMatches(data, id) { return Boolean(data && String(data.organization_id || '') === String(id)); }
    function number(value) { return new Intl.NumberFormat('ru-RU').format(Number(value || 0)); }
    function money(value) { return `${number(value)} ₽`; }
    function dateLabel(value) { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleDateString('ru-RU'); }
    function empty(title, text) { return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`; }
    function clientLabel(id) { const item = payload?.clients?.find(row => row.id === id); return item ? `${item.client_name} · ${item.client_phone}` : 'Клиент'; }
    function bookingLabel(item) { return `${dateLabel(item.booking_date)} · ${item.client_name} · ${item.service_name}`; }
    function optionsList(items, label) { return items.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(label(item))}</option>`).join(''); }
    function dateInputValue(days = 0) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Samara', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + days));
      return date.toISOString().slice(0, 10);
    }
    function ensurePromoDefaults() {
      if (!$('#loyaltyPromoFrom').value) $('#loyaltyPromoFrom').value = dateInputValue();
      if (!$('#loyaltyPromoUntil').value) $('#loyaltyPromoUntil').value = dateInputValue(30);
    }
    function showFormError(selector, message) {
      const holder = $(selector);
      if (!holder) return;
      holder.textContent = message;
      holder.hidden = false;
    }

    function setBusy(value) {
      $('#loyaltyPanel')?.querySelectorAll('[data-loyalty-write]').forEach(control => {
        if (value && !control.disabled) { control.disabled = true; control.dataset.loyaltyBusy = 'true'; }
        else if (!value && control.dataset.loyaltyBusy === 'true') { control.disabled = false; delete control.dataset.loyaltyBusy; }
      });
    }
    function reset() {
      revision += 1; organization = null; payload = null; availability = null; writing = false; pendingOrganization = undefined;
      adjustmentRequestId = ''; redemptionRequestId = ''; promoRequestId = '';
      $('#loyaltyPanel').hidden = true; $('#loyaltyLoading').hidden = true; $('#loyaltyUnavailable').hidden = true; $('#loyaltyWorkspace').hidden = true;
    }
    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      if (writing) { pendingOrganization = normalized; revision += 1; $('#loyaltyPanel').hidden = !normalized; $('#loyaltyWorkspace').hidden = true; return { ok:false, optional:true, pending:true }; }
      if (!normalized) { reset(); return { ok:false, optional:true }; }
      if (!['owner','admin'].includes(normalized.current_role)) { reset(); return { ok:false, optional:true, forbidden:true }; }
      organization = normalized; pendingOrganization = undefined; return load();
    }
    async function load() {
      if (writing) return { ok:false, optional:true, pending:true };
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization?.id, current = ++revision;
      if (!userId || !organizationId) { reset(); return { ok:false, optional:true }; }
      availability = 'loading'; payload = null; $('#loyaltyPanel').hidden = false; $('#loyaltyLoading').hidden = false; $('#loyaltyUnavailable').hidden = true; $('#loyaltyWorkspace').hidden = true;
      const { data, error } = await db.rpc('get_minuta_loyalty_workspace', { p_organization:organizationId });
      if (!sessionIsCurrent(userId, generation) || current !== revision || organization?.id !== organizationId) return { ok:false, optional:true, stale:true };
      $('#loyaltyLoading').hidden = true;
      if (error) {
        availability = unsupported(error) ? 'unsupported' : 'error';
        if (availability === 'unsupported') { $('#loyaltyPanel').hidden = true; return { ok:false, optional:true, unsupported:true }; }
        $('#loyaltyUnavailable').hidden = false; $('#loyaltyUnavailableText').textContent = 'Записи и оплаты продолжают работать. Не удалось загрузить только бонусы.'; return { ok:false, optional:true };
      }
      if (!scopeMatches(data, organizationId)) { availability = 'error'; $('#loyaltyUnavailable').hidden = false; $('#loyaltyUnavailableText').textContent = 'Сервер вернул данные другой организации. Изменения заблокированы.'; return { ok:false, optional:true }; }
      payload = data;
      for (const key of ['clients','bookings','accounts','promotions','promo_redemptions','ledger']) if (!Array.isArray(payload[key])) payload[key] = [];
      availability = 'ready'; render(); return { ok:true, optional:true };
    }

    function accountCard(item) {
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(clientLabel(item.client_account_id))}</strong><small>Начислено ${escapeHtml(number(item.lifetime_earned))} · списано ${escapeHtml(number(item.lifetime_spent))}</small></div><span class="loyalty-balance">${escapeHtml(number(item.balance_points))} Б</span></article>`;
    }
    function promoCard(item) {
      const value = item.kind === 'percent' ? `${number(item.value / 100)}%` : money(item.value);
      const usage = `${item.usage_count || 0}${item.total_limit ? ` из ${item.total_limit}` : ''}`;
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(item.code)} · ${escapeHtml(value)}</strong><small>${escapeHtml(dateLabel(item.valid_from))} — ${escapeHtml(dateLabel(item.valid_until))} · использовано ${escapeHtml(usage)}</small></div><span class="organization-tags"><span class="organization-status ${item.active ? 'is-active' : ''}">${item.active ? 'Активен' : 'Выключен'}</span><button class="secondary-button" type="button" data-loyalty-promo-active="${item.active ? 'false' : 'true'}" data-loyalty-promo="${escapeHtml(item.id)}" data-loyalty-write>${item.active ? 'Выключить' : 'Включить'}</button></span></article>`;
    }
    function ledgerCard(item) {
      const labels = { visit_earned:'Начисление за визит', visit_reversed:'Отмена начисления', manual_adjustment:'Ручная корректировка', redemption:'Списание бонусов' };
      const sign = Number(item.points_delta) > 0 ? '+' : '';
      return `<article><div><strong>${escapeHtml(labels[item.event_type] || item.event_type)}</strong><small>${escapeHtml(clientLabel(item.client_account_id))}${item.reason ? ` · ${escapeHtml(item.reason)}` : ''}</small></div><span>${escapeHtml(`${sign}${number(item.points_delta)} Б · остаток ${number(item.balance_after)}`)}</span></article>`;
    }
    function render() {
      if (availability !== 'ready' || !payload) return;
      const rule = payload.rule || {};
      $('#loyaltyWorkspace').hidden = false; $('#loyaltyUnavailable').hidden = true;
      $('#loyaltyEnabled').checked = Boolean(payload.enabled); $('#loyaltyEnabled').disabled = payload.current_role !== 'owner';
      $('#loyaltyEarnPercent').value = String(Number(rule.earn_rate_bps || 500) / 100);
      $('#loyaltyMinPaid').value = Number(rule.min_paid_amount_rub || 0);
      $('#loyaltyMaxRedeemPercent').value = Number(payload.max_redeem_percent_bps || 3000) / 100;
      $('#loyaltyRuleForm').hidden = !payload.enabled;
      $('#loyaltyActions').hidden = !payload.enabled;
      $('#loyaltyBalancesList').innerHTML = payload.accounts.length ? payload.accounts.map(accountCard).join('') : empty('Бонусов пока нет', 'Баланс появится после начисления или ручной корректировки.');
      $('#loyaltyPromotionsList').innerHTML = payload.promotions.length ? payload.promotions.map(promoCard).join('') : empty('Промокодов пока нет', 'Создайте первый промокод с периодом и лимитами.');
      $('#loyaltyLedgerList').innerHTML = payload.ledger.length ? payload.ledger.map(ledgerCard).join('') : empty('Журнал пуст', 'Все начисления и списания будут записаны неизменяемо.');
      const clientOptions = optionsList(payload.clients, item => `${item.client_name} · ${item.client_phone}`);
      $('#loyaltyAdjustmentClient').innerHTML = clientOptions;
      $('#loyaltyRedeemClient').innerHTML = clientOptions;
      $('#loyaltyPromoClient').innerHTML = clientOptions;
      renderBookingOptions('loyaltyRedeemClient', 'loyaltyRedeemBooking');
      renderBookingOptions('loyaltyPromoClient', 'loyaltyPromoBooking');
      ensurePromoDefaults();
      const workflow = $('#loyaltyWorkflowStatus');
      if (workflow) workflow.textContent = !payload.enabled
        ? 'Программа выключена. Включите переключатель выше, затем сохраните правила.'
        : payload.accounts.length
          ? `Программа включена. Клиентов с бонусным балансом: ${payload.accounts.length}.`
          : 'Программа включена. Баланс появится после первого завершённого и оплаченного визита.';
      setBusy(false); applyWriteAvailability();
    }
    function renderBookingOptions(clientId, bookingId) {
      const client = $(`#${clientId}`).value;
      const bookings = payload.bookings.filter(item => item.client_account_id === client && (
        bookingId !== 'loyaltyRedeemBooking'
        || (item.visit_status === 'completed' && item.payment_method !== 'unpaid' && Number(item.amount_rub) > 0)
      ));
      $(`#${bookingId}`).innerHTML = optionsList(bookings, bookingLabel);
    }
    function messageFor(error) {
      const text = `${error?.message || ''} ${error?.details || ''}`;
      const rows = [
        ['loyalty_disabled','Сначала включите бонусную программу.'],['owner_required','Изменить включение может только владелец.'],
        ['booking_benefit_conflict','Для одной записи можно выбрать только один вариант: абонемент или сертификат, бонусы либо промокод.'],
        ['loyalty_client_not_in_organization','Клиент не относится к этой организации.'],['insufficient_loyalty_balance','Недостаточно бонусов.'],
        ['loyalty_redemption_limit_exceeded','Сумма превышает разрешённую долю оплаты.'],['loyalty_booking_not_paid','Сначала завершите и отметьте оплату визита.'],
        ['loyalty_request_conflict','Повтор запроса содержит другие данные. Обновите раздел.'],['promo_not_available','Промокод недоступен или срок закончился.'],
        ['promo_total_limit_reached','Общий лимит промокода исчерпан.'],['promo_client_limit_reached','Лимит промокода для клиента исчерпан.'],
        ['promo_already_applied','К этой записи уже применён промокод.'],['invalid_promotion','Заполните код, размер скидки и период действия. Проверьте, что дата окончания не раньше даты начала.'],
        ['promo_discount_zero','Для этой записи скидка получилась равной нулю.'],['invalid_loyalty_adjustment','Укажите целое количество бонусов и причину длиной не менее 8 символов.'],
        ['invalid_loyalty_redemption','Укажите положительное целое количество бонусов.'],['loyalty_booking_already_redeemed','Бонусы для этой записи уже списаны.']
      ];
      return rows.find(([key]) => text.includes(key))?.[1] || 'Изменение не сохранено. Записи и деньги не затронуты.';
    }
    async function mutate(rpc, parameters, button, success, errorHolder) {
      if (!requireWrites() || writing || availability !== 'ready' || !scopeMatches(payload, organization?.id)) return false;
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization.id, current = ++revision;
      writing = true; setBusy(true); if (errorHolder) { $(errorHolder).hidden = true; $(errorHolder).textContent = ''; }
      const old = button?.textContent; if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      const { data, error } = await db.rpc(rpc, parameters); if (button) button.textContent = old;
      const stale = !sessionIsCurrent(userId, generation) || current !== revision || organization?.id !== organizationId; writing = false;
      if (stale) { const next = pendingOrganization; pendingOrganization = undefined; if (next !== undefined) await setOrganization(next); return false; }
      if (error) { const message = messageFor(error); if (errorHolder) { $(errorHolder).textContent = message; $(errorHolder).hidden = false; } else notify(message); await load(); return false; }
      if (!scopeMatches(data, organizationId)) { notify('Ответ другой организации заблокирован.'); await load(); return false; }
      notify(success); await load(); return true;
    }
    async function submit(event) {
      if (!event.target.closest('#loyaltyPanel')) return;
      if (event.target.id === 'loyaltyRuleForm') {
        event.preventDefault();
        await mutate('upsert_minuta_loyalty_rule', { p_organization:organization.id, p_name:$('#loyaltyRuleName').value.trim(), p_earn_rate_bps:Math.round(Number($('#loyaltyEarnPercent').value) * 100), p_min_paid_amount_rub:Math.round(Number($('#loyaltyMinPaid').value)), p_max_redeem_percent_bps:Math.round(Number($('#loyaltyMaxRedeemPercent').value) * 100) }, event.submitter, 'Правила лояльности сохранены', '#loyaltyRuleError'); return;
      }
      if (event.target.id === 'loyaltyAdjustmentForm') {
        event.preventDefault(); adjustmentRequestId = adjustmentRequestId || uuid();
        const ok = await mutate('adjust_minuta_loyalty_balance', { p_organization:organization.id, p_client_account:$('#loyaltyAdjustmentClient').value, p_points_delta:Math.round(Number($('#loyaltyAdjustmentPoints').value)), p_reason:$('#loyaltyAdjustmentReason').value.trim(), p_request_id:adjustmentRequestId }, event.submitter, 'Баланс скорректирован', '#loyaltyAdjustmentError');
        if (ok) { adjustmentRequestId = ''; event.target.reset(); } return;
      }
      if (event.target.id === 'loyaltyRedeemForm') {
        event.preventDefault(); redemptionRequestId = redemptionRequestId || uuid();
        const ok = await mutate('redeem_minuta_loyalty', { p_organization:organization.id, p_booking:$('#loyaltyRedeemBooking').value, p_points:Math.round(Number($('#loyaltyRedeemPoints').value)), p_request_id:redemptionRequestId }, event.submitter, 'Бонусы списаны', '#loyaltyRedeemError');
        if (ok) { redemptionRequestId = ''; event.target.reset(); renderBookingOptions('loyaltyRedeemClient', 'loyaltyRedeemBooking'); } return;
      }
      if (event.target.id === 'loyaltyPromoForm') {
        event.preventDefault(); const kind = $('#loyaltyPromoKind').value;
        const ok = await mutate('upsert_minuta_promotion', { p_organization:organization.id, p_code:$('#loyaltyPromoCode').value.trim(), p_kind:kind, p_value:Math.round(Number($('#loyaltyPromoValue').value) * (kind === 'percent' ? 100 : 1)), p_valid_from:$('#loyaltyPromoFrom').value, p_valid_until:$('#loyaltyPromoUntil').value, p_total_limit:Math.round(Number($('#loyaltyPromoTotalLimit').value)) || null, p_per_client_limit:Math.round(Number($('#loyaltyPromoClientLimit').value)) || null }, event.submitter, 'Промокод сохранён', '#loyaltyPromoError');
        if (ok) { event.target.reset(); ensurePromoDefaults(); } return;
      }
      if (event.target.id === 'loyaltyPromoApplyForm') {
        event.preventDefault(); promoRequestId = promoRequestId || uuid();
        const ok = await mutate('redeem_minuta_promotion', { p_organization:organization.id, p_code:$('#loyaltyPromoApplyCode').value.trim(), p_booking:$('#loyaltyPromoBooking').value, p_request_id:promoRequestId }, event.submitter, 'Промокод применён и проверен сервером', '#loyaltyPromoApplyError');
        if (ok) { promoRequestId = ''; event.target.reset(); renderBookingOptions('loyaltyPromoClient', 'loyaltyPromoBooking'); }
      }
    }
    async function click(event) {
      if (event.target.closest('#reloadLoyalty')) { await load(); return; }
      const toggle = event.target.closest('[data-loyalty-promo-active]');
      if (toggle) await mutate('set_minuta_promotion_active', { p_organization:organization.id, p_promotion:toggle.dataset.loyaltyPromo, p_active:toggle.dataset.loyaltyPromoActive === 'true' }, toggle, 'Статус промокода обновлён');
    }
    async function change(event) {
      if (event.target.id === 'loyaltyEnabled') { const desired = event.target.checked; const ok = await mutate('set_minuta_loyalty_enabled', { p_organization:organization.id, p_enabled:desired }, event.target, desired ? 'Бонусная программа включена' : 'Бонусная программа выключена'); if (!ok && payload) event.target.checked = Boolean(payload.enabled); }
      if (event.target.id === 'loyaltyRedeemClient') { redemptionRequestId = ''; renderBookingOptions('loyaltyRedeemClient', 'loyaltyRedeemBooking'); }
      if (event.target.id === 'loyaltyPromoClient') { promoRequestId = ''; renderBookingOptions('loyaltyPromoClient', 'loyaltyPromoBooking'); }
      if (event.target.closest('#loyaltyAdjustmentForm')) adjustmentRequestId = '';
      if (event.target.closest('#loyaltyRedeemForm')) redemptionRequestId = '';
      if (event.target.closest('#loyaltyPromoApplyForm')) promoRequestId = '';
      if (event.target.id === 'loyaltyPromoKind') {
        const percent = event.target.value === 'percent';
        $('#loyaltyPromoValueLabel').textContent = percent ? 'Скидка, %' : 'Скидка, ₽';
        $('#loyaltyPromoValue').max = percent ? '100' : '10000000';
        $('#loyaltyPromoValue').placeholder = percent ? 'Например, 10' : 'Например, 500';
        $('#loyaltyPromoValueHint').textContent = percent ? 'Введите 10, чтобы дать скидку 10%.' : 'Введите сумму скидки в рублях.';
      }
    }
    function invalid(event) {
      if (!event.target.closest('#loyaltyPanel')) return;
      const form = event.target.form;
      const holders = { loyaltyRuleForm:'#loyaltyRuleError', loyaltyAdjustmentForm:'#loyaltyAdjustmentError', loyaltyRedeemForm:'#loyaltyRedeemError', loyaltyPromoForm:'#loyaltyPromoError', loyaltyPromoApplyForm:'#loyaltyPromoApplyError' };
      const holder = holders[form?.id];
      if (!holder) return;
      const messages = {
        loyaltyPromoCode:'Введите код промокода. WELCOME10 в сером цвете является только примером.',
        loyaltyPromoValue:'Укажите размер скидки.', loyaltyPromoFrom:'Укажите дату начала действия.', loyaltyPromoUntil:'Укажите дату окончания действия.',
        loyaltyPromoClient:'Сначала выберите клиента.', loyaltyPromoBooking:'У выбранного клиента нет подходящей записи.', loyaltyPromoApplyCode:'Введите созданный промокод.',
        loyaltyAdjustmentClient:'Сначала выберите клиента.', loyaltyAdjustmentPoints:'Укажите количество бонусов.', loyaltyAdjustmentReason:'Напишите причину длиной не менее 8 символов.',
        loyaltyRedeemClient:'Сначала выберите клиента.', loyaltyRedeemBooking:'Нет завершённого оплаченного визита для списания.', loyaltyRedeemPoints:'Укажите количество бонусов для списания.'
      };
      showFormError(holder, messages[event.target.id] || 'Заполните обязательное поле и проверьте введённое значение.');
    }
    function input(event) {
      if (['loyaltyPromoCode','loyaltyPromoApplyCode'].includes(event.target.id)) event.target.value = event.target.value.toUpperCase().replace(/[^A-ZА-ЯЁ0-9_-]/g, '');
      const holder = event.target.form?.querySelector('.form-error');
      if (holder && !holder.hidden) { holder.hidden = true; holder.textContent = ''; }
    }
    function bind() { document.addEventListener('submit', submit); document.addEventListener('click', click); document.addEventListener('change', change); document.addEventListener('invalid', invalid, true); document.addEventListener('input', input); }
    return { bind, load, reset, setOrganization, get availability() { return availability; }, get payload() { return payload; } };
  }

  window.MinutaLoyalty = { createController };
})();
