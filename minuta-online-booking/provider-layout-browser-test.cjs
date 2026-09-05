// Read-only layout fixtures. Run with Playwright available in NODE_PATH.
// MINUTA_CHROME_PATH selects a browser; MINUTA_LAYOUT_OUTPUT keeps reports/screenshots.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = __dirname;
const source = fs.readFileSync(path.join(root, 'provider.js'), 'utf8');
const keys = name => [...source.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`))[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const layouts = keys('PROVIDER_LAYOUT_KEYS');
const themes = keys('PROVIDER_THEME_KEYS');
const widths = (process.env.MINUTA_LAYOUT_WIDTHS || '320,390,760,768,1024,1440').split(',').map(Number);
const output = process.env.MINUTA_LAYOUT_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  response.setHeader('Content-Type', ({ '.html':'text/html; charset=utf-8', '.css':'text/css', '.svg':'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  response.end(content);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless:true, ...(process.env.MINUTA_CHROME_PATH ? { executablePath:process.env.MINUTA_CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + '/provider.html');
    await page.addStyleTag({ content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot').remove();
      document.querySelector('#dashboard').hidden = false;
      document.body.dataset.providerTextScale = 'large';
      document.querySelector('#sidebarName').textContent = 'Александра Константинопольская';
      document.querySelectorAll('#notificationBadge,#waitlistBadge').forEach(element => { element.hidden = false; element.textContent = '12'; });
      document.querySelector('#scheduleDatePicker').value = '2026-09-06';
      document.querySelector('#selectedDateTitle').textContent = 'Воскресенье, 6 сентября';
      document.querySelector('#selectedDateSummary').textContent = 'Проверка оформления · тестовые данные';
      document.querySelector('#providerBookings').className = 'schedule-list';
      document.querySelector('#providerBookings').innerHTML = '<div class="provider-empty"><strong>На этот день записей нет</strong><small>Свободное время доступно для записи</small></div>';
      document.querySelector('#dateStrip').innerHTML = Array.from({ length:7 }, (_, i) => `<button type="button" class="${i === 6 ? 'active' : ''}" data-booking-date="2026-09-0${i+1}"><span>${['Пн','Вт','Ср','Чт','Пт','Сб','Сегодня'][i]}</span><strong>${i+1}</strong><small>сент</small></button>`).join('');
      document.querySelectorAll('.settings-layout > *').forEach(element => element.hidden = !element.querySelector('[name="providerLayout"]'));
    });
    const results = [];
    for (const width of widths) {
      await page.setViewportSize({ width, height:1000 });
      for (const layout of layouts) for (const theme of themes) for (const panel of ['bookings','schedule','settings']) {
        const measured = await page.evaluate(async ({ layout, theme, panel }) => {
          document.body.dataset.providerLayout = layout;
          document.body.dataset.providerTheme = theme;
          document.querySelectorAll('.provider-view').forEach(element => element.hidden = element.dataset.providerPanel !== panel);
          window.scrollTo(0, 0);
          await new Promise(requestAnimationFrame);
          const elements = [...document.querySelectorAll('.provider-view:not([hidden]) > *, .provider-view:not([hidden]) .schedule-card > *, .provider-view:not([hidden]) .schedule-settings-layout > *')].filter(element => element.checkVisibility());
          const outside = elements.map(element => ({ selector:element.id || element.className, rect:element.getBoundingClientRect() })).filter(({ rect }) => rect.right > innerWidth + 2 || rect.left < -2).map(({selector,rect}) => ({ selector, left:Math.round(rect.left), right:Math.round(rect.right) }));
          const title = document.querySelector('.provider-topbar h1');
          const font = title ? getComputedStyle(title) : null;
          const choices = [...document.querySelectorAll('.provider-layout-option')].map(element => ({ heading:parseFloat(getComputedStyle(element.querySelector('strong')).fontSize), description:parseFloat(getComputedStyle(element.querySelector('small')).fontSize) }));
          const listHeight = document.querySelector('#providerBookings').getBoundingClientRect().height;
          const clippedNav = innerWidth > 760 && [...document.querySelectorAll('.provider-nav button>span:nth-child(2)')].some(element => element.scrollWidth > element.clientWidth + 2);
          return { pageOverflow:document.documentElement.scrollWidth > innerWidth + 2, outside, titleWordBreak:font?.overflowWrap, choices, listHeight, clippedNav };
        }, { layout, theme, panel });
        results.push({ width, layout, theme, panel, ...measured });
        if (output && theme === 'sage' && panel === 'bookings' && [390,768,1440].includes(width)) await page.screenshot({ path:path.join(output, `${layout}-${width}.png`) });
        if (output && theme === 'sage' && panel === 'settings' && layout === 'soft' && width === 390) await page.screenshot({ path:path.join(output, 'settings-soft-390.png') });
      }
      console.log(`Layout matrix: ${width}px checked`);
    }
    const failures = results.filter(result => result.pageOverflow || result.outside.length || result.choices.some(choice => choice.heading < choice.description)
      || result.clippedNav || (result.width > 760 && result.width <= 1100 && result.titleWordBreak !== 'normal')
      || (result.layout === 'split' && result.panel === 'bookings' && result.width > 1100 && result.listHeight >= 720));
    if (output) fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, failures }, null, 2));
    console.log(`${results.length} layout/theme/viewport/panel checks; failures: ${failures.length}`);
    console.log(JSON.stringify(failures.slice(0, 3)));
    assert.equal(failures.length, 0, 'Published-layout regression: overflow or inverted typography');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
