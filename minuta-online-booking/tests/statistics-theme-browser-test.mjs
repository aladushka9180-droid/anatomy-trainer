import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
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
const output = process.env.MINUTA_STATISTICS_OUTPUT ? path.resolve(process.env.MINUTA_STATISTICS_OUTPUT) : '';
if (output) await mkdir(output, { recursive:true });

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
    document.querySelector('#reportUtmFunnelState').hidden = true;
    document.querySelector('#reportUtmFunnelStages').hidden = false;
    document.querySelector('#reportUtmFunnelStages').innerHTML = ['Открыли страницу','Выбрали услугу','Посмотрели время','Начали оформление','Создали запись'].map((label,index) => `<article><small>${index + 1}</small><span>${label}</span><strong>0</strong><em>—</em></article>`).join('');
    document.querySelector('#reportUtmFunnelOutcomes').hidden = false;
    document.querySelector('#reportUtmFunnelOutcomes').innerHTML = ['Пришли','Отменили','Не пришли','Оплатили','Получено'].map(label => `<article><small>${label}</small><strong>0</strong></article>`).join('');
    document.querySelector('#reportUtmFunnelSources').hidden = false;
    document.querySelector('#reportUtmFunnelSources').innerHTML = '<aside class="report-utm-test-source"><strong>Виджет онлайн-записи</strong><small>Тестовые переходы с сайта · 3 посещения · не учитываются в показателях</small></aside>';
    const values = {
      reportFilterSummary:'30 дней · Вся команда', reportPeriodLabel:'10 августа — 8 сентября 2026 · Вся команда',
      reportCommandNarrative:'Поступления выросли. У трёх визитов нужно уточнить результат.', reportHeroRevenue:'191 100 ₽',
      reportHeroRevenueTrend:'Оплата указана для 56 из 59 визитов', reportCompleted:'59', reportWorkload:'76 часов работы',
      reportHeroUtilization:'68%', reportHeroUtilizationNote:'По рабочему времени', reportPlanProgress:'64%',
      reportPlanProgressNote:'Из цели 300 000 ₽', reportForecast:'278 000 ₽', reportForecastTrend:'250 000–292 000 ₽ · средняя уверенность',
      reportHealthScore:'76', reportHealthLabel:'Хорошее состояние', reportAverage:'3 239 ₽', reportPending:'3',
      reportComparisonCaption:'10 июля — 8 августа', reportCompletedValue:'191 100 ₽',
      reportPaymentUnknownValue:'18 500 ₽', reportPaymentUnknown:'6 визитов без отметки',
      reportDebt:'4 200 ₽', reportUnpaid:'2 визита с подтверждённым долгом'
    };
    for (const [id, value] of Object.entries(values)) { const element = document.getElementById(id); if (element) element.textContent = value; }
    document.querySelector('#reportSmartActions').innerHTML = [
      ['Завершить визиты','3 записи без результата','pending'],
      ['Уточнить оплаты','У 3 визитов не указана оплата','payment-unknown'],
      ['Вернуть клиентов','8 клиентов давно не записывались','clients']
    ].map(([title,text,action]) => `<article class="report-smart-action is-attention"><span>!</span><div><strong>${title}</strong><small>${text}</small><i>Проверено по выбранному периоду</i><b>Откроем нужные записи</b></div><button type="button" data-report-action="${action}">Проверить →</button></article>`).join('') + '<button class="report-actions-toggle" type="button" data-report-actions-toggle aria-expanded="false">Ещё 2</button>';
    document.querySelector('#reportHeatmap').innerHTML = [3, 16, 36, 58]
      .map((heat, index) => index ? `<button class="report-heatmap-cell${index === 3 ? ' is-peak' : ''}" type="button" style="--heat:${heat}%"><i>${index * 6} ч</i></button>` : `<span class="report-heatmap-cell" style="--heat:${heat}%"><i>—</i></span>`).join('');
    document.querySelector('#reportHeatmapLegend').hidden = false;
    document.querySelector('#reportTrendTitle').textContent = 'Фактически получено по неделям';
    document.querySelector('#reportTrendTotal').textContent = '10 300 ₽';
    document.querySelector('#reportTrendCoverage').textContent = 'Оплата указана у 3 из 49 визитов';
    document.querySelector('#reportTrendCoverage').classList.add('is-incomplete');
    document.querySelector('#reportRevenueChart').innerHTML = [
      ['Нет данных','10–16 авг','is-unknown',0],
      ['Нет визитов','17–23 авг','is-empty',0],
      ['Нет визитов','24–30 авг','is-empty',0],
      ['7 300 ₽','31 авг–6 сент','is-best is-selected',100],
      ['3 000 ₽','7–8 сент','',41]
    ].map(([value,label,state,height], index) => `<button class="report-chart-column ${state}" type="button" data-report-trend-bucket aria-pressed="${index === 3}"><b>${value}</b><span aria-hidden="true"><i style="height:${height}%"></i></span><small>${label}</small></button>`).join('');
    const trendDetail = document.querySelector('#reportTrendDetail');
    trendDetail.hidden = false;
    trendDetail.innerHTML = '<div><small>31 авг.–6 сент.</small><strong>7 300 ₽</strong><p>Данные об оплате заполнены полностью: 2 из 2.</p></div><button class="secondary-button report-trend-open" type="button">Открыть записи периода</button>';
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
          && !element.closest('.report-periods,.report-heatmap,.report-comparison-list,.report-chart')
          && element.getBoundingClientRect().right > innerWidth + 2);
        const detailsClosed = ![...document.querySelectorAll('.report-period-details,.report-analytics-details')].some(element => element.open);
        const analyticsDetails = document.querySelector('.report-analytics-details');
        analyticsDetails.open = true;
        const utmCard = document.querySelector('#reportUtmFunnelCard');
        const utmState = document.querySelector('#reportUtmFunnelState');
        const utmParts = [...utmCard.querySelectorAll('#reportUtmFunnelStages,#reportUtmFunnelOutcomes,#reportUtmFunnelSources,.report-utm-test-source')].filter(visible);
        const testSource = document.querySelector('.report-utm-test-source');
        const comparison = document.querySelector('#reportComparison');
        const comparisonList = comparison.querySelector('.report-comparison-list');
        const comparisonCards = [...comparisonList.children];
        const within = (child, parent) => child.getBoundingClientRect().right <= parent.getBoundingClientRect().right + 2;
        const heatmap = document.querySelector('#reportHeatmap');
        const heatColors = [...heatmap.querySelectorAll('.report-heatmap-cell')].map(element => getComputedStyle(element).backgroundColor);
        const visualGrid = document.querySelector('.report-visual-grid');
        const funnel = document.querySelector('#reportFunnel');
        const visualGridOverflow = visualGrid.getBoundingClientRect().right > rect.right + 2;
        const funnelOverflow = funnel.getBoundingClientRect().right > rect.right + 2;
        const heatmapOverflow = heatmap.getBoundingClientRect().right > rect.right + 2;
        const visualGridWidth = Math.round(visualGrid.getBoundingClientRect().width);
        const analyticsWidth = Math.round(rect.width);
        const heatLegendVisible = visible(document.querySelector('#reportHeatmapLegend'));
        const trend = document.querySelector('.report-trend');
        const chart = document.querySelector('#reportRevenueChart');
        const chartTracks = [...chart.querySelectorAll('.report-chart-column > span')];
        const chartLabels = [...chart.querySelectorAll('.report-chart-column > small')];
        const trendDetail = document.querySelector('#reportTrendDetail');
        const trendAction = trendDetail.querySelector('.report-trend-open');
        const trendCopy = trendDetail.querySelector(':scope > div');
        analytics.dataset.reportTab = 'money';
        const summary = analytics.querySelector('.report-summary[data-report-section="money"]');
        const summaryCards = [...summary.children].filter(visible);
        const summaryOverflow = summary.getBoundingClientRect().right > innerWidth + 2
          || summaryCards.some(element => element.getBoundingClientRect().right > innerWidth + 2);
        const summaryLabels = summaryCards.map(element => element.querySelector('small')?.textContent?.trim() || '');
        const summaryTracks = getComputedStyle(summary).gridTemplateColumns.split(' ').length;
        analytics.dataset.reportTab = 'overview';
        analyticsDetails.open = false;
        return {
          pageOverflow:document.documentElement.scrollWidth > innerWidth + 1,
          panelOverflow:rect.right > innerWidth + 2,
          overflowing:overflowing.slice(0, 3).map(element => element.id || String(element.className)),
          demoVisible:visible(document.querySelector('[data-report-source="demo"]')),
          visibleKpis:[...document.querySelectorAll('.report-command-metrics > article')].filter(visible).length,
          visibleActions:[...document.querySelectorAll('#reportSmartActions > .report-smart-action')].filter(visible).length,
          detailsClosed,
          utmOverflow:utmCard.scrollWidth > utmCard.clientWidth + 1 || utmParts.some(element => element.scrollWidth > element.clientWidth + 1 || !within(element, utmCard)),
          testSourceText:testSource?.textContent?.trim() || '',
          rawTestLabels:utmCard.textContent.includes('primetime_external_test') || utmCard.textContent.includes('booking_widget') || utmCard.textContent.includes('embed'),
          comparisonOverflow:comparison.scrollWidth > comparison.clientWidth + 1 || comparisonList.scrollWidth > comparisonList.clientWidth + 1 || comparisonCards.some(card => !within(card, comparisonList)),
          comparisonTracks:getComputedStyle(comparisonList).gridTemplateColumns.split(' ').length,
          visualGridOverflow,
          funnelOverflow,
          heatmapOverflow,
          visualGridWidth,
          analyticsWidth,
          heatLegendVisible,
          heatColorSteps:new Set(heatColors).size,
          heatButtons:heatmap.querySelectorAll('button.report-heatmap-cell').length,
          heatHint:document.querySelector('#reportHeatmapLegend small')?.textContent?.trim() || '',
          trendOverflow:trend.getBoundingClientRect().right > innerWidth + 2,
          chartHeight:Math.round(chart.getBoundingClientRect().height),
          defaultChartOverflow:chart.scrollWidth > chart.clientWidth + 1,
          chartLabelOverflow:chartLabels.some(label => label.scrollWidth > label.clientWidth + 1 || label.getBoundingClientRect().right > label.parentElement.getBoundingClientRect().right + 1),
          chartTracksTransparent:chartTracks.every(element => getComputedStyle(element).backgroundColor === 'rgba(0, 0, 0, 0)'),
          trendDetailOverflow:trendDetail.getBoundingClientRect().right > trend.getBoundingClientRect().right + 2,
          trendActionTooWide:innerWidth > 760 && trendAction.getBoundingClientRect().width > trendDetail.getBoundingClientRect().width * .5,
          trendCopyTooNarrow:innerWidth > 760 && trendCopy.getBoundingClientRect().width < 220,
          summaryOverflow,
          summaryLabels,
          summaryTracks
        };
      });
      const expectedChartHeight = width <= 760 ? 168 : 210;
      const expectedSummaryTracks = width <= 760 ? 2 : 3;
      const expectedComparisonTracks = width <= 760 ? 2 : 4;
      if (metrics.pageOverflow || metrics.panelOverflow || metrics.overflowing.length || !metrics.demoVisible || metrics.visibleKpis !== 3 || metrics.visibleActions !== 1 || !metrics.detailsClosed || metrics.utmOverflow || metrics.testSourceText !== 'Виджет онлайн-записиТестовые переходы с сайта · 3 посещения · не учитываются в показателях' || metrics.rawTestLabels || metrics.comparisonOverflow || metrics.comparisonTracks !== expectedComparisonTracks || metrics.visualGridOverflow || metrics.funnelOverflow || metrics.heatmapOverflow || !metrics.heatLegendVisible || metrics.heatColorSteps !== 4 || metrics.heatButtons !== 3 || !metrics.heatHint || metrics.trendOverflow || metrics.chartHeight !== expectedChartHeight || metrics.defaultChartOverflow || metrics.chartLabelOverflow || !metrics.chartTracksTransparent || metrics.trendDetailOverflow || metrics.trendActionTooWide || metrics.trendCopyTooNarrow || metrics.summaryOverflow || metrics.summaryLabels.join('|') !== 'Стоимость оказанных услуг|Оплата не указана|Подтверждённый долг' || metrics.summaryTracks !== expectedSummaryTracks) {
        failures.push({ width, theme, ...metrics });
      }
      if (output && theme === 'warm') await page.screenshot({ path:path.join(output, `statistics-screen-${width}.png`), fullPage:true });
      if (output && theme === 'warm') await page.locator('.report-trend').screenshot({ path:path.join(output, `weekly-revenue-${width}.png`) });
      if (output && theme === 'warm') {
        await page.evaluate(() => { document.querySelector('.report-analytics-details').open = true; });
        await page.locator('#reportUtmFunnelCard').screenshot({ path:path.join(output, `utm-test-traffic-${width}.png`) });
        await page.evaluate(() => { document.querySelector('.report-analytics-details').open = false; });
        await page.evaluate(() => { document.querySelector('#analyticsView').dataset.reportTab = 'money'; });
        await page.locator('.report-summary[data-report-section="money"]').screenshot({ path:path.join(output, `payment-separation-${width}.png`) });
        await page.evaluate(() => { document.querySelector('#analyticsView').dataset.reportTab = 'overview'; });
      }
    }
  }
  assert.deepEqual(failures, [], `Ошибки статистики в матрице тем: ${JSON.stringify(failures.slice(0, 8))}`);
  console.log(`Statistics visual matrix passed: ${themes.length} themes × 3 widths.`);
} finally {
  await browser.close();
  server.close();
}
