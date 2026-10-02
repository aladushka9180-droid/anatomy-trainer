/* People UI uses the existing organization write contract. Workplace labels are
   read from saved shifts; they are not permanent assignments or free slots. */
(() => {
  'use strict';
  const roles = {
    owner: 'Управляет организацией, сотрудниками и правами доступа.',
    admin: 'Управляет работой команды; приглашает и изменяет только специалистов.',
    specialist: 'Работает со своими услугами и расписанием. Не управляет правами команды.'
  };
  function createController(options) {
    const { db, escapeHtml, getCurrentUser, getSessionGeneration, sessionIsCurrent } = options;
    const root = document.getElementById('organizationPeopleSection');
    if (!root) return null;
    const forms = () => [...root.querySelectorAll('form')];
    let organization = null, actor = '', drafts = {}, readRevision = 0;
    let schedule = null, readState = 'idle', period = null, mounted = false;
    let wasVisible = false;
    const disabledBeforeWrite = new Map();
    const formKey = form => form?.id || (form?.dataset.locationForm ? 'location:' + form.dataset.locationForm : form?.dataset.memberForm ? 'member:' + form.dataset.memberForm : '');
    const storageKey = () => 'minuta-people-drafts-v1:' + actor + ':' + (organization?.id || '');
    const icon = name => '<svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-' + name + '"></use></svg>';
    function fields(form) {
      return [...(form?.elements || [])].filter(el => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && el.type !== 'hidden');
    }
    function snapshot(form) {
      return form ? Object.fromEntries(fields(form).map(el => [el.name || el.id, el.type === 'checkbox' ? el.checked : el.value])) : null;
    }
    function hasDraft(form) { return Boolean(drafts[formKey(form)]); }
    function storeDrafts() {
      if (!actor || !organization) return;
      try {
        if (Object.keys(drafts).length) sessionStorage.setItem(storageKey(), JSON.stringify({ at: Date.now(), drafts }));
        else sessionStorage.removeItem(storageKey());
      } catch { /* Storage denial must not break editing. */ }
    }
    function capture() {
      if (!organization || !actor) return;
      for (const form of forms()) {
        if (form.dataset.peopleDirty !== 'true') continue;
        drafts[formKey(form)] = { values: snapshot(form), open: Boolean(form.closest('details')?.open) };
      }
      storeDrafts();
    }
    function restore() {
      for (const form of forms()) {
        const draft = drafts[formKey(form)];
        if (!draft || !organization?.can_manage) continue;
        for (const el of fields(form)) {
          const value = draft.values?.[el.name || el.id];
          if (value === undefined || el.disabled) continue;
          if (el.type === 'checkbox') el.checked = value === true;
          else if (el.tagName !== 'SELECT' || [...el.options].some(option => option.value === value && !option.disabled)) el.value = String(value);
        }
        form.dataset.peopleDirty = 'true';
        if (draft.open && form.closest('details')) form.closest('details').open = true;
        roleHelp(form);
      }
      // A reload may restore several desktop drafts onto a small screen.
      if (matchMedia('(max-width: 760px)').matches) {
        [...root.querySelectorAll('details[open]')].slice(1).forEach(node => { node.open = false; });
      }
    }
    function saved(form, submitted) {
      if (!form || !submitted) return;
      if (JSON.stringify(snapshot(form)) === JSON.stringify(submitted)) {
        delete drafts[formKey(form)];
        delete form.dataset.peopleDirty;
        if (form.id) form.reset();
      } else {
        form.dataset.peopleDirty = 'true';
        capture();
      }
      storeDrafts();
    }
    function announce(message) {
      const node = root.querySelector('[data-people-live]');
      if (node) node.textContent = message;
    }
    function setBusy(busy) {
      root.setAttribute('aria-busy', String(busy));
      if (busy) {
        const nodes = [...root.querySelectorAll('button[type="submit"], [data-people-cancel]'), ...document.querySelectorAll('#invitationsPanel [data-organization-write], [data-people-reload], #organizationSwitcher')];
        for (const node of nodes) { disabledBeforeWrite.set(node, node.disabled); node.disabled = true; }
      } else {
        for (const [node, disabled] of disabledBeforeWrite) node.disabled = disabled;
        disabledBeforeWrite.clear();
      }
    }
    function roleHelp(form) {
      const select = form.querySelector('select[name="role"], #memberRole');
      if (!select) return;
      let hint = form.querySelector('[data-people-role-help]');
      if (!hint) {
        hint = document.createElement('p');
        hint.className = 'settings-hint people-role-help';
        hint.dataset.peopleRoleHelp = '';
        select.closest('label').after(hint);
      }
      hint.textContent = roles[select.value] || '';
    }
    function decorate() {
      for (const details of root.querySelectorAll('.organization-editor')) {
        const summary = details.querySelector('summary');
        if (details.dataset.locationCard && !summary.querySelector('.organization-place-icon')) {
          summary.insertAdjacentHTML('afterbegin', '<span class="organization-place-icon">' + icon('org') + '</span>');
        }
        if (!summary.querySelector('.people-chevron')) summary.insertAdjacentHTML('beforeend', '<span class="people-chevron">' + icon('arrow-right') + '</span>');
        summary.setAttribute('aria-label', 'Открыть: ' + summary.querySelector('strong').textContent.trim());
      }
      [...root.querySelectorAll('#locationsList > article')].forEach((card, index) => {
        card.dataset.peopleLocation = organization.locations[index]?.id || '';
        if (!card.querySelector('.organization-place-icon')) card.insertAdjacentHTML('afterbegin', '<span class="organization-place-icon">' + icon('org') + '</span>');
      });
      [...root.querySelectorAll('#membersList > article')].forEach((card, index) => {
        card.dataset.peopleMember = organization.members[index]?.user_id || '';
      });
      for (const form of forms()) {
        const error = form.querySelector('.form-error');
        error?.setAttribute('role', 'alert');
        if (!form.querySelector('[data-people-cancel]')) {
          const cancel = document.createElement('button');
          cancel.type = 'button'; cancel.className = 'secondary-button people-cancel';
          cancel.dataset.peopleCancel = ''; cancel.textContent = 'Отменить изменения';
          form.append(cancel);
        }
        roleHelp(form);
      }
      for (const details of root.querySelectorAll('[data-member-card]')) {
        const member = organization.members.find(item => item.user_id === details.dataset.memberCard);
        const form = details.querySelector('form');
        const last = member?.active && member.role === 'owner' && organization.members.filter(item => item.active && item.role === 'owner').length === 1;
        if (last) {
          form.elements.role.disabled = true; form.elements.active.disabled = true;
          let hint = form.querySelector('[data-people-owner-guard]');
          if (!hint) {
            hint = document.createElement('p'); hint.className = 'settings-hint';
            hint.dataset.peopleOwnerGuard = ''; form.elements.role.closest('label').after(hint);
          }
          hint.textContent = 'В команде должен оставаться хотя бы один действующий владелец.';
        }
      }
      // Statuses are independent: membership, accepting clients, organization booking.
      for (const node of root.querySelectorAll('[data-member-card], [data-people-member]')) {
        const member = organization.members.find(item => item.user_id === (node.dataset.memberCard || node.dataset.peopleMember));
        const main = node.querySelector('.organization-row-main');
        const subtitle = main?.querySelector('small');
        if (member && subtitle) subtitle.textContent = member.email || 'Почта не указана';
        if (member && main && !main.querySelector('.organization-member-states')) {
          main.insertAdjacentHTML('beforeend', '<span class="organization-member-states"><span>' +
            (member.active ? 'Доступ открыт' : 'Доступ отключён') + '</span><span>' +
            (!member.active ? 'Приём недоступен' : member.is_bookable ? 'Принимает клиентов' : 'Не принимает клиентов') + '</span></span>');
        }
      }
      paintWorkplaces();
    }
    function mount() {
      if (mounted) return;
      mounted = true; root.dataset.peopleReady = '';
      const invitationLabel = document.querySelector('#invitationsPanel .panel-head small');
      if (invitationLabel) invitationLabel.textContent = 'Ожидают принятия';
      for (const [creatorId, countId, titleIcon, label] of [
        ['locationCreator', 'locationsCount', 'org', 'Добавить'],
        ['memberCreator', 'membersCount', 'users', 'Пригласить']
      ]) {
        const creator = document.getElementById(creatorId);
        const head = creator.closest('.organization-section').querySelector('.panel-head');
        const title = head.querySelector('h3');
        title.insertAdjacentHTML('afterbegin', icon(titleIcon));
        title.parentElement.append(document.getElementById(countId));
        title.parentElement.classList.add('people-panel-title');
        const action = document.createElement('button');
        action.type = 'button'; action.className = 'secondary-button people-create-action';
        action.dataset.peopleOpen = creatorId; action.setAttribute('aria-controls', creatorId);
        action.setAttribute('aria-expanded', 'false');
        action.innerHTML = icon('plus') + '<span>' + label + '</span>'; head.append(action);
      }
      const live = document.createElement('p');
      live.className = 'people-live'; live.dataset.peopleLive = ''; live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true'); root.append(live);
      const refresh = document.createElement('button');
      refresh.type = 'button'; refresh.className = 'secondary-button people-refresh';
      refresh.dataset.peopleReload = ''; refresh.innerHTML = icon('refresh') + '<span>Обновить списки</span>';
      root.after(refresh);
    }
    function visible() {
      return Boolean(organization && !root.closest('[hidden]') && root.getClientRects().length);
    }
    function range() {
      const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Samara', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const date = new Date(start + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + 13);
      return { start, end: date.toISOString().slice(0, 10) };
    }
    async function loadWorkplaces() {
      if (!visible() || readState === 'loading' || readState === 'ready') return;
      const id = organization.id, user = getCurrentUser()?.id, generation = getSessionGeneration(), revision = ++readRevision;
      period = range(); readState = 'loading'; paintWorkplaces();
      let timer, response;
      try {
        response = await Promise.race([
          db.rpc('get_minuta_shift_workspace', { p_organization: id, p_start: period.start, p_end: period.end }),
          new Promise(resolve => { timer = setTimeout(() => resolve({ error: { code: 'TIMEOUT' } }), 12000); })
        ]);
      } catch { response = { error: { code: 'NETWORK_ERROR' } }; }
      finally { clearTimeout(timer); }
      if (!sessionIsCurrent(user, generation) || revision !== readRevision || organization?.id !== id) return;
      const data = response.data;
      const valid = !response.error && data?.organization_id === id && Array.isArray(data.shifts) && Array.isArray(data.services) && Array.isArray(data.absences);
      schedule = valid ? data : null; readState = valid ? 'ready' : 'error'; paintWorkplaces();
    }
    function paintWorkplaces() {
      if (!organization) return;
      const canSeeTeam = ['owner', 'admin'].includes(organization.current_role);
      const minutes = value => {
        const match = String(value || '').match(/^([0-9]{2}):([0-9]{2})(?::[0-5][0-9])?$/);
        if (!match) return null;
        const hour = Number(match[1]), minute = Number(match[2]);
        return hour <= 24 && minute < 60 && (hour < 24 || minute === 0) ? hour * 60 + minute : null;
      };
      const validShifts = (schedule?.shifts || []).filter(item => item && item.active === true &&
        item.shift_date >= period.start && item.shift_date <= period.end &&
        minutes(item.start_time) !== null && minutes(item.end_time) !== null && minutes(item.end_time) > minutes(item.start_time) &&
        !(schedule.absences || []).some(absence => absence && absence.active === true && absence.performer_id === item.performer_id && item.shift_date >= absence.starts_on && item.shift_date <= absence.ends_on));
      const label = period ? [period.start, period.end].map(value => new Date(value + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })).join(' — ') : 'ближайшие 14 дней';
      const unknown = readState === 'error' ? 'Не удалось проверить график.' : 'Проверяем график…';
      for (const card of root.querySelectorAll('[data-member-card], [data-people-member], [data-location-card], [data-people-location]')) {
        let note = card.querySelector('[data-people-workplace]');
        if (!note) {
          note = document.createElement('div'); note.className = 'people-workplace'; note.dataset.peopleWorkplace = '';
          (card.querySelector('form') || card.querySelector('.organization-row-main')).append(note);
        }
        const memberId = card.dataset.memberCard || card.dataset.peopleMember;
        const locationId = card.dataset.locationCard || card.dataset.peopleLocation;
        let text;
        if (readState !== 'ready') text = unknown;
        else if (memberId) {
          if (!canSeeTeam && memberId !== actor) {
            note.innerHTML = icon('lock') + '<p>График этого сотрудника недоступен с вашей ролью.</p>';
            continue;
          }
          const locations = organization.locations.filter(item => item.active && validShifts.some(shift => shift.performer_id === memberId && shift.location_id === item.id));
          text = locations.length ? 'По графику: ' + locations.map(item => item.name).join(', ') : 'В графике нет смен в филиалах.';
          const services = schedule.services.some(service => service && service.performer_id === memberId && service.active !== false && String(service.name || '').trim() && Number(service.duration_minutes) > 0);
          text += ' ' + (!organization.public_booking_enabled ? 'Онлайн-запись команды выключена.' : !services ? 'Для онлайн-записи нужна активная услуга.' : 'Онлайн-запись команды включена; свободное время проверяется в графике.');
        } else if (!canSeeTeam) text = 'Показаны доступные вам смены.';
        else {
          const members = organization.members.filter(item => item.active && validShifts.some(shift => shift.location_id === locationId && shift.performer_id === item.user_id));
          text = members.length ? 'По графику: ' + members.map(item => item.display_name).join(', ') : 'В графике нет смен сотрудников.';
        }
        note.innerHTML = icon('calendar') + '<div><strong>График · ' + escapeHtml(label) + '</strong><p>' + escapeHtml(text) + '</p>' +
          (readState === 'error' ? '<button type="button" class="secondary-button" data-people-retry>Повторить проверку</button>' : '<button type="button" class="secondary-button" data-section-target="shiftsPanel">Открыть график команды</button>') + '</div>';
      }
    }
    function setOrganization(next) {
      const nextActor = getCurrentUser()?.id || '';
      const changed = organization?.id !== next.id || actor !== nextActor;
      if (changed) {
        capture(); organization = next; actor = nextActor; drafts = {}; schedule = null; readState = 'idle'; readRevision++;
        forms().forEach(form => { form.reset(); delete form.dataset.peopleDirty; const error = form.querySelector('.form-error'); if (error) error.hidden = true; });
        root.querySelectorAll('details').forEach(node => { node.open = false; });
        try {
          const saved = JSON.parse(sessionStorage.getItem(storageKey()) || 'null');
          if (saved?.at > Date.now() - 86400000 && saved.drafts && typeof saved.drafts === 'object') drafts = saved.drafts;
          else sessionStorage.removeItem(storageKey());
        } catch { /* Malformed drafts are ignored. */ }
      } else { organization = next; schedule = null; readState = 'idle'; readRevision++; }
      mount(); decorate(); restore();
      root.querySelectorAll('[data-people-open]').forEach(button => { button.hidden = !next.can_manage; });
      void loadWorkplaces();
      wasVisible = visible();
    }
    function reset() {
      if (actor) {
        try {
          for (const key of Object.keys(sessionStorage)) if (key.startsWith('minuta-people-drafts-v1:' + actor + ':')) sessionStorage.removeItem(key);
        } catch { /* Optional storage. */ }
      }
      organization = null; actor = ''; drafts = {}; schedule = null; readState = 'idle'; readRevision++;
      forms().forEach(form => { form.reset(); delete form.dataset.peopleDirty; });
      root.querySelectorAll('details').forEach(node => { node.open = false; });
      announce('');
    }
    function bind() {
      root.addEventListener('input', event => {
        const form = event.target.closest('form'); if (!form || !organization) return;
        form.dataset.peopleDirty = 'true'; roleHelp(form); capture();
      });
      root.addEventListener('change', event => {
        const form = event.target.closest('form'); if (!form || !organization) return;
        form.dataset.peopleDirty = 'true'; roleHelp(form); capture();
      });
      root.addEventListener('toggle', event => {
        const details = event.target;
        if (!details.matches('details')) return;
        if (details.open && matchMedia('(max-width: 760px)').matches) root.querySelectorAll('details[open]').forEach(node => { if (node !== details) node.open = false; });
        const action = root.querySelector('[data-people-open="' + details.id + '"]');
        action?.setAttribute('aria-expanded', String(details.open)); capture();
      }, true);
      root.addEventListener('click', event => {
        const open = event.target.closest('[data-people-open]');
        if (open) {
          const creator = document.getElementById(open.dataset.peopleOpen);
          creator.open = !creator.open;
          if (creator.open) creator.querySelector('input:not([type="hidden"])')?.focus();
        }
        const cancel = event.target.closest('[data-people-cancel]');
        if (cancel) {
          const form = cancel.closest('form'); delete drafts[formKey(form)]; delete form.dataset.peopleDirty;
          form.reset(); roleHelp(form); form.closest('details').open = false;
          const error = form.querySelector('.form-error'); if (error) error.hidden = true;
          storeDrafts(); announce('Черновик отменён');
        }
        if (event.target.closest('[data-people-retry]')) { readState = 'idle'; void loadWorkplaces(); }
      });
      new MutationObserver(() => {
        const nowVisible = visible();
        if (nowVisible && !wasVisible && readState !== 'loading') { readState = 'idle'; void loadWorkplaces(); }
        wasVisible = nowVisible;
      }).observe(root.closest('[data-provider-panel]') || root, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
      window.addEventListener('pagehide', capture);
    }
    return { bind, setOrganization, capture, snapshot, saved, hasDraft, announce, reset, setBusy };
  }
  window.MinutaOrganizationPeople = { createController };
})();
