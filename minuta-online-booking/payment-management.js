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
    let refundIntent = null;
    let refundVerifiedStatus = '';
    let refundStorageFailed = false;

    function intentKey() { return `minuta_refund_intent_v1:${organization.id}`; }
    function restoreRefundIntent() {
      refundIntent = null; refundVerifiedStatus = ''; refundStorageFailed = false;
      if (!organization) return;
      try {
        const raw = global.localStorage.getItem(intentKey());
        if (!raw) return;
        const value = JSON.parse(raw);
        if (value.organization_id !== organization.id || !value.request_id || !value.attempt_id
          || !Number.isSafeInteger(value.amount_minor) || value.amount_minor < 100
          || !/^[a-f0-9]{64}$/.test(value.reason_hash)) throw new Error('invalid_refund_intent');
        refundIntent = value;
      } catch { refundStorageFailed = true; }
    }
    function persistRefundIntent(value) {
      const existing = global.localStorage.getItem(intentKey());
      if (existing && JSON.parse(existing).request_id !== value.request_id) throw new Error('another_refund_intent');
      const encoded = JSON.stringify(value);
      global.localStorage.setItem(intentKey(), encoded);
      if (global.localStorage.getItem(intentKey()) !== encoded) throw new Error('refund_intent_not_saved');
      refundIntent = value;
    }
    async function reasonHash(reason) {
      const digest = await global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(reason));
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function terminalRefund() { return ['succeeded', 'canceled', 'failed'].includes(refundVerifiedStatus); }
    function renderRefundRecovery() {
      const form = $('#paymentRefundForm');
      if (!form) return;
      if (document.createElement && !document.getElementById('paymentRefundRecovery')) {
        const recovery = document.createElement('div');
        recovery.id = 'paymentRefundRecovery';
        recovery.innerHTML = '<p id="paymentRefundRecoveryStatus" role="status"></p><button id="paymentRefundNew" class="secondary-button" type="button">Новый возврат</button>';
        $('#paymentProviderWorkspace').prepend(recovery);
      }
      const active = Boolean(refundIntent || refundStorageFailed);
      if ($('#paymentRefundRecovery')) $('#paymentRefundRecovery').hidden = !active;
      // An unresolved operation is the current task; ordinary refunds remain below history.
      if(active)$('#paymentRefundRecovery')?.after?.(form);
      else $('#paymentProviderWorkspace')?.append?.(form);
      if ($('#paymentRefundRecoveryStatus')) $('#paymentRefundRecoveryStatus').textContent = refundStorageFailed
        ? 'Не удалось прочитать сохранённый возврат. Проверьте хранилище браузера перед новой операцией.'
        : terminalRefund() ? `Предыдущий возврат: ${refundStatusLabel(refundVerifiedStatus)}. Для отдельной операции нажмите «Новый возврат».`
          : 'Есть незавершённая проверка возврата. Сначала проверьте его статус. Для безопасного повтора понадобится прежняя причина.';
      if ($('#paymentRefundNew')) { $('#paymentRefundNew').hidden = !terminalRefund(); $('#paymentRefundNew').disabled = busy; }
      const submitButton = form.querySelector?.('button[type="submit"]');
      if (submitButton) { submitButton.textContent = active ? 'Проверить возврат' : 'Вернуть через ЮKassa'; submitButton.disabled = busy || refundStorageFailed; }
      if (refundIntent) {
        $('#paymentRefundAmount').value = minorInputValue(refundIntent.amount_minor);
        $('#paymentRefundAmount').max = '';
        $('#paymentRefundAmount').readOnly = true;
        $('#paymentRefundAttempt').disabled = true;
        $('#paymentRefundReason').required = false;
        form.hidden = false;
      } else {
        $('#paymentRefundAmount').readOnly = false;
        $('#paymentRefundReason').required = true;
      }
    }
    async function reconcileRefundIntent(intent, isCurrent) {
      let query = db.from('payment_provider_refunds')
        .select('id,organization_id,request_id,attempt_id,amount_minor,status')
        .eq('organization_id', intent.organization_id);
      query = intent.refund_id ? query.eq('id', intent.refund_id) : query.eq('request_id', intent.request_id);
      const result = await query.maybeSingle();
      if (!isCurrent()) return 'stale';
      if (result.error) throw new Error('refund_check_unavailable');
      const row = result.data;
      if (!row) {
        // The legacy server may reuse another in-flight refund's canonical ID.
        // If that reply was lost, absence of our ID alone cannot authorize replay.
        const possibleAlias = await db.from('payment_provider_refunds').select('id')
          .eq('organization_id', intent.organization_id).eq('attempt_id', intent.attempt_id)
          .eq('amount_minor', intent.amount_minor).in('status', ['creating','pending','succeeded']).limit(1).maybeSingle();
        if (!isCurrent()) return 'stale';
        if (possibleAlias.error || possibleAlias.data) throw new Error('refund_identity_unresolved');
        refundVerifiedStatus = ''; return 'missing';
      }
      if (row.organization_id !== intent.organization_id || row.attempt_id !== intent.attempt_id
        || Number(row.amount_minor) !== intent.amount_minor
        || (!intent.refund_id && row.request_id !== intent.request_id)
        || (intent.refund_id && row.id !== intent.refund_id)
        || !['creating', 'pending', 'succeeded', 'canceled', 'failed'].includes(row.status)) throw new Error('refund_check_mismatch');
      refundVerifiedStatus = row.status;
      renderRefundRecovery();
      return row.status;
    }
    function newRefund() {
      if (!organization || busy || !manager() || !terminalRefund()) return;
      try {
        if (JSON.parse(global.localStorage.getItem(intentKey()) || 'null')?.request_id !== refundIntent?.request_id) throw new Error('another_refund_intent');
        global.localStorage.removeItem(intentKey());
        if (global.localStorage.getItem(intentKey()) !== null) throw new Error('refund_clear_failed');
      } catch { notify('Не удалось завершить предыдущую проверку. Новый возврат пока недоступен.'); return; }
      refundIntent = null; refundVerifiedStatus = '';
      $('#paymentRefundForm').reset();
      refundSelectionInitialized = false;
      render();
    }

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
      renderRefundRecovery();
    }
    function reset() {
      organization = null; payload = null; available = null; busy = false;
      refundIntent = null; refundVerifiedStatus = ''; refundStorageFailed = false;
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
      if (changed) restoreRefundIntent();
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
      const guide=panel.querySelector?.('.payment-technical-details');
      if(guide){
        const intro=panel.querySelector(':scope > .organization-invite-help');
        const summary=guide.querySelector('summary');
        if(summary)summary.textContent='Подробнее о подключении';
        if(intro&&summary)summary.after(intro);
        panel.append(guide);
      }
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
      if (refundIntent && !refundable.some(item => item.id === refundIntent.attempt_id)) {
        $('#paymentRefundAttempt').innerHTML += `<option value="${escapeHtml(refundIntent.attempt_id)}">Сохранённый возврат · ${escapeHtml(moneyMinor(refundIntent.amount_minor))}</option>`;
      }
      if (refundIntent) $('#paymentRefundAttempt').value = refundIntent.attempt_id;
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
      if (refundStorageFailed) { notify('Не удалось прочитать сохранённый возврат. Новая операция заблокирована.'); return; }
      if (refundIntent) {
        const intent = refundIntent;
        const isCurrent = beginOperation();
        try {
          const status = await reconcileRefundIntent(intent, isCurrent);
          if (!isCurrent()) return;
          if (['succeeded','canceled','failed','pending'].includes(status)) {
            notify(status === 'succeeded' ? 'Возврат выполнен' : status === 'pending' ? 'Возврат принят в обработку' : status === 'canceled' ? 'Возврат отменён' : 'Возврат завершился ошибкой');
            return;
          }
          const reason = $('#paymentRefundReason').value.trim();
          if (!reason || await reasonHash(reason) !== intent.reason_hash) {
            if (isCurrent()) notify('Для повтора укажите прежнюю причину возврата. Сумма и операция сохранены.');
            return;
          }
          if (!isCurrent()) return;
          if (!global.confirm?.(`Проверка не подтвердила завершение. Повторить тот же возврат ${moneyMinor(intent.amount_minor)}? Новая операция создана не будет.`)) return;
          await sendRefund(intent, reason, isCurrent);
        } catch { if (isCurrent()) notify('Не удалось сверить возврат. Новая операция заблокирована; повторите проверку позже.'); }
        finally { if (isCurrent()) setBusy(false); }
        return;
      }
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
        const intent = { organization_id:organization.id, attempt_id:$('#paymentRefundAttempt').value,
          request_id:requestId(), amount_minor:amountMinor, reason_hash:await reasonHash(reason) };
        if (!isCurrent()) return;
        try { persistRefundIntent(intent); }
        catch { notify('Не удалось сохранить защиту от повторного возврата. Операция не отправлена.'); return; }
        await sendRefund(intent, reason, isCurrent);
      } catch {
        if (isCurrent()) {
          notify('Возврат не подтверждён. Проверьте настройки и журнал операций.');
          await load();
        }
      } finally {
        if (isCurrent()) setBusy(false);
      }
    }
    async function sendRefund(intent, reason, isCurrent) {
      const result = await db.functions.invoke('yookassa-refund', { body:{
        organization_id:intent.organization_id, attempt_id:intent.attempt_id,
        request_id:intent.request_id, amount_minor:intent.amount_minor, reason
      }});
      if (!isCurrent()) return;
      if (result.error || result.data?.ok !== true || typeof result.data.refund_id !== 'string'
        || !result.data.refund_id || result.data.amount_minor !== intent.amount_minor
        || !['succeeded','pending','canceled'].includes(result.data.status)) {
        notify('Возврат не подтверждён. Сохранена та же операция; проверьте её статус перед повтором.');
        await load();
        return;
      }
      try { persistRefundIntent({ ...intent, refund_id:result.data.refund_id }); } catch { /* Original request remains durable. */ }
      // Even an acknowledged request stays attached until an explicit new action.
      if (['succeeded','canceled','failed','pending'].includes(result.data.status)) refundVerifiedStatus = result.data.status;
      await load();
      if (isCurrent()) notify(result.data.status === 'succeeded' ? 'Возврат выполнен' : result.data.status === 'pending' ? 'Возврат принят в обработку' : 'Возврат отменён');
    }
    function change(event) {
      if (event.target.id === 'paymentFiscalizationEnabled' || event.target.id === 'paymentRefundAttempt') updateRefundAmount();
    }
    function bind() {
      document.addEventListener('submit', submit);
      document.addEventListener('change', change);
      document.addEventListener('click', event => { if (event.target.closest?.('#paymentRefundNew')) newRefund(); });
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
