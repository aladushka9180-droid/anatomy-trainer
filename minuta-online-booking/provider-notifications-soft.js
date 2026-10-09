(function refineNotifications() {
  'use strict';

  const root = document.querySelector('[data-provider-panel="notifications"]');
  if (!root || root.classList.contains('notification-soft')) return;
  const manual = root.querySelector('#notificationList');
  const automatic = root.querySelector('#automaticNotificationPanel');
  const automaticList = root.querySelector('#automaticNotificationList');
  const preferences = new Map();
  let nextMenu = 0;
  let openMenu = null;
  let scheduled = false;

  root.classList.add('notification-soft');
  const layout = document.createElement('div');
  layout.className = 'notification-workspace';
  const main = document.createElement('div');
  main.className = 'notification-main-column';
  const aside = document.createElement('aside');
  aside.className = 'notification-side-column';
  aside.setAttribute('aria-label', 'Автоматическая доставка');
  layout.append(main, aside);
  root.append(layout);
  for (const selector of ['.notification-events-panel', '.notification-primary-queue']) {
    const panel = root.querySelector(selector);
    if (panel) main.append(panel);
  }
  for (const selector of ['#unifiedNotificationPanel', '#automaticNotificationPanel', '#visitorNotificationPanel']) {
    const panel = root.querySelector(selector);
    if (panel) aside.append(panel);
  }
  const summary = root.querySelector('.notification-summary');
  if (summary) {
    const today = root.querySelector('#notificationSoonCount')?.parentElement;
    if (today) {
      today.classList.add('notification-today');
      root.querySelector('.notification-events-panel .notification-toolbar')?.append(today);
    }
    summary.querySelectorAll(':scope > i').forEach(node => node.remove());
    const pending = document.createElement('div');
    pending.innerHTML = '<strong id="notificationQueuePendingCount">0</strong><span>к отправке</span>';
    summary.querySelector('#notificationSentCount')?.parentElement.before(pending);
    root.insertBefore(summary, layout);
  }
  const description = root.querySelector('.view-description');
  if (description) description.textContent = 'Записи, сообщения и доставка — всё под контролем.';
  const deliveryTitle = root.querySelector('#notificationDeliveryTitle');
  if (deliveryTitle) deliveryTitle.textContent = 'Сообщения клиентам';
  const manualHint = root.querySelector('.notification-primary-queue .notification-toolbar p');
  if (manualHint) manualHint.textContent = 'Ручная отметка не подтверждает доставку клиенту.';

  const journal = document.createElement('details');
  journal.className = 'panel notification-delivery-journal';
  journal.hidden = true;
  journal.innerHTML = '<summary><span>Журнал автодоставки</span><small></small></summary><p>Передано каналу ≠ получено клиентом.</p><div class="notification-journal-list"></div>';
  if (automatic) automatic.after(journal);
  const journalList = journal.querySelector('.notification-journal-list');
  const live = document.createElement('span');
  live.className = 'notification-soft-status';
  live.setAttribute('role', 'status');
  root.append(live);

  function icon(channel) {
    if (channel === 'whatsapp') return '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.7a8 8 0 0 1-11.8 7L4 20l1.3-4.1A8 8 0 1 1 20 11.7Z"/><path d="M8.6 7.8c.5 4 3.4 6.9 7.4 7.6l1-2.1-2.2-1.1-1.1 1c-1.8-.7-3-1.9-3.7-3.6l1-1.1-1.1-2.2-1.3 1.5Z"/></svg>';
    return `<svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-${channel}"></use></svg>`;
  }
  function updateChoice(wrapper, channel) {
    const link = wrapper.querySelector('[data-open-notification]');
    const name = channel === 'telegram' ? 'Telegram' : 'WhatsApp';
    link.href = channel === 'telegram' ? wrapper.dataset.telegramUrl : wrapper.dataset.whatsappUrl;
    link.dataset.notificationMessenger = channel;
    link.innerHTML = `${icon(channel)}<span>Открыть ${name}</span>`;
    wrapper.querySelectorAll('[data-notification-channel]').forEach(button => {
      button.setAttribute('aria-checked', String(button.dataset.notificationChannel === channel));
    });
  }
  function closeMenu(restoreFocus = false) {
    if (!openMenu) return;
    const current = openMenu;
    openMenu = null;
    current.querySelector('.notification-channel-menu').hidden = true;
    const toggle = current.querySelector('[data-notification-channel-toggle]');
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  function enhanceMessenger(link) {
    if (link.closest('.notification-messenger')) return;
    let url;
    try { url = new URL(link.href); } catch { return; }
    if (url.origin !== 'https://wa.me' || !/^\/\d+$/.test(url.pathname)) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'notification-messenger';
    wrapper.dataset.whatsappUrl = url.href;
    const telegram = new URL(`https://t.me/+${url.pathname.slice(1)}`);
    const message = url.searchParams.get('text');
    if (message) telegram.searchParams.set('text', message);
    wrapper.dataset.telegramUrl = telegram.href;
    const id = `notification-channel-menu-${++nextMenu}`;
    link.before(wrapper);
    wrapper.append(link);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.dataset.notificationChannelToggle = '';
    toggle.className = 'notification-channel-toggle';
    toggle.setAttribute('aria-label', 'Выбрать мессенджер');
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', id);
    toggle.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
    const menu = document.createElement('div');
    menu.id = id;
    menu.className = 'notification-channel-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Мессенджер для сообщения');
    menu.hidden = true;
    for (const [channel, label] of [['telegram', 'Telegram'], ['whatsapp', 'WhatsApp']]) {
      const option = document.createElement('button');
      option.type = 'button';
      option.tabIndex = -1;
      option.dataset.notificationChannel = channel;
      option.setAttribute('role', 'menuitemradio');
      option.innerHTML = `${icon(channel)}<span>${label}</span><span class="notification-channel-selected" aria-hidden="true">✓</span>`;
      menu.append(option);
    }
    wrapper.append(toggle, menu);
    updateChoice(wrapper, preferences.get(link.dataset.openNotification) || 'whatsapp');
  }
  function limitRows(holder, selector, limit, label) {
    if (!holder) return;
    const rows = [...holder.querySelectorAll(selector)];
    let button = holder.querySelector(':scope > .notification-show-more');
    if (rows.length <= limit) {
      rows.forEach(row => { row.hidden = false; });
      button?.remove();
      return;
    }
    const expanded = holder.dataset.softExpanded === 'true';
    rows.forEach((row, index) => { row.hidden = !expanded && index >= limit; });
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'notification-show-more';
      button.dataset.notificationMore = selector;
      button.dataset.notificationLimit = String(limit);
      button.dataset.notificationMoreLabel = label;
      holder.append(button);
    }
    button.textContent = expanded ? 'Свернуть список' : `${label} · ${rows.length - limit}`;
    button.setAttribute('aria-expanded', String(expanded));
  }
  function arrangeAutomatic() {
    if (!automatic || !automaticList) return;
    const rows = [...automaticList.querySelectorAll(':scope > .notification-card')];
    if (rows.some(row => !row.dataset.softGrouped)) {
      journalList.replaceChildren();
      const failed = rows.filter(row => row.classList.contains('status-failed'));
      for (const row of rows) {
        row.dataset.softGrouped = 'true';
        if (!row.classList.contains('status-failed')) journalList.append(row);
      }
      automatic.dataset.softErrorCount = String(failed.length);
      const title = automatic.querySelector('.notification-toolbar h3');
      if (title) title.textContent = failed.length ? 'Ошибки доставки' : 'Статус автодоставки';
    } else if (automaticList.firstElementChild?.classList.contains('provider-empty')) {
      journalList.replaceChildren();
      delete automatic.dataset.softErrorCount;
      const title = automatic.querySelector('.notification-toolbar h3');
      if (title) title.textContent = 'Статус автодоставки';
    }
    automatic.classList.toggle('notification-errors-only', automatic.dataset.softErrorCount === '0');
    limitRows(automaticList, ':scope > .notification-card', 2, 'Показать все ошибки');
    journal.hidden = automatic.hidden || !journalList.children.length;
    const active = journalList.querySelectorAll('.status-pending,.status-sending').length;
    journal.querySelector('summary small').textContent = active ? `${active} в очереди` : `${journalList.children.length} событий`;
  }
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(refresh);
  });
  function refresh() {
    scheduled = false;
    observer.disconnect();
    try {
      if (openMenu && !openMenu.isConnected) openMenu = null;
      const count = root.querySelector('#notificationQueuePendingCount');
      if (count) count.textContent = manual?.dataset.pendingCount || '0';
      manual?.querySelectorAll('a[data-open-notification]').forEach(enhanceMessenger);
      limitRows(manual, ':scope > .notification-card', 4, 'Показать ещё');
      // Keep every dated group visible while shortening repetitive entries.
      root.querySelectorAll('.important-notification-group').forEach(group => {
        limitRows(group, ':scope > .important-notification-entry', 3, 'Показать ещё');
      });
      arrangeAutomatic();
      limitRows(root.querySelector('#unifiedNotificationEvents'), '.smart-event-row', 4, 'Все события');
      root.querySelectorAll('.smart-event-group').forEach(group => {
        const rows = [...group.querySelectorAll('.smart-event-row')];
        group.hidden = rows.length > 0 && rows.every(row => row.hidden);
      });
    } finally {
      observer.observe(root, { subtree:true, childList:true, attributes:true, attributeFilter:['hidden', 'data-pending-count'] });
    }
  }
  root.addEventListener('click', event => {
    const toggle = event.target.closest('[data-notification-channel-toggle]');
    if (toggle) {
      const wrapper = toggle.closest('.notification-messenger');
      const wasOpen = openMenu === wrapper;
      closeMenu();
      if (!wasOpen) {
        openMenu = wrapper;
        const menu = wrapper.querySelector('.notification-channel-menu');
        menu.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        wrapper.classList.toggle('notification-menu-above', menu.getBoundingClientRect().bottom > innerHeight - 8);
        menu.querySelector('[aria-checked="true"]')?.focus();
      }
      return;
    }
    const option = event.target.closest('[data-notification-channel]');
    if (option) {
      const wrapper = option.closest('.notification-messenger');
      const channel = option.dataset.notificationChannel;
      preferences.set(wrapper.querySelector('[data-open-notification]').dataset.openNotification, channel);
      updateChoice(wrapper, channel);
      closeMenu(true);
      live.textContent = `${channel === 'telegram' ? 'Telegram' : 'WhatsApp'} выбран. Проверьте получателя и отправьте сообщение в приложении.`;
      return;
    }
    const more = event.target.closest('[data-notification-more]');
    if (more) {
      const holder = more.parentElement;
      holder.dataset.softExpanded = String(holder.dataset.softExpanded !== 'true');
      refresh();
    }
  });
  document.addEventListener('click', event => {
    if (openMenu && !openMenu.contains(event.target)) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (!openMenu) return;
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
    if (event.key === 'Tab') { closeMenu(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...openMenu.querySelectorAll('[data-notification-channel]')];
    const index = options.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  });
  window.addEventListener('resize', () => closeMenu());
  refresh();
})();
