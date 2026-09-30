/* Presentation only: native inputs, validation and booking actions remain owned by provider.js. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const text = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
  function render(options) {
    const form = $('#newBookingForm');
    if (!form) return;
    const clientMode = options.mode === 'client';
    $('#bookingSheet').classList.toggle('new-booking-card', clientMode);
    if ($('#newBookingSelectionSummary')) $('#newBookingSelectionSummary').hidden = !clientMode;
    if (!clientMode) return;
    if (!$('#newBookingSelectedClient')) {
      const selected = document.createElement('div');
      selected.id = 'newBookingSelectedClient';
      selected.innerHTML = '<span class="new-booking-selected-avatar"></span><span class="new-booking-selected-copy"><strong></strong><small></small></span><button type="button">Изменить</button><button type="button" data-open-selected-client>Карточка и история</button>';
      $('#newBookingClientEntry').before(selected);
      selected.querySelector('button').addEventListener('click', () => {
        delete $('#newBookingClientFields').dataset.clientLookupState;
        selected.hidden = true;
        $('#newBookingClientEntry').hidden = false;
        $('#newBookingName').focus();
        $('#newBookingName').select();
      });
      const hint = document.createElement('small');
      hint.className = 'new-booking-search-hint'; hint.textContent = 'Можно последние 4 цифры';
      $('.new-booking-name-field').after(hint);
      const meta = document.createElement('small'); meta.id = 'newBookingServiceMeta';
      $('#newBookingServiceOpenName').after(meta);
      const summary = document.createElement('div'); summary.id = 'newBookingSelectionSummary';
      summary.setAttribute('aria-live', 'polite'); summary.innerHTML = '<span></span><small></small>';
      $('#newBookingSubmit').before(summary);
    }
    $('#newBookingName').placeholder = 'Имя или телефон';
    const selected = $('#newBookingSelectedClient');
    selected.hidden = !options.selected;
    $('#newBookingClientEntry').hidden = Boolean(options.selected);
    selected.querySelector('[data-open-selected-client]').hidden = !options.clientExists;
    if (options.selected) {
      text(selected.querySelector('strong'), options.name);
      text(selected.querySelector('.new-booking-selected-copy small'), options.phone);
      const avatar = selected.querySelector('.new-booking-selected-avatar');
      if (avatar.innerHTML !== options.avatar) avatar.innerHTML = options.avatar;
    }
    const serviceMeta = `${options.duration} мин · ${options.price}`;
    text($('#newBookingServiceMeta'), serviceMeta);
    $('#newBookingServiceLabel').hidden = Boolean(options.repeat);
    const dateLabel = $('.new-booking-date-field>.sr-only');
    text(dateLabel, 'Дата');
    const summary = $('#newBookingSelectionSummary');
    let when = options.date ? new Date(`${options.date}T12:00:00`).toLocaleDateString('ru-RU', {day:'numeric',month:'long'}) : 'Выберите дату';
    if (options.time) {
      const [hour, minute] = options.time.split(':').map(Number);
      const end = hour * 60 + minute + options.duration;
      when += ` · ${options.time}–${String(Math.floor(end / 60) % 24).padStart(2,'0')}:${String(end % 60).padStart(2,'0')}${end >= 1440 ? ' (+1 день)' : ''}`;
    } else when += ' · выберите время';
    text(summary.querySelector('span'), when);
    text(summary.querySelector('small'), serviceMeta);
  }
  window.PrimeTimeNewBookingCard = Object.freeze({ render });
})();
