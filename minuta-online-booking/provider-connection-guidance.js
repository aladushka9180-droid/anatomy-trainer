(function () {
  'use strict';

  function plural(count, one, few, many) {
    const value = Math.max(0, Number(count) || 0);
    const mod10 = value % 10;
    const mod100 = value % 100;
    return `${value} ${mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many}`;
  }

  function savedText(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const verb = mod10 === 1 && mod100 !== 11 ? 'Сохранена'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'Сохранены' : 'Сохранено';
    return `${verb} ${plural(count, 'запись', 'записи', 'записей')}`;
  }

  function view({ online, hasUser, sessionTrust, canQueueBooking, hasSavedSchedule, serverUnavailable, recovery } = {}) {
    if (!hasUser) return null;
    if (!online) return {
      kind:'offline', title:'Нет интернета',
      description:canQueueBooking && hasSavedSchedule
        ? 'Можно смотреть сохранённые записи и добавлять новые. Новые записи сохраним на устройстве, а после подключения проверим свободное время'
        : hasSavedSchedule
          ? 'Можно смотреть сохранённые записи. Новую запись сейчас создать нельзя'
          : 'Соединение отсутствует. Сохранённое расписание недоступно, новую запись сейчас создать нельзя',
      help:true, inspect:false
    };
    if (sessionTrust !== 'verified') return {
      kind:'session', title:'Сеанс нужно подтвердить',
      description:'После восстановления доступа проверим расписание. Новые записи пока недоступны',
      help:false, inspect:false
    };
    if (serverUnavailable) return {
      kind:'server', title:'Нет связи с сервером',
      description:canQueueBooking && hasSavedSchedule
        ? 'Повторим автоматически. Неподтверждённую запись можно сохранить на устройстве; после подключения проверим свободное время'
        : 'Повторим автоматически. Новую запись пока создать нельзя',
      help:false, inspect:false
    };
    if (recovery?.kind === 'checking') return {
      kind:'checking', title:'Проверяем связь',
      description:'Соединение появилось. Проверяем записи и расписание на сервере',
      help:false, inspect:false
    };
    if (recovery?.kind === 'complete') return {
      kind:'complete', title:'Связь восстановлена', description:recovery.text,
      help:false, inspect:true
    };
    return null;
  }

  function createRecoveryTracker() {
    let active = null;
    function start(actor) {
      if (!actor) return false;
      if (active?.actor === actor) return false;
      active = { actor, confirmed:new Set(), queued:new Set() };
      return true;
    }
    function snapshot(actor, queue) {
      if (!active || actor !== active.actor) return false;
      for (const item of queue || []) if (item?.id) active.queued.add(item.id);
      return true;
    }
    function confirm(actor, id) {
      if (!active || actor !== active.actor || !id || !active.queued.has(id)) return false;
      active.confirmed.add(id);
      return true;
    }
    function finish(actor, { bookingReady = false, complete = false, queue = [] } = {}) {
      if (!active || actor !== active.actor || !bookingReady) return null;
      const rows = (queue || []).filter(item => active.queued.has(item?.id));
      const conflicts = rows.filter(item => item.status === 'conflict').length;
      const pending = rows.filter(item => ['pending', 'syncing', 'server_check_pending', 'notification_pending'].includes(item.status)).length;
      const saved = active.confirmed.size;
      active = null;
      const parts = [];
      if (saved) parts.push(savedText(saved));
      if (conflicts) parts.push(`${plural(conflicts, 'запись требует', 'записи требуют', 'записей требуют')} проверки`);
      if (pending) parts.push(`${plural(pending, 'запись ожидает', 'записи ожидают', 'записей ожидают')} проверки сервера`);
      const text = parts.length
        ? parts.join(', ')
        : complete ? 'Записи и расписание обновлены' : 'Расписание обновлено; остальные данные проверяем';
      return { kind:'complete', text, saved, conflicts, pending };
    }
    function reset() { active = null; }
    return { start, snapshot, confirm, finish, reset, get active() { return Boolean(active); } };
  }

  window.MinutaProviderConnectionGuidance = { view, createRecoveryTracker };
})();
