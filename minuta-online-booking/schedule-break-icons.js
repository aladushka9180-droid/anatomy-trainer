/* Presentation preferences only: never changes availability or booking data. */
(() => {
  'use strict';
  const choices = [
    ['pause', 'Пауза', '<path d="M8 5v14M16 5v14"/>'],
    ['coffee', 'Чашка', '<path d="M4 7h12v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3ZM16 8h2a3 3 0 0 1 0 6h-2M7 3v1M12 3v1"/>'],
    ['meal', 'Обед', '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M19 21V3c-4 3-4 9 0 10"/>'],
    ['personal', 'Личное', '<circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>'],
    ['travel', 'Дорога', '<path d="m4 10 2-6h12l2 6v9H4ZM4 10h16M7 19v2M17 19v2M7 14h1M16 14h1"/>'],
    ['none', 'Без иконки', '']
  ];
  const valid = value => choices.some(([key]) => key === value) ? value : 'pause';
  const svg = key => {
    const shape = choices.find(([value]) => value === valid(key))[2];
    return shape ? `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>` : '';
  };
  function selected(item, preferences = {}) {
    return valid(item?.automatic_break ? preferences.break_icons?.automatic : preferences.break_icons?.bookings?.[item?.id]);
  }
  function markup(item, preferences) {
    const key = selected(item, preferences);
    return `<span class="schedule-break-icon" data-break-icon="${key}" aria-hidden="true">${svg(key)}</span>`;
  }
  function picker(key, automatic) {
    const section = document.createElement('details');
    section.className = 'schedule-break-icon-picker';
    section.dataset.breakIconScope = key;
    section.innerHTML = `<summary>Иконка перерыва</summary><fieldset><legend class="sr-only">Иконка перерыва</legend>${choices.map(([value,label]) => `<label><input type="radio" name="break-icon-${key}" value="${value}"><span>${svg(value)}<span>${label}</span></span></label>`).join('')}</fieldset><small>${automatic ? 'Для автоматических перерывов этого кабинета.' : 'Только для этого перерыва.'}</small>`;
    return section;
  }
  function init(bridge) {
    let pending = false;
    function refresh() {
      pending = false;
      const preferences = bridge.preferences();
      const bookings = new Map(bridge.bookings().map(item => [String(item.id),item]));
      for (const [id,label] of [['todayBookingsLabel','Сегодня'],['tomorrowBookingsLabel','Завтра'],['upcomingBookingsLabel','Предстоящих записей']]) {
        const element = document.getElementById(id);
        if (element && element.textContent !== label) element.textContent = label;
      }
      document.querySelectorAll('#providerBookings [data-open-booking], #providerBookings [data-open-automatic-break]').forEach(button => {
        const item = button.hasAttribute('data-open-automatic-break') ? {automatic_break:true} : bookings.get(button.dataset.openBooking);
        if (!item) return;
        const card = button.closest('.provider-booking') || button;
        card.classList.toggle('is-online-booking', !item.automatic_break && !bridge.isBlock(item) && item.booking_source === 'client_online');
        const timeEnd = card.querySelector('.timeline-mobile-time')?.lastChild;
        if (timeEnd?.nodeType === Node.TEXT_NODE && / · $/.test(timeEnd.nodeValue)) timeEnd.nodeValue = timeEnd.nodeValue.replace(/ · $/,'');
        if (!item.automatic_break && !bridge.isBlock(item)) return;
        const title = card.querySelector('.timeline-booking-copy>strong, .timeline-break-short-label, h3');
        if (!title) return;
        const previous = title.querySelector('.schedule-break-icon');
        if (previous?.dataset.breakIcon !== selected(item, preferences)) {
          previous?.remove(); title.insertAdjacentHTML('afterbegin', markup(item, preferences));
        }
      });
      const sheet = document.querySelector('#bookingSheet');
      const content = document.querySelector('#bookingSheetContent');
      if (sheet && content && !sheet.hidden && !content.querySelector('.schedule-break-icon-picker')) {
        const automatic = sheet.dataset.assistantContext === 'automatic-break';
        const item = automatic ? null : bookings.get(sheet.dataset.bookingId);
        if (automatic || (item && /^[a-zA-Z0-9_-]{1,100}$/.test(item.id) && bridge.isBlock(item) && !item.is_imported_history)) {
          const control = picker(automatic ? 'automatic' : String(item.id), automatic);
          const anchor = content.querySelector('.automatic-break-sheet-color, .booking-color-options, .booking-color-picker');
          if (anchor) anchor.after(control); else content.append(control);
        }
      }
      document.querySelectorAll('.schedule-break-icon-picker').forEach(control => {
        const scope = control.dataset.breakIconScope;
        const value = valid(scope === 'automatic' ? preferences.break_icons?.automatic : preferences.break_icons?.bookings?.[scope]);
        control.querySelectorAll('input').forEach(input => { input.checked = input.value === value; });
      });
    }
    document.addEventListener('change', event => {
      const control = event.target.closest('.schedule-break-icon-picker');
      if (!control || event.target.type !== 'radio') return;
      const preferences = bridge.preferences(), value = valid(event.target.value), scope = control.dataset.breakIconScope;
      if (scope !== 'automatic') {
        const item = bridge.bookings().find(item => String(item.id) === scope);
        if (!item || !bridge.isBlock(item) || item.is_imported_history) return;
      }
      bridge.save({...preferences, break_icons:scope === 'automatic'
        ? {...preferences.break_icons, automatic:value}
        : {...preferences.break_icons, bookings:{...preferences.break_icons?.bookings, [scope]:value}}});
      refresh();
    });
    const observer = new MutationObserver(() => {
      if (!pending) { pending = true; queueMicrotask(refresh); }
    });
    document.querySelectorAll('#providerBookings,#bookingSheetContent,.dashboard-summary,.provider-mobile-nav').forEach(container => observer.observe(container,{childList:true,subtree:true}));
    const sheet = document.querySelector('#bookingSheet');
    if (sheet) observer.observe(sheet,{attributes:true,attributeFilter:['hidden','data-booking-id','data-assistant-context']});
    refresh();
  }
  window.PrimeTimeBreakIcons = { valid, selected, markup, init };
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof bookingSourceItems !== 'function' || typeof displayPreferences === 'undefined') return;
    init({preferences:() => displayPreferences, save:saveDisplayPreferences,
      bookings:bookingSourceItems, isBlock:isScheduleBlock});
  }, {once:true});
})();

