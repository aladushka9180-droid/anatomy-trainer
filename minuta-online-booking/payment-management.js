(function initMinutaPayments(global) {
  'use strict';

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites } = options;
    const refreshNavigation = typeof options.refreshNavigation === 'function' ? options.refreshNavigation : () => {};
    let organization = null;
    let payload = null;
    let available = null;
    let busy = false;
    let refundSelectionInitialized = false;
    let contextRevision = 0;
    let loadRevision = 0;
    let operationRevision = 0;

    // UI lifetime only: these tokens do not cancel or deduplicate server refunds.
    function currentContext() {
      const revision = contextRevision;
      const organizationId = organization?.id;
      const role = currentRole();
      return () => revision === contextRevision && organization?.id === organizationId && currentRole() === role;
    }
    function invalidateContext() {
      contextRevision += 1;
      loadRevision += 1;
      setBusy(false);
    }
    function beginOperation() {
      const contextIsCurrent = currentContext();
      const revision = ++operationRevision;
      setBusy(true);
      return () => contextIsCurrent() && revision === operationRevision;
    }

    function isMissing(error) {
      return /PGRST202|42883|get_minuta_payment_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function currentRole() { return String(payload?.current_role || organization?.current_role || ''); }
    function manager() { return ['owner', 'admin'].includes(currentRole()); }
    function owner() { return currentRole() === 'owner'; }
    function moneyMinor(value) { return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number(value || 0) / 100)} ₽`; }
    function parseRefundAmount(value) {
      const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(String(value ?? '').trim());
      if (!match) return null;
      // Convert decimal integer digits, never a floating-point RUB amount.
      const amount = Number(`${match[1]}${(match[2] || '').padEnd(2, '0')}`);
      return Number.isSafeInteger(amount) ? amount : null;
    }
    function minorInteger(value) {
      if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
      const amount = Number(value);
      return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
    }
    function refundRemaining() {
      const attempts = Array.isArray(payload?.recent_attempts) ? payload.recent_attempts : [];
      const attempt = attempts.find((item) => item.id === $('#paymentRefundAttempt').value);
      const captured = minorInteger(attempt?.captured_amount_minor);
      const refunded = minorInteger(attempt?.refunded_amount_minor);
      return captured !== null && refunded !== null && refunded <= captured ? captured - refunded : null;
    }
    function minorInputValue(amount) {
      const digits = String(amount).padStart(3, '0');
      return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
    }
    function requestId() {
      if (!global.crypto?.randomUUID) throw new Error('secure_request_id_unavailable');
      return global.crypto.randomUUID();
    }
    function setBusy(value) {
      busy = value;
      $('#paymentProviderPanel')?.querySelectorAll('button,input,select').forEach((item) => { item.disabled = value; });
    }
    function reset() {
      organization = null; payload = null; available = null; busy = false;
      invalidateContext();
      refundSelectionInitialized = false;
      if ($('#paymentProviderPanel')) $('#paymentProviderPanel').hidden = true;
      refreshNavigation();
    }
    async function load() {
      if (!organization) return;
      if (!manager()) { available = false; render(); return; }
      const contextIsCurrent = currentContext();
      const revision = ++loadRevision;
      const isCurrent = () => contextIsCurrent() && revision === loadRevision;
      try {
        const result = await db.rpc('get_minuta_payment_workspace', { p_organization:organization.id });
        if (!isCurrent()) return;
        if (result.error) {
          const denied = /42501|payment_access_denied/i.test(`${result.error.code || ''} ${result.error.message || ''}`);
          if (denied) invalidateContext();
          available = isMissing(result.error) || denied ? false : null;
          render(result.error);
          return;
        }
        if (String(result.data?.current_role || organization.current_role || '') !== currentRole()) invalidateContext();
        available = true;
        payload = result.data || {};
        render();
      } catch (error) {
        if (!isCurrent()) return;
        available = null;
        render(error);
      }
    }
    async function setOrganization(next) {
      const changed = (next?.id || null) !== (organization?.id || null)
        || String(next?.current_role || '') !== currentRole();
      if (changed) invalidateContext();
      organization = next?.id ? next : null;
      payload = null;
      available = null;
      if (!organization) { reset(); return; }
      if (!manager()) { available = false; render(); return; }
      if (changed) render();
      await load();
    }
    function statusLabel(value) {
      return ({ creating:'создаётся', pending:'ожидает оплаты', succeeded:'оплачено', canceled:'отменено', failed:'ошибка', partially_refunded:'частично возвращено', refunded:'возвращено' })[value] || value || '—';
    }
    function render(error = null) {
      const panel = $('#paymentProviderPanel');
      if (!panel) return;
      panel.hidden = !organization || !manager() || available === false;
      if (panel.hidden) { refreshNavigation(); return; }
      $('#paymentProviderUnavailable').hidden = available !== null;
      $('#paymentProviderWorkspace').hidden = available !== true;
      if (available !== true) {
        $('#paymentProviderUnavailableText').textContent = error ? 'Не удалось загрузить платёжный модуль. Записи продолжают работать без онлайн-эквайринга.' : '';
        refreshNavigation();
        return;
      }
      const settings = payload.settings || {};
      $('#paymentProviderEnabled').checked = Boolean(settings.enabled);
      $('#paymentProviderEnvironment').value = settings.environment || 'test';
      $('#paymentFiscalizationEnabled').checked = Boolean(settings.fiscalization_enabled);
      $('#paymentTaxation').value = settings.taxation || 'usn_income';
      $('#paymentVatCode').value = String(settings.vat_code || 1);
      $('#paymentMode').value = settings.payment_mode || 'full_prepayment';
      $('#paymentProviderState').textContent = settings.enabled
        ? `ЮKassa включена в режиме «${settings.environment === 'production' ? 'рабочий' : 'тестовый'}»`
        : 'ЮKassa подготовлена, но выключена';
      $('#paymentProviderSettingsForm').hidden = !owner();
      $('#paymentProviderControls').hidden = !owner();
      const attempts = Array.isArray(payload.recent_attempts) ? payload.recent_attempts : [];
      $('#paymentAttemptsList').innerHTML = attempts.length ? attempts.map((item) => {
        const remaining = Math.max(0, Number(item.captured_amount_minor || 0) - Number(item.refunded_amount_minor || 0));
        return `<article class="organization-row payment-attempt-row"><div><strong>${escapeHtml(moneyMinor(item.amount_minor))}</strong><small>${escapeHtml(statusLabel(item.status))} · ${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></div><span>${remaining > 0 ? `доступно к возврату ${escapeHtml(moneyMinor(remaining))}` : ''}</span></article>`;
      }).join('') : '<div class="provider-empty compact-empty"><strong>Платежей пока нет</strong><small>Операции появятся после включения ЮKassa и первой предоплаты.</small></div>';
      const refundable = attempts.filter((item) => Number(item.captured_amount_minor || 0) > Number(item.refunded_amount_minor || 0));
      const previousAttempt = $('#paymentRefundAttempt').value;
      const maySelectInitial = !refundSelectionInitialized
        && !$('#paymentRefundAmount').value && !$('#paymentRefundReason').value;
      $('#paymentRefundAttempt').innerHTML = refundable.map((item) => {
        const remaining = Number(item.captured_amount_minor || 0) - Number(item.refunded_amount_minor || 0);
        return `<option value="${escapeHtml(item.id)}" data-remaining="${remaining}">${escapeHtml(moneyMinor(remaining))} · ${escapeHtml(String(item.id).slice(0, 8))}</option>`;
      }).join('');
      if (!maySelectInitial) {
        const stillRefundable = refundable.some((item) => item.id === previousAttempt);
        $('#paymentRefundAttempt').value = stillRefundable ? previousAttempt : '';
        if (previousAttempt && !stillRefundable) {
          notify('Выбранный платёж больше не доступен для возврата. Выберите платёж заново. Сумма и причина сохранены.');
        }
      }
      refundSelectionInitialized = true;
      $('#paymentRefundForm').hidden = !manager() || !refundable.length;
      updateRefundAmount();
      setBusy(busy);
      refreshNavigation();
    }
    function updateFiscalization() {
      const enabled = $('#paymentFiscalizationEnabled')?.checked;
      $('#paymentFiscalizationFields').hidden = !enabled;
    }
    function updateRefundAmount() {
      const remaining = refundRemaining();
      if ($('#paymentRefundAmount')) {
        $('#paymentRefundAmount').max = remaining === null ? '' : minorInputValue(remaining);
        if (!$('#paymentRefundAmount').value && remaining !== null) $('#paymentRefundAmount').value = minorInputValue(remaining);
      }
      updateFiscalization();
    }
    async function submit(event) {
      if (event.target.id === 'paymentProviderSettingsForm') {
        event.preventDefault();
        if (!organization || !owner() || busy || !requireWrites()) return;
        const isCurrent = beginOperation();
        const fiscal = $('#paymentFiscalizationEnabled').checked;
        try {
          const result = await db.rpc('set_minuta_yookassa_settings', {
            p_organization:organization.id,
            p_enabled:$('#paymentProviderEnabled').checked,
            p_environment:$('#paymentProviderEnvironment').value,
            p_fiscalization_enabled:fiscal,
            p_taxation:fiscal ? $('#paymentTaxation').value : null,
            p_vat_code:fiscal ? Number($('#paymentVatCode').value) : null,
            p_payment_mode:fiscal ? $('#paymentMode').value : null
          });
          if (!isCurrent()) return;
          setBusy(false);
          if (result.error) { notify('Сохранение настроек ЮKassa не подтверждено. Проверьте настройки.'); return; }
          await load();
          if (isCurrent()) notify('Настройки ЮKassa сохранены');
        } catch {
          if (isCurrent()) notify('Сохранение настроек ЮKassa не подтверждено. Проверьте настройки.');
        } finally {
          if (isCurrent()) setBusy(false);
        }
        return;
      }
      if (event.target.id !== 'paymentRefundForm') return;
      event.preventDefault();
      if (!organization || busy || !manager() || !requireWrites()) return;
      if (!$('#paymentRefundAttempt').value) {
        notify('Выберите платёж для возврата. Сумма и причина не изменены.');
        return;
      }
      const amountMinor = parseRefundAmount($('#paymentRefundAmount').value);
      const reason = $('#paymentRefundReason').value.trim();
      if (amountMinor === null) {
        notify('Укажите точную сумму в рублях: не больше двух знаков после запятой, без округления. Сумма должна быть в допустимом диапазоне.');
        return;
      }
      if (amountMinor < 100) {
        notify('Минимальная сумма возврата через ЮKassa — 1 ₽. Сумма не изменена.');
        return;
      }
      const remaining = refundRemaining();
      if (remaining === null) {
        notify('Не удалось проверить доступную сумму возврата. Обновите журнал операций.');
        return;
      }
      if (amountMinor > remaining) {
        notify(`Сумма возврата превышает доступные ${minorInputValue(remaining).replace('.', ',')} ₽. Проверьте журнал операций. Сумма не изменена.`);
        return;
      }
      const remainder = remaining - amountMinor;
      if (remainder > 0 && remainder < 100) {
        const full = `${minorInputValue(remaining).replace('.', ',')} ₽`;
        const alternative = remaining >= 200
          ? `Выберите сумму не больше ${minorInputValue(remaining - 100).replace('.', ',')} ₽ или верните весь остаток — ${full}.`
          : `Можно вернуть весь остаток — ${full}.`;
        notify(`После возврата через ЮKassa должно остаться 0 ₽ или не меньше 1 ₽. ${alternative} Сумма не изменена.`);
        return;
      }
      if (reason.length < 8) {
        notify('Укажите причину возврата не короче 8 символов');
        return;
      }
      const isCurrent = beginOperation();
      try {
        const result = await db.functions.invoke('yookassa-refund', { body:{
          organization_id:organization.id,
          attempt_id:$('#paymentRefundAttempt').value,
          request_id:requestId(),
          amount_minor:amountMinor,
          reason
        }});
        if (!isCurrent()) return;
        setBusy(false);
        if (result.error || !result.data?.ok) { notify('Возврат не подтверждён. Проверьте настройки и журнал операций.'); await load(); return; }
        event.target.reset();
        await load();
        if (isCurrent()) notify(result.data.status === 'succeeded' ? 'Возврат выполнен' : 'Возврат принят в обработку');
      } catch {
        if (isCurrent()) {
          notify('Возврат не подтверждён. Проверьте настройки и журнал операций.');
          await load();
        }
      } finally {
        if (isCurrent()) setBusy(false);
      }
    }
    function change(event) {
      if (event.target.id === 'paymentFiscalizationEnabled' || event.target.id === 'paymentRefundAttempt') updateRefundAmount();
    }
    function bind() {
      document.addEventListener('submit', submit);
      document.addEventListener('change', change);
      $('#reloadPaymentProvider')?.addEventListener('click', load);
    }
    return {
      bind,
      load,
      setOrganization,
      reset,
      isCheckoutEnabled: () => available === true && Boolean(payload?.settings?.enabled)
    };
  }

  global.MinutaPayments = { createController };
})(window);
