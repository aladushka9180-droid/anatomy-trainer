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
      writePending = false;
      pendingOrganization = undefined;
      $('#resourcesPanel').hidden = true;
      $('#resourcesLoading').hidden = true;
      $('#resourcesUnavailable').hidden = true;
      $('#resourceWorkspace').hidden = true;
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
        return { ok: false, optional: true, pending: true };
      }
      if (!normalized) { reset(); return { ok: false, optional: true }; }
      pendingOrganization = undefined;
      organization = normalized;
      payload = null;
      availability = null;
      selectedServiceId = '';
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
        $('#resourcesUnavailableText').textContent = 'Филиалы и команда работают. Не удалось загрузить только кабинеты и оборудование.';
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

    function groupCard(group, canManage) {
      const state = group.active ? 'Активна' : 'Отключена';
      if (!canManage) return `<article class="organization-row ${group.active ? '' : 'is-muted'}"><div class="organization-row-main"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.description || kindLabels[group.kind] || 'Группа ресурсов')}</small></div><span class="organization-tags"><span class="organization-role">${escapeHtml(kindLabels[group.kind] || 'Другое')}</span><span class="organization-status ${group.active ? 'is-active' : ''}">${state}</span></span></article>`;
      const kinds = Object.entries(kindLabels).map(([value, label]) => `<option value="${value}" ${group.kind === value ? 'selected' : ''}>${label}</option>`).join('');
      return `<details class="organization-row organization-editor ${group.active ? '' : 'is-muted'}" data-resource-group-card="${escapeHtml(group.id)}"><summary><div class="organization-row-main"><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(group.description || 'Взаимозаменяемые ресурсы')}</small></div><span class="organization-tags"><span class="organization-role">${escapeHtml(kindLabels[group.kind] || 'Другое')}</span><span class="organization-status ${group.active ? 'is-active' : ''}">${state}</span></span></summary><form data-resource-group-form="${escapeHtml(group.id)}"><label>Название<input name="name" maxlength="120" value="${escapeHtml(group.name)}" required></label><div class="form-row"><label>Тип<select name="kind">${kinds}</select></label><label>Описание<input name="description" maxlength="500" value="${escapeHtml(group.description || '')}"></label></div><div class="organization-checks"><label><input name="active" type="checkbox" ${group.active ? 'checked' : ''}><span>Группа активна</span></label></div><p class="form-error" data-resource-group-error hidden></p><button class="secondary-button" type="submit" data-resource-write>Сохранить группу</button></form></details>`;
    }

    function resourceCard(resource, canManage) {
      const state = resource.active ? 'Активен' : 'Отключён';
      if (!canManage) return `<article class="organization-row ${resource.active ? '' : 'is-muted'}"><div class="organization-row-main"><strong>${escapeHtml(resource.name)}</strong><small>${escapeHtml(resource.location_name)} · ${escapeHtml(resource.group_name)}</small></div><span class="organization-status ${resource.active ? 'is-active' : ''}">${state}</span></article>`;
      const locations = payload.locations.filter(item => item.active || item.id === resource.location_id);
      const groups = payload.groups.filter(item => item.active || item.id === resource.group_id);
      return `<details class="organization-row organization-editor ${resource.active ? '' : 'is-muted'}" data-resource-card="${escapeHtml(resource.id)}"><summary><div class="organization-row-main"><strong>${escapeHtml(resource.name)}</strong><small>${escapeHtml(resource.location_name)} · ${escapeHtml(resource.group_name)}</small></div><span class="organization-tags"><span class="organization-role">${escapeHtml(kindLabels[resource.kind] || 'Ресурс')}</span><span class="organization-status ${resource.active ? 'is-active' : ''}">${state}</span></span></summary><form data-resource-form="${escapeHtml(resource.id)}"><label>Название<input name="name" maxlength="120" value="${escapeHtml(resource.name)}" required></label><div class="form-row"><label>Филиал<select name="location" required>${optionList(locations, resource.location_id, item => item.name)}</select></label><label>Группа<select name="group" required>${optionList(groups, resource.group_id, item => `${item.name} · ${kindLabels[item.kind] || 'Другое'}`)}</select></label></div><div class="organization-checks"><label><input name="active" type="checkbox" ${resource.active ? 'checked' : ''}><span>Ресурс активен</span></label></div><p class="form-error" data-resource-error hidden></p><button class="secondary-button" type="submit" data-resource-write>Сохранить ресурс</button></form></details>`;
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
      holder.innerHTML = groups.length ? groups.map(group => `<label class="resource-requirement-row"><span><strong>${escapeHtml(group.name)}</strong><small>${escapeHtml(kindLabels[group.kind] || 'Ресурс')}</small></span><input type="number" min="0" max="20" step="1" value="${values.get(group.id) || 0}" data-requirement-group="${escapeHtml(group.id)}" aria-label="Количество: ${escapeHtml(group.name)}"></label>`).join('') : empty('Групп пока нет', 'Создайте группу кабинетов, столов или оборудования.');
      $('#resourceRequirementSubmit').disabled = !payload.can_manage || !groups.length;
    }

    function render() {
      if (availability !== 'ready' || !payload) return;
      const canManage = Boolean(payload.can_manage);
      setResourceWritesDisabled(false);
      $('#resourcesPanel').hidden = false;
      $('#resourcesUnavailable').hidden = true;
      $('#resourceWorkspace').hidden = false;
      $('#resourcesCount').textContent = String(payload.resources.filter(item => item.active).length);
      $('#resourceGroupsCount').textContent = String(payload.groups.filter(item => item.active).length);
      $('#resourceGroupsList').innerHTML = payload.groups.length ? payload.groups.map(item => groupCard(item, canManage)).join('') : empty('Групп пока нет', 'Добавьте тип взаимозаменяемых ресурсов.');
      $('#resourcesList').innerHTML = payload.resources.length ? payload.resources.map(item => resourceCard(item, canManage)).join('') : empty('Ресурсов пока нет', 'Запись пока учитывает только занятость специалиста.');
      $('#resourceGroupCreator').hidden = !canManage;
      $('#resourceCreator').hidden = !canManage;
      $('#resourceRequirementsPanel').hidden = !canManage;
      const activeLocations = payload.locations.filter(item => item.active);
      const activeGroups = payload.groups.filter(item => item.active);
      $('#resourceLocation').innerHTML = optionList(activeLocations, '', item => item.name);
      $('#resourceGroup').innerHTML = optionList(activeGroups, '', item => `${item.name} · ${kindLabels[item.kind] || 'Другое'}`);
      $('#resourceForm button[type="submit"]').disabled = !activeLocations.length || !activeGroups.length;
      $('#resourceCreateHelp').textContent = !activeLocations.length ? 'Сначала добавьте активный филиал.' : !activeGroups.length ? 'Сначала добавьте активную группу.' : '';
      $('#resourceRequirementService').innerHTML = optionList(payload.services, selectedServiceId, item => `${item.name} · ${item.performer_name}`);
      renderRequirements();
      $('#resourceAuditPanel').hidden = !canManage;
      $('#resourceAuditCount').textContent = String(payload.audit.length);
      $('#resourceAuditList').innerHTML = payload.audit.length ? payload.audit.map(auditCard).join('') : empty('Изменений пока нет', 'Здесь появятся действия с группами, ресурсами и требованиями услуг.');
      applyWriteAvailability();
    }

    function showError(selector, message) {
      const holder = $(selector);
      if (!holder) return;
      holder.textContent = message;
      holder.hidden = false;
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
        const text = `${error.message || ''} ${error.details || ''}`;
        const message = /resource_has_future_bookings/i.test(text)
          ? 'Сначала перенесите или отмените будущие записи, связанные с этим ресурсом.'
          : /resource_unavailable/i.test(text)
            ? 'Не всем будущим записям хватает свободных ресурсов. Настройки не изменены.'
            : /duplicate key/i.test(text)
              ? 'Такое название уже используется в этом разделе.'
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
      if (event.target.id !== 'resourceRequirementService') return;
      selectedServiceId = event.target.value;
      $('#resourceRequirementError').hidden = true;
      renderRequirements();
    }

    async function handleClick(event) {
      if (event.target.closest('#reloadResources') && !writePending) await load();
    }

    function bind() {
      document.addEventListener('submit', handleSubmit);
      document.addEventListener('change', handleChange);
      document.addEventListener('click', handleClick);
    }

    return { bind, load, reset, setOrganization, render, get availability() { return availability; } };
  }

  window.MinutaResources = { createController };
})();
