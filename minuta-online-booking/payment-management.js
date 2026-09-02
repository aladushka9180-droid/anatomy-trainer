(function initMinutaPayments(global) {
  'use strict';

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites } = options;
    const refreshNavigation = typeof options.refreshNavigation === 'function' ? options.refreshNavigation : () => {};
    let organization = null;
    let payload = null;
    let available = null;
    let busy = false;

    function isMissing(error) {
      return /PGRST202|42883|get_minuta_payment_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }
    function currentRole() { return String(payload?.current_role || organization?.current_role || ''); }
    function manager() { return ['owner', 'admin'].includes(currentRole()); }
    function owner() { return currentRole() === 'owner'; }
    function moneyMinor(value) { return `${new Intl.NumberFormat('ru-RU', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(Number(value || 0) / 100)} ₽`; }
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
      if ($('#paymentProviderPanel')) $('#paymentProviderPanel').hidden = true;
      refreshNavigation();
    }
    async function load() {
      if (!organization) return;
      if (!manager()) { available = false; render(); return; }
      const result = await db.rpc('get_minuta_payment_workspace', { p_organization:organization.id });
      if (result.error) {
        const denied = /42501|payment_access_denied/i.test(`${result.error.code || ''} ${result.error.message || ''}`);
        available = isMissing(result.error) || denied ? false : null;
        render(result.error);
        return;
      }
      available = true;
      payload = result.data || {};
      render();
    }
    async function setOrganization(next) {
      organization = next?.id ? next : null;
      payload = null;
      available = null;
      if (!organization) { reset(); return; }
      if (!manager()) { available = false; render(); return; }
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
        return `<article><div><strong>${escapeHtml(moneyMinor(item.amount_minor))}</strong><small>${escapeHtml(statusLabel(item.status))} · ${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></div><span>${remaining > 0 ? `доступно к возврату ${escapeHtml(moneyMinor(remaining))}` : ''}</span></article>`;
      }).join('') : '<div class="provider-empty compact-empty"><strong>Платежей пока нет</strong><small>Операции появятся после включения ЮKassa и первой предоплаты.</small></div>';
      const refundable = attempts.filter((item) => Number(item.captured_amount_minor || 0) > Number(item.refunded_amount_minor || 0));
      $('#paymentRefundAttempt').innerHTML = refundable.map((item) => {
        const remaining = Number(item.captured_amount_minor || 0) - Number(item.refunded_amount_minor || 0);
        return `<option value="${escapeHtml(item.id)}" data-remaining="${remaining}">${escapeHtml(moneyMinor(remaining))} · ${escapeHtml(String(item.id).slice(0, 8))}</option>`;
      }).join('');
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
      const option = $('#paymentRefundAttempt')?.selectedOptions?.[0];
      const remaining = Number(option?.dataset.remaining || 0);
      if ($('#paymentRefundAmount')) {
        $('#paymentRefundAmount').max = String(remaining / 100);
        if (!$('#paymentRefundAmount').value || Number($('#paymentRefundAmount').value) > remaining / 100) $('#paymentRefundAmount').value = String(remaining / 100);
      }
      updateFiscalization();
    }
    async function submit(event) {
      if (event.target.id === 'paymentProviderSettingsForm') {
        event.preventDefault();
        if (!organization || !owner() || busy || !requireWrites()) return;
        setBusy(true);
        const fiscal = $('#paymentFiscalizationEnabled').checked;
        const result = await db.rpc('set_minuta_yookassa_settings', {
          p_organization:organization.id,
          p_enabled:$('#paymentProviderEnabled').checked,
          p_environment:$('#paymentProviderEnvironment').value,
          p_fiscalization_enabled:fiscal,
          p_taxation:fiscal ? $('#paymentTaxation').value : null,
          p_vat_code:fiscal ? Number($('#paymentVatCode').value) : null,
          p_payment_mode:fiscal ? $('#paymentMode').value : null
        });
        setBusy(false);
        if (result.error) { notify('Не удалось сохранить настройки ЮKassa'); return; }
        await load();
        notify('Настройки ЮKassa сохранены');
        return;
      }
      if (event.target.id !== 'paymentRefundForm') return;
      event.preventDefault();
      if (!organization || busy || !manager() || !requireWrites()) return;
      const amountMinor = Math.round(Number($('#paymentRefundAmount').value) * 100);
      const reason = $('#paymentRefundReason').value.trim();
      if (!Number.isSafeInteger(amountMinor) || amountMinor < 100 || reason.length < 8) {
        notify('Укажите сумму и причину возврата не короче 8 символов');
        return;
      }
      setBusy(true);
      const result = await db.functions.invoke('yookassa-refund', { body:{
        organization_id:organization.id,
        attempt_id:$('#paymentRefundAttempt').value,
        request_id:requestId(),
        amount_minor:amountMinor,
        reason
      }});
      setBusy(false);
      if (result.error || !result.data?.ok) { notify('Возврат не подтверждён. Проверьте настройки и журнал операций.'); await load(); return; }
      event.target.reset();
      await load();
      notify(result.data.status === 'succeeded' ? 'Возврат выполнен' : 'Возврат принят в обработку');
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
