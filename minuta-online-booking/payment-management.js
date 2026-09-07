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
    function scopeMatches(data, organizationId) {
      return Boolean(data && typeof data === 'object' && String(data.organization_id || '') === String(organizationId || ''));
    }
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
      return attemptRemaining(attempt);
    }
    function attemptRemaining(attempt) {
      if (!attempt || attempt.status !== 'succeeded') return null;
      const captured = minorInteger(attempt.captured_amount_minor);
      const refunded = minorInteger(attempt.refunded_amount_minor);
      if (captured === null || refunded === null || refunded > captured) return null;
      const pending = (Array.isArray(payload?.recent_refunds) ? payload.recent_refunds : [])
        .filter(item => item.attempt_id === attempt.id && ['creating', 'pending'].includes(item.status))
        .reduce((sum, item) => {
          const amount = minorInteger(item.amount_minor);
          return amount === null ? sum : sum + amount;
        }, 0);
      return Math.max(0, captured - refunded - pending);
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
      if (!organization) return { ok:false, optional:true };
      if (!manager()) { available = false; render(); return { ok:false, optional:true, denied:true }; }
      const organizationId = organization.id;
      const contextIsCurrent = currentContext();
      const revision = ++loadRevision;
      const isCurrent = () => contextIsCurrent() && revision === loadRevision;
      try {
        const result = await db.rpc('get_minuta_payment_workspace', { p_organization:organization.id });
        if (!isCurrent()) return { ok:false, optional:true, stale:true };
        if (result.error) {
          const denied = /42501|payment_access_denied/i.test(`${result.error.code || ''} ${result.error.message || ''}`);
          if (denied) invalidateContext();
          available = isMissing(result.error) || denied ? false : null;
          render(result.error);
          return { ok:false, optional:true, unavailable:true };
        }
        if (!scopeMatches(result.data, organizationId)) {
          payload = null;
          available = null;
          render({ code:'payment_workspace_scope_mismatch' });
          return { ok:false, optional:true, scopeMismatch:true };
        }
        if (String(result.data?.current_role || organization.current_role || '') !== currentRole()) invalidateContext();
        available = true;
        payload = result.data || {};
        render();
        return { ok:true, optional:true };
      } catch (error) {
        if (!isCurrent()) return { ok:false, optional:true, stale:true };
        available = null;
        render(error);
        return { ok:false, optional:true, unavailable:true };
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
      return ({ creating:'создаётся', pending:'ожидает оплаты', succeeded:'оплачено', canceled:'отменено', failed:'ошибка', partially_refunded:'частично возвращено', refunded:'возвращено', matched:'сверено', mismatch:'расхождение' })[value] || value || '—';
    }
    function refundStatusLabel(value) {
      return ({ creating:'создаётся', pending:'в обработке', succeeded:'выполнено', canceled:'отменено', failed:'ошибка' })[value] || value || '—';
    }
    function render(error = null) {
      const panel = $('#paymentProviderPanel');
      if (!panel) return;
      panel.hidden = !organization || !manager() || available === false;
      if (panel.hidden) { refreshNavigation(); return; }
      $('#paymentProviderUnavailable').hidden = available !== null;
      $('#paymentProviderWorkspace').hidden = available !== true;
      if (available !== true) {
        $('#paymentProviderUnavailableText').textContent = error?.code === 'payment_workspace_scope_mismatch'
          ? 'Сервер вернул данные другой организации. Платёжные действия заблокированы.'
          : error ? 'Не удалось загрузить платёжный модуль. Записи продолжают работать без онлайн-эквайринга.' : 'Проверяем защищённые настройки и операции…';
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
      const attempts = Array.isArray(payload.recent_attempts) ? payload.recent_attempts : [];
      const refunds = Array.isArray(payload.recent_refunds) ? payload.recent_refunds : [];
      const reconciliations = Array.isArray(payload.recent_reconciliations) ? payload.recent_reconciliations : [];
      const testPaymentSucceeded = attempts.some(item => item.environment === 'test' && item.status === 'succeeded');
      $('#paymentProviderState').textContent = settings.enabled
        ? `ЮKassa включена в режиме «${settings.environment === 'production' ? 'рабочий' : 'тестовый'}»`
        : testPaymentSucceeded ? 'Тестовый платёж подтверждён, приём выключен' : 'Тестовый платёж ещё не подтверждён';
      $('#paymentProviderSettingsForm').hidden = !owner();
      $('#paymentProviderControls').hidden = !owner();
      const operationRows = [
        ...attempts.map(item => {
          const remaining = attemptRemaining(item);
          return `<article class="organization-row payment-attempt-row"><div><strong>Платёж · ${escapeHtml(moneyMinor(item.amount_minor))}</strong><small>${escapeHtml(statusLabel(item.status))} · ${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></div><span>${remaining > 0 ? `доступно к возврату ${escapeHtml(moneyMinor(remaining))}` : ''}</span></article>`;
        }),
        ...refunds.map(item => `<article class="organization-row payment-attempt-row"><div><strong>Возврат · ${escapeHtml(moneyMinor(item.amount_minor))}</strong><small>${escapeHtml(refundStatusLabel(item.status))} · ${escapeHtml(item.reason || 'Без пояснения')} · ${escapeHtml(new Date(item.created_at).toLocaleString('ru-RU'))}</small></div><span>${['creating','pending'].includes(item.status) ? 'сумма зарезервирована' : ''}</span></article>`),
        ...reconciliations.map(item => `<article class="organization-row payment-attempt-row"><div><strong>Сверка · ${escapeHtml(statusLabel(item.outcome))}</strong><small>${escapeHtml(item.object_kind || 'операция')} · ${escapeHtml(new Date(item.checked_at).toLocaleString('ru-RU'))}</small></div><span>${item.amount_minor == null ? '' : escapeHtml(moneyMinor(item.amount_minor))}</span></article>`)
      ];
      $('#paymentAttemptsList').innerHTML = operationRows.length ? operationRows.join('') : '<div class="provider-empty compact-empty"><strong>Платежей пока нет</strong><small>Операции появятся после включения ЮKassa и первой предоплаты.</small></div>';
      const refundable = attempts.filter(item => item.status === 'succeeded' && Number.isSafeInteger(attemptRemaining(item)) && attemptRemaining(item) >= 100);
      const previousAttempt = $('#paymentRefundAttempt').value;
      const maySelectInitial = !refundSelectionInitialized
        && !$('#paymentRefundAmount').value && !$('#paymentRefundReason').value;
      $('#paymentRefundAttempt').innerHTML = refundable.map((item) => {
        const remaining = attemptRemaining(item);
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
    function settingsMatch(actual, expected) {
      return Boolean(actual)
        && Boolean(actual.enabled) === expected.enabled
        && String(actual.environment || 'test') === expected.environment
        && Boolean(actual.fiscalization_enabled) === expected.fiscalization_enabled
        && (!expected.fiscalization_enabled || (
          String(actual.taxation || '') === expected.taxation
          && Number(actual.vat_code) === expected.vat_code
          && String(actual.payment_mode || '') === expected.payment_mode
        ));
    }
    async function submit(event) {
      if (event.target.id === 'paymentProviderSettingsForm') {
        event.preventDefault();
        if (!organization || !owner() || busy || !requireWrites()) return;
        const isCurrent = beginOperation();
        const fiscal = $('#paymentFiscalizationEnabled').checked;
        const expected = {
          enabled:$('#paymentProviderEnabled').checked,
          environment:$('#paymentProviderEnvironment').value,
          fiscalization_enabled:fiscal,
          taxation:fiscal ? $('#paymentTaxation').value : null,
          vat_code:fiscal ? Number($('#paymentVatCode').value) : null,
          payment_mode:fiscal ? $('#paymentMode').value : null
        };
        try {
          const result = await db.rpc('set_minuta_yookassa_settings', {
            p_organization:organization.id,
            p_enabled:expected.enabled,
            p_environment:expected.environment,
            p_fiscalization_enabled:expected.fiscalization_enabled,
            p_taxation:expected.taxation,
            p_vat_code:expected.vat_code,
            p_payment_mode:expected.payment_mode
          });
          if (!isCurrent()) return;
          setBusy(false);
          if (result.error || !scopeMatches(result.data, organization.id)) {
            await load();
            if (isCurrent()) notify('Сохранение настроек ЮKassa не подтверждено. Показано последнее подтверждённое состояние.');
            return;
          }
          const verified = await load();
          if (!isCurrent()) return;
          if (verified?.ok && settingsMatch(payload?.settings, expected)) notify('Настройки ЮKassa сохранены и проверены');
          else notify('Сохранение настроек ЮKassa не удалось сверить. Платёжные действия заблокированы до обновления.');
        } catch {
          if (isCurrent()) {
            await load();
            if (isCurrent()) notify('Сохранение настроек ЮKassa не подтверждено. Показано последнее подтверждённое состояние.');
          }
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
      const confirmedByUser = typeof global.confirm === 'function'
        && global.confirm(`Вернуть ${minorInputValue(amountMinor).replace('.', ',')} ₽ через ЮKassa? Отменить операцию после отправки нельзя.`);
      if (!confirmedByUser) {
        notify('Возврат не отправлен');
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
