import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assets = new Map(await Promise.all(['styles.css', 'client-themes.css', 'theme-catalog.js'].map(async name => [
  `/${name}`,
  await readFile(path.join(root, name), 'utf8'),
])));

const fixture = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="theme-color" content="#fff"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/client-themes.css"><style>*{transition:none!important}</style></head>
<body class="booking-client-page" data-client-theme="sage">
  <main class="booking-card">
    <p class="duration-note">Сеанс длится <strong>1 час</strong>.</p>
    <div class="availability-suggestion"><div class="availability-suggestion-icon">+</div><div><strong>Сегодня мест нет</strong><span>Ближайшее окно - завтра, 10:00</span></div><button>Показать это время</button></div>
    <div class="waitlist-cta"><div><strong>Не подходит время?</strong><span>Оставьте заявку, и мастер свяжется с вами.</span></div><button class="secondary-button">Встать в лист ожидания</button></div>
    <div class="actions"><button class="back">Назад</button><button class="primary">Ввести контакты</button></div>
  </main>
  <section class="booking-faq"><div class="booking-faq-heading"><small><span></span>Полезно знать</small><h2>Частые вопросы</h2><p>Ответы перед записью</p></div><div class="booking-faq-list"><details open><summary><span>Можно ли перенести запись?</span><i></i></summary><p>Да, запись можно перенести.</p></details></div></section>
  <script src="/theme-catalog.js"></script>
</body></html>`;

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  response.setHeader('Cache-Control', 'no-store');
  if (assets.has(pathname)) {
    response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
    response.end(assets.get(pathname));
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(fixture);
});

await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const { port } = server.address();
const playwrightModule = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const { chromium } = playwrightModule.chromium ? playwrightModule : playwrightModule.default;
let browser;
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport:{ width:1280, height:1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  const results = await page.evaluate(async () => {
    const parseColor = value => {
      const numbers = value.match(/[\d.]+/g)?.map(Number) || [];
      if (value.startsWith('color(srgb')) return numbers.slice(0, 3).map(item => Math.round(item * 255));
      return numbers.slice(0, 3);
    };
    const luminance = color => {
      const rgb = parseColor(color).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
    };
    const background = element => {
      for (let node = element; node; node = node.parentElement) {
        const value = getComputedStyle(node).backgroundColor;
        if (value && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') return value;
      }
      return 'rgb(255,255,255)';
    };
    const contrast = element => {
      const foreground = luminance(getComputedStyle(element).color);
      const behind = luminance(background(element));
      return (Math.max(foreground, behind) + .05) / (Math.min(foreground, behind) + .05);
    };
    const textSelectors = ['.booking-faq-heading h2', '.booking-faq summary span', '.booking-faq details p', '.availability-suggestion strong', '.availability-suggestion span', '.waitlist-cta strong', '.waitlist-cta span'];
    const surfaceSelectors = ['.booking-card', '.duration-note', '.availability-suggestion', '.waitlist-cta', '.booking-faq', '.booking-faq details'];
    const results = [];
    for (const theme of window.MinutaThemeCatalog.themes) {
      window.MinutaThemeCatalog.applyClientTheme(document.body, theme.key);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      results.push({
        key:theme.key,
        dark:theme.palette.dark,
        matchedDetailsTheme:document.querySelector('.booking-faq details').matches('.booking-client-page[data-client-theme] .booking-faq details[open]'),
        hasThemeRule:[...document.styleSheets].some(sheet => [...sheet.cssRules].some(rule => rule.selectorText?.includes('.booking-faq details[open]') && rule.selectorText?.includes('[data-client-theme]'))),
        text:textSelectors.map(selector => ({ selector, ratio:contrast(document.querySelector(selector)), color:getComputedStyle(document.querySelector(selector)).color, background:background(document.querySelector(selector)) })),
        surfaces:surfaceSelectors.map(selector => ({ selector, background:background(document.querySelector(selector)), luminance:luminance(background(document.querySelector(selector))) })),
      });
    }
    return results;
  });

  const forbiddenLegacyColors = new Set(['rgb(23, 61, 45)', 'rgb(36, 95, 67)', 'rgb(22, 59, 41)']);
  for (const theme of results) {
    for (const item of theme.text) {
      assert.ok(item.ratio >= 4.5, `${theme.key} ${item.selector}: contrast ${item.ratio.toFixed(2)} is below 4.5 (${item.color} on ${item.background}); matched=${theme.matchedDetailsTheme}; rule=${theme.hasThemeRule}; surfaces=${JSON.stringify(theme.surfaces)}`);
      if (theme.dark) assert.equal(forbiddenLegacyColors.has(item.color), false, `${theme.key} ${item.selector}: legacy green leaked into dark theme`);
    }
    if (theme.dark) {
      assert.equal(theme.matchedDetailsTheme, true, `${theme.key}: themed FAQ selector must match`);
      assert.equal(theme.hasThemeRule, true, `${theme.key}: themed FAQ rule must load`);
      for (const item of theme.surfaces) assert.ok(item.luminance < .24, `${theme.key} ${item.selector}: light surface leaked into dark theme (${item.background})`);
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Client theme visual parity checks passed for ${results.length} themes, including dark surfaces and readable text.`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