/* Scale the entire mobile day grid; never mutate a booking or its duration. */
(() => {
  'use strict';
  let ratio = 1, floor = 75, bridge, gesture, suppressUntil = 0, mounted = false;
  const mobile = () => matchMedia('(max-width:760px)').matches;
  const clamp = value => Math.max(1, Math.min(3, Math.round(value * 20) / 20));
  function height(items, isMobile) {
    if (!isMobile) return 76;
    const durations = items.filter(item => !item.automatic_break && !isScheduleBlock(item))
      .map(item => Number(item.duration_minutes || item.services?.duration_minutes || 60))
      .filter(duration => duration > 1 && duration <= 30);
    const textStep = Math.max(0, parseFloat(getComputedStyle(document.body).getPropertyValue('--provider-text-step')) || 0);
    floor = durations.length ? Math.max(75, (34 + 3 * textStep) * 60 / Math.min(...durations)) : 75;
    return floor * ratio;
  }
  function refresh() {
    const stage = document.querySelector('#providerBookings .timeline-stage');
    const group = document.querySelector('.schedule-scale-controls');
    if (group) {
      group.hidden = !mobile() || !stage;
      group.querySelector('output').textContent = Math.round(floor * ratio / 75 * 100) + '%';
      group.querySelector('[data-grid-scale="-1"]').disabled = ratio <= 1;
      group.querySelector('[data-grid-scale="1"]').disabled = ratio >= 3;
      group.querySelector('small').hidden = floor <= 75;
    }
    if (!mobile() || !stage) return;
    stage.querySelectorAll('.timeline-booking[data-open-booking]:not(.status-block):not(.minute-only)').forEach(card => {
      if (Number(card.dataset.bookingDuration) > 40 || card.querySelector('.timeline-details-cue')) return;
      if (card.classList.contains('timeline-short-visit')) {
        const tail = card.querySelector('.timeline-mobile-time')?.lastChild;
        if (tail?.nodeType === Node.TEXT_NODE) tail.textContent = tail.textContent.replace(/ · $/u, '');
      }
      const cue = document.createElement('span');
      cue.className = 'timeline-details-cue';
      cue.setAttribute('aria-hidden', 'true');
      cue.innerHTML = '<svg class="ui-icon"><use href="ui-icons.svg#icon-arrow-right"></use></svg>';
      card.append(cue);
      card.setAttribute('aria-haspopup', 'dialog');
      card.setAttribute('aria-controls', 'bookingSheet');
      card.setAttribute('aria-label', card.getAttribute('aria-label') + '. Открыть подробности и комментарий');
    });
  }
  function change(next, clientY = 180) {
    next = clamp(next);
    if (next === ratio || !bridge?.idle()) return refresh();
    const stage = document.querySelector('#providerBookings .timeline-stage');
    if (!stage) return;
    const point = Math.max(0, Math.min(1, (clientY - stage.getBoundingClientRect().top) / Number(stage.dataset.timelineNaturalHeight)));
    const before = stage.getBoundingClientRect().top + point * Number(stage.dataset.timelineNaturalHeight);
    ratio = next;
    bridge.redraw();
    const updated = document.querySelector('#providerBookings .timeline-stage');
    if (updated) window.scrollBy(0, updated.getBoundingClientRect().top + point * Number(updated.dataset.timelineNaturalHeight) - before);
    refresh();
  }
  function init(api) {
    if (mounted) return;
    const options = document.querySelector('#scheduleViewMenu .schedule-view-options');
    const holder = document.querySelector('#providerBookings');
    if (!options || !holder) return;
    mounted = true;
    bridge = api;
    const controls = document.createElement('div');
    controls.className = 'schedule-view-option-group schedule-scale-controls';
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Масштаб шкалы');
    controls.innerHTML = '<span>Масштаб шкалы</span><div><button type="button" data-grid-scale="-1" aria-label="Уменьшить масштаб шкалы">−</button><output aria-live="polite" aria-label="Масштаб шкалы"></output><button type="button" data-grid-scale="1" aria-label="Увеличить масштаб шкалы">+</button></div><small>Минимум увеличен, чтобы время и имя помещались.</small>';
    options.append(controls);
    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-grid-scale]');
      if (button) change(ratio + Number(button.dataset.gridScale) * .25);
    });
    new MutationObserver(refresh).observe(holder, {childList:true, subtree:true});
    window.addEventListener('resize', refresh);
    document.addEventListener('pointerdown', event => {
      if (event.target.closest?.('.timeline-details-cue') || gesture) event.stopImmediatePropagation();
    }, true);
    for (const name of ['pointermove', 'pointerup', 'pointercancel']) document.addEventListener(name, event => {
      if (gesture) event.stopImmediatePropagation();
    }, true);
    document.addEventListener('click', event => {
      if (Date.now() < suppressUntil && event.target.closest?.('#providerBookings')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('touchstart', event => {
      if (!mobile() || gesture || event.touches.length !== 2 || !event.cancelable || !bridge.idle()) return;
      const [a,b] = [...event.touches];
      if (![a,b].every(touch => touch.target.closest?.('#providerBookings .timeline-stage') && !touch.target.closest('.timeline-booking'))) return;
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (distance < 36) return;
      bridge.cancelSwipe();
      gesture = {distance, ratio, next:ratio, clientY:(a.clientY + b.clientY) / 2};
      suppressUntil = Date.now() + 700;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, {capture:true, passive:false});
    document.addEventListener('touchmove', event => {
      if (!gesture || event.touches.length !== 2) return;
      const [a,b] = [...event.touches];
      gesture.next = clamp(gesture.ratio * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / gesture.distance);
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      controls.querySelector('output').textContent = Math.round(floor * gesture.next / 75 * 100) + '%';
    }, {capture:true, passive:false});
    for (const name of ['touchend', 'touchcancel']) document.addEventListener(name, event => {
      if (!gesture) return;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
      suppressUntil = Date.now() + 700;
      if (event.touches.length && name !== 'touchcancel') return;
      const state = gesture;
      gesture = null;
      if (name === 'touchend') change(state.next, state.clientY); else refresh();
    }, {capture:true, passive:false});
    refresh();
  }
  window.PrimeTimeScheduleGrid = {height, init};
  const start = () => {
    if (typeof renderBookings !== 'function') return;
    init({redraw:renderBookings,
      idle:() => !timelineBookingDrag && !timelineMovePending && !timelineMoveConfirmationPending && !scheduleDaySwipe?.active,
      cancelSwipe:() => { if (scheduleDaySwipe) finishScheduleDaySwipe(scheduleDaySwipe, {clientX:scheduleDaySwipe.startX}); }});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
