(function () {
  'use strict';

  const statusLabels = { draft: 'Черновик', approved: 'Утверждено', paid: 'Выплачено' };
  const auditLabels = {
    payroll_enabled_changed: 'Изменена доступность расчёта зарплат', payroll_plan_saved: 'Сохранён план мотивации',
    payroll_period_calculated: 'Зарплата рассчитана', payroll_adjustment_added: 'Добавлена корректировка',
    payroll_period_status_changed: 'Изменён статус расчёта'
  };

  function localIso(date) {
    const copy = new Date(date);
    copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
    return copy.toISOString().slice(0, 10);
  }

  function monthBounds() {
    const now = new Date();
    return {
      start: localIso(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: localIso(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    };
  }

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const select = options.$;
    function $(selector) { return select(selector); }
    let organization = null;
    let payload = null;
    let availability = null;
    let requestRevision = 0;
    let writePending = false;
    let pendingOrganization;
    // Memory-only protection, not server idempotency. Keep unresolved attempts
    // across this controller's reset/org switches, keyed by actor + organization.
    // A full page reload/new controller loses this registry: reconcile manually;
    // matching amount/reason or a similar workspace row cannot resolve an intent.
    const adjustmentIntents = new Map();
    let activeAdjustmentWrite = null;

    function adjustmentKey(userId = getCurrentUser()?.id, organizationId = organization?.id) {
      return JSON.stringify([userId || '', organizationId || '']);
    }
    function syncAdjustmentLock() {
      const intent = adjustmentIntents.get(adjustmentKey());
      const form = $('#payrollAdjustmentForm');
      const button = $('#payrollAdjustmentForm button[type="submit"]');
      if (!form || !button) return;
      if (intent) {
        form.dataset.adjustmentState = intent.state;
        if (!button.dataset.adjustmentLabel) button.dataset.adjustmentLabel = button.textContent;
        if (!button.disabled) { button.disabled = true; button.dataset.adjustmentLocked = 'true'; }
        button.textContent = intent.state === 'pending' ? 'Сохраняем…' : 'Результат не подтверждён';
      } else {
        delete form.dataset.adjustmentState;
        if (button.dataset.adjustmentLocked === 'true') { button.disabled = false; delete button.dataset.adjustmentLocked; }
        if (button.dataset.adjustmentLabel) { button.textContent = button.dataset.adjustmentLabel; delete button.dataset.adjustmentLabel; }
      }
    }

    function unsupported(error) {
      return /PGRST202|42883|get_minuta_payroll_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }

    function scopeMatches(data, organizationId) {
      return Boolean(data && typeof data === 'object' && String(data.organization_id || '') === String(organizationId));
    }

    function setBusy(value) {
      $('#payrollPanel')?.querySelectorAll('[data-payroll-write]').forEach(control => {
        if (value && !control.disabled) { control.disabled = true; control.dataset.payrollBusy = 'true'; }
        else if (!value && control.dataset.payrollBusy === 'true') { control.disabled = false; delete control.dataset.payrollBusy; }
      });
    }

    function reset() {
      requestRevision += 1;
      organization = null;
      payload = null;
      availability = null;
      writePending = false;
      pendingOrganization = undefined;
      activeAdjustmentWrite = null;
      $('#payrollPanel').hidden = true;
      $('#payrollLoading').hidden = true;
      $('#payrollUnavailable').hidden = true;
      $('#payrollWorkspace').hidden = true;
    }

    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      if (writePending) {
        pendingOrganization = normalized;
        requestRevision += 1;
        payload = null;
        availability = normalized ? 'loading' : null;
        $('#payrollPanel').hidden = !normalized;
        $('#payrollLoading').hidden = !normalized;
        $('#payrollWorkspace').hidden = true;
        return { ok: false, optional: true, pending: true };
      }
      if (!normalized) { reset(); return { ok: false, optional: true }; }
      organization = normalized;
      pendingOrganization = undefined;
      const bounds = monthBounds();
      if (!$('#payrollStartDate').value) $('#payrollStartDate').value = bounds.start;
      if (!$('#payrollEndDate').value) $('#payrollEndDate').value = bounds.end;
      return load();
    }

    function validRange() {
      const start = $('#payrollStartDate').value;
      const end = $('#payrollEndDate').value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return null;
      const span = (new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000;
      return span >= 0 && span <= 366 ? { start, end } : null;
    }

    function normalize(data) {
      const result = data || {};
      for (const key of ['members', 'locations', 'plans', 'periods', 'items', 'adjustments', 'audit']) if (!Array.isArray(result[key])) result[key] = [];
      return result;
    }

    async function load() {
      if (writePending) return { ok: false, optional: true, pending: true };
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const organizationId = organization?.id;
      const range = validRange();
      const revision = ++requestRevision;
      if (!userId || !organizationId) { reset(); return { ok: false, optional: true }; }
      if (!range) {
        availability = 'error';
        $('#payrollPanel').hidden = false;
        $('#payrollWorkspace').hidden = true;
        $('#payrollUnavailable').hidden = false;
        $('#payrollUnavailableText').textContent = 'Выберите период не более 366 дней.';
        return { ok: false, optional: true, validation: true };
      }
      availability = 'loading';
      payload = null;
      $('#payrollPanel').hidden = false;
      $('#payrollLoading').hidden = false;
      $('#payrollUnavailable').hidden = true;
      $('#payrollWorkspace').hidden = true;
      const { data, error } = await db.rpc('get_minuta_payroll_workspace', { p_organization: organizationId, p_start: range.start, p_end: range.end });
      if (!sessionIsCurrent(userId, generation) || revision !== requestRevision || organization?.id !== organizationId) return { ok: false, optional: true, stale: true };
      $('#payrollLoading').hidden = true;
      if (error) {
        availability = unsupported(error) ? 'unsupported' : 'error';
        if (availability === 'unsupported') {
          $('#payrollPanel').hidden = true;
          return { ok: false, optional: true, unsupported: true };
        }
        $('#payrollUnavailable').hidden = false;
        $('#payrollUnavailableText').textContent = 'Команда и записи продолжают работать. Не удалось загрузить только зарплаты.';
        return { ok: false, optional: true };
      }
      if (!scopeMatches(data, organizationId)) {
        availability = 'error';
        $('#payrollUnavailable').hidden = false;
        $('#payrollUnavailableText').textContent = 'Сервер вернул расчёты другой организации. Изменения заблокированы.';
        return { ok: false, optional: true, scopeMismatch: true };
      }
      payload = normalize(data);
      availability = 'ready';
      render();
      return { ok: true, optional: true };
    }

    function memberName(id) { return payload.members.find(item => item.id === id)?.display_name || 'Специалист'; }
    function locationName(id) { return payload.locations.find(item => item.id === id)?.name || 'Все филиалы'; }
    function rubles(value) { return `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`; }
    function percent(bps) { return `${(Number(bps || 0) / 100).toLocaleString('ru-RU')}%`; }
    function dateLabel(value) { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }); }
    function optionList(items, selected, label) { return items.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(selected) ? 'selected' : ''}>${escapeHtml(label(item))}</option>`).join(''); }
    function empty(title, text) { return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`; }

    function planCard(plan, canManage) {
      const tiers = Array.isArray(plan.tiers) && plan.tiers.length
        ? plan.tiers.map(tier => `от ${rubles(tier.threshold_rub)} — ${percent(tier.rate_bps)}`).join(' · ')
        : 'без ступеней';
      const dates = `${dateLabel(plan.effective_from)}${plan.effective_to ? ` — ${dateLabel(plan.effective_to)}` : ''}`;
      return `<article class="organization-row payroll-plan-row ${plan.active === false ? 'is-muted' : ''}"><div class="organization-row-main"><strong>${escapeHtml(plan.name || 'План мотивации')} · ${escapeHtml(percent(plan.base_rate_bps))}</strong><small>${escapeHtml(memberName(plan.performer_id))} · ${escapeHtml(dates)} · ${escapeHtml(tiers)}</small></div>${canManage ? `<button class="secondary-button payroll-edit-plan" type="button" data-edit-payroll-plan="${escapeHtml(plan.id)}" data-payroll-write>Изменить</button>` : ''}</article>`;
    }

    function periodCard(period, permissions) {
      const status = statusLabels[period.status] || period.status || 'Черновик';
      const actions = [];
      if (period.status === 'draft' && permissions.canApprove) actions.push(`<button class="secondary-button" type="button" data-payroll-status="approved" data-payroll-period="${escapeHtml(period.id)}" data-payroll-write>Утвердить</button>`);
      if (period.status === 'approved' && permissions.canPay) actions.push(`<button class="primary-button" type="button" data-payroll-status="paid" data-payroll-period="${escapeHtml(period.id)}" data-payroll-write>Отметить выплату</button>`);
      return `<article class="organization-row payroll-period-row" data-period-id="${escapeHtml(period.id)}"><div class="organization-row-main"><strong>${escapeHtml(period.name || 'Расчёт')} · ${escapeHtml(rubles(period.total_payroll_rub))}</strong><small>${escapeHtml(locationName(period.location_id))} · ${escapeHtml(dateLabel(period.starts_on))} — ${escapeHtml(dateLabel(period.ends_on))} · выручка ${escapeHtml(rubles(period.total_revenue_rub))}</small></div><span class="organization-tags"><span class="organization-status ${period.status === 'paid' ? 'is-active' : ''}">${escapeHtml(status)}</span>${actions.join('')}</span></article>`;
    }

    function itemCard(item) {
      return `<article class="organization-row payroll-item-row"><div class="organization-row-main"><strong>${escapeHtml(item.service_name || 'Услуга')} · ${escapeHtml(rubles(item.payroll_rub))}</strong><small>${escapeHtml(memberName(item.performer_id))} · ${escapeHtml(dateLabel(item.booking_date))} · ${escapeHtml(percent(item.rate_bps))} от ${escapeHtml(rubles(item.amount_rub))}</small></div></article>`;
    }

    function auditCard(item) {
      const created = new Date(item.created_at);
      const time = Number.isNaN(created.getTime()) ? '' : created.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<article><span></span><div><strong>${escapeHtml(auditLabels[item.action] || 'Изменение зарплат')}</strong><small>${escapeHtml(time)}</small></div></article>`;
    }

    function render() {
      if (availability !== 'ready' || !payload) return;
      const role = payload.current_role || '';
      const canManage = Boolean(payload.can_manage) && (role === 'owner' || role === 'admin');
      const permissions = {
        canCalculate: canManage && payload.enabled !== false,
        canApprove: role === 'owner',
        canPay: role === 'owner'
      };
      $('#payrollPanel').hidden = false;
      $('#payrollUnavailable').hidden = true;
      $('#payrollWorkspace').hidden = false;
      $('#payrollEnabled').checked = Boolean(payload.enabled);
      $('#payrollEnabled').disabled = role !== 'owner';
      $('#payrollEnabledField').title = role === 'owner' ? '' : 'Включить зарплаты может только владелец';
      $('#payrollEnabledHint').textContent = payload.enabled ? 'Расчёты выполняются только вручную и после проверки.' : 'До включения записи и деньги не изменяются.';
      $('#payrollPlansCount').textContent = String(payload.plans.filter(item => item.active !== false).length);
      $('#payrollPeriodsCount').textContent = String(payload.periods.length);
      $('#payrollPlansList').innerHTML = payload.plans.length ? payload.plans.map(item => planCard(item, canManage)).join('') : empty('Планов пока нет', canManage ? 'Создайте процент для сотрудника.' : 'Владелец ещё не настроил мотивацию.');
      $('#payrollPeriodsList').innerHTML = payload.periods.length ? payload.periods.map(item => periodCard(item, permissions)).join('') : empty('Расчётов пока нет', 'Выберите период и выполните расчёт.');
      $('#payrollItemsList').innerHTML = payload.items.length ? payload.items.map(itemCard).join('') : empty('Начислений нет', 'Они появятся после расчёта завершённых записей.');
      $('#payrollPlanCreator').hidden = !canManage;
      $('#payrollPeriodCreator').hidden = !permissions.canCalculate;
      $('#payrollAdjustmentPanel').hidden = !canManage || !payload.periods.some(item => item.status === 'draft');
      $('#payrollPlanPerformer').innerHTML = optionList(payload.members.filter(item => item.is_bookable !== false), '', item => item.display_name);
      $('#payrollPeriodLocation').innerHTML = `<option value="">Все филиалы</option>${optionList(payload.locations, '', item => item.name)}`;
      const drafts = payload.periods.filter(item => item.status === 'draft');
      $('#payrollAdjustmentPeriod').innerHTML = optionList(drafts, '', item => item.name || `${item.starts_on} — ${item.ends_on}`);
      $('#payrollAdjustmentPerformer').innerHTML = optionList(payload.members, '', item => item.display_name);
      $('#payrollAuditPanel').hidden = !canManage;
      $('#payrollAuditCount').textContent = String(payload.audit.length);
      $('#payrollAuditList').innerHTML = payload.audit.length ? payload.audit.map(auditCard).join('') : empty('Изменений пока нет', 'Здесь появятся планы, расчёты и статусы выплат.');
      setBusy(false);
      syncAdjustmentLock();
      applyWriteAvailability();
      syncAdjustmentLock();
    }

    function showError(selector, message) { const holder = $(selector); if (!holder) return; holder.textContent = message; holder.hidden = false; }
    function clearError(selector) { const holder = $(selector); if (!holder) return; holder.textContent = ''; holder.hidden = true; }

    async function mutate(rpc, parameters, button, success, errorSelector) {
      if (rpc === 'add_minuta_payroll_adjustment') return mutateAdjustment(parameters, button, errorSelector);
      if (!requireWrites() || writePending || availability !== 'ready' || !payload || !organization?.id || String(payload.organization_id) !== String(organization.id)) return false;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const organizationId = organization.id;
      const revision = ++requestRevision;
      writePending = true;
      setBusy(true);
      if (errorSelector) clearError(errorSelector);
      const oldText = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      const { data, error } = await db.rpc(rpc, parameters);
      if (button) button.textContent = oldText;
      const stale = !sessionIsCurrent(userId, generation) || organization?.id !== organizationId || revision !== requestRevision;
      writePending = false;
      if (stale) {
        const next = pendingOrganization;
        pendingOrganization = undefined;
        if (next !== undefined) await setOrganization(next);
        return false;
      }
      if (error) {
        const source = `${error.message || ''} ${error.details || ''}`;
        const messages = [
          ['payroll_period_immutable', 'Утверждённый или выплаченный расчёт нельзя изменить.'],
          ['payroll_period_overlap', 'Для этого филиала уже есть пересекающийся расчёт.'],
          ['payroll_plan_overlap', 'У сотрудника уже действует план на этот период.'],
          ['payroll_plan_missing_for_completed_booking', 'Для одного из завершённых визитов не найден план мотивации. Добавьте план и повторите расчёт.'],
          ['payroll_requires_completed_bookings', 'В периоде нет завершённых записей для расчёта.'],
          ['owner_required', 'Это действие доступно только владельцу.'],
          ['payroll_disabled', 'Сначала включите зарплаты в организации.']
        ];
        const message = messages.find(([key]) => source.includes(key))?.[1] || 'Изменение не сохранено. Записи и деньги не затронуты.';
        if (errorSelector) showError(errorSelector, message); else notify(message);
        await load();
        return false;
      }
      if (!scopeMatches(data, organizationId)) {
        notify('Ответ сервера относится к другой организации. Изменение заблокировано и перепроверено.');
        await load();
        return false;
      }
      notify(success);
      await load();
      const next = pendingOrganization;
      pendingOrganization = undefined;
      if (next !== undefined) await setOrganization(next);
      return true;
    }

    async function mutateAdjustment(parameters, button, errorSelector) {
      if (!requireWrites() || writePending || availability !== 'ready' || !payload || !organization?.id
        || String(payload.organization_id) !== String(organization.id)) return false;
      const userId = getCurrentUser()?.id, generation = getSessionGeneration(), organizationId = organization.id;
      if (!userId) return false;
      const key = adjustmentKey(userId, organizationId);
      if (adjustmentIntents.has(key)) { syncAdjustmentLock(); return false; }
      const intent = { state:'pending', parameters:Object.freeze({ ...parameters }) };
      adjustmentIntents.set(key, intent);
      activeAdjustmentWrite = intent;
      const revision = ++requestRevision;
      const contextIsCurrent = () => sessionIsCurrent(userId, generation) && organization?.id === organizationId;
      writePending = true;
      clearError(errorSelector);
      syncAdjustmentLock();
      setBusy(true);
      let result, transportThrown = false;
      try { result = await db.rpc('add_minuta_payroll_adjustment', intent.parameters); }
      catch (error) { transportThrown = true; result = { error }; }
      const data = result?.data, error = result?.error;
      const confirmed = error === null && data && typeof data.id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.id)
        && data.organization_id === organizationId && data.period_id === intent.parameters.p_period
        && Number.isSafeInteger(data.total_payroll_rub);
      const refusals = {
        '42501':['authentication_required', 'organization_access_denied', 'payroll_manager_role_required'],
        '55000':['payroll_disabled', 'payroll_period_not_draft'],
        '22023':['invalid_payroll_adjustment'],
        '23503':['payroll_performer_not_in_organization']
      };
      const refused = !transportThrown && !confirmed && refusals[String(error?.code || '')]?.includes(String(error?.message || ''));
      if (confirmed || refused) adjustmentIntents.delete(key);
      else intent.state = 'unknown';
      // reset may already have admitted an independent operation in another
      // context. An old completion must not clear that operation's busy state.
      if (activeAdjustmentWrite !== intent) return false;
      activeAdjustmentWrite = null;
      writePending = false;
      if (!contextIsCurrent() || revision !== requestRevision) {
        const next = pendingOrganization;
        pendingOrganization = undefined;
        if (next !== undefined) await setOrganization(next);
        return false;
      }
      setBusy(false);
      syncAdjustmentLock();
      applyWriteAvailability();
      syncAdjustmentLock();
      if (confirmed) notify('Корректировка добавлена');
      else if (refused) {
        const messages = {
          payroll_disabled:'Сначала включите зарплаты в организации.',
          payroll_period_not_draft:'Корректировать можно только черновик расчёта.',
          invalid_payroll_adjustment:'Проверьте сумму и причину корректировки.',
          payroll_performer_not_in_organization:'Выберите действующего сотрудника организации.'
        };
        showError(errorSelector, messages[error.message] || 'Недостаточно прав для этой корректировки.');
      } else showError(errorSelector, 'Результат корректировки не подтверждён. Проверьте расчёт перед новой операцией. Повторная отправка заблокирована.');
      const reloadRevision = requestRevision + 1;
      try { await load(); }
      catch {
        if (contextIsCurrent() && requestRevision === reloadRevision && !writePending) {
          availability = 'error';
          $('#payrollLoading').hidden = true;
          $('#payrollWorkspace').hidden = true;
          $('#payrollUnavailable').hidden = false;
          $('#payrollUnavailableText').textContent = 'Не удалось обновить расчёт. Проверьте данные перед новой корректировкой.';
        }
      }
      return Boolean(confirmed);
    }

    function parseTiers(text) {
      if (!String(text || '').trim()) return [];
      return String(text).split(/\r?\n/).filter(line => line.trim()).map(line => {
        const parts = line.trim().split(/\s*(?:=|—|-)\s*/);
        const threshold = Number(parts[0].replace(/\s/g, '').replace(',', '.'));
        const rate = Number((parts[1] || '').replace(',', '.'));
        if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('invalid_tier');
        return { threshold_rub: Math.round(threshold), rate_bps: Math.round(rate * 100) };
      }).sort((a, b) => a.threshold_rub - b.threshold_rub);
    }

    async function handleSubmit(event) {
      if (!event.target.closest('#payrollPanel')) return;
      if (event.target.id === 'payrollPlanForm') {
        event.preventDefault();
        let tiers;
        try { tiers = parseTiers($('#payrollPlanTiers').value); }
        catch { showError('#payrollPlanError', 'Ступени указываются построчно: сумма — процент.'); return; }
        const saved = await mutate('upsert_minuta_payroll_plan', {
          p_organization: organization.id, p_plan: $('#payrollPlanId').value || null,
          p_performer: $('#payrollPlanPerformer').value, p_name: $('#payrollPlanName').value.trim(),
          p_effective_from: $('#payrollPlanFrom').value, p_effective_to: $('#payrollPlanTo').value || null,
          p_base_rate_bps: Math.round(Number($('#payrollPlanRate').value) * 100), p_tiers: tiers
        }, event.submitter, 'План мотивации сохранён', '#payrollPlanError');
        if (saved) { event.target.reset(); $('#payrollPlanId').value = ''; $('#payrollPlanCreator').open = false; }
        return;
      }
      if (event.target.id === 'payrollPeriodForm') {
        event.preventDefault();
        const range = validRange();
        if (!range) { showError('#payrollPeriodError', 'Проверьте даты периода.'); return; }
        await mutate('calculate_minuta_payroll_period', {
          p_organization: organization.id, p_period: null, p_location: $('#payrollPeriodLocation').value || null,
          p_starts_on: range.start, p_ends_on: range.end, p_name: $('#payrollPeriodName').value.trim()
        }, event.submitter, 'Зарплата рассчитана. Проверьте её перед утверждением.', '#payrollPeriodError');
        return;
      }
      if (event.target.id === 'payrollAdjustmentForm') {
        event.preventDefault();
        await mutate('add_minuta_payroll_adjustment', {
          p_organization: organization.id, p_period: $('#payrollAdjustmentPeriod').value,
          p_performer: $('#payrollAdjustmentPerformer').value, p_amount_rub: Math.round(Number($('#payrollAdjustmentAmount').value)),
          p_reason: $('#payrollAdjustmentReason').value.trim()
        }, event.submitter, 'Корректировка добавлена', '#payrollAdjustmentError');
      }
    }

    async function handleClick(event) {
      if (event.target.closest('#reloadPayroll')) { await load(); return; }
      const edit = event.target.closest('[data-edit-payroll-plan]');
      if (edit) {
        const plan = payload?.plans.find(item => String(item.id) === edit.dataset.editPayrollPlan);
        if (!plan) return;
        $('#payrollPlanId').value = plan.id;
        $('#payrollPlanPerformer').value = plan.performer_id;
        $('#payrollPlanName').value = plan.name || '';
        $('#payrollPlanFrom').value = plan.effective_from || '';
        $('#payrollPlanTo').value = plan.effective_to || '';
        $('#payrollPlanRate').value = Number(plan.base_rate_bps || 0) / 100;
        $('#payrollPlanTiers').value = (plan.tiers || []).map(tier => `${tier.threshold_rub} — ${Number(tier.rate_bps || 0) / 100}`).join('\n');
        $('#payrollPlanCreator').open = true;
        return;
      }
      const status = event.target.closest('[data-payroll-status]');
      if (status) await mutate('set_minuta_payroll_period_status', { p_organization: organization.id, p_period: status.dataset.payrollPeriod, p_status: status.dataset.payrollStatus }, status, status.dataset.payrollStatus === 'paid' ? 'Выплата отмечена' : 'Расчёт утверждён');
    }

    async function handleChange(event) {
      if (event.target.id === 'payrollStartDate' || event.target.id === 'payrollEndDate') await load();
      if (event.target.id === 'payrollEnabled') {
        const desired = event.target.checked;
        const ok = await mutate('set_minuta_payroll_enabled', { p_organization: organization.id, p_enabled: desired }, event.target, desired ? 'Зарплаты включены' : 'Зарплаты выключены');
        if (!ok && payload) event.target.checked = Boolean(payload.enabled);
      }
    }

    function bind() {
      document.addEventListener('submit', handleSubmit);
      document.addEventListener('click', handleClick);
      document.addEventListener('change', handleChange);
    }

    return {
      bind, load, reset, setOrganization,
      get availability() { return availability; },
      get payload() { return payload; }
    };
  }

  window.MinutaPayroll = { createController };
})();
