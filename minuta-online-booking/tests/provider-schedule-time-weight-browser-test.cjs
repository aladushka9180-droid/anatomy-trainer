const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'provider.html'), 'utf8');
const themes = [...html.matchAll(/name="providerTheme" value="([^"]+)"/g)].map(match => match[1]);
assert.equal(themes.length, 40);
const output = process.env.MINUTA_SCHEDULE_TIME_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });

const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end();
    return;
  }
  const type = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' }[path.extname(file)];
  response.setHeader('Content-Type', type || 'application/octet-stream');
  const content = fs.readFileSync(file);
  response.end(file.endsWith('.html') ? content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') : content);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.MINUTA_CHROME_PATH });
    const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
    await page.goto(`http://127.0.0.1:${server.address().port}/provider.html`);
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      const dashboard = document.querySelector('#dashboard');
      dashboard.hidden = false;
      dashboard.dataset.activeView = 'bookings';
      document.body.dataset.providerLayout = 'soft';
      document.querySelector('#dateStrip').hidden = true;
      const holder = document.querySelector('#providerBookings');
      holder.className = 'provider-bookings timeline-view';
      holder.innerHTML = `<div class="day-timeline" style="--timeline-height:400px">
        <div class="timeline-hours"><span class="timeline-hour" style="top:0">10:00</span></div>
        <div class="timeline-stage" style="--timeline-height:400px">
          <button class="timeline-booking status-confirmed color-auto" data-mobile-timeline-top="78" style="top:78px;height:72px">
            <span class="timeline-booking-time"><b>11:00</b><small>–12:00</small></span>
            <span class="timeline-booking-copy"><strong>Массаж спины</strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">11:00–12:00 · </span>Сергей</small></span></span>
          </button>
          <button class="timeline-booking status-block automatic-break" data-mobile-timeline-top="154" style="top:154px;height:72px">
            <span class="timeline-booking-time"><b>12:00</b><small>–13:00</small></span>
            <span class="timeline-booking-copy"><strong>Автоперерыв</strong><span class="timeline-booking-client-row"><small class="timeline-booking-client"><span class="timeline-mobile-time">12:00–13:00</span></small></span></span>
          </button>
        </div>
      </div>`;
    });

    for (const width of [1440, 760, 390]) {
      await page.setViewportSize({ width, height:900 });
      for (const theme of themes) {
        await page.evaluate(value => { document.body.dataset.providerTheme = value; }, theme);
        const result = await page.evaluate(() => ({
          rows:[...document.querySelectorAll('.timeline-booking')].map(card => ({
            start:getComputedStyle(card.querySelector('.timeline-booking-time b')).fontWeight,
            end:getComputedStyle(card.querySelector('.timeline-booking-time small')).fontWeight,
            mobile:getComputedStyle(card.querySelector('.timeline-mobile-time')).fontWeight,
            mobileVisible:getComputedStyle(card.querySelector('.timeline-mobile-time')).display !== 'none'
          })),
          overflow:document.documentElement.scrollWidth > innerWidth + 2
        }));
        assert.equal(result.overflow, false, `${theme}/${width}: horizontal overflow`);
        for (const row of result.rows) {
          if (width > 760) {
            assert.equal(row.start, '600', `${theme}: desktop start time weight`);
            assert.equal(row.end, '600', `${theme}: desktop end time weight`);
          } else {
            assert.equal(row.mobile, '600', `${theme}/${width}: mobile range weight`);
            assert.equal(row.mobileVisible, true, `${theme}/${width}: mobile range hidden`);
          }
        }
        if (output && theme === 'warm' && [1440, 390].includes(width)) {
          await page.screenshot({ path:path.join(output, `warm-${width}.png`) });
        }
      }
    }
    console.log('Provider schedule time weight: 40 themes x 390/760/1440, record and automatic break OK');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
