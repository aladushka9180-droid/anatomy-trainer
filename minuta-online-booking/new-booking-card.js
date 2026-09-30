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
    $('#bookingSheet').classList.toggle('compact-selected-booking', clientMode && Boolean(options.selected));
    if (!clientMode) {
      if ($('#newBookingWhen')) $('#newBookingWhen').hidden = true;
      if ($('#newBookingDateTimeEditor')) $('#newBookingDateTimeEditor').hidden = false;
    }
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
      const when = document.createElement('button');
      when.type = 'button'; when.id = 'newBookingWhen';
      when.setAttribute('aria-controls', 'newBookingDateTimeEditor');
      when.innerHTML = '<span><small></small><span></span></span><em>Изменить</em>';
      $('#newBookingDateTimeEditor').before(when);
      when.addEventListener('click', () => {
        const plan = window.PrimeTimeRepeatSeries?.current(form);
        if (Number($('#newBookingOccurrences')?.value || 1) > 1 && plan?.plan().length) {
          plan.open(); void plan.edit(0); return;
        }
        form.dataset.whenExpanded = String(form.dataset.whenExpanded !== 'true');
        const open = form.dataset.whenExpanded === 'true';
        $('#newBookingDateTimeEditor').hidden = !open;
        when.setAttribute('aria-expanded', String(open));
        text(when.querySelector('em'), open ? 'Готово' : 'Изменить');
        if (open) $('#newBookingDate').focus();
      });
      form.addEventListener('click', event => {
        if (event.target.closest('[data-new-booking-time]')) form.dataset.whenExpanded = 'false';
      }, true);
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
    const repeatPreview = $('#repeatVisitPreview');
    if (options.repeat && repeatPreview) {
      $('#newBookingModeToggle').hidden = true;
      let details = $('#compactRepeatDetails');
      if (!details) {
        details = document.createElement('details'); details.id = 'compactRepeatDetails';
        const toggle = document.createElement('summary');
        toggle.innerHTML = '<small>Услуга</small><strong></strong><span></span><em>Состав и цена</em>';
        repeatPreview.before(details); details.append(toggle, repeatPreview);
      }
      const services = repeatPreview.querySelectorAll('.repeat-visit-row');
      const title = services[0]?.querySelector('strong')?.textContent || 'Повтор визита';
      text(details.querySelector('summary strong'), title + (services.length > 1 ? ` + ещё ${services.length - 1}` : ''));
      text(details.querySelector('summary>span'), serviceMeta);
    }
    const dateLabel = $('.new-booking-date-field>.sr-only');
    text(dateLabel, 'Дата');
    const summary = $('#newBookingSelectionSummary');
    const count = Number($('#newBookingOccurrences')?.value || 1);
    const first = count > 1 ? window.PrimeTimeRepeatSeries?.current(form)?.plan()[0] : null;
    const date = first?.date || options.date, time = first?.time || options.time;
    let when = date ? new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {day:'numeric',month:'long'}) : 'Выберите дату';
    if (time) {
      const [hour, minute] = time.split(':').map(Number);
      const end = hour * 60 + minute + options.duration;
      when += ` · ${time}–${String(Math.floor(end / 60) % 24).padStart(2,'0')}:${String(end % 60).padStart(2,'0')}${end >= 1440 ? ' (+1 день)' : ''}`;
    } else when += ' · выберите время';
    text(summary.querySelector('span'), when);
    text(summary.querySelector('small'), serviceMeta);
    const compact = Boolean(options.selected);
    const whenButton = $('#newBookingWhen');
    // Historical payment and the offline flexible-time control must remain visible.
    const specialMode = $('#newBookingHistoricalPayment')?.hidden === false || $('#newBookingFlexibleEndField')?.hidden === false;
    whenButton.hidden = !compact || specialMode;
    const open = specialMode || !compact || !options.time || form.dataset.whenExpanded === 'true';
    $('#newBookingDateTimeEditor').hidden = !open;
    whenButton.setAttribute('aria-expanded', String(open));
    text(whenButton.querySelector('small'), count > 1 ? 'Первый визит' : 'Когда');
    text(whenButton.querySelector('span>span'), when);
    text(whenButton.querySelector('em'), open ? 'Готово' : 'Изменить');
    summary.querySelector('span').hidden = compact && Boolean(options.time) && !specialMode;
    const extra = $('#newBookingAdvancedSummary');
    if (extra) {
      extra.classList.remove('sr-only');
      const visits = count === 1 ? '1 запись' : `${count} ${[2,3,4].includes(count % 10) && ![12,13,14].includes(count) ? 'визита' : count === 21 ? 'визит' : 'визитов'}`;
      const note = $('#newBookingNote')?.value.trim() ? 'есть пожелания · ' : '';
      const color = $('[name="newBookingColor"]:checked')?.value;
      text(extra, `${note}${visits} · ${!color || color === 'auto' ? 'цвет авто' : 'цвет выбран'}`);
    }
  }
  window.PrimeTimeNewBookingCard = Object.freeze({ render });
})();
