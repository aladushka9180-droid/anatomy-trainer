/* Presentation only: keep the existing controls, form values and delegated actions. */
(() => {
  'use strict';
  const paths = {
    chevron:'<path d="m9 5 7 7-7 7"/>',
    message:'<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 10 10 0 0 1-4-.8L3 21l1.8-5.5a10 10 0 0 1-.8-4A8.5 8.5 0 1 1 21 11.5Z"/>',
    phone:'<path d="m7 3 3 5-2.5 2a15 15 0 0 0 6.5 6.5l2-2.5 5 3c.2 2.5-1.5 4-4 4C10 20 4 14 3 7c0-2.5 1.5-4.2 4-4Z"/>',
    layers:'<path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5"/>',
    card:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18m-6 5h4"/>',
    tag:'<path d="M3 4h8l10 10-8 8L3 12V4Z"/><circle cx="7.5" cy="8" r=".8"/>',
    note:'<path d="M6 3h8l5 5v13H6V3Zm8 0v6h5M9 13h7m-7 4h5"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 5 5 3-3 4 4"/>',
    palette:'<path d="M12 3a9 9 0 1 0 0 18h1c2 0 3-2 1-3-1-.7-.5-2 1-2h2a5 5 0 0 0 4-5c0-4-4-8-9-8Z"/><path d="M7 9h.1M11 6h.1M16 8h.1M6 14h.1"/>',
    cloud:'<path d="M7 19a5 5 0 0 1-1-10 6 6 0 0 1 11-2 6 6 0 0 1 1 12H7Z"/>',
    trash:'<path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
    check:'<path d="m5 12 4 4L19 6"/>'
  };
  function icon(name) {
    const host = document.createElement('span');
    host.innerHTML = `<svg class="detail-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.chevron}</svg>`;
    return host.firstElementChild;
  }
  function textElement(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  }
  function detailRow(details, title, iconName, value) {
    if (!details) return;
    const summary = details.querySelector(':scope > summary');
    if (!summary) return;
    const copy = document.createElement('span');
    copy.className = 'detail-card-row-copy';
    copy.append(textElement('strong', '', title));
    if (value) {
      value.classList.add('detail-card-row-value');
      copy.append(value);
    }
    summary.replaceChildren(icon(iconName), copy, icon('chevron'));
    details.classList.add('detail-card-row');
    details.open = false;
  }
  function render({ sheet, item, outcome, dateLabel, receivedLabel }) {
    if (!sheet || item?.is_imported_history) return;
    const content = sheet.querySelector('#bookingSheetContent');
    if (!content || !content.querySelector('.booking-repeat-actions')) return;
    sheet.classList.add('booking-sheet-reference');
    const find = selector => content.querySelector(selector);
    find('.booking-sheet-kicker').textContent = dateLabel;
    const status = find('.booking-detail-heading .booking-status');
    if (outcome.visit_status === 'completed' && item.status !== 'cancelled') {
      status.title = status.getAttribute('aria-label') || status.textContent;
      status.textContent = 'Состоялся';
      status.prepend(icon('check'));
      status.classList.add('detail-card-completed');
    }
    const copy = find('.booking-sheet-client-copy');
    const profile = find('[data-open-client-profile]');
    const clientName = find('.booking-sheet-client-name > strong');
    if (profile && clientName) {
      profile.classList.remove('primary','secondary-button');
      profile.classList.add('detail-card-profile');
      profile.setAttribute('aria-label', `Открыть карточку клиента: ${item.client_name || 'Клиент'}`);
      profile.replaceChildren(clientName.cloneNode(true), icon('chevron'));
      clientName.replaceWith(profile);
    }
    const overview = find('.booking-client-overview');
    if (overview && copy) {
      const summary = overview.querySelector('summary');
      const facts = summary.querySelector('strong')?.textContent || '';
      copy.append(textElement('div', 'detail-card-client-facts', facts.replace(/^История клиента · /, '')));
      summary.replaceChildren(textElement('span', '', 'История посещений'), icon('chevron'));
      copy.append(overview);
    }
    const actions = find('.booking-repeat-actions');
    const message = find('[data-message-client]');
    if (message) {
      message.prepend(icon('message'));
      actions.prepend(message);
      const call = document.createElement('a');
      call.className = 'secondary-button detail-card-call';
      call.href = `tel:${String(item.client_phone || '').replace(/[^+\d]/g, '')}`;
      call.append(icon('phone'), document.createTextNode('Позвонить'));
      message.after(call);
    }
    const repeat = find('[data-repeat-booking]');
    if (repeat && !find('[data-booking-status="confirmed"]')) {
      repeat.classList.remove('secondary-button');
      repeat.classList.add('primary');
    }
    const secondary = find('.booking-sheet-secondary');
    const services = find('.booking-session-summary');
    if (services) {
      services.classList.add('detail-card-services');
      const heading = services.querySelector('.booking-session-heading');
      const labels = heading.querySelector('div');
      const count = labels.querySelector('strong').textContent.split(' · ')[0];
      labels.replaceChildren(textElement('strong', '', 'Услуги'), textElement('span', 'detail-card-row-value', count));
      heading.prepend(icon('layers'));
      const editIcon = heading.querySelector('button .ui-icon');
      if (editIcon) editIcon.replaceWith(icon('chevron'));
    }
    const payment = find('.booking-outcome-disclosure');
    if (payment) {
      const state = outcome.visit_status === 'no_show' ? 'Клиент не пришёл'
        : outcome.visit_status !== 'completed' ? 'Запланирован'
        : outcome.payment_method === 'unpaid' ? 'Не оплачено'
        : `Получено ${receivedLabel} · ${{cash:'Наличные',transfer:'Перевод',card:'Карта'}[outcome.payment_method] || 'Оплата'}`;
      const value = textElement('span', '', state);
      detailRow(payment, 'Результат и оплата', 'card', value);
      const paymentCopy = payment.querySelector('.detail-card-row-copy');
      if (outcome._sync_pending) {
        const sync = textElement('span', 'detail-card-sync', '');
        const syncCopy = textElement('span', '', 'Сохранено на устройстве');
        syncCopy.append(textElement('span', '', 'Ожидает синхронизации'));
        sync.append(icon('cloud'), syncCopy);
        paymentCopy.append(sync);
      } else if (outcome.completion_source === 'auto') {
        paymentCopy.append(textElement('span', 'detail-card-automatic', 'Учтён автоматически'));
      }
      services ? services.after(payment) : secondary.prepend(payment);
    }
    const labels = find('.booking-labels-disclosure');
    const note = find('.booking-note-disclosure');
    const result = find('.booking-client-result-disclosure');
    const color = find('.booking-color-compact');
    detailRow(labels, 'Метки клиента', 'tag', labels?.querySelector('.booking-labels-summary'));
    detailRow(note, 'Заметка о клиенте', 'note', note?.querySelector('.booking-note-state'));
    detailRow(result, 'Фото и результат услуги', 'image', result?.querySelector('[data-booking-result-summary]'));
    const colorValue = color?.querySelector('summary > strong');
    if (colorValue && colorValue.textContent.trim() === 'Авто') colorValue.textContent = 'Автоматически';
    detailRow(color, 'Цвет записи', 'palette', colorValue);
    const extras = document.createElement('section');
    extras.className = 'detail-card-extras';
    extras.setAttribute('aria-label', 'Дополнительно');
    extras.append(textElement('h3', '', 'Дополнительно'));
    for (const row of [labels,note,result,color]) if (row) extras.append(row);
    secondary.append(extras);
    const conversation = find('[data-open-message-booking]');
    if (conversation) {
      const more = document.createElement('details');
      more.className = 'detail-card-conversation';
      more.append(textElement('summary', '', 'Диалог с клиентом'), conversation);
      extras.append(more);
      conversation.classList.replace('primary', 'secondary-button');
    }
    for (const group of content.querySelectorAll('.booking-message-actions')) if (!group.children.length) group.remove();
    find('.booking-delete-action')?.prepend(icon('trash'));
  }
  window.PrimeTimeBookingDetailCard = Object.freeze({ render });
})();
