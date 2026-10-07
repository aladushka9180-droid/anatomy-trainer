import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_NOTIFICATIONS_SOFT_OUTPUT;
if (output) mkdirSync(output, { recursive:true });
const source = readFileSync(resolve(root, 'provider.js'), 'utf8');
const automatic = source.slice(source.indexOf('function renderAutomaticNotifications()'), source.indexOf('async function retryAutomaticNotification('));
const manual = source.slice(source.indexOf('function renderNotifications()'), source.indexOf('async function markAllDueNotificationsSent('));
const markAll = source.slice(source.indexOf('async function markAllDueNotificationsSent('), source.indexOf('async function saveNotificationTemplates('));
assert.ok(automatic && manual, 'Use the application renderers with isolated data');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, match => /provider-notifications-soft\.js/.test(match) ? match : '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const server = createServer((request, response) => {
  const file = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
  if (!file.startsWith(`${root}${sep}`)) return response.writeHead(404).end();
  try {
    response.setHeader('Content-Type', { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml' }[extname(file)] || 'application/octet-stream');
    response.end(file.endsWith('provider.html') ? html : readFileSync(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const context = await browser.newContext({ viewport:{ width:1440, height:1050 } });
  const unexpected = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    unexpected.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // No application bootstrap, Supabase, authentication or real client data.
  await page.goto(`${origin}/provider.html?section=notifications`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot').hidden = true;
    document.body.dataset.providerTheme = 'midnight';
    document.body.dataset.providerLayout = 'soft';
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'notifications';
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'notifications';
      view.classList.toggle('active', !view.hidden);
    });
    document.querySelector('#importantNotificationList').innerHTML = `<section class="important-notification-group"><h4>Сегодня</h4>${Array.from({ length:5 }, (_, i) => `<article class="important-notification-entry"><button type="button" class="important-notification-card"><i></i><span class="important-notification-copy"><span class="important-notification-head"><strong>${i % 2 ? 'Время записи изменено' : 'Новая запись от клиента'}</strong><time>10:${17 + i}</time></span><span class="important-notification-context">Анна · Массаж спины · 8 окт. в 14:00</span><span class="important-notification-meta">Автор: Клиент</span><span class="important-notification-effect">Ожидаемая выручка +2 500 ₽ · Занятость +40 мин</span></span><span>›</span></button><button type="button" class="important-notification-contact">Связаться</button></article>`).join('')}</section>`;
    window.$ = selector => document.querySelector(selector);
    window.$$ = selector => [...document.querySelectorAll(selector)];
    window.escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
    window.currentUser = { id:'fixture-user' };
    window.notificationOutboxRemoteAvailable = true;
    window.notificationFilter = 'pending';
    window.fixtureMarks = {};
    window.notificationMarks = () => window.fixtureMarks;
    window.allBookings = Array.from({ length:7 }, (_, i) => ({ id:`booking-${i}`, client_name:['Анна', 'Ирина', 'Мария'][i % 3], client_phone:'79990000000', booking_date:'2026-10-08', booking_time:'10:00', services:{ name:'Массаж спины и шейно-воротниковой зоны' } }));
    window.fixtureTasks = allBookings.map((item, i) => ({ key:`task-${i}`, item, type:i % 3 === 0 ? 'cancellation' : i % 2 ? 'reminder' : 'confirmation', dueAt:new Date(0) }));
    window.notificationOutbox = allBookings.map((item, i) => ({ id:`outbox-${i}`, booking_id:item.id, status:i < 3 ? 'failed' : i === 3 ? 'pending' : 'sent', attempts:1, last_error:'Тестовая причина недоступности канала', last_error_code:'gateway_timeout' }));
    window.buildNotificationTasks = () => window.fixtureTasks;
    window.renderImportantNotifications = () => {};
    window.importantNotificationRows = () => [];
    window.importantNotificationUnreadRows = () => [];
    window.localIsoDate = () => '2026-10-07';
    window.businessTodayIso = () => '2026-10-07';
    window.serviceName = value => value;
    window.parseLocalIsoDate = value => new Date(`${value}T12:00:00`);
    window.bookingStart = item => new Date(`${item.booking_date}T${item.booking_time}`);
    window.composeNotificationMessage = (type, item) => `Здравствуйте, ${item.client_name}! ${type}: 8 октября в 10:00. Текст & ссылка: https://example.test/?a=1&b=2`;
    window.whatsappLink = (item, type) => `https://wa.me/${item.client_phone}?text=${encodeURIComponent(composeNotificationMessage(type, item))}`;
    window.notificationDueLabel = () => 'Сейчас';
    window.uiIcon = name => `<svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-${name}"></use></svg>`;
    window.fixtureActions = [];
    window.requireWrites = () => true;
    window.notify = () => {};
    window.setNotificationMark = async (key, mark) => { fixtureMarks[key] = mark; return true; };
    document.addEventListener('click', event => {
      const open = event.target.closest('[data-open-notification]');
      const done = event.target.closest('[data-sent-notification]');
      const restore = event.target.closest('[data-restore-notification]');
      const retry = event.target.closest('[data-retry-notification-outbox]');
      const filter = event.target.closest('[data-notification-filter]');
      if (open) { event.preventDefault(); fixtureActions.push({ type:'open', href:open.href }); }
      if (done || restore) {
        fixtureActions.push({ type:done ? 'mark' : 'restore' });
        fixtureMarks[(done || restore).dataset[done ? 'sentNotification' : 'restoreNotification']] = done ? 'sent' : '';
        renderNotifications();
      }
      if (retry) fixtureActions.push({ type:'retry', id:retry.dataset.retryNotificationOutbox });
      if (event.target.closest('#markAllNotificationsSent')) void markAllDueNotificationsSent(event.target.closest('#markAllNotificationsSent'));
      if (filter) {
        notificationFilter = filter.dataset.notificationFilter;
        document.querySelectorAll('[data-notification-filter]').forEach(button => button.classList.toggle('active', button === filter));
        renderNotifications();
      }
    });
  });
  await page.addScriptTag({ content:`${automatic}\n${manual}\n${markAll}\nrenderNotifications();` });
  await page.addScriptTag({ path:resolve(root, 'notification-center.js') });
  await page.evaluate(async () => {
    window.MINUTA_CONFIG = { supabaseUrl:'https://fixture.test', supabaseKey:'test-key' };
    window.fetch = async () => ({ ok:true, json:async () => ({ ok:true, configured_channels:['telegram'], provider_telegram_fallback:false }) });
    const workspace = {
      organization_id:'fixture-org', current_role:'owner',
      settings:{ organization_id:'fixture-org', enabled:true, booking_created_enabled:true, booking_confirmed_enabled:true, booking_reminder_enabled:true, booking_confirmation_request_enabled:false, reminder_minutes_before:1440, confirmation_request_minutes_before:1440 },
      channels:['telegram','max','whatsapp','sms','vk','email','push'].flatMap(channel => ['provider','client'].map(audience => ({ organization_id:'fixture-org', audience, channel, enabled:channel === 'telegram' && audience === 'provider' }))),
      endpoints:[{ audience:'provider', subject_key:'fixture-user', channel:'telegram', active:true, configured:true }], outbox:[]
    };
    window.fixtureRpc = [];
    window.softController = MinutaNotificationCenter.createController({
      db:{ auth:{ getUser:async () => ({ data:{ user:currentUser } }) }, rpc:async (name, args) => {
        fixtureRpc.push({ name, args });
        if (name === 'set_minuta_notification_master') workspace.settings.enabled = args.p_enabled;
        return { data:structuredClone(workspace), error:null };
      } },
      $, escapeHtml, notify:() => {}, requireWrites:() => true
    });
    softController.bind();
    await softController.setOrganization({ id:'fixture-org' });
  });
  if (output) await page.screenshot({ path:resolve(output, 'before-midnight-1440.png'), fullPage:true });
  await page.addScriptTag({ path:resolve(root, 'provider-feature-assets.js') });
  await page.waitForSelector('.notification-soft .notification-messenger');
  await page.waitForFunction(() => document.querySelector('#notificationQueuePendingCount').textContent === '7');
  assert.equal(await page.locator('#notificationList > .notification-card:visible').count(), 4);
  assert.equal(await page.locator('#automaticNotificationList > .notification-card:visible').count(), 2);
  assert.equal(await page.locator('.notification-journal-list > .notification-card').count(), 4);
  assert.equal(await page.locator('#unifiedNotificationEvents .smart-event-row:visible').count(), 4, await page.locator('#unifiedNotificationUnavailable').textContent());
  const first = page.locator('.notification-messenger').first();
  const original = await first.locator('a').getAttribute('href');
  const rpcBeforeChoice = await page.evaluate(() => fixtureRpc.length);
  await first.locator('[data-notification-channel-toggle]').click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  const telegram = new URL(await first.locator('a').getAttribute('href'));
  assert.equal(telegram.origin, 'https://t.me');
  assert.equal(telegram.pathname, '/+79990000000');
  assert.equal(telegram.searchParams.get('text'), new URL(original).searchParams.get('text'));
  assert.equal(await page.evaluate(() => fixtureActions.length), 0, 'Selecting a channel must not open or mark the message');
  assert.equal(await page.evaluate(() => fixtureRpc.length), rpcBeforeChoice, 'Selecting a messenger must not write automatic delivery settings');
  assert.equal(await page.locator('.notification-journal-list > .notification-card').count(), 4, 'UI-only updates must preserve the full journal');
  await first.locator('a').click();
  assert.equal(await page.evaluate(() => fixtureActions.at(-1).href), telegram.href);
  await page.evaluate(() => renderNotifications());
  await page.waitForFunction(() => document.querySelector('[data-open-notification]').dataset.notificationMessenger === 'telegram');
  await first.locator('[data-notification-channel-toggle]').click();
  await page.keyboard.press('Escape');
  assert.equal(await first.locator('[data-notification-channel-toggle]').getAttribute('aria-expanded'), 'false');
  assert.equal(await first.locator('[data-notification-channel-toggle]').evaluate(node => node === document.activeElement), true);
  await first.locator('[data-notification-channel-toggle]').click();
  await page.locator('#notificationDeliveryTitle').click();
  assert.equal(await first.locator('.notification-channel-menu').isVisible(), false);
  await first.locator('[data-notification-channel-toggle]').click();
  await page.keyboard.press('Tab');
  assert.equal(await first.locator('.notification-channel-menu').isVisible(), false);
  await page.locator('#notificationList > .notification-show-more').click();
  assert.equal(await page.locator('#notificationList > .notification-card:visible').count(), 7);
  await page.locator('#notificationList > .notification-show-more').click();
  await page.locator('#automaticNotificationList > .notification-show-more').click();
  assert.equal(await page.locator('#automaticNotificationList > .notification-card:visible').count(), 3);
  await page.locator('[data-retry-notification-outbox]').first().click();
  assert.equal(await page.evaluate(() => fixtureActions.at(-1).type), 'retry');
  await page.locator('#automaticNotificationList > .notification-show-more').click();
  await page.locator('#unifiedNotificationEvents > .notification-show-more').click();
  assert.ok(await page.locator('#unifiedNotificationEvents .smart-event-row:visible').count() > 4);
  await page.locator('#unifiedNotificationEvents > .notification-show-more').click();
  await page.locator('[data-unified-tab="channels"]').click();
  assert.equal(await page.locator('#unifiedNotificationChannels').isVisible(), true);
  await page.locator('[data-unified-tab="deliveries"]').click();
  assert.equal(await page.locator('#unifiedNotificationDeliveries').isVisible(), true);
  await page.locator('[data-unified-tab="events"]').click();
  await page.locator('#unifiedNotificationsEnabled').uncheck();
  assert.equal(await page.locator('#saveUnifiedNotifications').isEnabled(), true);
  await page.locator('#saveUnifiedNotifications').click();
  assert.ok(await page.evaluate(() => fixtureRpc.some(call => call.name === 'set_minuta_notification_master' && call.args.p_enabled === false)), 'The existing explicit save must remain bound');
  await page.locator('#unifiedNotificationsEnabled').check();
  await page.locator('#saveUnifiedNotifications').click();
  await page.locator('#notificationList [data-sent-notification]').first().click();
  await page.waitForFunction(() => document.querySelector('#notificationQueuePendingCount').textContent === '6');
  await page.locator('[data-notification-filter="sent"]').click();
  assert.equal(await page.locator('#notificationList [data-restore-notification]').count(), 1);
  await page.locator('#notificationList [data-restore-notification]').click();
  await page.locator('[data-notification-filter="pending"]').click();
  await page.waitForFunction(() => document.querySelector('#notificationQueuePendingCount').textContent === '7');

  for (const theme of ['midnight', 'warm', 'cocoa-pearl', 'oled-mono', 'volt-graphite']) {
    await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
    for (const width of [390, 760, 1440]) {
      await page.setViewportSize({ width, height:1050 });
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(80);
      const geometry = await page.evaluate(() => {
        const root = document.querySelector('.notification-soft');
        const controls = [...root.querySelectorAll('.notification-card-actions a,.notification-card-actions button,.smart-delivery-tabs button')]
          .filter(node => node.getClientRects().length);
        const settings = root.querySelector('[data-open-notification-templates]').getBoundingClientRect();
        const refresh = root.querySelector('#refreshNotifications').getBoundingClientRect();
        return {
          overflow:document.documentElement.scrollWidth - innerWidth,
          clipped:controls.filter(node => { const r = node.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1 || r.height < 44 || r.width < 44; }).map(node => node.outerHTML.slice(0, 80)),
          panel:getComputedStyle(root.querySelector('.panel')).backgroundColor,
          border:getComputedStyle(root.querySelector('.panel')).borderTopWidth,
          cardBackground:getComputedStyle(root.querySelector('.notification-card')).backgroundColor,
          filterBackground:getComputedStyle(root.querySelector('.notification-filters')).backgroundColor,
          columns:getComputedStyle(root.querySelector('.notification-workspace')).gridTemplateColumns,
          text:getComputedStyle(root.querySelector('.notification-card p')).fontSize,
          headerDifference:Math.abs(settings.top + settings.height / 2 - refresh.top - refresh.height / 2),
          mainWidth:root.querySelector('.notification-card-main').getBoundingClientRect().width,
          cardWidth:root.querySelector('.notification-card').getBoundingClientRect().width
        };
      });
      assert.ok(geometry.overflow <= 1, `${theme}/${width}: overflow ${JSON.stringify(geometry)}`);
      assert.deepEqual(geometry.clipped, [], `${theme}/${width}: controls must fit and remain touchable`);
      assert.ok(parseFloat(geometry.text) >= 14, `${theme}/${width}: secondary text is too small`);
      assert.notEqual(geometry.panel, 'rgba(0, 0, 0, 0)', 'Keep the selected theme surface');
      assert.equal(geometry.border, '0px', 'Use the approved flat panels');
      assert.equal(geometry.cardBackground, 'rgba(0, 0, 0, 0)', 'Rows must not become nested cards');
      assert.equal(geometry.filterBackground, 'rgba(0, 0, 0, 0)', 'Filters must retain their quiet underline style');
      assert.ok(geometry.headerDifference <= 1, `${theme}/${width}: header actions must remain on the same row (${geometry.headerDifference})`);
      assert.ok(geometry.mainWidth >= (width === 1440 ? 210 : geometry.cardWidth - 35), `${theme}/${width}: message copy squeezed by old grid rules`);
      assert.equal(geometry.columns.split(' ').length, width === 1440 ? 2 : 1);
      if (output && theme === 'midnight') {
        // Activate content-visibility:auto rows before a full-page capture.
        for (const panel of await page.locator('.notification-soft .panel:visible').all()) {
          await panel.scrollIntoViewIfNeeded();
          await page.waitForTimeout(60);
        }
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path:resolve(output, `after-${theme}-${width}.png`), fullPage:true });
        await page.locator('#automaticNotificationPanel').scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
        assert.equal(await page.locator('#automaticNotificationList .notification-card h3').first().isVisible(), true);
        await page.screenshot({ path:resolve(output, `errors-${theme}-${width}.png`) });
      }
      await first.locator('[data-notification-channel-toggle]').click();
      const menu = await first.locator('.notification-channel-menu').boundingBox();
      assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 1, `${width}: messenger menu clips`);
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width:390, height:844 });
  await page.evaluate(() => document.body.style.setProperty('--provider-text-step', '4px'));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Large text must retain mobile layout');
  await page.locator('#markAllNotificationsSent').click();
  await page.waitForFunction(() => document.querySelector('#notificationQueuePendingCount').textContent === '0');
  assert.equal(await page.locator('#notificationList .provider-empty').count(), 1);
  const cold = await context.newPage();
  await cold.goto(`${origin}/provider.html`);
  await cold.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    window.fixtureNavigationCount = 0;
    document.addEventListener('click', event => {
      if (!event.target.closest('[data-provider-view="notifications"]')) return;
      fixtureNavigationCount++;
      document.querySelector('[data-provider-panel="notifications"]').hidden = false;
    });
  });
  await cold.addScriptTag({ path:resolve(root, 'provider-feature-assets.js') });
  await cold.locator('[data-provider-view="notifications"]').first().click();
  await cold.waitForSelector('.notification-soft');
  assert.equal(await cold.evaluate(() => fixtureNavigationCount), 1, 'Cold navigation must replay exactly once after the feature loads');
  await cold.close();
  await page.evaluate(() => { notificationOutbox = []; renderNotifications(); });
  await page.waitForFunction(() => document.querySelector('.notification-delivery-journal').hidden);
  assert.equal(await page.locator('#automaticNotificationList .provider-empty').count(), 1);
  await page.evaluate(() => { notificationOutboxRemoteAvailable = false; renderNotifications(); });
  assert.equal(await page.locator('#automaticNotificationPanel').isVisible(), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, [], 'This proof must remain entirely local');
  console.log('PASS: notification renderers, Telegram/WhatsApp choice, no implicit send, rerenders, filters, marks, retry, journal, settings and 15 theme/width layouts.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
