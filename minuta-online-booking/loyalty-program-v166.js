(function () {
  'use strict';

  function createController(options) {
    const { db, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    const select = typeof options.$ === 'function' ? options.$ : selector => document.querySelector(selector);
    const $ = selector => select(selector);
    let organization = null;
    let payload = null;
    let availability = 'idle';
    let revision = 0;
    let selectedClient = null;
    let writing = false;

    const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const stableJson = value => {
      if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
      if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
      return JSON.stringify(value);
    };
    const digest = value => {
      let hash = 2166136261;
      for (const character of stableJson(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
      return (hash >>> 0).toString(36);
    };
    const intentKey = action => `minuta-loyalty-v166:${action}:${organization?.id || 'none'}:${getCurrentUser()?.id || 'none'}`;
    function prepareIntent(action, parameters) {
      const key = intentKey(action), fingerprint = digest(parameters);
      try {
        const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved?.fingerprint === fingerprint && saved?.requestId) return { key, requestId:saved.requestId };
        const next = { fingerprint, requestId:uuid() };
        localStorage.setItem(key, JSON.stringify(next));
        return { key, requestId:next.requestId };
      } catch (_) { return { key:null, requestId:uuid() }; }
    }
    function clearIntent(intent) {
      if (!intent?.key) return;
      try { localStorage.removeItem(intent.key); } catch (_) {}
    }
    const integer = value => Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
    const visitWord = value => {
      const count = Math.abs(integer(value));
      if (count % 100 >= 11 && count % 100 <= 14) return 'визитов';
      if (count % 10 === 1) return 'визит';
      if (count % 10 >= 2 && count % 10 <= 4) return 'визита';
      return 'визитов';
    };
    const dateText = value => value ? new Date(value).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' }) : 'без срока';
    const clientById = id => payload?.clients?.find(item => item.id === id) || null;
    const accountByClient = id => payload?.accounts?.find(item => item.client_account_id === id) || null;
    const rewardText = row => {
      if (!row) return 'Награда';
      if (row.reward_kind === 'percent') return `${integer(row.reward_value) / 100}% скидка`;
      if (row.reward_kind === 'fixed') return `${integer(row.reward_value).toLocaleString('ru-RU')} ₽ скидка`;
      return row.reward_title || 'Бонус';
    };
    const showError = (selector, message) => {
      const holder = $(selector); if (!holder) return;
      holder.textContent = message; holder.hidden = false;
    };
    const clearError = selector => { const holder = $(selector); if (holder) { holder.hidden = true; holder.textContent = ''; } };

    function goal() {
      const preset = $('#loyaltyGoalPreset')?.value || '10';
      return preset === 'custom' ? integer($('#loyaltyGoalCustom')?.value) : integer(preset);
    }
    function rewardValue() {
      const kind = $('#loyaltyRewardKind')?.value;
      if (kind === 'text') return null;
      const raw = Number($('#loyaltyRewardValue')?.value);
      return kind === 'percent' ? Math.round(raw * 100) : Math.round(raw);
    }
    function validity() {
      const value = $('#loyaltyValidity')?.value;
      return value === 'none' ? null : integer(value);
    }
    function updateForm() {
      const enabled = Boolean($('#loyaltyEnabled')?.checked);
      const preset = $('#loyaltyGoalPreset')?.value || '10';
      const kind = $('#loyaltyRewardKind')?.value || 'percent';
      const value = Number($('#loyaltyRewardValue')?.value || 0);
      const period = validity();
      if ($('#loyaltyProgramFields')) $('#loyaltyProgramFields').inert = !enabled;
      if ($('#loyaltyGoalCustomField')) $('#loyaltyGoalCustomField').hidden = preset !== 'custom';
      if ($('#loyaltyRewardValueField')) $('#loyaltyRewardValueField').hidden = kind === 'text';
      const input = $('#loyaltyRewardValue');
      if (input) { input.max = kind === 'percent' ? '100' : '10000000'; input.step = kind === 'percent' ? '0.01' : '1'; }
      const description = kind === 'percent' ? `скидка ${value || 0}%` : kind === 'fixed'
        ? `скидка ${integer(value).toLocaleString('ru-RU')} ₽` : ($('#loyaltyRewardTitle')?.value.trim() || 'бонус');
      if ($('#loyaltyPreviewTitle')) $('#loyaltyPreviewTitle').textContent = `${goal()} ${visitWord(goal())} → ${description}`;
      if ($('#loyaltyPreviewText')) $('#loyaltyPreviewText').textContent = enabled
        ? `После ${goal()}-го завершённого визита появится одна награда${period ? ` на ${period} дней` : ' без срока'}.`
        : 'Включите программу, чтобы начать отсчёт со следующего завершённого визита.';
    }

    function adjustmentPreviewState() {
      const client = $('#loyaltyAdjustmentClient')?.value || '';
      const input = $('#loyaltyAdjustmentPoints');
      const raw = String(input?.value || '').trim();
      const account = accountByClient(client);
      const before = Math.max(0, integer(account?.progress));
      const target = Math.max(0, integer(account?.goal_visits || payload?.rule?.goal_visits));
      const numeric = Number(raw);
      const delta = Number.isInteger(numeric) ? numeric : 0;
      const after = before + delta;
      const validDelta = raw !== '' && Number.isInteger(numeric) && delta !== 0 && Math.abs(delta) <= 100;
      return { client, raw, before, target, delta, after, validDelta, valid: Boolean(client && validDelta && after >= 0 && (!target || after <= target)) };
    }

    function updateAdjustmentPreview() {
      const holder = $('#loyaltyAdjustmentPreview');
      const input = $('#loyaltyAdjustmentPoints');
      if (!holder || !input) return;
      const state = adjustmentPreviewState();
      input.setCustomValidity('');
      if (!state.client) {
        holder.textContent = 'Выберите клиента, чтобы увидеть текущий прогресс.';
        return;
      }
      if (!state.raw) {
        holder.textContent = `Было ${state.before}. Укажите, сколько визитов добавить или убрать.`;
        return;
      }
      if (!state.validDelta) {
        input.setCustomValidity('Укажите целое число от −100 до 100, кроме нуля.');
        holder.textContent = 'Укажите целое число от −100 до 100, кроме нуля.';
        return;
      }
      const result = `Было ${state.before} → станет ${state.after} ${visitWord(state.after)}.`;
      if (state.after < 0 || (state.target && state.after > state.target)) {
        input.setCustomValidity(`Итоговый прогресс должен быть от 0 до ${state.target}.`);
        holder.textContent = `${result} Допустимый итог: от 0 до ${state.target}.`;
        return;
      }
      holder.textContent = result;
    }

    function renderCard() {
      const card = $('#clientMilestoneCard');
      const orbit = $('#clientProfileOrbit');
      if (!card || !orbit || !selectedClient) return;
      const enabled = Boolean(payload?.enabled && payload?.rule?.id && selectedClient.clientAccountId);
      const account = accountByClient(selectedClient.clientAccountId);
      const pending = payload?.rewards?.find(row => row.client_account_id === selectedClient.clientAccountId && row.status === 'pending');
      const target = integer(account?.goal_visits || payload?.rule?.goal_visits || 0);
      const progress = Math.min(target, Math.max(0, integer(account?.progress)));
      card.hidden = false;
      orbit.classList.toggle('has-loyalty-progress', enabled);
      orbit.style.setProperty('--client-level-progress', `${target ? progress / target : 0}turn`);
      orbit.removeAttribute('data-client-level');
      $('#clientMilestoneProgress')?.setAttribute('aria-valuemax', String(target || 1));
      $('#clientMilestoneProgress')?.setAttribute('aria-valuenow', String(progress));
      card.style.setProperty('--client-level-width', `${target ? Math.round(progress / target * 100) : 0}%`);
      if (!enabled) {
        $('#clientMilestoneText').textContent = 'Программа не включена';
        $('#clientMilestoneHint').textContent = 'Настройте цель, награду и срок примерно за минуту.';
        orbit.setAttribute('aria-label', 'Программа лояльности не включена');
        return;
      }
      if (pending) {
        $('#clientMilestoneText').textContent = `Награда доступна: ${rewardText(pending)}`;
        $('#clientMilestoneHint').textContent = pending.expires_at ? `Использовать до ${dateText(pending.expires_at)}` : 'Без срока. Использование подтверждает мастер.';
        orbit.setAttribute('aria-label', `Награда доступна. ${rewardText(pending)}`);
        return;
      }
      const remaining = Math.max(0, target - progress);
      $('#clientMilestoneText').textContent = `${progress} из ${target} ${visitWord(target)}`;
      $('#clientMilestoneHint').textContent = `Ещё ${remaining} ${visitWord(remaining)} до награды «${payload.rule.reward_title}»`;
      orbit.setAttribute('aria-label', `${progress} из ${target} визитов, ещё ${remaining} до награды`);
    }

    function renderClients() {
      const holder = $('#loyaltyBalancesList');
      if (!holder) return;
      const rows = (payload?.clients || []).map(client => {
        const account = accountByClient(client.id);
        const target = integer(account?.goal_visits || payload?.rule?.goal_visits || 0);
        const progress = Math.min(target, Math.max(0, integer(account?.progress)));
        const pending = payload?.rewards?.some(reward => reward.client_account_id === client.id && reward.status === 'pending');
        return { client, target, progress, pending };
      }).filter(row => row.progress || row.pending).sort((a,b) => Number(b.pending)-Number(a.pending) || b.progress-a.progress);
      holder.innerHTML = rows.length ? rows.map(({ client, target, progress, pending }) => `<article class="loyalty-client-row">
        <div><strong>${escapeHtml(client.client_name || 'Клиент')}</strong><small>${pending ? 'Награда доступна' : `${progress} из ${target} · ещё ${Math.max(0,target-progress)} до награды`}</small></div>
        <span class="loyalty-progress-value" aria-label="${progress} из ${target}">${progress}/${target}</span>
      </article>`).join('') : '<div class="organization-empty"><strong>Прогресс появится после завершённого визита</strong><small>Старые визиты не засчитываются автоматически.</small></div>';
    }

    function renderRewards() {
      const holder = $('#loyaltyRewardsList');
      if (!holder) return;
      const rewards = (payload?.rewards || []).filter(row => row.status === 'pending');
      holder.innerHTML = rewards.length ? rewards.map(reward => {
        const client = clientById(reward.client_account_id);
        return `<article class="loyalty-reward-row"><div><strong>${escapeHtml(client?.client_name || 'Клиент')} · ${escapeHtml(rewardText(reward))}</strong><small>${reward.expires_at ? `До ${escapeHtml(dateText(reward.expires_at))}` : 'Без срока'}${reward.reward_terms ? ` · ${escapeHtml(reward.reward_terms)}` : ''}</small></div><button class="secondary-button" type="button" data-redeem-loyalty-reward="${escapeHtml(reward.id)}">Отметить использованной</button></article>`;
      }).join('') : '<div class="organization-empty"><strong>Доступных наград пока нет</strong><small>Награда появится один раз при достижении цели.</small></div>';
    }

    function renderHistory() {
      const holder = $('#loyaltyLedgerList'); if (!holder) return;
      const labels = { program_enabled:'Программа включена',program_disabled:'Программа выключена',rule_changed:'Правила изменены',visit_counted:'Визит засчитан',visit_reversed:'Визит отменён',reward_issued:'Награда выдана',reward_redeemed:'Награда использована',reward_expired:'Срок награды истёк',reward_voided:'Награда отозвана',manual_adjustment:'Прогресс скорректирован' };
      holder.innerHTML = (payload?.history || []).length ? payload.history.map(entry => `<article><div><strong>${escapeHtml(labels[entry.event_type] || entry.event_type)}</strong><small>${entry.client_account_id ? escapeHtml(clientById(entry.client_account_id)?.client_name || 'Клиент') : 'Общие настройки'}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ''}</small></div><time>${escapeHtml(dateText(entry.created_at))}</time></article>`).join('') : '<div class="organization-empty"><strong>История пока пуста</strong><small>Здесь останутся все изменения программы.</small></div>';
    }

    function render() {
      const enabled = Boolean(payload?.enabled);
      const rule = payload?.rule || {};
      if ($('#loyaltyEnabled')) $('#loyaltyEnabled').checked = enabled;
      if (rule.id) {
        const preset = [5,10,20].includes(integer(rule.goal_visits)) ? String(rule.goal_visits) : 'custom';
        $('#loyaltyGoalPreset').value = preset;
        $('#loyaltyGoalCustom').value = String(rule.goal_visits || 10);
        $('#loyaltyRewardKind').value = rule.reward_kind || 'percent';
        $('#loyaltyRewardValue').value = rule.reward_kind === 'percent' ? String(Number(rule.reward_value || 0) / 100) : String(rule.reward_value || '');
        $('#loyaltyRewardTitle').value = rule.reward_title || '';
        $('#loyaltyRewardTerms').value = rule.reward_terms || '';
        $('#loyaltyValidity').value = rule.validity_days == null ? 'none' : String(rule.validity_days);
      }
      $('#loyaltyIssuedCount').textContent = String(payload?.stats?.issued || 0);
      $('#loyaltyRedeemedCount').textContent = String(payload?.stats?.redeemed || 0);
      const clients = payload?.clients || [];
      $('#loyaltyAdjustmentClient').innerHTML = `<option value="">Выберите клиента</option>${clients.map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.client_name || 'Клиент')}</option>`).join('')}`;
      renderClients(); renderRewards(); renderHistory(); updateForm(); updateAdjustmentPreview(); renderCard();
      $('#loyaltyWorkflowStatus').textContent = enabled ? 'Программа включена. Текущие циклы сохраняют правила, с которыми начались.' : 'Программа выключена. История и выданные награды сохранены.';
      applyWriteAvailability?.();
    }

    async function load() {
      if (!organization?.id || !getCurrentUser()?.id) return false;
      const userId = getCurrentUser().id, generation = getSessionGeneration(), current = ++revision, organizationId = organization.id;
      availability = 'loading';
      $('#loyaltyLoading').hidden = false; $('#loyaltyUnavailable').hidden = true;
      try {
        const { data, error } = await db.rpc('get_minuta_loyalty_program_workspace_v166', { p_organization:organizationId });
        if (error) throw error;
        if (!sessionIsCurrent(userId,generation) || current !== revision || organization?.id !== organizationId) return false;
        payload = data || {}; availability = 'ready';
        $('#loyaltyWorkspace').hidden = false; render(); return true;
      } catch (error) {
        if (!sessionIsCurrent(userId,generation) || current !== revision) return false;
        availability = 'failed'; $('#loyaltyWorkspace').hidden = true; $('#loyaltyUnavailable').hidden = false;
        $('#loyaltyUnavailableText').textContent = navigator.onLine === false ? 'Нет сети. Данные не изменены; повторите после подключения.' : 'Данные не изменены. Повторите загрузку.';
        return false;
      } finally { if (current === revision) $('#loyaltyLoading').hidden = true; }
    }

    async function mutate(rpc, parameters, button, success, intent) {
      if (writing || !organization?.id || !requireWrites()) return false;
      writing = true; if (button) button.disabled = true;
      try {
        const { error } = await db.rpc(rpc, parameters);
        if (error) throw error;
        clearIntent(intent); await load(); notify(success); return true;
      } catch (error) {
        const code = String(error?.code || '');
        const known = code.startsWith('22') || code.startsWith('23') || code === '42501' || code === '55000' || code === 'P0002';
        if (known) clearIntent(intent);
        if (!known) notify('Не удалось подтвердить результат. Повторите исходное действие после обновления данных.');
        return false;
      } finally { writing = false; if (button) button.disabled = false; }
    }

    async function submit(event) {
      if (event.target.id === 'loyaltyProgramForm') {
        event.preventDefault(); clearError('#loyaltyRuleError');
        const enabled = $('#loyaltyEnabled').checked, target = goal(), kind = $('#loyaltyRewardKind').value;
        if (enabled && (target < 2 || target > 100)) { showError('#loyaltyRuleError','Цель должна быть от 2 до 100 визитов.'); return; }
        const parameters = { p_organization:organization.id,p_enabled:enabled,p_goal_visits:enabled?target:null,p_reward_kind:enabled?kind:null,p_reward_value:enabled?rewardValue():null,p_reward_title:enabled?$('#loyaltyRewardTitle').value.trim():null,p_reward_terms:enabled?$('#loyaltyRewardTerms').value.trim():null,p_validity_days:enabled?validity():null };
        const intent = prepareIntent('settings',parameters); parameters.p_request_id = intent.requestId;
        const ok = await mutate('set_minuta_loyalty_program_v166',parameters,event.submitter,enabled?'Программа лояльности сохранена':'Программа выключена; история сохранена',intent);
        if (!ok) showError('#loyaltyRuleError','Не удалось сохранить. Проверьте поля и повторите то же действие.');
      }
      if (event.target.id === 'loyaltyAdjustmentForm') {
        event.preventDefault(); clearError('#loyaltyAdjustmentError');
        const client = $('#loyaltyAdjustmentClient').value, delta = integer($('#loyaltyAdjustmentPoints').value), reason = $('#loyaltyAdjustmentReason').value.trim();
        const preview = adjustmentPreviewState();
        if (!client || !preview.valid || reason.length < 3) { showError('#loyaltyAdjustmentError','Выберите клиента, допустимое изменение и укажите причину.'); updateAdjustmentPreview(); return; }
        const parameters = {p_organization:organization.id,p_client_account:client,p_delta:delta,p_reason:reason};
        const intent = prepareIntent('adjustment',parameters); parameters.p_request_id = intent.requestId;
        const ok = await mutate('adjust_minuta_loyalty_progress_v166',parameters,event.submitter,'Прогресс скорректирован',intent);
        if (ok) { event.target.reset(); updateAdjustmentPreview(); } else showError('#loyaltyAdjustmentError','Корректировка не сохранена. Проверьте допустимый итог прогресса.');
      }
    }

    async function click(event) {
      if (event.target.closest('#reloadLoyalty')) { await load(); return; }
      const redeem = event.target.closest('[data-redeem-loyalty-reward]');
      if (!redeem) return;
      const reward = payload?.rewards?.find(row => row.id === redeem.dataset.redeemLoyaltyReward);
      const client = clientById(reward?.client_account_id);
      if (!reward || !confirm(`Отметить награду «${rewardText(reward)}» для ${client?.client_name || 'клиента'} использованной?`)) return;
      const parameters = {p_organization:organization.id,p_reward:reward.id,p_booking:null,p_reason:'Подтверждено мастером'};
      const intent = prepareIntent('redeem',parameters); parameters.p_request_id = intent.requestId;
      await mutate('redeem_minuta_loyalty_reward_v166',parameters,redeem,'Награда отмечена использованной',intent);
    }

    function input(event) {
      if (event.target.closest('#loyaltyProgramForm')) { clearError('#loyaltyRuleError'); updateForm(); }
      if (event.target.closest('#loyaltyAdjustmentForm')) { clearError('#loyaltyAdjustmentError'); updateAdjustmentPreview(); }
    }
    function change(event) {
      if (event.target.closest('#loyaltyProgramForm')) updateForm();
      if (event.target.closest('#loyaltyAdjustmentForm')) updateAdjustmentPreview();
    }
    function bind() { document.addEventListener('submit',submit); document.addEventListener('click',click); document.addEventListener('input',input); document.addEventListener('change',change); }
    function reset() { organization=null;payload=null;availability='idle';revision+=1;selectedClient=null;$('#loyaltyWorkspace')?.setAttribute('hidden',''); }
    async function setOrganization(next) {
      if (next?.id && organization?.id === next.id && payload) { organization=next; render(); return true; }
      organization=next || null; payload=null; if (!organization?.id) { reset(); return false; } return load();
    }
    function setClient(client) { selectedClient=client || null; renderCard(); }
    return { bind,load,reset,setOrganization,setClient,get availability(){return availability;},get payload(){return payload;} };
  }

  window.MinutaLoyalty = { createController };
})();
