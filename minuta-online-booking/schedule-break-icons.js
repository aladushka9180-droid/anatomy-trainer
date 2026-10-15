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
