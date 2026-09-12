import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const themes = ['pearl-zebra', 'noir-rose', 'cocoa-pearl', 'plum-cashmere', 'obsidian-champagne'];
const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname.replace(/^\/+/, '') || 'provider.html');
    const target = path.resolve(root, relative);
    if (!target.startsWith(root) || !(await stat(target)).isFile()) throw new Error('not found');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', contentTypes.get(path.extname(target)) || 'application/octet-stream');
    response.end(await readFile(target));
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const playwright = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH || undefined });
const output = process.env.MINUTA_THEME_OUTPUT;
if (output) await mkdir(output, { recursive:true });

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('**/*', route => route.request().resourceType() === 'script' ? route.abort() : route.continue());
  await page.goto(`${origin}/provider.html`, { waitUntil:'networkidle' });
  await page.evaluate(() => {
    document.documentElement.classList.remove('provider-booting', 'requires-top-level');
    document.querySelector('#providerBoot').hidden = true;
    document.querySelector('#dashboard').hidden = false;
    document.body.classList.add('authenticated');
    document.body.dataset.providerLayout = 'soft';
    document.body.dataset.providerTextScale = 'default';
    document.querySelectorAll('.provider-view').forEach(view => {
      view.hidden = view.dataset.providerPanel !== 'bookings';
      view.classList.toggle('active', view.dataset.providerPanel === 'bookings');
    });
    document.querySelectorAll('[data-provider-view]').forEach(button => button.classList.toggle('active', button.dataset.providerView === 'bookings'));
    document.querySelector('#welcomeName').textContent = 'Здравствуйте, Анна!';
    document.querySelector('#todayLabel').textContent = 'Пятница, 12 сентября';
    document.querySelector('#currentTimeLabel').textContent = '14:30';
    document.querySelector('#todayBookingsCount').textContent = '4';
    document.querySelector('#newBookingsCount').textContent = '2';
    document.querySelector('#activeServicesCount').textContent = '8';
    document.querySelector('#selectedDateTitle').textContent = 'Сегодня, 12 сентября';
    document.querySelector('#selectedDateSummary').textContent = '4 записи · 5 ч 30 мин';
    document.querySelector('#dateStrip').innerHTML = [10, 11, 12, 13, 14].map(day => `<button type="button" class="${day === 12 ? 'active' : ''}"><span>${day === 12 ? 'Пт' : day < 12 ? 'Ср' : 'Сб'}</span><strong>${day}</strong><small>сентября</small></button>`).join('');
    const rows = [
      ['10:00', '11:00', 'Классический массаж', 'Екатерина К.', 'Подтверждена'],
      ['11:30', '12:30', 'Спортивный массаж', 'Алексей М.', 'Ожидает'],
      ['14:00', '15:00', 'Антистресс-программа', 'Ольга Л.', 'Подтверждена'],
      ['16:30', '17:30', 'Лечебный массаж', 'Дмитрий И.', 'Новая'],
    ];
    document.querySelector('#providerBookings').innerHTML = rows.map(([start, end, service, client, status]) => `<article class="provider-booking status-confirmed color-auto"><button class="provider-booking-open" type="button"><span class="booking-time-column"><strong>${start}<small>до ${end}</small></strong><span>12 сентября</span></span><span class="booking-main"><span class="provider-booking-top"><h3>${service}</h3><span class="booking-status">${status}</span></span><span class="provider-booking-client-line"><span class="booking-client-name-row"><strong>${client}</strong></span><span class="provider-booking-phone">+7 (900) 000-00-00</span></span></span><span class="provider-booking-chevron">›</span></button></article>`).join('');
  });

  const failures = [];
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:1000 });
    for (const theme of themes) {
      const snapshot = await page.evaluate(themeKey => {
        document.body.dataset.providerTheme = themeKey;
        const style = getComputedStyle(document.body);
        const cards = [...document.querySelectorAll('#providerBookings .provider-booking')];
        const cardRects = cards.map(card => card.getBoundingClientRect());
        return {
          theme:themeKey,
          viewport:innerWidth,
          scrollWidth:document.documentElement.scrollWidth,
          themeBg:style.getPropertyValue('--theme-bg').trim(),
          themeInk:style.getPropertyValue('--theme-ink').trim(),
          cards:cards.length,
          clippedCards:cards.filter(card => card.scrollWidth > card.clientWidth || card.scrollHeight > card.clientHeight).length,
          cardLeft:Math.min(...cardRects.map(rect => rect.left)),
          cardRight:Math.max(...cardRects.map(rect => rect.right)),
          primaryVisible:Boolean(document.querySelector('#newBookingButton')?.getBoundingClientRect().width),
        };
      }, theme);
      if (!snapshot.themeBg || !snapshot.themeInk) failures.push({ ...snapshot, problem:'theme tokens missing' });
      if (snapshot.cards !== 4 || snapshot.clippedCards) failures.push({ ...snapshot, problem:'booking cards missing or clipped' });
      if (snapshot.scrollWidth > snapshot.viewport + 1 || snapshot.cardLeft < -1 || snapshot.cardRight > snapshot.viewport + 1) failures.push({ ...snapshot, problem:'horizontal overflow' });
      if (!snapshot.primaryVisible) failures.push({ ...snapshot, problem:'primary booking action is hidden' });
      if (output) await page.screenshot({ path:path.resolve(output, `${theme}-${width}.png`), fullPage:true });
    }
  }
  assert.deepEqual(failures, []);
  console.log('Soft feminine themes: PASS at 390/760/1440 on the real Bookings screen.');
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
