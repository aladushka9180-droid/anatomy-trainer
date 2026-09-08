import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { themes } from './theme-card-fixture.mjs';

const base = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
let html = await readFile(path.join(base, 'provider.html'), 'utf8');
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*Content-Security-Policy[^>]*>/gi, '');
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html;charset=utf-8'); response.end(html); return; }
    const file = path.resolve(base, `.${pathname}`);
    if (!file.startsWith(base)) throw new Error('unsafe path');
    response.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
    response.end(await readFile(file));
  } catch { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const playwrightModule = process.env.MINUTA_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule.startsWith('.') || path.isAbsolute(playwrightModule) ? pathToFileURL(playwrightModule).href : playwrightModule);
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  const page = await browser.newPage({ viewport:{ width:390, height:900 } });
  await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.evaluate(() => {
    document.documentElement.className = 'provider-ready';
    document.querySelector('#providerBoot').hidden = true;
    document.body.dataset.providerLayout = 'soft';
    document.body.dataset.providerTextScale = 'default';
    for (const section of document.querySelectorAll('.provider-main > section')) section.hidden = section.id !== 'dashboard';
    document.querySelector('#dashboard').hidden = false;
    for (const panel of document.querySelectorAll('[data-provider-panel]')) panel.hidden = panel.dataset.providerPanel !== 'analytics';
    const analytics = document.querySelector('#analyticsView');
    analytics.dataset.reportTab = 'overview';
    analytics.dataset.reportEmpty = 'false';
    analytics.dataset.reportSource = 'own';
    document.querySelector('#reportDataSource').hidden = false;
    document.querySelector('#reportComparison').hidden = false;
    const values = {
      reportFilterSummary:'30 дней · Вся команда', reportPeriodLabel:'10 августа — 8 сентября 2026 · Вся команда',
      reportCommandNarrative:'Поступления выросли. У трёх визитов нужно уточнить результат.', reportHeroRevenue:'191 100 ₽',
      reportHeroRevenueTrend:'Оплата указана для 56 из 59 визитов', reportCompleted:'59', reportWorkload:'76 часов работы',
      reportHeroUtilization:'68%', reportHeroUtilizationNote:'По рабочему времени', reportPlanProgress:'64%',
      reportPlanProgressNote:'Из цели 300 000 ₽', reportForecast:'278 000 ₽', reportForecastTrend:'250 000–292 000 ₽ · средняя уверенность',
      reportHealthScore:'76', reportHealthLabel:'Хорошее состояние', reportAverage:'3 239 ₽', reportPending:'3',
      reportComparisonCaption:'10 июля — 8 августа'
    };
    for (const [id, value] of Object.entries(values)) { const element = document.getElementById(id); if (element) element.textContent = value; }
    document.querySelector('#reportSmartActions').innerHTML = [
      ['Завершить визиты','3 записи без результата','pending'],
      ['Уточнить оплаты','У 3 визитов не указана оплата','payment-unknown'],
      ['Вернуть клиентов','8 клиентов давно не записывались','clients']
    ].map(([title,text,action]) => `<article class="report-smart-action is-attention"><span>!</span><div><strong>${title}</strong><small>${text}</small><i>Проверено по выбранному периоду</i><b>Откроем нужные записи</b></div><button type="button" data-report-action="${action}">Проверить →</button></article>`).join('') + '<button class="report-actions-toggle" type="button" data-report-actions-toggle aria-expanded="false">Ещё 2</button>';
  });

  const failures = [];
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:1000 });
    for (const theme of themes) {
      await page.evaluate(value => { document.body.dataset.providerTheme = value; window.scrollTo(0, 0); }, theme);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.evaluate(() => {
        const visible = element => {
          if (!element || !element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false;
          const closed = element.closest('details:not([open])');
          return !closed || element === closed || element.parentElement === closed && element.matches('summary');
        };
        const analytics = document.querySelector('#analyticsView');
        const rect = analytics.getBoundingClientRect();
        const overflowing = [...analytics.querySelectorAll('*')].filter(element => visible(element)
          && !element.closest('.report-periods,.report-heatmap,.report-comparison-list')
          && element.getBoundingClientRect().right > innerWidth + 2);
        return {
          pageOverflow:document.documentElement.scrollWidth > innerWidth + 1,
          panelOverflow:rect.right > innerWidth + 2,
          overflowing:overflowing.slice(0, 3).map(element => element.id || String(element.className)),
          demoVisible:visible(document.querySelector('[data-report-source="demo"]')),
          visibleKpis:[...document.querySelectorAll('.report-command-metrics > article')].filter(visible).length,
          visibleActions:[...document.querySelectorAll('#reportSmartActions > .report-smart-action')].filter(visible).length,
          detailsClosed:![...document.querySelectorAll('.report-period-details,.report-analytics-details')].some(element => element.open)
        };
      });
      if (metrics.pageOverflow || metrics.panelOverflow || metrics.overflowing.length || !metrics.demoVisible || metrics.visibleKpis !== 3 || metrics.visibleActions !== 1 || !metrics.detailsClosed) {
        failures.push({ width, theme, ...metrics });
      }
    }
  }
  assert.deepEqual(failures, [], `Ошибки статистики в матрице тем: ${JSON.stringify(failures.slice(0, 8))}`);
  console.log(`Statistics visual matrix passed: ${themes.length} themes × 3 widths.`);
} finally {
  await browser.close();
  server.close();
}
