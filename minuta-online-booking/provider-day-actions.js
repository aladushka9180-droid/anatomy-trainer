(function registerProviderDayActions(root) {
  'use strict';
  let dialogSequence = 0;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  const REQUEST_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const scopeKey = context => JSON.stringify([context?.userId, context?.organizationId, context?.locationId, context?.date, context?.timeZone]);
  function validatedContext(context, date) {
    if (!context?.userId || !context?.organizationId || !context?.locationId || !context?.timeZone || context.date !== date || !DATE.test(String(date || ''))) throw new Error('day_action_scope_required');
    return Object.freeze({ userId:context.userId, organizationId:context.organizationId, locationId:context.locationId, date, timeZone:context.timeZone });
  }
  function create(ports) {
    for (const name of ['getContext', 'canWrite', 'loadDay', 'saveHours', 'resolveHours', 'openAppointment', 'openBlockedTime', 'refresh']) {
      if (typeof ports?.[name] !== 'function') throw new TypeError(`day_action_port_required:${name}`);
    }
    let revision = 0;
    let dialog = null;
    let activeRequest = false;
    const unresolved = new Map();
    const handlers = new WeakMap();
    const context = date => validatedContext(ports.getContext(), date);
    const isCurrent = snapshot => {
      try { return scopeKey(context(snapshot.date)) === scopeKey(snapshot); }
      catch { return false; }
    };
    const message = (error, fallback) => error?.code === 'DAY_ACTION_BACKEND_UNAVAILABLE'
      ? 'Действие станет доступно после обновления расписания. Рабочий график не изменён.'
      : fallback;
    function close() {
      revision += 1;
      if (dialog) { dialog.close(); dialog.remove(); dialog = null; }
    }
    function markup(day) {
      if (!DATE.test(String(day?.date || ''))) throw new Error('day_action_date_required');
      return `<div class="schedule-day-empty" data-provider-action-date="${escape(day.date)}"><div class="schedule-day-empty-heading"><strong>${escape(day.label || 'Выходной')}</strong></div><small>Онлайн-запись закрыта. Можно изменить часы или добавить разовую запись.</small><button class="schedule-day-primary" type="button" data-schedule-day-action="hours">Изменить часы дня</button><div class="schedule-day-secondary"><button class="schedule-day-secondary-action" type="button" data-schedule-day-action="booking">Добавить запись</button><button class="schedule-day-secondary-action" type="button" data-schedule-day-action="block">Занять время</button></div><p class="schedule-day-error" role="alert" hidden></p></div>`;
    }
    async function openHours(date) {
      if (activeRequest) return;
      close();
      const snapshot = context(date);
      const requestRevision = revision;
      const day = await ports.loadDay(snapshot);
      if (requestRevision !== revision || !isCurrent(snapshot)) return;
      if (!day || day.date !== snapshot.date || !TIME.test(day.start) || !TIME.test(day.end) || day.revision == null) throw new Error('day_action_response_scope_mismatch');
      if (day.pendingHours) {
        const attempt=day.pendingHours;
        if (attempt.date !== snapshot.date || !REQUEST_ID.test(attempt.requestId) || !TIME.test(attempt.start) || !TIME.test(attempt.end) || attempt.end <= attempt.start || typeof attempt.onlineEnabled !== 'boolean' || attempt.expectedRevision == null) throw new Error('day_action_pending_scope_mismatch');
        unresolved.set(scopeKey(snapshot),Object.freeze({ requestId:attempt.requestId, date:attempt.date, start:attempt.start, end:attempt.end, onlineEnabled:attempt.onlineEnabled, expectedRevision:attempt.expectedRevision }));
      }
      const label = new Intl.DateTimeFormat('ru-RU', { weekday:'long', day:'numeric', month:'long', timeZone:'UTC' }).format(new Date(`${date}T12:00:00Z`));
      const titleId = `provider-day-hours-title-${++dialogSequence}`;
      const currentDialog = document.createElement('dialog');
      currentDialog.className = 'schedule-day-hours-dialog';
      currentDialog.setAttribute('aria-labelledby', titleId);
      currentDialog.innerHTML = `<div class="schedule-day-hours-heading"><h2 id="${titleId}">Часы выбранного дня</h2><button type="button" class="secondary-button" data-close-day-hours aria-label="Закрыть">×</button></div><p class="schedule-day-hours-date">${escape(label)}</p><form><div class="schedule-day-hours-fields"><label>Начало работы<input name="start" type="time" value="${escape(day.start)}" required></label><label>Конец работы<input name="end" type="time" value="${escape(day.end)}" required></label></div><label class="schedule-day-online"><input name="online" type="checkbox" ${day.onlineEnabled ? 'checked' : ''}>Открыть эти часы для онлайн-записи</label><p class="schedule-day-scope-note">Изменение только на выбранную дату. Обычный график по дням недели сохранится.</p><p class="schedule-day-error" role="alert" hidden></p><button class="primary" type="submit">Сохранить часы</button></form>`;
      document.body.append(currentDialog);
      dialog = currentDialog;
      const form = currentDialog.querySelector('form');
      const error = form.querySelector('[role="alert"]');
      const showError = text => { error.textContent=text; error.hidden=false; };
      const submit=form.querySelector('[type="submit"]');
      const unknownMessage='Результат сохранения пока неизвестен. Проверьте его перед новым изменением.';
      const syncPending = () => {
        const attempt=unresolved.get(scopeKey(snapshot));
        submit.textContent=attempt ? 'Проверить сохранение' : 'Сохранить часы';
        form.elements.start.disabled=Boolean(attempt);
        form.elements.end.disabled=Boolean(attempt);
        form.elements.online.disabled=Boolean(attempt);
        if (attempt) {
          form.elements.start.value=attempt.start;
          form.elements.end.value=attempt.end;
          form.elements.online.checked=attempt.onlineEnabled;
          showError(unknownMessage);
        }
      };
      syncPending();
      currentDialog.querySelector('[data-close-day-hours]').addEventListener('click', close);
      currentDialog.addEventListener('cancel', close);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (activeRequest || !form.reportValidity()) return;
        if (!isCurrent(snapshot) || !ports.canWrite(snapshot)) { showError('Контекст изменился. Откройте выбранный день заново.'); return; }
        const key=scopeKey(snapshot);
        const pending=unresolved.get(key);
        const start=form.elements.start.value;
        const end=form.elements.end.value;
        if (!pending && (!TIME.test(start) || !TIME.test(end) || end <= start)) { showError('Конец работы должен быть позже начала.'); return; }
        const payload=pending || Object.freeze({ requestId:root.crypto.randomUUID(), date:snapshot.date, start, end, onlineEnabled:form.elements.online.checked, expectedRevision:day.revision });
        unresolved.set(key,payload);
        activeRequest=true; submit.disabled=true; error.hidden=true;
        try {
          const result=pending ? await ports.resolveHours(snapshot,payload.requestId) : await ports.saveHours(snapshot,payload);
          const matches=result?.requestId === payload.requestId && result?.date === snapshot.date;
          if (matches && (result.confirmed === true || result.notApplied === true)) unresolved.delete(key);
          if (!isCurrent(snapshot)) return;
          if (matches && result.notApplied === true && result.confirmed !== true) {
            showError('Изменение не применено. Откройте день заново, чтобы загрузить актуальные часы.');
            submit.disabled=true;
            return;
          }
          if (!matches || result.confirmed !== true) {
            showError(unknownMessage);
            return;
          }
          await ports.refresh(snapshot);
          if (dialog === currentDialog && isCurrent(snapshot)) close();
        } catch (failure) {
          if (failure?.code === 'DAY_ACTION_BACKEND_UNAVAILABLE' && !pending) unresolved.delete(key);
          if (dialog === currentDialog) showError(message(failure,unresolved.has(key) ? unknownMessage : 'Не удалось обновить расписание. Откройте день заново.'));
        } finally {
          activeRequest=false;
          if (submit.isConnected && dialog === currentDialog) {
            syncPending();
            submit.disabled=!unresolved.has(key);
          }
        }
      });
      currentDialog.showModal();
    }
    async function perform(action,date) {
      const snapshot=context(date);
      if (!ports.canWrite(snapshot)) throw new Error('day_action_writes_unavailable');
      if (action === 'hours') return openHours(date);
      if (action === 'booking') return ports.openAppointment(snapshot, Object.freeze({ outsideSchedule:true, preserveDayAvailability:true }));
      if (action === 'block') return ports.openBlockedTime(snapshot, Object.freeze({ mode:'block', clientRequired:false, preserveDayAvailability:true }));
      throw new Error('unknown_day_action');
    }
    function attach(holder) {
      if (handlers.has(holder)) return;
      const listener=async event => {
        const button=event.target.closest('[data-schedule-day-action]');
        const day=button?.closest('[data-provider-action-date]');
        if (!button || !day || !holder.contains(day)) return;
        const error=day.querySelector('[role="alert"]');
        try { if (error) error.hidden=true; await perform(button.dataset.scheduleDayAction,day.dataset.providerActionDate); }
        catch (failure) { if (error) { error.textContent=message(failure,'Не удалось открыть действие. Обновите расписание и повторите.'); error.hidden=false; } }
      };
      handlers.set(holder,listener);
      holder.addEventListener('click',listener);
    }
    function detach(holder) {
      const listener=handlers.get(holder);
      if (listener) { holder.removeEventListener('click',listener); handlers.delete(holder); }
      close();
    }
    return Object.freeze({ markup,attach,detach,openHours,perform,close });
  }
  root.PrimeTimeProviderDayActions = Object.freeze({ create });
})(window);
