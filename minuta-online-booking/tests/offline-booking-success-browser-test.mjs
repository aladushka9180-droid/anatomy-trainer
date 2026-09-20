import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
    document.querySelector('#offlineBookingQueueStatus').textContent = '1 отправится автоматически после подключения';
    const list = document.querySelector('#offlineBookingQueueList');
    list.innerHTML = '<article class="offline-booking-item is-pending"><div><strong>Рамиль</strong><span>23 сент. · 12:00 · Общий массаж</span><small>Будет проверено при подключении</small></div><div class="offline-booking-actions"><button type="button">Удалить</button></div></article>';
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
      document.querySelector('#offlineBookingQueueStatus').textContent = '1 отправится автоматически после подключения';
      document.querySelector('#offlineBookingQueueDetails').hidden = false;
      document.querySelector('#offlineBookingQueueList').innerHTML = '<article class="offline-booking-item is-pending"><div><strong>Рамиль</strong><span>23 сент. · 12:00 · Общий массаж</span><small>Будет проверено при подключении</small></div><div class="offline-booking-actions"><button type="button">Удалить</button></div></article>';
    });
    const before = await page.evaluate(() => {
      const panel = document.querySelector('#offlineBookingQueuePanel').getBoundingClientRect();
      const item = document.querySelector('.offline-booking-item').getBoundingClientRect();
      return { panel:{ top:panel.top, left:panel.left, width:panel.width }, item:{ top:item.top, left:item.left, width:item.width } };
    });
    await page.evaluate(() => {
      const panel = document.querySelector('#offlineBookingQueuePanel');
      panel.classList.add('is-created');
      document.querySelector('#offlineBookingQueueHead').hidden = false;
      document.querySelector('#offlineBookingQueueTitle').textContent = 'Офлайн-запись';
      document.querySelector('#offlineBookingQueueStatus').textContent = '\u00a0';
      document.querySelector('#offlineBookingQueueDetails').hidden = true;
      document.querySelector('#offlineBookingQueueList').innerHTML = '<article class="offline-booking-item is-created"><div><strong>Запись создана</strong><span>Рамиль · Общий массаж · 12:00–13:30</span><small>Уведомление клиенту не отправлено — Telegram не подключён</small></div><div class="offline-booking-actions"><button class="offline-booking-dismiss" type="button" aria-label="Закрыть подтверждение">×</button></div></article>';
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
    assert.match(state.text, /Рамиль · Общий массаж · 12:00–13:30/);
    assert.match(state.text, /Telegram не подключён/);
    if (output) await page.screenshot({ path:path.join(output, `offline-booking-success-${width}.png`), fullPage:true });
  }
  console.log('PrimeTime Pro offline booking success browser checks: PASS');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
