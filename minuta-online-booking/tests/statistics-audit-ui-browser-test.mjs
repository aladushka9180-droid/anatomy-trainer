import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const auditStyles = readFileSync(new URL('../statistics-audit-ui.css', import.meta.url), 'utf8');
const providerUxStyles = readFileSync(new URL('../provider-ux.css', import.meta.url), 'utf8');
const signatureStyles = readFileSync(new URL('../provider-themes-signature.css', import.meta.url), 'utf8');
const auditScript = readFileSync(new URL('../statistics-audit-ui.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  for (const width of [360, 390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.route('**/*', route => route.abort());
    await page.goto('about:blank');
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      const report = parsed.querySelector('#analyticsView');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'soft';
      document.body.style.margin = '0';
      document.body.style.padding = '12px';
      document.body.append(document.importNode(report, true));
      const root = document.querySelector('#analyticsView');
      root.hidden = false;
      root.dataset.reportTab = 'clients';
      root.dataset.reportEmpty = 'false';
      root.dataset.reportLoadState = 'ready';
      root.querySelector('.report-filters').classList.add('is-open');
      root.querySelector('.report-analytics-details').open = true;
      root.querySelector('.report-health-details').open = true;
      root.querySelector('#reportPaymentRateNote').textContent = '46 из 46 визитов; финансовая оценка доступна от 80%';
      root.querySelector('#reportSmartActions').innerHTML = '<article class="report-smart-action is-money"><span>!</span><div><strong>Проверить оплаты</strong><small>Подтверждённый долг 5 995 ₽</small><i>Оплачено 96% стоимости услуг</i></div><button type="button">Проверить →</button></article><button class="report-actions-toggle" type="button">Ещё 2</button>';
      root.querySelector('#reportFunnel').innerHTML = '<article><div><span>1</span><strong>Все записи</strong><b>53</b><small>Все записи периода</small></div><i></i></article>';
      root.querySelector('#reportHeatmapLegend').hidden = false;
      root.querySelector('#reportHeatmap').innerHTML = '<span class="report-heatmap-corner"></span>'
        + Array.from({ length:7 }, (_, i) => `<b>${i + 1}</b>`).join('')
        + '<strong>10:00</strong>' + Array.from({ length:7 }, () => '<button class="report-heatmap-cell"><i>5</i></button>').join('');
      root.querySelector('#reportRevenueChart').innerHTML = Array.from({ length:5 }, (_, i) => `<button class="report-chart-column"><b>${(i + 1) * 1000} ₽</b><span></span><small>${i + 1}–${i + 7} сент</small></button>`).join('');
      root.querySelector('#reportReconciliation').innerHTML = '<div><small>Сверка визитов</small><strong>Учебные данные</strong></div><span>Сумма подтверждена</span>';
      root.querySelector('#reportReconciliation').hidden = false;
      root.querySelector('#reportPerformersList').innerHTML = '<button class="report-performer-row" type="button"><span class="report-team-rank">1</span><div class="report-team-person"><strong>Тестовый сотрудник <em>Лидер</em></strong><small>Четыре завершённых визита</small></div><span class="report-team-bar"><i style="width:60%"></i></span><div class="report-performer-value"><b>4 500 ₽</b><small>За выбранный период</small></div><span class="report-team-arrow">→</span></button>';
      for (const [selector, value] of Object.entries({
        '#reportHeroRevenueTrend':'−47% к прошлому периоду',
        '#reportWorkload':'54.3 ч работы',
        '#reportHeroUtilizationNote':'Цель 70%',
        '#reportPlanCaption':'План периода',
        '#reportPlanProgressNote':'Добавьте цель',
        '#reportTrendCoverage':'Оплата указана у 46 из 46 визитов'
      })) root.querySelector(selector).textContent = value;
      document.querySelector('#reportUniqueClients').textContent = '2';
      document.querySelector('#reportNewClients').textContent = '1';
      document.querySelector('#reportReturningClients').textContent = '1';
    }, html);
    await page.addStyleTag({ content:styles });
    await page.addStyleTag({ content:auditStyles });
    await page.addStyleTag({ content:providerUxStyles });
    await page.addStyleTag({ content:signatureStyles });
    await page.addScriptTag({ content:auditScript });
    await page.evaluate(() => {
      const first = { client_name:'<img src=x onerror=alert(1)>', client_phone:'79991111111', booking_date:'2026-09-02', booking_time:'10:00' };
      const firstAgain = { ...first, booking_date:'2026-09-10', booking_time:'12:00' };
      const second = { client_name:'Мария', client_phone:'79992222222', booking_date:'2026-09-03', booking_time:'10:00' };
      window.auditTest = { scope:{ session:1, organization:'org-1', source:'own', role:'owner', locations:[{id:'branch-a',name:'Первый филиал'}], start:'2026-09-01', end:'2026-09-30', performer:'all', performerName:'Вся команда', status:'ready' }, downloads:[] };
      window.auditTest.retention = {scope:{organization:'org-1',role:'owner',session:1,revision:1,organizationName:'Учебная организация'},
        segments:MinutaStatisticsAuditUI.buildRetentionSegments([
          {client_account_id:'client-a',client_name:'Анна <script>',completed_visits:4,eligible:true,consent_status:'granted',last_visit_on:'2026-09-10'},
          {client_account_id:'client-b',client_name:'Мария',completed_visits:1,eligible:true,consent_status:'granted',last_visit_on:'2026-09-11'},
          {client_account_id:'client-c',client_name:'Ольга',completed_visits:3,eligible:false,consent_status:'unknown',last_visit_on:'2026-09-12'},
          {client_account_id:'client-d',client_name:'Отказ от связи',completed_visits:5,eligible:true,consent_status:'revoked'}
        ])};
      window.auditTest.legacyDownloads = 0;
      window.auditTest.legacyDateSubmits = 0;
      document.querySelector('#exportBookings').addEventListener('click', () => document.querySelector('#reportExportDialog').showModal());
      for (const button of document.querySelectorAll('[data-report-export]')) button.addEventListener('click', () => { window.auditTest.legacyDownloads += 1; });
      document.querySelector('#reportCustomPeriod').addEventListener('submit', event => { event.preventDefault(); window.auditTest.legacyDateSubmits += 1; });
      window.auditController = window.MinutaStatisticsAuditUI.create({
        document,
        getScope:() => window.auditTest.scope,
        getRetentionSegments:() => window.auditTest.retention,
        getSegments:() => window.MinutaStatisticsAuditUI.buildClientSegments({ completed:[first,firstAgain,second], history:[{ client_phone:'79992222222' }], identityFor:item => item.client_phone }),
        download:(format,privacy) => window.auditTest.downloads.push({ format,privacy,
          location:document.querySelector('#reportExportLocation').value,
          segment:document.querySelector('#reportExportSegment').value })
      });
      window.auditController.mount();
    });
    for (const [kind,names] of [['eligible',['Анна <script>','Мария']],['regular',['Анна <script>']],['unknownConsent',['Ольга']]]) {
      await page.locator(`[data-report-retention-segment="${kind}"]`).click();
      const dialog=page.locator('.report-segment-dialog');
      assert.deepEqual(await dialog.locator('.report-audit-list article strong').allTextContents(),names);
      assert.equal(await dialog.locator('a,input,script').count(),0,'Read-only lists contain no contact or send actions');
      assert.match(await dialog.locator('.report-audit-scope').textContent(),/Все филиалы.*не применяются/);
      assert.match(await dialog.locator('.report-audit-count').textContent(),/только просмотр/);
      if(process.env.MINUTA_SCREENSHOT_DIR) await dialog.screenshot({path:`${process.env.MINUTA_SCREENSHOT_DIR}/retention-${kind}-${width}.png`});
      await dialog.locator('[data-audit-close]').click();
    }
    await page.locator('[data-report-retention-segment="eligible"]').click();
    await page.evaluate(()=>{auditTest.scope.session=2;auditController.refresh();});
    assert.equal(await page.locator('.report-segment-dialog').isVisible(),false,'Session change immediately closes the old list');
    assert.equal(await page.locator('.report-segment-dialog .report-audit-list article').count(),0);
    assert.equal(await page.locator('[data-report-retention-segment="eligible"]').isDisabled(),true);
    await page.evaluate(()=>{auditTest.scope.session=1;auditController.refresh();});
    const retentionLayout = await page.evaluate(() => ({
      available:document.querySelector('.report-retention-list').getBoundingClientRect().width,
      consent:document.querySelector('[data-report-retention-segment="unknownConsent"]').getBoundingClientRect().width
    }));
    assert.ok(retentionLayout.consent >= retentionLayout.available * .95, 'Unknown-consent card keeps its original full-row width');
    assert.equal(await page.locator('.report-segment-button').count(), 3);
    await page.locator('[data-report-segment="new"]').click();
    assert.match(await page.locator('.report-segment-dialog').innerText(), /1 клиент/);
    assert.match(await page.locator('.report-segment-dialog').innerText(), /визитов 2/);
    assert.equal(await page.locator('.report-segment-dialog img').count(), 0, 'client name is text');
    assert.doesNotMatch(await page.locator('.report-segment-dialog').innerText(), /79991111111/);
    await page.locator('.report-segment-dialog [data-audit-close]').click();
    await page.locator('#exportBookings').click();
    assert.match(await page.locator('#reportExportDialog .report-audit-scope').innerText(), /01.09.2026 — 30.09.2026 · Вся команда/);
    assert.match(await page.locator('#reportExportScopeNote').innerText(), /Импортированные визиты без филиала включены/);
    await page.locator('#reportExportLocation').selectOption('branch-a');
    await page.locator('#reportExportSegment').selectOption('new');
    assert.match(await page.locator('#reportExportScopeNote').innerText(), /исключены из отчёта выбранного филиала/);
    assert.equal(await page.locator('#reportExportDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${width}px export dialog overflow`);
    if (process.env.REPORT_EXPORT_SCREENSHOT_DIR) {
      mkdirSync(process.env.REPORT_EXPORT_SCREENSHOT_DIR, { recursive:true });
      await page.locator('#reportExportDialog').screenshot({ path:path.join(process.env.REPORT_EXPORT_SCREENSHOT_DIR, `export-dialog-${width}.png`) });
    }
    await page.locator('#reportExportPrivacy').selectOption('full');
    await page.locator('[data-report-export="csv"]').click();
    assert.match(await page.locator('.report-export-review .report-audit-scope').innerText(), /Филиал: Первый филиал · Сегмент: Новые/);
    assert.match(await page.locator('.report-export-review .report-audit-scope-note').innerText(), /Импортированные визиты без филиала исключены/);
    assert.equal(await page.locator('.report-export-review').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `${width}px export review overflow`);
    if (process.env.REPORT_EXPORT_SCREENSHOT_DIR) await page.locator('.report-export-review').screenshot({ path:path.join(process.env.REPORT_EXPORT_SCREENSHOT_DIR, `export-review-${width}.png`) });
    await page.locator('.report-export-review [data-audit-confirm]').click();
    assert.equal(await page.evaluate(() => window.auditTest.downloads.length), 0, 'full phones require confirmation');
    await page.locator('.report-export-review input[type="checkbox"]').check();
    await page.locator('.report-export-review [data-audit-confirm]').click();
    assert.deepEqual(await page.evaluate(() => window.auditTest.downloads), [{ format:'csv', privacy:'full', location:'branch-a', segment:'new' }]);
    assert.equal(await page.evaluate(() => window.auditTest.legacyDownloads), 0, 'old direct export listener is intercepted');
    await page.evaluate(() => { window.auditTest.scope = { ...window.auditTest.scope, role:'specialist' }; });
    await page.locator('#exportBookings').click();
    assert.equal(await page.locator('#reportExportPrivacy option[value="full"]').evaluate(el => el.disabled), true, 'specialist cannot select full phones');
    await page.evaluate(() => { document.querySelector('#reportExportPrivacy').value = 'full'; });
    await page.locator('[data-report-export="csv"]').click();
    assert.equal(await page.locator('.report-export-review').count(), 1);
    assert.equal(await page.locator('.report-export-review').evaluate(el => el.open), false, 'UI rejects a forced full-phone value for specialist');
    await page.evaluate(() => { window.auditTest.scope = { ...window.auditTest.scope, role:'owner' }; });
    await page.locator('#reportExportDialog [data-close-report-export]').click();
    await page.locator('#exportBookings').click();
    await page.locator('#reportExportLocation').selectOption('all');
    await page.locator('#reportExportSegment').selectOption('all');
    await page.locator('#reportExportPrivacy').selectOption('masked');
    await page.locator('[data-report-export="pdf"]').click();
    assert.match(await page.locator('.report-export-review .report-audit-privacy').innerText(), /не включены/);
    await page.locator('.report-export-review [data-audit-cancel]').click();
    assert.equal(await page.evaluate(() => window.auditTest.downloads.length), 1, 'cancel never downloads');
    await page.locator('#exportBookings').click();
    await page.locator('[data-report-export="xlsx"]').click();
    await page.evaluate(() => { window.auditTest.scope = { ...window.auditTest.scope, performer:'staff-1' }; window.auditController.refresh(); });
    assert.equal(await page.locator('.report-export-review').evaluate(el => el.open), false, 'scope change closes review');
    assert.equal(await page.evaluate(() => window.auditTest.downloads.length), 1);
    await page.evaluate(() => { window.auditTest.scope = { ...window.auditTest.scope, source:'demo' }; });
    await page.locator('#exportBookings').click();
    assert.equal(await page.locator('#reportExportLocation').isDisabled(), true, 'demo cannot request an unsupported branch');
    assert.equal(await page.locator('#reportExportSegment').isDisabled(), true, 'demo cannot request an unsupported segment');
    assert.match(await page.locator('#reportExportScopeNote').innerText(), /В демо выбор филиала и сегмента недоступен/);
    await page.locator('#reportExportDialog [data-close-report-export]').click();
    await page.evaluate(() => { document.querySelector('#reportDateFrom').value = '2026-09-30'; document.querySelector('#reportDateTo').value = '2026-09-01'; document.querySelector('#reportCustomPeriod').requestSubmit(); });
    assert.equal(await page.locator('#reportDateTo').getAttribute('aria-invalid'), 'true');
    assert.match(await page.locator('#reportDateToError').innerText(), /раньше начала/);
    assert.equal(await page.evaluate(() => window.auditTest.legacyDateSubmits), 0, 'invalid dates never reach old handler');
    await page.evaluate(() => { document.querySelector('#reportDateTo').value = '2026-10-01'; });
    assert.equal(await page.evaluate(() => window.auditController.validateCustomDates()), true);
    await page.evaluate(() => document.querySelector('#reportCustomPeriod').requestSubmit());
    assert.equal(await page.evaluate(() => window.auditTest.legacyDateSubmits), 1);
    const layout = await page.evaluate(() => {
      const size = selector => Math.round(document.querySelector(selector).getBoundingClientRect().height);
      const segment = size('.report-segment-button');
      document.querySelector('#analyticsView').dataset.reportTab = 'overview';
      const heatmap = document.querySelector('#reportHeatmap');
      return { segment, period:size('.report-periods button'),
        heatmapOverflow:heatmap.scrollWidth > heatmap.clientWidth + 1,
        pageOverflow:document.documentElement.scrollWidth > innerWidth + 1,
        hint:getComputedStyle(document.querySelector('#reportHeatmapScrollHint')).display };
    });
    assert.equal(layout.pageOverflow, false, `${width}px page overflow`);
    assert.ok(layout.segment >= 44);
    const overviewLabels = await page.evaluate(() => {
      const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      return {
        kicker:size('.report-command-kicker'),
        completed:size('.report-summary-primary>span'),
        payment:size('.report-summary-action>span'),
        paymentHint:size('.report-summary-action>i'),
        reconciliation:size('.report-reconciliation small'),
        revenueTrend:size('#reportHeroRevenueTrend'),
        workload:size('#reportWorkload'),
        utilization:size('#reportHeroUtilizationNote'),
        planCaption:size('#reportPlanCaption'),
        planHint:size('#reportPlanProgressNote'),
        trendCoverage:size('#reportTrendCoverage')
      };
    });
    assert.ok(Object.values(overviewLabels).every(size => size >= 12), `${width}px overview labels: ${JSON.stringify(overviewLabels)}`);
    const clippedOverviewLabels = await page.evaluate(() => ['#reportHeroRevenueTrend','#reportWorkload','#reportHeroUtilizationNote','#reportPlanCaption','#reportPlanProgressNote','#reportTrendCoverage']
      .filter(selector => { const label = document.querySelector(selector); return label.scrollWidth > label.clientWidth + 1; }));
    assert.deepEqual(clippedOverviewLabels, [], `${width}px overview explanations stay readable`);
    const detailLabels = await page.evaluate(() => {
      const selectors = ['.report-funnel-card .report-section-heading small','.report-funnel strong','.report-funnel small','.report-heatmap-legend span','.report-heatmap-legend small','.report-comparison .report-section-heading small','.report-comparison-list span','.report-comparison-list strong'];
      return selectors.map(selector => { const label = document.querySelector(selector); return { selector, size:parseFloat(getComputedStyle(label).fontSize), clipped:label.scrollWidth > label.clientWidth + 1 }; });
    });
    assert.ok(detailLabels.every(label => label.size >= 12 && !label.clipped), `${width}px expanded analytics labels: ${JSON.stringify(detailLabels)}`);
    const healthLabels = await page.evaluate(() => [...document.querySelectorAll('.report-health-details summary,.report-health-factors small,.report-health-factors i,.report-health-details>p')]
      .map(label => ({ text:label.textContent.trim().slice(0,40), size:parseFloat(getComputedStyle(label).fontSize), clipped:label.scrollWidth > label.clientWidth + 1 })));
    assert.ok(healthLabels.every(label => label.size >= 12 && !label.clipped), `${width}px health explanation labels: ${JSON.stringify(healthLabels)}`);
    assert.ok(await page.locator('.report-health-details summary').evaluate(label => label.getBoundingClientRect().height >= 44), `${width}px health explanation target`);
    if (width <= 760) {
      const labels = await page.evaluate(() => {
        const root = document.querySelector('#analyticsView');
        const selectors = {
          overview:['.report-data-source>span','.report-filter-toggle small','.report-secondary small','.report-secondary .report-zero-summary strong','.report-reconciliation strong','.report-trend .panel-head small','.report-period-details>summary','.report-analytics-details>summary','.report-methodology>summary','.report-methodology-grid span'],
          clients:['.report-clients .report-section-heading small','.report-retention .report-section-heading small','.report-retention-list span'],
          team:['.report-utilization .report-section-heading small','.report-utilization-values span','.report-performers .report-section-heading small','.report-team-rank','.report-team-person em','.report-team-person small','.report-performer-value b','.report-performer-value small']
        };
        const result = [];
        for (const [tab, items] of Object.entries(selectors)) {
          root.dataset.reportTab = tab;
          for (const selector of items) {
            const label = root.querySelector(selector);
            if (!label) throw new Error(`Missing S05 label: ${selector}`);
            result.push({ selector, size:parseFloat(getComputedStyle(label).fontSize), clipped:label.getClientRects().length > 0 && label.scrollWidth > label.clientWidth + 1 });
          }
          if (document.documentElement.scrollWidth > innerWidth + 1) result.push({ selector:`${tab} page overflow`, size:0, clipped:true });
        }
        root.dataset.reportTab = 'overview';
        return result;
      });
      assert.ok(labels.every(label => label.size >= 12 && !label.clipped), `${width}px remaining report labels: ${JSON.stringify(labels)}`);
    }
    if (width <= 760) {
      assert.ok(layout.period >= 44, `${width}px period target`);
      const smartActions = await page.evaluate(() => [...document.querySelectorAll('#reportSmartActions small,#reportSmartActions i,#reportSmartActions button')]
        .map(label => ({ text:label.textContent.trim(), button:label.tagName === 'BUTTON', size:parseFloat(getComputedStyle(label).fontSize), height:label.getBoundingClientRect().height, clipped:label.scrollWidth > label.clientWidth + 1 })));
      assert.ok(smartActions.every(label => label.size >= 12 && !label.clipped && (!label.button || label.height >= 44)), `${width}px smart-action labels and targets: ${JSON.stringify(smartActions)}`);
    }
    if (width <= 390) {
      const clippedChartValues = await page.evaluate(() => [...document.querySelectorAll('.report-chart-column>b')].filter(label => label.scrollWidth > label.clientWidth + 1).map(label => label.textContent.trim()));
      assert.deepEqual(clippedChartValues, [], `${width}px chart values stay readable`);
    }
    if (width <= 600) {
      assert.equal(layout.heatmapOverflow, true, `${width}px heatmap scrolls`);
      assert.notEqual(layout.hint, 'none');
      for (const scale of ['default', 'large']) {
        const tabs = await page.evaluate(textScale => {
          document.body.dataset.providerTextScale = textScale;
          const nav = document.querySelector('.report-view-tabs').getBoundingClientRect();
          const buttons = [...document.querySelectorAll('.report-view-tabs button')];
          return buttons.map(button => {
            const rect = button.getBoundingClientRect();
            return { label:button.textContent.trim(), height:rect.height, visible:rect.left >= nav.left - 1 && rect.right <= nav.right + 1 };
          });
        }, scale);
        assert.ok(tabs.every(tab => tab.height >= 44 && tab.visible), `${width}px ${scale} statistics tabs: ${JSON.stringify(tabs)}`);
      }
    }
    if (width === 390) {
      const labels = await page.evaluate(() => {
        document.body.dataset.providerTextScale = 'default';
        const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        return { note:size('.report-team-note'), axis:size('.report-chart-column small'), source:size('.report-data-source>small'), chartContext:size('.report-chart-context small'), chartHint:size('.report-chart-hint'), period:size('.report-trend .panel-head p'), summary:size('.report-command-copy>p'), metric:size('.report-primary-metric small'), chartValue:size('.report-chart-column b') };
      });
      assert.ok(labels.note >= 12 && labels.axis >= 11 && labels.source >= 12 && labels.chartContext >= 12 && labels.chartHint >= 12 && labels.period >= 12 && labels.summary >= 12 && labels.metric >= 12 && labels.chartValue >= 12, `390px statistics labels: ${JSON.stringify(labels)}`);
      const largeLabels = await page.evaluate(() => {
        document.body.dataset.providerTextScale = 'large';
        const size = selector => parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
        return { note:size('.report-team-note'), axis:size('.report-chart-column small') };
      });
      assert.ok(largeLabels.note >= 14 && largeLabels.axis >= 13, `390px large statistics labels: ${JSON.stringify(largeLabels)}`);
      const smallTargets = await page.evaluate(() => {
        const report = document.querySelector('#analyticsView');
        const found = [];
        for (const tab of ['overview', 'money', 'clients', 'team']) {
          report.dataset.reportTab = tab;
          for (const button of report.querySelectorAll('button')) {
            if (button.closest('dialog') || !button.getClientRects().length) continue;
            const height = button.getBoundingClientRect().height;
            if (height > 0 && height < 44) found.push({ tab, className:button.className, text:button.textContent.trim().slice(0, 30), height:Math.round(height) });
          }
        }
        return found;
      });
      assert.deepEqual(smallTargets, [], `390px small targets: ${JSON.stringify(smallTargets)}`);
    }
    if (process.env.MINUTA_SCREENSHOT_DIR) {
      await page.evaluate(() => { document.querySelector('#analyticsView').dataset.reportTab = 'overview'; });
      await page.screenshot({ path:`${process.env.MINUTA_SCREENSHOT_DIR}/statistics-${width}.png`, fullPage:true });
      await page.locator('.report-command-center').screenshot({ path:`${process.env.MINUTA_SCREENSHOT_DIR}/health-${width}.png` });
      await page.locator('#reportSmartActions').screenshot({ path:`${process.env.MINUTA_SCREENSHOT_DIR}/smart-actions-${width}.png` });
      await page.evaluate(() => { document.querySelector('#analyticsView').dataset.reportTab = 'clients'; });
      await page.locator('.report-business-grid').screenshot({ path:`${process.env.MINUTA_SCREENSHOT_DIR}/clients-${width}.png` });
      await page.evaluate(() => { document.querySelector('#analyticsView').dataset.reportTab = 'team'; });
      await page.locator('.report-business-grid').screenshot({ path:`${process.env.MINUTA_SCREENSHOT_DIR}/team-${width}.png` });
      await page.locator('#reportPerformers').screenshot({ path:`${process.env.MINUTA_SCREENSHOT_DIR}/performers-${width}.png` });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
