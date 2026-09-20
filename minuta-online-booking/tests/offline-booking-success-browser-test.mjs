import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themeBox = { window:{} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'theme-catalog.js'), 'utf8'), themeBox);
const themes = themeBox.window.MinutaThemeCatalog.themes.map(theme => ({ key:theme.key, palette:{ ...theme.palette } }));
const output = process.env.MINUTA_OFFLINE_SUCCESS_OUTPUT || '';
if (output) fs.mkdirSync(output, { recursive:true });
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const server = http.createServer((request, response) => {
  const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const file = path.resolve(root, `.${requested}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  const content = file.endsWith('.html') ? html : fs.readFileSync(file);
  response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
  response.end(content);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
  await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot')?.remove();
    document.querySelector('#dashboard').hidden = false;
    document.querySelector('#dashboard').dataset.activeView = 'bookings';
    document.body.dataset.providerTheme = 'warm';
    document.body.dataset.providerLayout = 'soft';
    document.querySelectorAll('.provider-view').forEach(view => { view.hidden = view.dataset.providerPanel !== 'bookings'; });
    const panel = document.querySelector('#offlineBookingQueuePanel');
    panel.hidden = false;
    document.querySelector('#offlineBookingQueueStatus').textContent = 'Когда интернет вернётся, PrimeTime Pro проверит выбранное время и создаст запись';
    const list = document.querySelector('#offlineBookingQueueList');
    list.innerHTML = '<article class="offline-booking-item is-pending"><div><strong>Рамиль с очень длинной фамилией для проверки переноса</strong><span>23 сент. · 12:00–13:30</span><span>Общий оздоровительный массаж всего тела с длинным названием</span><small>Ожидает подключения</small></div><div class="offline-booking-actions"><button type="button">Удалить</button></div></article>';
    const holder = document.querySelector('#providerBookings');
    holder.className = 'provider-bookings timeline-view';
    holder.innerHTML = '<div class="day-timeline" style="--timeline-height:500px;--half-hour-offset:38px"><div class="timeline-hours"><span class="timeline-hour" style="top:0">12:00</span></div><div class="timeline-stage" style="height:500px"><button class="timeline-booking confirmed" type="button" style="top:10px;height:108px"><span class="timeline-booking-time"><b>12:00</b><small>–13:30</small></span><span class="timeline-booking-copy"><strong>Общий массаж</strong><small class="timeline-booking-client">Рамиль</small></span></button></div></div>';
  });
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:1000 });
    await page.evaluate(() => {
      const panel = document.querySelector('#offlineBookingQueuePanel');
      panel.classList.remove('is-created');
      document.querySelector('#offlineBookingQueueHead').hidden = false;
      document.querySelector('#offlineBookingQueueTitle').textContent = 'Сохранено на устройстве';
      document.querySelector('#offlineBookingQueueStatus').textContent = 'Когда интернет вернётся, PrimeTime Pro проверит выбранное время и создаст запись';
      document.querySelector('#offlineBookingQueueDetails').hidden = true;
      document.querySelector('#offlineBookingQueueList').innerHTML = '<article class="offline-booking-item is-pending"><div><strong>Рамиль с очень длинной фамилией для проверки переноса</strong><span>23 сент. · 12:00–13:30</span><span>Общий оздоровительный массаж всего тела с длинным названием</span><small>Ожидает подключения</small></div><div class="offline-booking-actions"><button type="button">Удалить</button></div></article>';
    });
    const before = await page.evaluate(() => {
      const panel = document.querySelector('#offlineBookingQueuePanel').getBoundingClientRect();
      const item = document.querySelector('.offline-booking-item').getBoundingClientRect();
      return { panel:{ top:panel.top, left:panel.left, width:panel.width }, item:{ top:item.top, left:item.left, width:item.width } };
    });
    if (output) await page.screenshot({ path:path.join(output, `offline-booking-pending-${width}.png`), fullPage:true });
    await page.evaluate(() => {
      const panel = document.querySelector('#offlineBookingQueuePanel');
      panel.classList.add('is-created');
      document.querySelector('#offlineBookingQueueHead').hidden = false;
      document.querySelector('#offlineBookingQueueTitle').textContent = 'Офлайн-запись';
      document.querySelector('#offlineBookingQueueStatus').textContent = 'Когда интернет вернётся, PrimeTime Pro проверит выбранное время и создаст запись';
      document.querySelector('#offlineBookingQueueDetails').hidden = true;
      document.querySelector('#offlineBookingQueueList').innerHTML = '<article class="offline-booking-item is-created"><div><strong>Запись создана</strong><b>Рамиль с очень длинной фамилией для проверки переноса</b><span>Общий оздоровительный массаж всего тела с длинным названием</span><span>23 сентября · 12:00–13:30</span><small>Уведомление клиенту не отправлено — Telegram не подключён</small></div><div class="offline-booking-actions offline-booking-created-actions"><button class="offline-booking-create-more" type="button">Создать ещё запись</button><button class="offline-booking-dismiss" type="button" aria-label="Закрыть подтверждение">×</button></div></article>';
    });
    const state = await page.evaluate(() => {
      const panel = document.querySelector('#offlineBookingQueuePanel').getBoundingClientRect();
      const item = document.querySelector('.offline-booking-item').getBoundingClientRect();
      const schedule = document.querySelector('#providerBookings').getBoundingClientRect();
      const booking = document.querySelector('.timeline-booking').getBoundingClientRect();
      return {
        panel:{ top:panel.top, left:panel.left, width:panel.width, bottom:panel.bottom },
        item:{ top:item.top, left:item.left, width:item.width }, scheduleTop:schedule.top,
        bookingVisible:booking.width > 0 && booking.height > 0,
        overlap:panel.bottom > schedule.top,
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        text:document.querySelector('.offline-booking-item').innerText
      };
    });
    assert.ok(Math.abs(state.panel.top - before.panel.top) < 1, `${width}px panel moved vertically`);
    assert.ok(Math.abs(state.panel.left - before.panel.left) < 1, `${width}px panel moved horizontally`);
    assert.ok(Math.abs(state.panel.width - before.panel.width) < 1, `${width}px panel width changed`);
    assert.ok(Math.abs(state.item.left - before.item.left) < 1, `${width}px row moved horizontally`);
    assert.ok(Math.abs(state.item.top - before.item.top) < 1, `${width}px row moved vertically: ${before.item.top} -> ${state.item.top}`);
    assert.ok(Math.abs(state.item.width - before.item.width) < 1, `${width}px row width changed`);
    assert.equal(state.overlap, false, `${width}px success row overlaps schedule`);
    assert.equal(state.bookingVisible, true, `${width}px booking is not visible with success row`);
    assert.equal(state.overflow, false, `${width}px overflow`);
    assert.match(state.text, /Запись создана/);
    assert.match(state.text, /Рамиль с очень длинной фамилией/);
    assert.match(state.text, /Общий оздоровительный массаж/);
    assert.match(state.text, /23 сентября · 12:00–13:30/);
    assert.match(state.text, /Telegram не подключён/);
    assert.match(state.text, /Создать ещё запись/);
    if (output) await page.screenshot({ path:path.join(output, `offline-booking-success-${width}.png`), fullPage:true });
  }

  const themeStates = await page.evaluate(themesToCheck => {
    const rgb = value => {
      const numbers = String(value).match(/[\d.]+/g)?.map(Number) || [];
      if (String(value).startsWith('color(srgb')) return numbers.slice(0, 3).map(channel => channel * 255);
      return numbers.slice(0, 3);
    };
    const luminance = value => rgb(value).map(channel => channel / 255).map(channel => channel <= .03928 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126,.7152,.0722][index], 0);
    const contrast = (foreground, background) => {
      const a = luminance(foreground);
      const b = luminance(background);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    };
    const panel = document.querySelector('#offlineBookingQueuePanel');
    const item = document.querySelector('#offlineBookingQueueList');
    return themesToCheck.map(theme => {
      document.body.dataset.providerTheme = theme.key;
      for (const [name, value] of Object.entries(theme.palette)) {
        if (typeof value === 'string') document.body.style.setProperty(`--theme-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
      }
      panel.classList.remove('is-created');
      item.innerHTML = '<article class="offline-booking-item is-pending"><div><strong>Длинное имя клиента</strong><span>23 сент. · 12:00–13:30</span><span>Длинное название услуги</span><small>Ожидает подключения</small></div><div class="offline-booking-actions"><button type="button">Удалить</button></div></article>';
      const pendingPanelStyle = getComputedStyle(panel);
      const pendingItemStyle = getComputedStyle(item.firstElementChild);
      const pending = { color:pendingPanelStyle.color, background:pendingPanelStyle.backgroundColor, border:pendingPanelStyle.borderColor, itemBackground:pendingItemStyle.backgroundColor,
        contrast:Math.min(...[...item.querySelectorAll('strong,span,small,button')].map(element => contrast(getComputedStyle(element).color, element.matches('button') ? getComputedStyle(element).backgroundColor : pendingItemStyle.backgroundColor))) };
      panel.classList.add('is-created');
      item.innerHTML = '<article class="offline-booking-item is-created"><div><strong>Запись создана</strong><b>Длинное имя клиента</b><span>Длинное название услуги</span><span>23 сентября · 12:00–13:30</span><small>Telegram не подключён</small></div><div class="offline-booking-actions offline-booking-created-actions"><button class="offline-booking-create-more" type="button">Создать ещё запись</button><button class="offline-booking-dismiss" type="button">×</button></div></article>';
      const createdPanelStyle = getComputedStyle(panel);
      const createdItemStyle = getComputedStyle(item.firstElementChild);
      const createMoreStyle = getComputedStyle(item.querySelector('.offline-booking-create-more'));
      const created = { color:createdPanelStyle.color, background:createdPanelStyle.backgroundColor, border:createdPanelStyle.borderColor, itemBackground:createdItemStyle.backgroundColor, actionColor:createMoreStyle.color, actionBackground:createMoreStyle.backgroundColor,
        contrast:Math.min(...[...item.querySelectorAll('strong,b,span,small,button')].map(element => contrast(getComputedStyle(element).color, element.matches('button') ? getComputedStyle(element).backgroundColor : createdItemStyle.backgroundColor))) };
      return {
        key:theme.key,
        pending,
        created,
        overflow:document.documentElement.scrollWidth > innerWidth + 2
      };
    });
  }, themes);
  for (const state of themeStates) {
    assert.equal(state.overflow, false, `${state.key}: theme causes horizontal overflow`);
    assert.notEqual(state.pending.background, 'rgba(0, 0, 0, 0)', `${state.key}: pending background is transparent`);
    assert.notEqual(state.pending.border, state.created.border, `${state.key}: pending and created borders must use different semantics`);
    assert.notEqual(state.pending.background, state.created.background, `${state.key}: pending and created backgrounds must use different semantics`);
    assert.notEqual(state.created.actionBackground, 'rgba(0, 0, 0, 0)', `${state.key}: create-more action background is transparent`);
    assert.ok(state.pending.contrast >= 4.5, `${state.key}: pending contrast ${state.pending.contrast.toFixed(2)} is below 4.5`);
    assert.ok(state.created.contrast >= 4.5, `${state.key}: created contrast ${state.created.contrast.toFixed(2)} is below 4.5`);
  }
  if (output) {
    const graphite = themes.find(theme => theme.key === 'graphite');
    await page.setViewportSize({ width:390, height:1000 });
    await page.evaluate(theme => {
      document.body.dataset.providerTheme = theme.key;
      for (const [name, value] of Object.entries(theme.palette)) {
        if (typeof value === 'string') document.body.style.setProperty(`--theme-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
      }
      const panel = document.querySelector('#offlineBookingQueuePanel');
      panel.classList.remove('is-created');
      document.querySelector('#offlineBookingQueueTitle').textContent = 'Сохранено на устройстве';
      document.querySelector('#offlineBookingQueueStatus').textContent = 'Когда интернет вернётся, PrimeTime Pro проверит выбранное время и создаст запись';
      document.querySelector('#offlineBookingQueueList').innerHTML = '<article class="offline-booking-item is-pending"><div><strong>Рамиль с очень длинной фамилией для проверки переноса</strong><span>23 сент. · 12:00–13:30</span><span>Общий оздоровительный массаж всего тела с длинным названием</span><small>Ожидает подключения</small></div><div class="offline-booking-actions"><button type="button">Удалить</button></div></article>';
    }, graphite);
    await page.screenshot({ path:path.join(output, 'offline-booking-pending-graphite-390.png'), fullPage:true });
    await page.evaluate(() => {
      const panel = document.querySelector('#offlineBookingQueuePanel');
      panel.classList.add('is-created');
      document.querySelector('#offlineBookingQueueTitle').textContent = 'Офлайн-запись';
      document.querySelector('#offlineBookingQueueList').innerHTML = '<article class="offline-booking-item is-created"><div><strong>Запись создана</strong><b>Рамиль с очень длинной фамилией для проверки переноса</b><span>Общий оздоровительный массаж всего тела с длинным названием</span><span>23 сентября · 12:00–13:30</span><small>Уведомление клиенту не отправлено — Telegram не подключён</small></div><div class="offline-booking-actions offline-booking-created-actions"><button class="offline-booking-create-more" type="button">Создать ещё запись</button><button class="offline-booking-dismiss" type="button">×</button></div></article>';
    });
    await page.screenshot({ path:path.join(output, 'offline-booking-success-graphite-390.png'), fullPage:true });
  }
  console.log('PrimeTime Pro offline booking success browser checks: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
