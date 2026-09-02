(function () {
  'use strict';

  const roleLabels = { owner: 'Владелец', admin: 'Администратор', specialist: 'Специалист' };
  const actionLabels = {
    organization_updated: 'Изменено название организации',
    location_created: 'Добавлен филиал',
    location_updated: 'Изменён филиал',
    member_invited: 'Создано приглашение',
    member_joined: 'Сотрудник добавлен в команду',
    member_updated: 'Изменены права сотрудника',
    invitation_cancelled: 'Приглашение отменено'
  };

  function createController(options) {
    const { db, $, $$, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability, onActiveOrganizationChange } = options;
    let organizations = [];
    let pendingInvitations = [];
    let activeOrganizationId = '';
    let availability = null;
    let requestRevision = 0;

    function activeOrganization() {
      return organizations.find(item => item.id === activeOrganizationId) || organizations[0] || null;
    }

    function getActiveOrganization() {
      const organization = activeOrganization();
      return organization ? {
        id: organization.id,
        name: organization.name,
        current_role: organization.current_role,
        can_manage: organization.can_manage,
        locations: Array.isArray(organization.locations) ? organization.locations.map(item => ({ ...item })) : [],
        members: Array.isArray(organization.members) ? organization.members.map(item => ({ ...item })) : []
      } : null;
    }

    function emitActiveOrganization() {
      onActiveOrganizationChange?.(getActiveOrganization());
    }

    function reset() {
      requestRevision += 1;
      organizations = [];
      pendingInvitations = [];
      activeOrganizationId = '';
      availability = null;
      $('#organizationLoading').hidden = false;
      $('#organizationLoading').setAttribute('aria-busy', 'true');
      $('#organizationUnavailable').hidden = true;
      $('#organizationPersonalInvites').hidden = true;
      $('#organizationWorkspace').hidden = true;
      $('#organizationRoleBadge').textContent = 'Загрузка';
      $('#teamBadge').textContent = '0';
      emitActiveOrganization();
    }

    function setUnavailable(message, unsupported = false) {
      availability = unsupported ? 'unsupported' : 'error';
      organizations = [];
      pendingInvitations = [];
      activeOrganizationId = '';
      $('#organizationLoading').hidden = true;
      $('#organizationLoading').removeAttribute('aria-busy');
      $('#organizationWorkspace').hidden = true;
      $('#organizationPersonalInvites').hidden = true;
      $('#organizationUnavailable').hidden = false;
      $('#organizationUnavailableText').textContent = message;
      $('#organizationRoleBadge').textContent = unsupported ? 'Не активировано' : 'Нет связи';
      $('#teamBadge').textContent = '0';
      emitActiveOrganization();
    }

    function applyPayload(payload) {
      const source = payload?.workspace || payload;
      organizations = Array.isArray(source?.organizations) ? source.organizations : [];
      pendingInvitations = Array.isArray(source?.pending_invitations) ? source.pending_invitations : [];
      if (!organizations.some(item => item.id === activeOrganizationId)) activeOrganizationId = organizations[0]?.id || '';
      availability = 'ready';
      render();
      emitActiveOrganization();
    }

    function isUnsupportedError(error) {
      const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
      return /PGRST202|42883|get_minuta_workspace|function .* does not exist/i.test(text);
    }

    async function load() {
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const revision = ++requestRevision;
      if (!userId) return { ok: false, optional: true };
      $('#organizationLoading').hidden = false;
      $('#organizationLoading').setAttribute('aria-busy', 'true');
      $('#organizationUnavailable').hidden = true;
      if (availability !== 'ready') $('#organizationWorkspace').hidden = true;
      const { data, error } = await db.rpc('get_minuta_workspace');
      if (!sessionIsCurrent(userId, generation) || revision !== requestRevision) return { ok: false, optional: true, stale: true };
      if (error) {
        setUnavailable(
          isUnsupportedError(error)
            ? 'База ещё не обновлена до версии команды. Старые записи, услуги и расписание продолжают работать.'
            : 'Не удалось безопасно загрузить команду. Другие разделы кабинета не заблокированы.',
          isUnsupportedError(error)
        );
        return { ok: false, optional: true, unsupported: isUnsupportedError(error) };
      }
      applyPayload(data);
      return { ok: true, optional: true };
    }

    function render() {
      if (availability === null) {
        $('#organizationLoading').hidden = false;
        $('#organizationLoading').setAttribute('aria-busy', 'true');
        $('#organizationUnavailable').hidden = true;
        $('#organizationPersonalInvites').hidden = true;
        $('#organizationWorkspace').hidden = true;
        return;
      }
      $('#organizationLoading').hidden = true;
      $('#organizationLoading').removeAttribute('aria-busy');
      $('#organizationUnavailable').hidden = true;
      $('#organizationPersonalInvites').hidden = !pendingInvitations.length;
      $('#personalInvitationsList').innerHTML = pendingInvitations.map(personalInvitationCard).join('');
      $('#organizationWorkspace').hidden = !organizations.length;
      if (!organizations.length) {
        if (!pendingInvitations.length) setUnavailable('Вы пока не состоите в активной организации. Обратитесь к владельцу или администратору.');
        $('#organizationRoleBadge').textContent = pendingInvitations.length ? 'Приглашение' : 'Нет доступа';
        return;
      }
      const organization = activeOrganization();
      const canManage = Boolean(organization.can_manage);
      const members = Array.isArray(organization.members) ? organization.members : [];
      const locations = Array.isArray(organization.locations) ? organization.locations : [];
      const invitations = Array.isArray(organization.invitations) ? organization.invitations : [];
      const audit = Array.isArray(organization.audit) ? organization.audit : [];
      const switcher = $('#organizationSwitcher');

      $('#organizationRoleBadge').textContent = roleLabels[organization.current_role] || 'Участник';
      $('#teamBadge').textContent = String(members.filter(item => item.active).length || 1);
      $('#organizationTitle').textContent = organization.name;
      $('#organizationAvatar').textContent = organization.name.slice(0, 1).toUpperCase();
      $('#organizationSlug').textContent = `Адрес в системе: ${organization.public_slug}`;
      $('#organizationPublicState').textContent = organization.public_booking_enabled
        ? 'Онлайн-запись команды включена'
        : 'Онлайн-запись команды пока выключена';
      $('#organizationName').value = organization.name;
      $('#organizationName').disabled = !canManage;
      $('#organizationForm').querySelector('button').hidden = !canManage;
      $('#organizationSwitcherField').hidden = organizations.length < 2;
      switcher.innerHTML = organizations.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === organization.id ? 'selected' : ''}>${escapeHtml(item.name)} · ${escapeHtml(roleLabels[item.current_role] || item.current_role)}</option>`).join('');

      $('#locationsCount').textContent = String(locations.filter(item => item.active).length);
      $('#locationsList').innerHTML = locations.length ? locations.map(location => locationCard(location, canManage)).join('') : emptyState('Филиалов пока нет', 'Добавьте первое место работы.');
      $('#locationCreator').hidden = !canManage;

      $('#membersCount').textContent = String(members.filter(item => item.active).length);
      $('#membersList').innerHTML = members.length ? members.map(member => memberCard(member, organization, canManage)).join('') : emptyState('Сотрудников пока нет', 'Пригласите специалиста по email.');
      $('#memberCreator').hidden = !canManage;
      const ownerOnlyOptions = $$('#memberRole option[value="owner"], #memberRole option[value="admin"]');
      ownerOnlyOptions.forEach(option => { option.disabled = organization.current_role !== 'owner'; });

      $('#invitationsPanel').hidden = !canManage || !invitations.length;
      $('#invitationsCount').textContent = String(invitations.length);
      $('#invitationsList').innerHTML = invitations.map(invitationCard).join('');

      $('#organizationAuditPanel').hidden = !canManage;
      $('#auditCount').textContent = String(audit.length);
      $('#organizationAuditList').innerHTML = audit.length ? audit.map(item => auditCard(item, members)).join('') : emptyState('Изменений пока нет', 'Здесь появится история действий с командой.');
      applyWriteAvailability();
    }

    function emptyState(title, text) {
      return `<div class="provider-empty compact-empty"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div>`;
    }

    function locationCard(location, canManage) {
      const state = location.active ? 'Активен' : 'Отключён';
      if (!canManage) return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.address || 'Адрес не указан')}</small></div><span class="organization-status ${location.active ? 'is-active' : ''}">${location.is_primary ? 'Основной' : escapeHtml(state)}</span></article>`;
      return `<details class="organization-row organization-editor" data-location-card="${escapeHtml(location.id)}"><summary><div class="organization-row-main"><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(location.address || 'Адрес не указан')}</small></div><span class="organization-status ${location.active ? 'is-active' : ''}">${location.is_primary ? 'Основной' : escapeHtml(state)}</span></summary><form data-location-form="${escapeHtml(location.id)}"><label>Название<input name="name" maxlength="120" value="${escapeHtml(location.name)}" required></label><label>Адрес<input name="address" maxlength="500" value="${escapeHtml(location.address || '')}"></label><input name="timezone" type="hidden" value="${escapeHtml(location.timezone || 'Europe/Samara')}"><div class="organization-checks"><label><input name="active" type="checkbox" ${location.active ? 'checked' : ''} ${location.is_primary ? 'disabled' : ''}><span>Филиал активен</span></label><label><input name="primary" type="checkbox" ${location.is_primary ? 'checked disabled' : ''}><span>Сделать основным</span></label></div><p class="form-error" data-location-error hidden></p><button class="secondary-button" type="submit" data-organization-write>Сохранить филиал</button></form></details>`;
    }

    function memberCard(member, organization, canManage) {
      const role = roleLabels[member.role] || member.role;
      const subtitle = [member.email, member.is_bookable ? 'принимает клиентов' : 'не принимает клиентов'].filter(Boolean).join(' · ');
      const canEdit = canManage && !(organization.current_role === 'admin' && member.role !== 'specialist');
      if (!canEdit) return `<article class="organization-row ${member.active ? '' : 'is-muted'}"><span class="member-avatar">${escapeHtml(member.display_name.slice(0, 1).toUpperCase())}</span><div class="organization-row-main"><strong>${escapeHtml(member.display_name)}${member.is_current_user ? ' <em>это вы</em>' : ''}</strong><small>${escapeHtml(subtitle)}</small></div><span class="organization-role">${escapeHtml(role)}</span></article>`;
      const roleOptions = Object.entries(roleLabels).map(([value, label]) => `<option value="${value}" ${member.role === value ? 'selected' : ''} ${organization.current_role !== 'owner' && value !== 'specialist' ? 'disabled' : ''}>${escapeHtml(label)}</option>`).join('');
      return `<details class="organization-row organization-editor ${member.active ? '' : 'is-muted'}" data-member-card="${escapeHtml(member.user_id)}"><summary><span class="member-avatar">${escapeHtml(member.display_name.slice(0, 1).toUpperCase())}</span><div class="organization-row-main"><strong>${escapeHtml(member.display_name)}${member.is_current_user ? ' <em>это вы</em>' : ''}</strong><small>${escapeHtml(subtitle)}</small></div><span class="organization-role">${escapeHtml(role)}</span></summary><form data-member-form="${escapeHtml(member.user_id)}"><label>Роль<select name="role">${roleOptions}</select></label><div class="organization-checks"><label><input name="bookable" type="checkbox" ${member.is_bookable ? 'checked' : ''}><span>Принимает клиентов</span></label><label><input name="active" type="checkbox" ${member.active ? 'checked' : ''}><span>Доступ активен</span></label></div><p class="form-error" data-member-error hidden></p><button class="secondary-button" type="submit" data-organization-write>Сохранить права</button></form></details>`;
    }

    function invitationCard(invitation) {
      const expires = new Date(invitation.expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(invitation.email)}</strong><small>${escapeHtml(roleLabels[invitation.role] || invitation.role)} · до ${escapeHtml(expires)}</small></div><button class="organization-cancel" type="button" data-cancel-invitation="${escapeHtml(invitation.id)}" data-organization-write>Отменить</button></article>`;
    }

    function personalInvitationCard(invitation) {
      const expires = new Date(invitation.expires_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      return `<article class="organization-row"><div class="organization-row-main"><strong>${escapeHtml(invitation.organization_name)}</strong><small>${escapeHtml(roleLabels[invitation.role] || invitation.role)} · до ${escapeHtml(expires)}</small></div><button class="primary compact-button" type="button" data-accept-invitation="${escapeHtml(invitation.id)}" data-organization-write>Принять</button></article>`;
    }

    function auditCard(item, members) {
      const actor = members.find(member => member.user_id === item.actor_id)?.display_name || 'Система';
      const time = new Date(item.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      return `<article><span></span><div><strong>${escapeHtml(actionLabels[item.action] || 'Изменение')}</strong><small>${escapeHtml(actor)} · ${escapeHtml(time)}</small></div></article>`;
    }

    function showError(selector, message) {
      const holder = $(selector);
      if (!holder) return;
      holder.textContent = message;
      holder.hidden = false;
    }

    function clearError(selector) {
      const holder = $(selector);
      if (!holder) return;
      holder.textContent = '';
      holder.hidden = true;
    }

    async function mutate(rpc, parameters, button, successMessage, errorSelector) {
      if (!requireWrites()) return false;
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      if (!userId) return false;
      if (errorSelector) clearError(errorSelector);
      const oldText = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Сохраняем…'; }
      const { data, error } = await db.rpc(rpc, parameters);
      if (button) { button.disabled = false; button.textContent = oldText; }
      if (!sessionIsCurrent(userId, generation)) return false;
      if (error) {
        const messages = {
          last_owner_must_remain: 'Нельзя отключить или понизить последнего владельца.',
          select_another_primary_first: 'Сначала назначьте другой основной филиал.',
          primary_location_must_be_active: 'Основной филиал должен оставаться активным.',
          admin_can_invite_specialist_only: 'Администратор может приглашать только специалистов.',
          admin_can_manage_specialists_only: 'Администратор не может изменять владельцев и других администраторов.'
        };
        const key = Object.keys(messages).find(item => `${error.message || ''} ${error.details || ''}`.includes(item));
        const message = messages[key] || 'Изменение не сохранено. Обновите данные и повторите.';
        if (errorSelector) showError(errorSelector, message); else notify(message);
        await load();
        return false;
      }
      applyPayload(data);
      notify(successMessage);
      return data;
    }

    async function handleSubmit(event) {
      const organization = activeOrganization();
      if (!organization) return;
      if (event.target.id === 'organizationForm') {
        event.preventDefault();
        await mutate('update_minuta_organization', { p_organization: organization.id, p_name: $('#organizationName').value.trim() }, event.submitter, 'Название сохранено', '#organizationError');
      }
      if (event.target.id === 'locationForm') {
        event.preventDefault();
        const saved = await mutate('create_minuta_location', { p_organization: organization.id, p_name: $('#locationName').value.trim(), p_address: $('#locationAddress').value.trim(), p_timezone: $('#locationTimezone').value }, event.submitter, 'Филиал добавлен', '#locationError');
        if (saved) { event.target.reset(); $('#locationTimezone').value = 'Europe/Samara'; $('#locationCreator').open = false; }
      }
      if (event.target.id === 'memberInviteForm') {
        event.preventDefault();
        const result = await mutate('invite_minuta_member', { p_organization: organization.id, p_email: $('#memberEmail').value.trim(), p_role: $('#memberRole').value, p_is_bookable: $('#memberBookable').checked }, event.submitter, 'Приглашение обработано', '#memberInviteError');
        if (result) {
          if (result.status === 'already_member') notify('Этот сотрудник уже состоит в команде');
          else notify(result.status === 'joined' ? 'Сотрудник добавлен' : 'Приглашение создано на 14 дней');
          event.target.reset(); $('#memberBookable').checked = true; $('#memberCreator').open = false;
        }
      }
      const locationForm = event.target.closest('[data-location-form]');
      if (locationForm) {
        event.preventDefault();
        const id = locationForm.dataset.locationForm;
        await mutate('update_minuta_location', { p_location: id, p_name: locationForm.elements.name.value.trim(), p_address: locationForm.elements.address.value.trim(), p_timezone: locationForm.elements.timezone.value, p_active: locationForm.elements.active.checked || locationForm.elements.active.disabled, p_is_primary: locationForm.elements.primary.checked }, event.submitter, 'Филиал сохранён', `[data-location-card="${id}"] [data-location-error]`);
      }
      const memberForm = event.target.closest('[data-member-form]');
      if (memberForm) {
        event.preventDefault();
        const id = memberForm.dataset.memberForm;
        await mutate('update_minuta_member', { p_organization: organization.id, p_user: id, p_role: memberForm.elements.role.value, p_is_bookable: memberForm.elements.bookable.checked, p_active: memberForm.elements.active.checked }, event.submitter, 'Права сотрудника сохранены', `[data-member-card="${id}"] [data-member-error]`);
      }
    }

    async function handleClick(event) {
      const retry = event.target.closest('#reloadOrganization');
      if (retry) await load();
      const cancel = event.target.closest('[data-cancel-invitation]');
      if (cancel) await mutate('cancel_minuta_invitation', { p_invitation: cancel.dataset.cancelInvitation }, cancel, 'Приглашение отменено');
      const accept = event.target.closest('[data-accept-invitation]');
      if (accept) await mutate('accept_minuta_invitation', { p_invitation: accept.dataset.acceptInvitation }, accept, 'Вы присоединились к команде');
    }

    function handleChange(event) {
      if (event.target.id !== 'organizationSwitcher') return;
      const next = organizations.find(item => item.id === event.target.value);
      if (!next) return;
      activeOrganizationId = next.id;
      render();
      emitActiveOrganization();
    }

    function bind() {
      document.addEventListener('submit', handleSubmit);
      document.addEventListener('click', handleClick);
      document.addEventListener('change', handleChange);
    }

    return { bind, load, render, reset, getActiveOrganization, get availability() { return availability; } };
  }

  window.MinutaOrganization = { createController };
})();
