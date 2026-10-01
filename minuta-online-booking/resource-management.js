(function () {
  'use strict';

  const kindLabels = { room: 'Кабинет', table: 'Массажный стол', equipment: 'Оборудование', other: 'Другое' };
  const auditLabels = {
    group_created: 'Создана группа ресурсов',
    group_updated: 'Изменена группа ресурсов',
    resource_created: 'Добавлен ресурс',
    resource_updated: 'Изменён ресурс',
    requirements_replaced: 'Изменены требования услуги'
  };

  function createController(options) {
    const { db, $, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    let organization = null;
    let payload = null;
    let availability = null;
    let requestRevision = 0;
    let selectedServiceId = '';
    let resourceQuery = '';
    let resourceLocationId = '';
    let resourceGroupId = '';
    let resourceStatus = '';
    let resourceLimit = 12;
    let groupsOpen = false;
    let writePending = false;
    let pendingOrganization;

    function isUnsupported(error) {
      return /PGRST202|42883|get_minuta_resource_workspace|function .* does not exist/i.test(`${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`);
    }

    function setResourceWritesDisabled(disabled) {
      $('#resourcesPanel').querySelectorAll('[data-resource-write]').forEach(control => {
        if (disabled && !control.disabled) {
          control.disabled = true;
          control.dataset.resourceBusyDisabled = 'true';
        } else if (!disabled && control.dataset.resourceBusyDisabled === 'true') {
          control.disabled = false;
          delete control.dataset.resourceBusyDisabled;
        }
      });
    }

    function reset() {
      requestRevision += 1;
      organization = null;
      payload = null;
      availability = null;
      selectedServiceId = '';
      resourceQuery = '';
      resourceLocationId = '';
      resourceGroupId = '';
      resourceStatus = '';
      resourceLimit = 12;
      groupsOpen = false;
      writePending = false;
      pendingOrganization = undefined;
      $('#resourcesPanel').hidden = true;
      $('#resourcesLoading').hidden = true;
      $('#resourcesUnavailable').hidden = true;
      $('#resourceWorkspace').hidden = true;
      if ($('#resourceHeaderActions')) $('#resourceHeaderActions').hidden = true;
    }

    async function setOrganization(next) {
      const normalized = next?.id ? { ...next } : null;
      if (writePending) {
        pendingOrganization = normalized;
        requestRevision += 1;
        payload = null;
        availability = normalized ? 'loading' : null;
        selectedServiceId = '';
        $('#resourceWorkspace').hidden = true;
        $('#resourcesUnavailable').hidden = true;
        $('#resourcesPanel').hidden = !normalized;
        $('#resourcesLoading').hidden = !normalized;
        if ($('#resourceHeaderActions')) $('#resourceHeaderActions').hidden = true;
        return { ok: false, optional: true, pending: true };
      }
      if (!normalized) { reset(); return { ok: false, optional: true }; }
      pendingOrganization = undefined;
      organization = normalized;
      payload = null;
      availability = null;
      selectedServiceId = '';
      resourceQuery = '';
      resourceLocationId = '';
      resourceGroupId = '';
      resourceStatus = '';
      resourceLimit = 12;
      groupsOpen = false;
      for (const selector of ['#resourceCreator', '#resourceGroupCreator']) {
        const creator = $(selector);
        creator.open = false;
        creator.querySelector('form')?.reset?.();
      }
      return load();
    }

    async function load() {
      if (writePending) return { ok: false, optional: true, pending: true };
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const organizationId = organization?.id;
      const revision = ++requestRevision;
      if (!userId || !organizationId) { reset(); return { ok: false, optional: true }; }
      availability = 'loading';
      payload = null;
      $('#resourcesPanel').hidden = false;
      $('#resourcesLoading').hidden = false;
      $('#resourcesUnavailable').hidden = true;
      $('#resourceWorkspace').hidden = true;
      if ($('#resourceHeaderActions')) $('#resourceHeaderActions').hidden = true;
      const { data, error } = await db.rpc('get_minuta_resource_workspace', { p_organization: organizationId });
      if (!sessionIsCurrent(userId, generation) || revision !== requestRevision || organization?.id !== organizationId) return { ok: false, optional: true, stale: true };
      $('#resourcesLoading').hidden = true;
      if (error) {
        if (isUnsupported(error)) {
          availability = 'unsupported';
          payload = null;
          $('#resourcesPanel').hidden = true;
          return { ok: false, optional: true, unsupported: true };
        }
        availability = 'error';
        payload = null;
        $('#resourceWorkspace').hidden = true;
        $('#resourcesUnavailable').hidden = false;
        $('#resourcesUnavailableText').textContent = 'Филиалы и команда работают. Не удалось загрузить группы и отдельные ресурсы; повторите попытку.';
        return { ok: false, optional: true };
      }
      if (String(data?.organization_id || '') !== String(organizationId)) {
        availability = 'error';
        payload = null;
        $('#resourceWorkspace').hidden = true;
        $('#resourcesUnavailable').hidden = false;
        $('#resourcesUnavailableText').textContent = 'Сервер вернул данные другой организации. Изменения заблокированы; повторите загрузку.';
        return { ok: false, optional: true, scopeMismatch: true };
      }
      availability = 'ready';
      payload = data || {};
      for (const key of ['services', 'groups', 'resources', 'requirements', 'locations', 'audit']) if (!Array.isArray(payload[key])) payload[key] = [];
      if (!payload.services.some(item => item.id === selectedServiceId)) selectedServiceId = payload.services[0]?.id || '';
      render();
      return { ok: true, optional: true };
    }

    function empty(title, text) {
      return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`;
    }

    function optionList(items, selected, label) {
      return items.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(label(item))}</option>`).join('');
    }

    function icon(kind) {
      const name = Object.hasOwn(kindLabels, kind) ? kind : 'other';
      return `<span class="resource-kind-icon"><svg aria-hidden="true"><use href="resource-icons.svg?v=1#${name}"></use></svg></span>`;
    }

    function installLayout() {
      const panel = $('#resourcesPanel');
      if (!panel.classList || panel.classList.contains('resources-soft-minimalism')) return;
      panel.classList.add('resources-soft-minimalism');
      if (!$('#resourceSoftMinimalismStyles')) {
        const sheet = document.createElement('link');
        sheet.id = 'resourceSoftMinimalismStyles';
        sheet.rel = 'stylesheet';
        sheet.href = 'resources-soft-minimalism.css?v=1';
        document.head.append(sheet);
      }
      const head = panel.querySelector('.panel-head');
      head.firstElementChild.classList.add('resource-title');
      head.firstElementChild.append($('#resourcesCount'));
      head.insertAdjacentHTML('beforeend', '<div class="resource-header-actions" id="resourceHeaderActions"><button class="secondary-button" id="resourceGroupsToggle" type="button" aria-controls="resourceGroupsSection" aria-expanded="false"><svg aria-hidden="true"><use href="resource-icons.svg?v=1#groups"></use></svg><span id="resourceGroupsToggleLabel">Группы</span></button><button class="primary" id="resourceMainAction" type="button" data-resource-write><svg aria-hidden="true"><use href="ui-icons.svg#icon-plus"></use></svg><span id="resourceMainActionLabel">Добавить ресурс</span></button></div>');
      const grid = $('#resourceManagementGrid');
      grid.before($('#resourceGroupsSection'));
      $('#resourceGroupsSection').hidden = true;
      $('#resourceGroupsSection').querySelector('.resource-subhead').insertAdjacentHTML('beforeend', '<button class="resource-text-button" type="button" data-resource-close-groups>Закрыть</button>');
      $('#resourceObjectsSection').prepend($('#resourceCreator'));
      $('#resourceObjectsSection').querySelector('.resource-subhead').classList.add('resource-objects-heading');
      for (const id of ['resourceForm', 'resourceGroupForm']) {
        $('#' + id).insertAdjacentHTML('beforeend', '<button class="resource-text-button resource-cancel" type="button" data-resource-cancel>Отмена</button>');
      }
      const requirements = $('#resourceRequirementsPanel');
      const disclosure = document.createElement('details');
      disclosure.id = 'resourceRequirementsDisclosure';
      disclosure.className = 'resource-secondary';
      disclosure.innerHTML = '<summary><svg aria-hidden="true"><use href="ui-icons.svg#icon-settings"></use></svg><span>Ресурсы для услуг</span><span class="resource-chevron" aria-hidden="true">⌄</span></summary>';
      requirements.before(disclosure);
      disclosure.append(requirements);
    }

    function renderHeader(canManage, hasGroups, activeLocations, activeGroups) {
      const actions = $('#resourceHeaderActions');
      if (!actions?.setAttribute) return;
      actions.hidden = false;
      $('#resourceMainAction').hidden = !canManage;
      $('#resourceMainAction').disabled = hasGroups && (!activeLocations.length || !activeGroups.length);
      $('#resourceMainActionLabel').textContent = hasGroups ? 'Добавить ресурс' : 'Создать группу';
      $('#resourceGroupsToggleLabel').textContent = `Группы · ${payload.groups.length}`;
      // The first setup keeps the existing group-creation step visible.
      $('#resourceGroupsSection').hidden = hasGroups ? !groupsOpen : false;
      $('#resourceGroupsToggle').setAttribute('aria-expanded', String(!$('#resourceGroupsSection').hidden));
      $('#resourceRequirementsDisclosure').hidden = $('#resourceRequirementsPanel').hidden;
    }

    function groupCard(group, canManage) {
      const state = group.active ? 'Активна' : 'Отключена';
      if (!canManage) return `<article class="organization-row resource-item ${group.active ? '' : 'is-muted'}">${icon(group.kind)}<div class="organization-row-main"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.description || kindLabels[group.kind] || 'Группа ресурсов')}</small></div><span class="organization-status ${group.active ? 'is-active' : ''}">${state}</span></article>`;
      const kinds = Object.entries(kindLabels).map(([value, label]) => `<option value="${value}" ${group.kind === value ? 'selected' : ''}>${label}</option>`).join('');
      return `<details class="organization-row organization-editor resource-item ${group.active ? '' : 'is-muted'}" data-resource-group-card="${escapeHtml(group.id)}"><summary>${icon(group.kind)}<div class="organization-row-main"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.description || kindLabels[group.kind] || 'Группа взаимозаменяемых ресурсов')}</small></div><span class="organization-status ${group.active ? 'is-active' : ''}">${state}</span><span class="resource-chevron" aria-hidden="true">›</span></summary><form data-resource-group-form="${escapeHtml(group.id)}"><label>Название группы<input name="name" maxlength="120" value="${escapeHtml(group.name)}" required></label><div class="form-row"><label>Тип<select name="kind">${kinds}</select></label><label>Описание (необязательно)<input name="description" maxlength="500" value="${escapeHtml(group.description || '')}"></label></div><div class="organization-checks"><label><input name="active" type="checkbox" ${group.active ? 'checked' : ''}><span>Группа активна</span></label></div><p class="form-error" data-resource-group-error hidden></p><div class="resource-form-actions"><button class="primary" type="submit" data-resource-write>Сохранить группу</button><button class="resource-text-button" type="button" data-resource-cancel>Отмена</button></div></form></details>`;
    }

    function resourceCard(resource, canManage) {
      const state = resource.active ? 'Активен' : 'Отключён';
      if (!canManage) return `<article class="organization-row resource-item ${resource.active ? '' : 'is-muted'}">${icon(resource.kind)}<div class="organization-row-main"><strong>${escapeHtml(resource.name)}</strong><small>${escapeHtml(resource.location_name)} · ${escapeHtml(resource.group_name)}</small></div><span class="organization-status ${resource.active ? 'is-active' : ''}">${state}</span></article>`;
      const locations = payload.locations.filter(item => item.active || item.id === resource.location_id);
      const groups = payload.groups.filter(item => item.active || item.id === resource.group_id);
      return `<details class="organization-row organization-editor resource-item ${resource.active ? '' : 'is-muted'}" data-resource-card="${escapeHtml(resource.id)}"><summary>${icon(resource.kind)}<div class="organization-row-main"><strong>${escapeHtml(resource.name)}</strong><small>${escapeHtml(resource.location_name)} · ${escapeHtml(resource.group_name)}</small></div><span class="organization-status ${resource.active ? 'is-active' : ''}">${state}</span><span class="resource-chevron" aria-hidden="true">›</span></summary><form data-resource-form="${escapeHtml(resource.id)}"><label>Название ресурса<input name="name" maxlength="120" value="${escapeHtml(resource.name)}" required></label><div class="form-row"><label>Филиал<select name="location" required>${optionList(locations, resource.location_id, item => item.name)}</select></label><label>Группа ресурсов<select name="group" required>${optionList(groups, resource.group_id, item => `${item.name} · ${kindLabels[item.kind] || 'Другое'}`)}</select></label></div><div class="organization-checks"><label><input name="active" type="checkbox" ${resource.active ? 'checked' : ''}><span>Ресурс активен</span></label></div><p class="form-error" data-resource-error hidden></p><div class="resource-form-actions"><button class="primary" type="submit" data-resource-write>Сохранить ресурс</button><button class="resource-text-button" type="button" data-resource-cancel>Отмена</button></div></form></details>`;
    }

    function auditCard(item) {
      const created = new Date(item.created_at);
      const time = Number.isNaN(created.getTime()) ? 'Время не указано' : created.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const details = item?.details && typeof item.details === 'object' ? item.details : {};
      const subject = details.name || payload.resources.find(resource => resource.id === item.subject_id)?.name || payload.groups.find(group => group.id === item.subject_id)?.name || payload.services.find(service => service.id === item.subject_id)?.name || '';
      return `<article><span></span><div><strong>${escapeHtml(auditLabels[item.action] || 'Изменение ресурсов')}</strong><small>${subject ? `${escapeHtml(subject)} · ` : ''}${escapeHtml(time)}</small></div></article>`;
    }

    function renderRequirements() {
      const holder = $('#resourceRequirementsList');
      const service = payload.services.find(item => item.id === selectedServiceId);
      if (!service) {
        holder.innerHTML = empty('Услуг пока нет', 'Сначала добавьте услугу специалисту команды.');
        $('#resourceRequirementSubmit').disabled = true;
        return;
      }
      const values = new Map(payload.requirements.filter(item => item.service_id === service.id && item.active).map(item => [item.group_id, Number(item.quantity)]));
      const groups = payload.groups.filter(item => item.active || values.has(item.id));
      holder.innerHTML = groups.length ? groups.map(group => `<label class="resource-requirement-row"><span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(kindLabels[group.kind] || 'Ресурс')}</small></span><input type="number" min="0" max="20" step="1" value="${values.get(group.id) || 0}" data-requirement-group="${escapeHtml(group.id)}" aria-label="Количество: ${escapeHtml(group.name)}"></label>`).join('') : empty('Активных групп пока нет', payload.can_manage ? 'Создайте или включите группу ресурсов, чтобы указать её для услуги.' : 'Администратор ещё не настроил группы ресурсов.');
      $('#resourceRequirementSubmit').disabled = !payload.can_manage || !groups.length;
    }

    function renderResourceList(canManage, keepEditors = false) {
      const list = $('#resourcesList');
      const normalized = resourceQuery.trim().toLocaleLowerCase('ru-RU');
      const visible = payload.resources.filter(item =>
        (!resourceLocationId || String(item.location_id) === resourceLocationId) &&
        (!resourceGroupId || String(item.group_id) === resourceGroupId) &&
        (!resourceStatus || Boolean(item.active) === (resourceStatus === 'active')) &&
        (!normalized || String(item.name || '').toLocaleLowerCase('ru-RU').includes(normalized)));
      const editors = keepEditors ? new Map([...list.querySelectorAll('[data-resource-card][open]')].map(node => [node.dataset.resourceCard, node])) : new Map();
      list.innerHTML = visible.length ? visible.slice(0, resourceLimit).map(item => resourceCard(item, canManage)).join('')
        : payload.resources.length ? empty('Ничего не найдено', 'Измените поиск или сбросьте фильтры.')
          : canManage ? '' : empty('Ресурсов пока нет', 'Администратор ещё не добавил ресурсы в филиалы.');
      list.querySelectorAll('[data-resource-card]').forEach(node => {
        const editor = editors.get(node.dataset.resourceCard);
        if (editor) node.replaceWith(editor);
      });
      const count = $('#resourceListMatchCount');
      if (count) count.textContent = `Найдено: ${visible.length} из ${payload.resources.length}`;
      const more = $('#resourceListMore');
      if (more) {
        more.hidden = visible.length <= resourceLimit;
        more.textContent = `Показать ещё · ${Math.min(12, visible.length - resourceLimit)}`;
      }
      if ($('#resourceListPageCount')) $('#resourceListPageCount').textContent = visible.length > resourceLimit ? `Показано ${resourceLimit} из ${visible.length}` : '';
      if ($('#resourceListReset')) $('#resourceListReset').hidden = !resourceQuery && !resourceLocationId && !resourceGroupId && !resourceStatus;
      if ($('#resourceFiltersToggle')) $('#resourceFiltersToggle').textContent = `Фильтры${[resourceLocationId, resourceGroupId, resourceStatus].filter(Boolean).length ? ' · ' + [resourceLocationId, resourceGroupId, resourceStatus].filter(Boolean).length : ''}`;
      if (writePending) setResourceWritesDisabled(true);
    }

    function renderResourceFilters() {
      const list = $('#resourcesList');
      if (!$('#resourceListFilters') && typeof list.insertAdjacentHTML === 'function') {
        list.insertAdjacentHTML('beforebegin', '<div class="resource-list-filters" id="resourceListFilters"><div class="resource-search-row"><label class="resource-search"><span class="resource-visually-hidden">Найти ресурс</span><svg aria-hidden="true"><use href="ui-icons.svg#icon-search"></use></svg><input id="resourceListSearch" type="search" autocomplete="off" placeholder="Найти ресурс"></label><button class="secondary-button" id="resourceFiltersToggle" type="button" aria-controls="resourceExtraFilters" aria-expanded="false">Фильтры</button></div><div class="resource-extra-filters" id="resourceExtraFilters"><label><span class="resource-visually-hidden">Фильтр ресурсов по филиалу</span><select id="resourceListLocation" aria-label="Фильтр ресурсов по филиалу"></select></label><label><span class="resource-visually-hidden">Фильтр ресурсов по группе</span><select id="resourceListGroup" aria-label="Фильтр ресурсов по группе"></select></label><label><span class="resource-visually-hidden">Фильтр ресурсов по статусу</span><select id="resourceListStatus" aria-label="Фильтр ресурсов по статусу"><option value="">Все статусы</option><option value="active">Активные</option><option value="inactive">Отключённые</option></select></label></div><div class="resource-filter-result"><span id="resourceListMatchCount" role="status" aria-live="polite"></span><button class="resource-text-button" id="resourceListReset" type="button" hidden>Сбросить фильтры</button></div></div>');
        list.insertAdjacentHTML('afterend', '<div class="resource-list-pagination"><span id="resourceListPageCount"></span><button class="secondary-button" id="resourceListMore" type="button" hidden>Показать ещё</button></div>');
      }
      const filters = $('#resourceListFilters');
      if (!filters) return;
      filters.hidden = !payload.resources.length;
      const locations = payload.locations.filter(item => payload.resources.some(resource => String(resource.location_id) === String(item.id)));
      if (resourceLocationId && !locations.some(item => String(item.id) === resourceLocationId)) resourceLocationId = '';
      $('#resourceListLocation').innerHTML = `<option value="">Все филиалы</option>${optionList(locations, resourceLocationId, item => item.name)}`;
      $('#resourceListLocation').value = resourceLocationId;
      $('#resourceListSearch').value = resourceQuery;
      const groups = payload.groups.filter(item => payload.resources.some(resource => String(resource.group_id) === String(item.id)));
      if (resourceGroupId && !groups.some(item => String(item.id) === resourceGroupId)) resourceGroupId = '';
      if ($('#resourceListGroup')) {
        $('#resourceListGroup').innerHTML = `<option value="">Все группы</option>${optionList(groups, resourceGroupId, item => item.name)}`;
        $('#resourceListGroup').value = resourceGroupId;
      }
      if ($('#resourceListStatus')) $('#resourceListStatus').value = resourceStatus;
    }

    function render() {
      if (availability !== 'ready' || !payload) return;
      installLayout();
      const canManage = Boolean(payload.can_manage);
      setResourceWritesDisabled(false);
      $('#resourcesPanel').hidden = false;
      $('#resourcesUnavailable').hidden = true;
      $('#resourceWorkspace').hidden = false;
      const activeResourceCount = payload.resources.filter(item => item.active).length;
      const hasGroups = payload.groups.length > 0;
      const hasResources = payload.resources.length > 0;
      $('#resourcesCount').textContent = String(payload.resources.length);
      $('#resourcesCount').hidden = !payload.resources.length;
      $('#resourceGroupsCount').textContent = String(payload.groups.length);
      $('#resourceGroupsCount').hidden = !payload.groups.length;
      $('#resourceGroupsList').innerHTML = hasGroups ? payload.groups.map(item => groupCard(item, canManage)).join('') : canManage ? '' : empty('Групп ресурсов пока нет', 'Администратор ещё не создал группы ресурсов.');
      renderResourceFilters();
      renderResourceList(canManage);
      $('#resourceManagementGrid').dataset.resourceStep = hasGroups ? (hasResources ? 'ready' : 'resources') : 'groups';
      $('#resourceObjectsSection').hidden = !hasGroups;
      $('#resourceGroupCreator').hidden = !canManage;
      $('#resourceGroupCreator').dataset.emptyAction = String(!hasGroups);
      $('#resourceGroupCreatorLabel').textContent = hasGroups ? 'Добавить группу' : 'Создать группу';
      $('#resourceGroupCreatorHint').textContent = hasGroups ? '' : 'Например, массажные кабинеты';
      $('#resourceCreator').hidden = !canManage || !hasGroups;
      $('#resourceCreator').dataset.emptyAction = String(!hasResources);
      $('#resourceCreatorLabel').textContent = hasResources ? 'Добавить ресурс' : 'Добавить первый ресурс';
      $('#resourceCreatorHint').textContent = hasResources ? '' : 'Укажите конкретный кабинет или оборудование, филиал и группу';
       const activeLocations = payload.locations.filter(item => item.active);
       const activeGroups = payload.groups.filter(item => item.active);
       const setupGuide = $('#resourceSetupGuide');
       setupGuide.hidden = !canManage || (activeLocations.length > 0 && activeGroups.length > 0 && activeResourceCount > 0);
       setupGuide.textContent = !activeLocations.length
         ? 'Сначала добавьте активный филиал. Затем создайте группу взаимозаменяемых ресурсов и добавьте в неё конкретный кабинет или оборудование.'
         : !activeGroups.length
           ? 'Сначала создайте группу взаимозаменяемых ресурсов. Затем добавьте конкретный кабинет или оборудование в филиал.'
           : 'Добавьте конкретный кабинет или оборудование в филиал. Затем укажите, каким услугам нужны ресурсы этой группы.';
       $('#resourceLocationLink').hidden = !canManage || activeLocations.length > 0;
       $('#resourceRequirementsPanel').hidden = !canManage || !activeGroups.length || !activeResourceCount;
      $('#resourceLocation').innerHTML = optionList(activeLocations, '', item => item.name);
      $('#resourceGroup').innerHTML = optionList(activeGroups, '', item => `${item.name} · ${kindLabels[item.kind] || 'Другое'}`);
      $('#resourceForm button[type="submit"]').disabled = !activeLocations.length || !activeGroups.length;
      $('#resourceCreateHelp').textContent = !activeLocations.length ? 'Сначала добавьте активный филиал.' : !activeGroups.length ? 'Сначала создайте или включите группу ресурсов.' : '';
      $('#resourceRequirementService').innerHTML = optionList(payload.services, selectedServiceId, item => `${item.name} · ${item.performer_name}`);
      renderRequirements();
      $('#resourceAuditPanel').hidden = !canManage || !payload.audit.length;
      $('#resourceAuditCount').textContent = String(payload.audit.length);
      $('#resourceAuditCount').hidden = payload.audit.length === 0;
      $('#resourceAuditList').innerHTML = payload.audit.length ? payload.audit.map(auditCard).join('') : empty('Изменений пока нет', 'Здесь появятся действия с группами, ресурсами и требованиями услуг.');
      renderHeader(canManage, hasGroups, activeLocations, activeGroups);
      applyWriteAvailability();
    }

    function showError(selector, message) {
      const holder = $(selector);
      if (!holder) return;
      holder.textContent = message;
      holder.hidden = false;
      if (holder.closest?.('details')) {
        holder.closest('details').open = true;
        if (holder.closest('#resourceGroupsSection')) {
          groupsOpen = true;
          $('#resourceGroupsSection').hidden = false;
          $('#resourceGroupsToggle')?.setAttribute?.('aria-expanded', 'true');
        }
      }
      if (holder.setAttribute) {
        holder.setAttribute('tabindex', '-1');
        holder.focus();
      }
    }

    async function mutate(rpc, parameters, button, success, errorSelector) {
      if (!requireWrites() || !organization?.id || availability !== 'ready' || !payload || payload.organization_id !== organization.id || writePending) return false;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const organizationId = organization.id;
      const revision = ++requestRevision;
      writePending = true;
      setResourceWritesDisabled(true);
      if (errorSelector) $(errorSelector).hidden = true;
      const oldText = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      let data = null;
      let error = null;
      try {
        ({ data, error } = await db.rpc(rpc, parameters));
      } catch (reason) {
        error = reason instanceof Error ? reason : { message: String(reason || '') };
      }
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
        const text = `${error.message || ''} ${error.details || ''}`;
        const subject = /resource_group/.test(rpc) ? 'группы' : 'ресурса';
        const message = /resource_has_future_bookings/i.test(text)
          ? `Сначала перенесите или отмените будущие записи, связанные с настройками ${subject}.`
          : /resource_unavailable/i.test(text)
            ? 'Не всем будущим записям хватает свободных ресурсов. Настройки не изменены.'
            : /duplicate key/i.test(text)
              ? `Такое название ${subject} уже используется.`
              : 'Изменение не сохранено. Проверьте данные и повторите.';
        const refreshed = await load();
        if (refreshed?.ok && errorSelector) showError(errorSelector, message); else notify(message);
        return false;
      }
      if (String(data?.organization_id || '') !== String(organizationId)) {
        await load();
        notify('Ответ сервера не соответствует выбранной организации. Изменение перепроверено.');
        return false;
      }
      payload = data;
      for (const key of ['services', 'groups', 'resources', 'requirements', 'locations', 'audit']) if (!Array.isArray(payload[key])) payload[key] = [];
      availability = 'ready';
      render();
      notify(success);
      return true;
    }

    async function handleSubmit(event) {
      if (!event.target.closest('#resourcesPanel')) return;
      event.preventDefault();
      if (!organization?.id || availability !== 'ready' || !payload || payload.organization_id !== organization.id || writePending) return;
      if (event.target.id === 'resourceGroupForm') {
        const saved = await mutate('create_minuta_resource_group', { p_organization: organization.id, p_name: $('#resourceGroupName').value.trim(), p_kind: $('#resourceGroupKind').value, p_description: $('#resourceGroupDescription').value.trim() }, event.submitter, 'Группа ресурсов создана', '#resourceGroupError');
        if (saved) { event.target.reset(); $('#resourceGroupCreator').open = false; }
        return;
      }
      if (event.target.id === 'resourceForm') {
        const saved = await mutate('create_minuta_resource', { p_organization: organization.id, p_location: $('#resourceLocation').value, p_group: $('#resourceGroup').value, p_name: $('#resourceName').value.trim() }, event.submitter, 'Ресурс создан', '#resourceError');
        if (saved) { event.target.reset(); $('#resourceCreator').open = false; }
        return;
      }
      if (event.target.id === 'resourceRequirementForm') {
        const requirements = [...event.target.querySelectorAll('[data-requirement-group]')].map(input => ({ group_id: input.dataset.requirementGroup, quantity: Number(input.value) })).filter(item => Number.isInteger(item.quantity) && item.quantity > 0);
        await mutate('replace_minuta_service_resource_requirements', { p_organization: organization.id, p_service: selectedServiceId, p_requirements: requirements }, event.submitter, 'Требования услуги сохранены', '#resourceRequirementError');
        return;
      }
      const groupForm = event.target.closest('[data-resource-group-form]');
      if (groupForm) {
        const id = groupForm.dataset.resourceGroupForm;
        await mutate('update_minuta_resource_group', { p_group: id, p_name: groupForm.elements.name.value.trim(), p_kind: groupForm.elements.kind.value, p_description: groupForm.elements.description.value.trim(), p_active: groupForm.elements.active.checked }, event.submitter, 'Группа сохранена', `[data-resource-group-card="${id}"] [data-resource-group-error]`);
        return;
      }
      const resourceForm = event.target.closest('[data-resource-form]');
      if (resourceForm) {
        const id = resourceForm.dataset.resourceForm;
        await mutate('update_minuta_resource', { p_resource: id, p_location: resourceForm.elements.location.value, p_group: resourceForm.elements.group.value, p_name: resourceForm.elements.name.value.trim(), p_active: resourceForm.elements.active.checked }, event.submitter, 'Ресурс сохранён', `[data-resource-card="${id}"] [data-resource-error]`);
      }
    }

    function handleChange(event) {
      if (['resourceListLocation', 'resourceListGroup', 'resourceListStatus'].includes(event.target.id)) {
        if (event.target.id === 'resourceListLocation') resourceLocationId = event.target.value;
        if (event.target.id === 'resourceListGroup') resourceGroupId = event.target.value;
        if (event.target.id === 'resourceListStatus') resourceStatus = event.target.value;
        resourceLimit = 12;
        if (payload) renderResourceList(Boolean(payload.can_manage), true);
        return;
      }
      if (event.target.id !== 'resourceRequirementService') return;
      selectedServiceId = event.target.value;
      $('#resourceRequirementError').hidden = true;
      renderRequirements();
    }

    async function handleClick(event) {
      if (event.target.closest('#reloadResources') && !writePending) await load();
      if (!event.target.closest('#resourcesPanel')) return;
      if (event.target.closest('#resourceGroupsToggle') || event.target.closest('[data-resource-close-groups]')) {
        groupsOpen = event.target.closest('[data-resource-close-groups]') ? false : $('#resourceGroupsSection').hidden;
        $('#resourceGroupsSection').hidden = !groupsOpen;
        $('#resourceGroupsToggle').setAttribute('aria-expanded', String(groupsOpen));
        if (!groupsOpen) $('#resourceGroupsToggle').focus();
      }
      if (event.target.closest('#resourceMainAction') && payload?.can_manage && !writePending) {
        const createGroup = !payload.groups.length;
        if (createGroup) {
          groupsOpen = true;
          $('#resourceGroupsSection').hidden = false;
          $('#resourceGroupsToggle').setAttribute('aria-expanded', 'true');
        }
        const creator = $(createGroup ? '#resourceGroupCreator' : '#resourceCreator');
        creator.open = true;
        $(createGroup ? '#resourceGroupName' : '#resourceName').focus();
      }
      if (event.target.closest('#resourceFiltersToggle')) {
        const filters = $('#resourceListFilters');
        const open = filters.dataset.expanded !== 'true';
        filters.dataset.expanded = String(open);
        $('#resourceFiltersToggle').setAttribute('aria-expanded', String(open));
      }
      if (event.target.closest('#resourceListReset')) {
        resourceQuery = ''; resourceLocationId = ''; resourceGroupId = ''; resourceStatus = ''; resourceLimit = 12;
        renderResourceFilters();
        renderResourceList(Boolean(payload.can_manage), true);
        $('#resourceListSearch').focus();
      }
      if (event.target.closest('#resourceListMore') && payload) {
        resourceLimit += 12;
        renderResourceList(Boolean(payload.can_manage), true);
      }
      if (event.target.closest('[data-resource-cancel]') && !writePending) cancelEditor(event.target);
    }

    function cancelEditor(target) {
      const editor = target.closest('details');
      if (!editor) return;
      editor.querySelector('form')?.reset();
      editor.querySelectorAll('.form-error').forEach(error => { error.hidden = true; });
      editor.open = false;
      const create = editor.id === 'resourceCreator' || editor.id === 'resourceGroupCreator';
      (create ? $('#resourceMainAction') : editor.querySelector('summary'))?.focus();
    }

    function bind() {
      document.addEventListener('submit', handleSubmit);
      document.addEventListener('change', handleChange);
      document.addEventListener('input', event => {
        if (event.target.id !== 'resourceListSearch') return;
        resourceQuery = event.target.value;
        resourceLimit = 12;
        if (payload) renderResourceList(Boolean(payload.can_manage), true);
      });
      document.addEventListener('click', handleClick);
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || writePending || !event.target.closest('#resourcesPanel details[open]')) return;
        const editor = event.target.closest('details');
        if (!editor?.querySelector('form')) return;
        event.preventDefault();
        cancelEditor(event.target);
      });
    }

    return { bind, load, reset, setOrganization, render, get availability() { return availability; } };
  }

  window.MinutaResources = { createController };
})();
