(function initMinutaIntegrations(global) {
  'use strict';

  const PROVIDERS = Object.freeze(['dikidi', 'yclients']);
  const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,199}$/;
  const EVENT_LABELS = Object.freeze({
    'booking.created':'Запись создана',
    'booking.updated':'Запись обновлена',
    'booking.cancelled':'Запись отменена'
  });
  const STATE_LABELS = Object.freeze({
    accepted:'Принято', processed:'Обработано', failed:'Ошибка'
  });

  function formatMoment(value) {
    if (!value) return '';
    const moment = new Date(value);
    return Number.isNaN(moment.getTime()) ? '' : moment.toLocaleString('ru-RU', {
      dateStyle:'short', timeStyle:'short'
    });
  }

  function validWorkspace(value, organizationId) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || String(value.organizationId || '') !== String(organizationId || '')
      || !['owner', 'admin'].includes(String(value.currentRole || ''))
      || !Array.isArray(value.connections) || !Array.isArray(value.recentEvents)) return false;
    const connectionIds = new Set();
    for (const item of value.connections) {
      if (!item || typeof item !== 'object' || !PROVIDERS.includes(item.provider)
        || !['testing', 'production'].includes(item.environment)
        || typeof item.connectionId !== 'string' || connectionIds.has(item.connectionId)
        || !ACCOUNT_ID.test(String(item.externalAccountId || '')) || typeof item.enabled !== 'boolean'
        || !['active', 'disabled'].includes(item.status)
        || (item.status === 'active') !== item.enabled) return false;
      connectionIds.add(item.connectionId);
    }
    return value.recentEvents.every(item => item && typeof item === 'object'
      && connectionIds.has(item.connectionId)
      && PROVIDERS.includes(item.provider)
      && ['booking.created', 'booking.updated', 'booking.cancelled'].includes(item.eventType)
      && ['accepted', 'processed', 'failed'].includes(item.state));
  }

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites } = options;
    let organization = null;
    let payload = null;
    let available = null;
    let busy = false;
    let revision = 0;
    let contextRevision = 0;
    let bound = false;
    const pendingSaves = new Map();

    function manager() {
      return ['owner', 'admin'].includes(String(payload?.currentRole || organization?.current_role || ''));
    }

    function missing(error) {
      return /PGRST202|42883|function .* does not exist/i
        .test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }

    function current(requestRevision, organizationId) {
      return requestRevision === revision && organization?.id === organizationId;
    }

    function setBusy(value) {
      busy = value;
      $('#providerIntegrationsDisclosure')?.querySelectorAll('button,input').forEach(control => {
        control.disabled = value || !manager();
      });
    }

    function connectionFor(provider) {
      const connections = Array.isArray(payload?.connections) ? payload.connections : [];
      return connections.find(item => item.provider === provider && item.environment === 'testing') || null;
    }

    function eventsFor(provider) {
      const events = Array.isArray(payload?.recentEvents) ? payload.recentEvents : [];
      return events.filter(item => item.provider === provider).slice(0, 12);
    }

    function renderProvider(provider) {
      const card = document.querySelector(`[data-provider-integration="${provider}"]`);
      if (!card) return;
      const connection = connectionFor(provider);
      const events = eventsFor(provider);
      const input = card.querySelector('[data-provider-integration-account]');
      const state = card.querySelector('[data-provider-integration-state]');
      const note = card.querySelector('[data-provider-integration-note]');
      const button = card.querySelector('button[type="submit"]');
      const history = card.querySelector('.provider-integration-history');
      const eventList = card.querySelector('[data-provider-integration-events]');
      if (input && document.activeElement !== input) input.value = pendingSaves.get(provider)?.accountId || connection?.externalAccountId || '';
      if (state) state.textContent = connection ? (connection.enabled ? 'Тестовая настройка включена' : 'Черновик сохранён') : 'Черновика нет';
      if (button) button.textContent = 'Сохранить черновик';
      if (note) {
        const last = events[0]?.receivedAt ? formatMoment(events[0].receivedAt) : '';
        note.textContent = connection
          ? connection.enabled
            ? `Тестовая настройка включена. Подключение к провайдеру здесь не проверяется${last ? ` · последнее событие ${last}` : ''}.`
            : `Черновик сохранён. Для этой тестовой настройки обмен выключен${last ? ` · последнее событие ${last}` : ''}.`
          : `Укажите ID филиала в ${provider === 'dikidi' ? 'календаре 1' : 'календаре 2'}. Сохранение черновика не включает обмен данными.`;
      }
      if (history) history.hidden = events.length === 0;
      if (eventList) eventList.innerHTML = events.map(item => {
        const event = EVENT_LABELS[item.eventType] || item.eventType || 'Событие';
        const status = STATE_LABELS[item.state] || item.state || 'Принято';
        const moment = formatMoment(item.processedAt || item.receivedAt);
        const failure = item.state === 'failed' && item.errorCode ? ` · ${item.errorCode}` : '';
        return `<article class="organization-audit-data-row"><div><strong>${escapeHtml(event)}</strong><small>${escapeHtml(moment || 'Время не указано')}</small></div><span><em>${escapeHtml(status)}${escapeHtml(failure)}</em></span></article>`;
      }).join('');
    }

    function render(error = null) {
      const disclosure = $('#providerIntegrationsDisclosure');
      if (!disclosure) return;
      disclosure.hidden = !organization || !manager();
      if (disclosure.hidden) return;
      const unavailable = $('#providerIntegrationsUnavailable');
      const workspace = $('#providerIntegrationsWorkspace');
      if (unavailable) unavailable.hidden = available === true;
      if (workspace) workspace.hidden = available !== true;
      if (available !== true) {
        if ($('#providerIntegrationsUnavailableText')) {
          $('#providerIntegrationsUnavailableText').textContent = missing(error)
            ? 'Настройки появятся после обновления системы. Оплата и записи продолжают работать.'
            : 'Не удалось получить статусы. Оплата и записи продолжают работать.';
        }
        setBusy(busy);
        return;
      }
      const ready = PROVIDERS.filter(provider => connectionFor(provider)).length;
      if ($('#providerIntegrationsState')) $('#providerIntegrationsState').textContent = `Тестовых настроек: ${ready} из 2`;
      PROVIDERS.forEach(renderProvider);
      setBusy(busy);
    }

    async function load() {
      if (!organization?.id) return;
      const organizationId = organization.id;
      const requestRevision = ++revision;
      let result;
      try {
        result = await db.rpc('get_minuta_provider_connector_read_model_v144', {
          p_organization:organizationId,
          p_count:24
        });
      } catch (error) {
        if (!current(requestRevision, organizationId)) return;
        payload = null; available = null;
        render(error);
        return;
      }
      if (!current(requestRevision, organizationId)) return;
      if (result.error) {
        payload = null;
        available = missing(result.error) ? false : null;
        render(result.error);
        return;
      }
      if (!validWorkspace(result.data, organizationId)) {
        payload = null; available = null;
        render(new Error('integration_workspace_mismatch'));
        return;
      }
      payload = result.data;
      available = true;
      render();
    }

    async function setOrganization(next) {
      revision += 1;
      contextRevision += 1;
      organization = next?.id ? next : null;
      payload = null; available = organization ? null : false; busy = false;
      pendingSaves.clear();
      render();
      if (organization && manager()) await load();
    }

    function reset() {
      revision += 1;
      contextRevision += 1;
      organization = null; payload = null; available = false; busy = false;
      pendingSaves.clear();
      render();
    }

    async function submit(event) {
      const form = event.target.closest('[data-provider-integration-form]');
      if (!form || !organization?.id || !manager() || busy) return;
      event.preventDefault();
      if (!requireWrites()) return;
      const provider = form.dataset.providerIntegrationForm;
      if (!PROVIDERS.includes(provider)) return;
      const input = form.querySelector('[data-provider-integration-account]');
      const accountId = String(input?.value || '').trim();
      if (!ACCOUNT_ID.test(accountId)) {
        input?.focus();
        notify('Проверьте ID филиала');
        return;
      }
      const connection = connectionFor(provider);
      const pending = pendingSaves.get(provider);
      if (connection?.externalAccountId !== accountId && pending?.accountId !== accountId
        && !global.crypto?.randomUUID) {
        notify('Безопасный идентификатор недоступен. Обновите браузер.');
        return;
      }
      const organizationId = organization.id;
      const operationContext = contextRevision;
      const isCurrent = () => operationContext === contextRevision && organization?.id === organizationId;
      const connectionId = connection?.externalAccountId === accountId ? connection.connectionId
        : pending?.accountId === accountId ? pending.connectionId : global.crypto.randomUUID();
      pendingSaves.set(provider, { accountId, connectionId });
      setBusy(true);
      try {
        await db.rpc('configure_minuta_integration_connection_v142', {
          p_organization:organizationId,
          p_connection:connectionId,
          p_provider:provider,
          p_environment:'testing',
          p_external_account_id:accountId,
          p_enabled:false
        });
      } catch {
        // The server may have committed before the response was lost.
      }
      if (!isCurrent()) return;
      await load();
      if (!isCurrent()) return;
      setBusy(false);
      const saved = available === true ? connectionFor(provider) : null;
      if (saved?.externalAccountId === accountId && saved.enabled === false) {
        pendingSaves.delete(provider);
        notify(`Черновик ${provider === 'dikidi' ? 'календаря 1' : 'календаря 2'} сохранён`);
      } else {
        notify('Не удалось подтвердить сохранение черновика. Обновите статусы или повторите сохранение.');
      }
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('#providerIntegrationsDisclosure')?.addEventListener('submit', submit);
      $('#reloadProviderIntegrations')?.addEventListener('click', () => { void load(); });
    }

    return { bind, load, setOrganization, reset };
  }

  global.MinutaIntegrations = { createController };
})(window);
