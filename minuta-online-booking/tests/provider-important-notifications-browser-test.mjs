import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_IMPORTANT_NOTIFICATIONS_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });
const providerSource = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const contactStart = providerSource.indexOf('function openClientContactDialogForPhone(');
const contactEnd = providerSource.indexOf('function openImportantNotificationContact(', contactStart);
assert.ok(contactStart >= 0 && contactEnd > contactStart, 'contact helper must exist');
const contactHelper = providerSource.slice(contactStart, contactEnd);

const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8');
  response.end(content);
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.body.dataset.providerTheme = 'warm';
    document.body.dataset.providerLayout = 'soft';
    const dashboard = document.querySelector('#dashboard');
    dashboard.hidden = false;
    dashboard.dataset.activeView = 'notifications';
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'notifications';
      view.classList.toggle('active', view.dataset.providerPanel === 'notifications');
    });
    document.querySelector('#importantNotificationList').innerHTML = `
      <section class="important-notification-group"><h4>Сегодня</h4>
        <article class="important-notification-entry"><button class="important-notification-card is-unread" type="button"><i></i><span class="important-notification-copy"><span class="important-notification-head"><strong>Новая запись от клиента</strong><time>10:17</time></span><span class="important-notification-context">Ирина · Массаж спины и шейно-воротниковой зоны · 15 сент. в 14:00</span><span class="important-notification-meta">Автор: Клиент · Ирина</span><span class="important-notification-effect">Ожидаемая выручка +2 500 ₽ · Занятость +40 мин</span></span><span class="important-notification-arrow">›</span></button><button class="important-notification-contact" type="button">Связаться</button></article>
        <article class="important-notification-entry"><button class="important-notification-card" type="button"><i></i><span class="important-notification-copy"><span class="important-notification-head"><strong>Дата или время изменены</strong><time>09:42</time></span><span class="important-notification-context">Анна · Общий массаж · 16 сент. в 12:30</span><span class="important-notification-meta">Автор: Администратор · Мария</span></span><span class="important-notification-arrow">›</span></button></article>
      </section>`;
    document.querySelector('#notificationList').innerHTML = '<div class="provider-empty notification-empty"><span class="provider-empty-icon">✓</span><strong>Доставка работает</strong><small>Сообщений, требующих внимания, нет.</small></div>';
    document.querySelector('#automaticNotificationPanel').hidden = false;
    document.querySelector('#automaticNotificationList').innerHTML = '<div class="provider-empty notification-empty"><span class="provider-empty-icon">✓</span><strong>Очередь обработана</strong><small>Ошибок доставки нет.</small></div>';
    const dialog = document.querySelector('#notificationTemplatesDialog');
    dialog.showModal();
    dialog.querySelectorAll('textarea').forEach((field, index) => { field.value = index ? 'Здравствуйте, {{client_name}}. Напоминаем о визите {{booking_date}} в {{booking_time}}.' : 'Подтвердите запись {{service_name}} на {{booking_date}} в {{booking_time}}.'; });
  });

  for (const theme of ['warm', 'cocoa-pearl', 'oled-mono', 'volt-graphite']) {
    await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
    for (const width of [390, 760, 1440]) {
      await page.setViewportSize({ width, height:900 });
      await page.waitForTimeout(240);
      const geometry = await page.evaluate(() => {
        const dialog = document.querySelector('#notificationTemplatesDialog');
        const save = dialog.querySelector('button[type="submit"]');
        const fields = dialog.querySelector('.notification-template-fields');
        const unread = document.querySelector('.important-notification-card.is-unread');
        const contact = document.querySelector('.important-notification-contact');
        const card = unread.getBoundingClientRect();
        const contactRect = contact.getBoundingClientRect();
        const modal = dialog.getBoundingClientRect();
        const saveRect = save.getBoundingClientRect();
        const style = getComputedStyle(unread);
        const bodyStyle = getComputedStyle(document.body);
        const panelStyle = getComputedStyle(document.querySelector('.notification-events-panel'));
        return {
          overflow:document.documentElement.scrollWidth > innerWidth + 1,
          cardInside:card.left >= -1 && card.right <= innerWidth + 1,
          contactInside:contactRect.left >= -1 && contactRect.right <= innerWidth + 1 && contactRect.height >= (innerWidth <= 760 ? 44 : 40),
          cardHeight:card.height,
          dialogInside:modal.left >= -1 && modal.right <= innerWidth + 1 && modal.top >= -1 && modal.bottom <= innerHeight + 1,
          saveVisible:saveRect.top >= modal.top && saveRect.bottom <= modal.bottom && saveRect.height >= 44,
          fieldsScrollable:fields.scrollHeight > fields.clientHeight,
          textColor:style.color,
          backgroundColor:style.backgroundColor,
          themeSurface:bodyStyle.getPropertyValue('--theme-surface').trim(),
          panelBackground:panelStyle.backgroundColor
        };
      });
      assert.equal(geometry.overflow, false, `${theme} ${width}px has horizontal overflow: ${JSON.stringify(geometry)}`);
      if (process.env.MINUTA_IMPORTANT_NOTIFICATIONS_DEBUG) console.log(theme, width, geometry.themeSurface, geometry.panelBackground);
      const expectedSurface = { warm:'rgb(255, 253, 250)', 'cocoa-pearl':'rgb(51, 43, 39)', 'oled-mono':'rgb(10, 10, 10)', 'volt-graphite':'rgb(24, 29, 34)' }[theme];
      assert.equal(geometry.panelBackground, expectedSurface, `${theme} ${width}px lost its theme surface`);
      assert.equal(geometry.cardInside && geometry.contactInside && geometry.dialogInside && geometry.saveVisible, true, `${theme} ${width}px clips content: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.cardHeight >= 76, `${theme} ${width}px event target is too short`);
      assert.notEqual(geometry.textColor, geometry.backgroundColor, `${theme} ${width}px event copy has no contrast`);
      if (width === 390) assert.equal(geometry.fieldsScrollable, true, `${theme} mobile template body should scroll independently`);
      if (output) await page.screenshot({ path:path.join(output, `important-${theme}-${width}.png`), fullPage:false });
    }
  }
  await page.locator('#notificationTemplatesDialog button[type="submit"]').focus();
  assert.equal(await page.locator('#notificationTemplatesDialog button[type="submit"]').evaluate(button => getComputedStyle(button).outlineStyle), 'solid');
  await page.locator('#notificationTemplatesDialog').evaluate(dialog => dialog.close());
  for (const { theme, width } of [{ theme:'warm', width:390 }, { theme:'cocoa-pearl', width:1440 }]) {
    await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
    await page.setViewportSize({ width, height:900 });
    await page.waitForTimeout(240);
    const feed = await page.locator('.notification-events-panel').evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      return { left:rect.left, right:rect.right, viewport:innerWidth, visible:rect.height > 0 };
    });
    assert.equal(feed.visible && feed.left >= -1 && feed.right <= feed.viewport + 1, true, `${theme} ${width}px important feed is clipped`);
    if (output) await page.screenshot({ path:path.join(output, `feed-${theme}-${width}.png`), fullPage:false });
  }
  await page.addScriptTag({ content:`
    const $ = selector => document.querySelector(selector);
    const normalizePhone = value => String(value || '').replace(/\\D/g, '');
    const newBookingClientPhoneLabel = (_phone, displayPhone) => displayPhone;
    ${contactHelper}
  ` });
  await page.evaluate(() => { document.body.dataset.providerTheme = 'noir-rose'; });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    assert.equal(await page.evaluate(() => openClientContactDialogForPhone('+7 900 111-22-33', '+7 900 111-22-33')), true);
    const contactGeometry = await page.locator('#clientContactDialog').evaluate(dialog => {
      const rect = dialog.getBoundingClientRect();
      return {
        parentIsBody:dialog.parentElement === document.body,
        visible:rect.width > 0 && rect.height > 0,
        inside:rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1,
        phone:dialog.querySelector('#clientContactPhone')?.textContent,
        overflow:document.documentElement.scrollWidth > innerWidth + 1
      };
    });
    assert.equal(contactGeometry.parentIsBody && contactGeometry.visible && contactGeometry.inside && !contactGeometry.overflow, true, `${width}px notification contact is hidden: ${JSON.stringify(contactGeometry)}`);
    assert.equal(contactGeometry.phone, '+7 900 111-22-33');
    await page.locator('#clientContactDialog').evaluate(dialog => dialog.close());
  }
  await page.evaluate(() => {
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'analytics';
      view.classList.toggle('active', view.dataset.providerPanel === 'analytics');
    });
    const panel = document.querySelector('#reportLastChange');
    panel.hidden = false;
    document.querySelector('#reportLastChangeContext').textContent = 'Ирина · Массаж спины и шейно-воротниковой зоны';
    document.querySelector('#reportLastChangeTitle').textContent = 'Новая запись от клиента';
    document.querySelector('#reportLastChangeEffect').textContent = 'Ожидаемая выручка +2 500 ₽ · Занятость +40 мин';
    document.querySelector('#reportLastChangeTime').textContent = '15 сент., 10:17';
    document.querySelector('#reportLastChangeActor').textContent = 'Автор: Клиент · Ирина';
    const history = document.querySelector('.report-event-history');
    history.open = true;
    document.querySelector('#reportEventList').innerHTML = Array.from({ length:18 }, (_, index) => `<article><time><span>${15 - index} сент.</span><b>${String(10 + index % 8).padStart(2,'0')}:17</b></time><div><strong>${index % 2 ? 'Дата или время изменены' : 'Новая запись от клиента'}</strong><p>Ирина · Массаж спины и шейно-воротниковой зоны</p><span>Ожидаемая выручка +2 500 ₽ · Занятость +40 мин</span><small>Автор: ${index % 2 ? 'Администратор · Мария' : 'Клиент · Ирина'}</small></div></article>`).join('');
  });
  for (const { theme, width } of [{ theme:'warm', width:390 }, { theme:'cocoa-pearl', width:760 }, { theme:'oled-mono', width:1440 }]) {
    await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
    await page.setViewportSize({ width, height:900 });
    await page.waitForTimeout(240);
    await page.locator('#reportLastChange').scrollIntoViewIfNeeded();
    const historyGeometry = await page.locator('#reportLastChange').evaluate(panel => {
      const rect = panel.getBoundingClientRect();
      const list = panel.querySelector('#reportEventList');
      return { overflow:document.documentElement.scrollWidth > innerWidth + 1, inside:rect.left >= -1 && rect.right <= innerWidth + 1, listScrolls:list.scrollHeight > list.clientHeight };
    });
    assert.equal(historyGeometry.overflow, false, `${theme} ${width}px history overflows horizontally`);
    assert.equal(historyGeometry.inside && historyGeometry.listScrolls, true, `${theme} ${width}px history geometry failed: ${JSON.stringify(historyGeometry)}`);
    if (output) await page.screenshot({ path:path.join(output, `history-${theme}-${width}.png`), fullPage:false });
  }
  console.log('PrimeTime Pro important notifications and template layout: PASS at 390/760/1440 in 4 themes');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
