(function () {
  'use strict';

  function isMissingRpc(error, name) {
    const text = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`;
    return /PGRST202|42883/i.test(text) || new RegExp(`function\\s+[^\\n]*${name}[^\\n]*does not exist`, 'i').test(text);
  }

  function localIso(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function requestId() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function durationLabel(value) {
    const minutes = Number(value || 0);
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return hours ? `${hours} ч${rest ? ` ${rest} мин` : ''}` : `${rest} мин`;
  }

  function eventDateLabel(item) {
    const date = new Date(`${item.event_date}T12:00:00`);
    return `${date.toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'long' })}, ${String(item.start_time || '').slice(0,5)}`;
  }

  function createProviderController(options) {
    const { db, $, escapeHtml, notify, requireWrites, getCurrentUser, getSessionGeneration, sessionIsCurrent, applyWriteAvailability } = options;
    let organization = null;
    let payload = null;
    let available = null;
    let revision = 0;
    let bound = false;

    function reset() {
      revision += 1;
      organization = null;
      payload = null;
      available = null;
      render();
    }

    function setOrganization(next) {
      const changed = next?.id !== organization?.id;
      organization = next || null;
      if (!organization) return reset();
      if (changed) {
        payload = null;
        available = null;
      }
      load();
    }

    async function load() {
      const userId = getCurrentUser()?.id;
      const generation = getSessionGeneration();
      const currentRevision = ++revision;
      if (!userId || !organization?.id) return { ok:false, optional:true };
      available = 'loading';
      render();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const end = new Date();
      end.setDate(end.getDate() + 365);
      const { data, error } = await db.rpc('get_minuta_group_booking_admin', {
        p_organization:organization.id,
        p_start:localIso(start),
        p_end:localIso(end)
      });
      if (!sessionIsCurrent(userId, generation) || currentRevision !== revision) return { ok:false, optional:true, stale:true };
      if (error) {
        available = isMissingRpc(error, 'get_minuta_group_booking_admin') ? 'unsupported' : 'error';
        payload = null;
        render();
        return { ok:false, optional:true, unsupported:available === 'unsupported' };
      }
      payload = data || {};
      available = 'ready';
      render();
      return { ok:true, optional:true };
    }

    function render() {
      const panel = $('#groupEventsPanel');
      const settings = $('#groupBookingSettingsCard');
      if (!panel || !settings) return;
      const supported = Boolean(organization && ['ready','loading','error'].includes(available));
      panel.hidden = !supported;
      settings.hidden = !supported;
      if (!supported) return;
      const enabled = payload?.enabled === true;
      const toggle = $('#groupBookingsEnabled');
      if (toggle) {
        toggle.checked = enabled;
        toggle.disabled = available !== 'ready' || organization.current_role !== 'owner';
      }
      const note = $('#groupBookingsSettingNote');
      if (note) note.textContent = available === 'loading'
        ? 'Проверяем доступность…'
        : available === 'error'
          ? 'Не удалось загрузить групповые события. Повторите обновление.'
          : enabled ? 'Групповые события видны на странице онлайн-записи.' : 'Функция выключена: события можно подготовить как черновики, клиенты их не видят.';
      const add = $('#newGroupEvent');
      if (add) add.disabled = available !== 'ready' || !payload?.performers?.length || !payload?.locations?.length;
      const list = $('#groupEventsList');
      if (available === 'loading') {
        list.innerHTML = '<div class="loading-state"><i></i><span>Загружаем групповые события…</span></div>';
        return;
      }
      if (available === 'error') {
        list.innerHTML = '<div class="provider-empty"><strong>Групповые события временно недоступны</strong><small>Обычные записи продолжают работать.</small></div>';
        return;
      }
      const events = Array.isArray(payload?.events) ? payload.events : [];
      list.innerHTML = events.length ? events.map(eventMarkup).join('') : '<div class="provider-empty"><strong>Групповых событий пока нет</strong><small>Создайте занятие, консультацию или другой сеанс с ограниченным числом мест.</small></div>';
      applyWriteAvailability?.();
    }

    function eventMarkup(item) {
      const participants = Array.isArray(item.participants) ? item.participants : [];
      const active = participants.filter(entry => entry.status !== 'cancelled');
      const statusLabel = ({ draft:'Черновик', published:'Опубликовано', closed:'Набор закрыт', cancelled:'Отменено' })[item.status] || item.status;
      return `<article class="group-event-card status-${escapeHtml(item.status)}">
        <div class="group-event-head"><div><small>${escapeHtml(eventDateLabel(item))}</small><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.performer_name)} · ${escapeHtml(item.location_name)} · ${escapeHtml(durationLabel(item.duration_minutes))}</p></div><span>${active.length}/${Number(item.capacity || 0)}</span></div>
        ${item.description ? `<p class="group-event-description">${escapeHtml(item.description)}</p>` : ''}
        <div class="group-event-actions"><span class="booking-status">${escapeHtml(statusLabel)}</span><button class="secondary-button" type="button" data-edit-group-event="${escapeHtml(item.id)}" data-group-booking-write>Изменить</button>${item.status === 'published' ? `<button class="secondary-button" type="button" data-group-event-status="closed" data-event-id="${escapeHtml(item.id)}" data-group-booking-write>Закрыть набор</button>` : item.status === 'draft' || item.status === 'closed' ? `<button class="secondary-button" type="button" data-group-event-status="published" data-event-id="${escapeHtml(item.id)}" data-group-booking-write>Опубликовать</button>` : ''}${item.status !== 'cancelled' ? `<button class="danger" type="button" data-group-event-status="cancelled" data-event-id="${escapeHtml(item.id)}" data-group-booking-write>Отменить</button>` : ''}</div>
        <details class="group-participants"><summary><span>Участники</span><strong>${participants.length}</strong></summary><div>${participants.length ? participants.map(participantMarkup).join('') : '<p class="group-participant-empty">Пока никто не записался.</p>'}</div></details>
      </article>`;
    }

    function participantMarkup(item) {
      const statusLabel = ({ confirmed:'Участвует', cancelled:'Отменён', attended:'Посетил', no_show:'Не пришёл' })[item.status] || item.status;
      return `<article class="group-participant status-${escapeHtml(item.status)}"><div><strong>${escapeHtml(item.name)}</strong><a href="tel:${escapeHtml(String(item.phone || '').replace(/[^+0-9]/g,''))}">${escapeHtml(item.phone)}</a>${item.comment ? `<p><b>Комментарий:</b> ${escapeHtml(item.comment)}</p>` : ''}<small>${escapeHtml(statusLabel)}</small></div><div>${item.status !== 'cancelled' ? `<button type="button" data-group-participant-status="attended" data-participant-id="${escapeHtml(item.id)}" data-group-booking-write>Посетил</button><button type="button" data-group-participant-status="no_show" data-participant-id="${escapeHtml(item.id)}" data-group-booking-write>Не пришёл</button><button type="button" data-group-participant-status="cancelled" data-participant-id="${escapeHtml(item.id)}" data-group-booking-write>Отменить</button>` : `<button type="button" data-group-participant-status="confirmed" data-participant-id="${escapeHtml(item.id)}" data-group-booking-write>Вернуть</button>`}</div></article>`;
    }

    function populateEventForm(item = null) {
      const form = $('#groupEventForm');
      if (!form || !payload) return;
      form.reset();
      $('#groupEventId').value = item?.id || '';
      $('#groupEventDialogTitle').textContent = item ? 'Изменить событие' : 'Новое групповое событие';
      $('#groupEventLocation').innerHTML = (payload.locations || []).map(location => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)}</option>`).join('');
      $('#groupEventPerformer').innerHTML = (payload.performers || []).map(performer => `<option value="${escapeHtml(performer.id)}">${escapeHtml(performer.name)}</option>`).join('');
      $('#groupEventTitle').value = item?.title || '';
      $('#groupEventDescription').value = item?.description || '';
      $('#groupEventLocation').value = item?.location_id || payload.locations?.[0]?.id || '';
      $('#groupEventPerformer').value = item?.performer_id || payload.performers?.[0]?.id || '';
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      $('#groupEventDate').min = localIso(new Date());
      $('#groupEventDate').value = item?.event_date || localIso(tomorrow);
      $('#groupEventTime').value = String(item?.start_time || '18:00').slice(0,5);
      $('#groupEventDuration').value = String(item?.duration_minutes || 60);
      $('#groupEventCapacity').value = String(item?.capacity || 6);
      $('#groupEventStatus').value = item?.status || (payload.enabled ? 'published' : 'draft');
      $('#groupEventError').hidden = true;
      $('#groupEventDialog').showModal();
    }

    async function saveEvent(event) {
      event.preventDefault();
      if (!requireWrites()) return;
      const button = event.submitter || $('#groupEventForm button[type="submit"]');
      button.disabled = true;
      $('#groupEventError').hidden = true;
      const parameters = {
        p_organization:organization.id,
        p_event:$('#groupEventId').value || null,
        p_location:$('#groupEventLocation').value,
        p_performer:$('#groupEventPerformer').value,
        p_title:$('#groupEventTitle').value.trim(),
        p_description:$('#groupEventDescription').value.trim(),
        p_date:$('#groupEventDate').value,
        p_time:`${$('#groupEventTime').value}:00`,
        p_duration:Number($('#groupEventDuration').value),
        p_capacity:Number($('#groupEventCapacity').value),
        p_status:$('#groupEventStatus').value
      };
      const { error } = await db.rpc('upsert_minuta_group_event', parameters);
      button.disabled = false;
      if (error) {
        const text = `${error.message || ''} ${error.details || ''}`;
        $('#groupEventError').textContent = /conflict/i.test(text) ? 'В это время у специалиста уже есть запись или другое событие.' : /capacity_below/i.test(text) ? 'Вместимость меньше числа действующих участников.' : 'Не удалось сохранить событие.';
        $('#groupEventError').hidden = false;
        return;
      }
      $('#groupEventDialog').close();
      notify('Групповое событие сохранено');
      await load();
    }

    async function setEnabled(enabled) {
      if (!requireWrites()) return render();
      const { error } = await db.rpc('set_minuta_group_bookings_enabled', { p_organization:organization.id, p_enabled:enabled });
      if (error) {
        notify('Не удалось изменить настройку групповых событий');
        render();
        return;
      }
      notify(enabled ? 'Групповые события включены' : 'Групповые события скрыты от клиентов');
      await load();
    }

    async function setEventStatus(id, status) {
      if (!requireWrites()) return;
      const { error } = await db.rpc('set_minuta_group_event_status', { p_organization:organization.id, p_event:id, p_status:status });
      notify(error ? 'Не удалось изменить статус события' : 'Статус события обновлён');
      await load();
    }

    async function setParticipantStatus(id, status) {
      if (!requireWrites()) return;
      const { error } = await db.rpc('set_minuta_group_participant_status', { p_organization:organization.id, p_participant:id, p_status:status });
      notify(error ? (/group_event_full/i.test(`${error.message || ''}`) ? 'В событии больше нет свободных мест' : 'Не удалось изменить участника') : 'Статус участника обновлён');
      await load();
    }

    function bind() {
      if (bound) return;
      bound = true;
      $('#groupBookingsEnabled')?.addEventListener('change', event => setEnabled(event.target.checked));
      $('#newGroupEvent')?.addEventListener('click', () => populateEventForm());
      $('#groupEventForm')?.addEventListener('submit', saveEvent);
      $('#closeGroupEventDialog')?.addEventListener('click', () => $('#groupEventDialog').close());
      $('#groupEventsPanel')?.addEventListener('click', event => {
        const edit = event.target.closest('[data-edit-group-event]');
        const eventStatus = event.target.closest('[data-group-event-status]');
        const participantStatus = event.target.closest('[data-group-participant-status]');
        if (edit) populateEventForm((payload?.events || []).find(item => item.id === edit.dataset.editGroupEvent));
        if (eventStatus) setEventStatus(eventStatus.dataset.eventId, eventStatus.dataset.groupEventStatus);
        if (participantStatus) setParticipantStatus(participantStatus.dataset.participantId, participantStatus.dataset.groupParticipantStatus);
      });
    }

    return { bind, load, reset, setOrganization, get availability() { return available; } };
  }

  function createPublicController(options) {
    const { db, $, escapeHtml, getSlug, notify } = options;
    let events = [];
    let selected = null;
    let available = null;

    async function load() {
      const slug = getSlug();
      const root = $('#publicGroupEvents');
      if (!root || !slug) return;
      const start = new Date();
      const end = new Date();
      end.setDate(end.getDate() + 180);
      const { data, error } = await db.rpc('get_public_minuta_group_events', { p_slug:slug, p_start:localIso(start), p_end:localIso(end) });
      if (error) {
        available = isMissingRpc(error, 'get_public_minuta_group_events') ? 'unsupported' : 'error';
        root.hidden = true;
        return;
      }
      available = data?.enabled ? 'ready' : 'disabled';
      events = Array.isArray(data?.events) ? data.events : [];
      render();
    }

    function render() {
      const root = $('#publicGroupEvents');
      const list = $('#publicGroupEventsList');
      if (!root || !list || available !== 'ready' || !events.length) {
        if (root) root.hidden = true;
        return;
      }
      root.hidden = false;
      list.innerHTML = events.map(item => {
        const full = Number(item.seats_left || 0) <= 0;
        return `<article class="public-group-event${full ? ' is-full' : ''}"><div><small>${escapeHtml(eventDateLabel(item))}</small><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.performer_name)} · ${escapeHtml(item.location_name)}${item.location_address ? ` · ${escapeHtml(item.location_address)}` : ''}</p>${item.description ? `<span>${escapeHtml(item.description)}</span>` : ''}</div><div><strong>${full ? 'Мест нет' : `${Number(item.seats_left)} из ${Number(item.capacity)} мест свободно`}</strong><button class="primary" type="button" data-book-group-event="${escapeHtml(item.id)}" ${full ? 'disabled' : ''}>Записаться</button></div></article>`;
      }).join('');
    }

    function open(id) {
      selected = events.find(item => item.id === id) || null;
      if (!selected) return;
      const form = $('#publicGroupBookingForm');
      form.reset();
      form.dataset.requestId = requestId();
      $('#publicGroupBookingTitle').textContent = selected.title;
      $('#publicGroupBookingSummary').textContent = `${eventDateLabel(selected)} · ${selected.performer_name} · ${selected.location_name}`;
      $('#publicGroupBookingError').hidden = true;
      $('#publicGroupBookingSuccess').hidden = true;
      form.hidden = false;
      $('#publicGroupBookingDialog').showModal();
    }

    async function submit(event) {
      event.preventDefault();
      if (!selected) return;
      const form = event.currentTarget;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      const button = event.submitter || form.querySelector('button[type="submit"]');
      button.disabled = true;
      $('#publicGroupBookingError').hidden = true;
      const { data, error } = await db.rpc('book_minuta_group_event', {
        p_request_id:form.dataset.requestId,
        p_event:selected.id,
        p_client_name:$('#publicGroupClientName').value.trim(),
        p_client_phone:$('#publicGroupClientPhone').value.trim(),
        p_comment:$('#publicGroupClientComment').value.trim()
      });
      button.disabled = false;
      if (error) {
        const text = `${error.message || ''} ${error.details || ''}`;
        $('#publicGroupBookingError').textContent = /duplicate/i.test(text) ? 'Этот номер уже записан на событие.' : /full/i.test(text) ? 'Свободные места только что закончились.' : /started|unavailable/i.test(text) ? 'Запись на это событие уже закрыта.' : 'Не удалось подтвердить запись. Повторите попытку — повтор не создаст дубль.';
        $('#publicGroupBookingError').hidden = false;
        if (/duplicate|full|started|unavailable/i.test(text)) await load();
        return;
      }
      form.hidden = true;
      $('#publicGroupBookingSuccess').innerHTML = `<strong>Вы записаны</strong><p>Код участия: <b>${escapeHtml(data?.booking_code || '')}</b>. Мастер увидит ваш комментарий.</p>`;
      $('#publicGroupBookingSuccess').hidden = false;
      notify?.('Участие подтверждено');
      await load();
    }

    function bind() {
      $('#publicGroupEventsList')?.addEventListener('click', event => {
        const button = event.target.closest('[data-book-group-event]');
        if (button) open(button.dataset.bookGroupEvent);
      });
      $('#publicGroupBookingForm')?.addEventListener('submit', submit);
      $('#closePublicGroupBooking')?.addEventListener('click', () => $('#publicGroupBookingDialog').close());
    }

    return { bind, load };
  }

  window.MinutaGroupBookings = { createProviderController, createPublicController };
})();
