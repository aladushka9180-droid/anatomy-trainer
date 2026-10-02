/* Presentation only. Scheduling, validation and persistence remain in provider.js. */
(() => {
  'use strict';
  const panel = document.querySelector('[data-provider-panel="schedule"]');
  if (!panel || panel.dataset.workHoursSoft === 'ready') return;
  panel.dataset.workHoursSoft = 'ready';
  panel.classList.add('work-hours-soft');
  const paths = {
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
    repeat: '<path d="M5 7h12a4 4 0 0 1 4 4M17 3l4 4-4 4M19 17H7a4 4 0 0 1-4-4M7 21l-4-4 4-4"/>',
    coffee: '<path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9ZM16 10h2a3 3 0 0 1 0 6h-2M3 22h15M7 2v3M12 2v3"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h3M8 17h5"/>',
    editCalendar: '<path d="M11 21H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v3M7 3v4M17 3v4M3 10h18M14 18l6-6 3 3-6 6-4 1 1-4Z"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>'
  };
  function addIcon(element, name) {
    if (!element || element.querySelector(':scope > .hours-icon')) return;
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('class', 'hours-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    icon.innerHTML = paths[name];
    element.prepend(icon);
  }
  function enhance() {
    addIcon(panel.querySelector('.view-title h2'), 'clock');
    addIcon(panel.querySelector('.schedule-section-summary > small'), 'repeat');
    addIcon(panel.querySelector('.schedule-quick-break-toggle > span'), 'coffee');
    addIcon(panel.querySelector('#weeklyScheduleDetails > summary > span:first-child'), 'calendar');
    addIcon(panel.querySelector('#monthlyScheduleEditor > summary > span:first-child'), 'editCalendar');
    panel.querySelectorAll('.schedule-disclosure-control > svg').forEach(icon => {
      if (icon.classList.contains('hours-chevron')) return;
      icon.classList.add('hours-chevron');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('focusable', 'false');
      icon.innerHTML = paths.chevron;
    });
    const today = panel.querySelector('#dayOffDate')?.min;
    panel.querySelectorAll('[data-monthly-schedule-date]').forEach(button => {
      const isToday = Boolean(today && button.dataset.monthlyScheduleDate === today);
      if (isToday) {
        button.dataset.hoursToday = 'true';
        button.setAttribute('aria-current', 'date');
      } else {
        delete button.dataset.hoursToday;
        if (button.getAttribute('aria-current') === 'date') button.removeAttribute('aria-current');
      }
      const partial = button.querySelector('.sr-only')?.textContent.trim() === 'Частично';
      if (partial) button.dataset.hoursPartial = 'true';
      else delete button.dataset.hoursPartial;
    });
    const legend = panel.querySelector('.monthly-schedule-legend');
    if (legend && !legend.querySelector('[data-hours-partial-legend]')) {
      const item = document.createElement('span');
      item.dataset.hoursPartialLegend = 'true';
      item.innerHTML = '<i class="hours-partial-mark"></i>Часть дня закрыта';
      legend.append(item);
    }
  }
  enhance();
  // Only this panel is observed. Attribute writes above are not observed.
  new MutationObserver(enhance).observe(panel, {
    subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'min']
  });
})();
