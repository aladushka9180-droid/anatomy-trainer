import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const moduleSource=readFileSync(new URL('../report-reconciliation.js',import.meta.url),'utf8');
function declaration(name){const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const lineEnd=source.indexOf('\n',start);return source.slice(start,source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2);}
const names=['reportBookings','reportCompletedItems','reportRevenue','reportClientIdentity','reportClientMetrics','reportExportData','reportExportVisit','reportSessionKey','reportDataQueryRange',
  'setReportFiltersExpanded','reportHours','reportVisitWord','reportClientWord','renderReportTeamRows',
  'reportServiceValue','reportReceivedAmount','reportImportedValue','reportDebtAmount','reportEffectivePerformerId','reportReconciledTeamRows','reportExportValue','reportExportDuration',
  'reportExportSheets','reportExportCell','reportExportPhone','reportExportMaster','reportExportPerformers','reportExportCreator','reportCurrentTeamRows','reportCurrentEventRows','renderAnalytics',
  'reportExportSheet','reportProfessionalWorkbook','reportZip','reportCrc32','reportXmlText','reportColumnName','exportBookingsXlsx','exportBookingsCsv','retryReportScopedBookings',
  'exportBookingsPdf','reportPdfText','reportPdfPage','reportPdfImageBytes','reportPdfBlob','reportTrendMarkup','selectReportTrendBucket'];
const script=`
  var $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  var currentUser={id:'master-A'},sessionGeneration=1,reportDataSource='own',reportPeriod='month',reportCanViewTeam=false,reportPerformerFilter='all';
  var reportServiceMetric='revenue',reportTeamMetric='hours',reportServicesExpanded=false,reportSubview='overview';
  var range={start:'2026-09-01',end:'2026-09-30',period:'month'};
  var row=(id,changes={})=>({id,booking_date:'2026-09-10',booking_time:'10:00:00',duration_minutes:60,performer_id:'master-A',organization_id:'org-A',client_name:'Тестовый клиент',client_phone:'79990000000',status:'confirmed',value:1000,booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:600},...changes});
  var allBookings=[row('paid'),row('minute',{minute:true,value:600,booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:100,actual_duration_minutes:30}}),
    row('cancelled',{status:'cancelled'}),row('scheduled',{booking_outcomes:{visit_status:'scheduled',payment_method:'cash',amount_rub:400}}),row('old',{booking_date:'2026-08-10'})];
  var importedBookingHistory=[row('import',{booking_date:'2026-09-02',is_imported_history:true,booking_outcomes:{visit_status:'completed',payment_method:'imported',amount_rub:1000,completion_source:'imported'}})];
  var reportScopedBookingsState={status:'ready',rows:allBookings},reportTeamAnalyticsState={status:'ready',key:'1:master-A:org-A:2026-09-01:2026-09-30',rows:[{performer_id:'master-A',performer_name:'Тестовый мастер',payroll_rub:-321}]},reportEventState={rows:[]};
  var reportRange=()=>range,reportOrganizationId=()=> 'org-A',reportUsesScopedBookings=()=>false;
  var bookingOutcome=i=>i.booking_outcomes,isScheduleBlock=i=>Boolean(i.is_schedule_block),isPerMinuteBooking=i=>Boolean(i.minute),bookingMinuteRate=i=>i.minute?10:0;
  var bookingSessionTotal=i=>i.value,bookingSession=i=>[{title:'Тестовая услуга',price_rub:i.value}],bookingSessionDuration=()=>60;
  var normalizePhone=v=>String(v||'').replace(/\\D/g,''),parseLocalIsoDate=v=>new Date(v+'T00:00:00Z'),localIsoDate=v=>new Date(v).toISOString().slice(0,10);
  var money=v=>new Intl.NumberFormat('ru-RU').format(v)+' ₽',serviceName=v=>v,escapeHtml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;');
  var reportExportDate=v=>v,reportExportEnd=()=> '11:00',reportExportSource=()=> 'Мастер',reportExportCreator=()=> 'Мастер',bookingDisplayNote=()=>'',paymentMethodLabel=v=>v;
  var reportSourceMetrics=()=>({online:0,manual:0,unknown:0}),reportDateText=(v,options={day:'numeric',month:'short'})=>parseLocalIsoDate(v).toLocaleDateString('ru-RU',options),reportShare=(v,total)=>total?Math.round(v/total*100)+'%':'0%';
  var reportPerformerName=()=> 'Тестовый мастер',reportEventTitle=()=>'';
  var setReportText=(s,v)=>{const n=$(s);if(n)n.textContent=v;},setReportSubview=()=>{},updateReportFilterSummary=()=>{},previousReportRange=()=>null,setReportTrend=()=>{},setReportComparison=()=>{};
  var reportForecastEnd=r=>r.end,retryCalls=[],loadReportScopedBookings=(query,performer)=>{retryCalls.push({query,performer});reportScopedBookingsState.status='loading';};
  var bookingIsCompleted=()=>true,renderReportUtilization=()=>40,renderReportRetention=()=>{},loadReportTeamAnalytics=()=>{},renderReportUtmFunnel=()=>{},loadReportUtmFunnel=()=>{},loadReportEvents=()=>{};
  var renderReportFunnel=()=>{},renderReportHeatmap=()=>{},renderReportCommandCenter=()=>{},providerPerformance={measure:()=>1,record(){}};
  var pendingNavigation=[],bookingStatusFilter='all',setJournalMode=v=>pendingNavigation.push(['mode',v]),setFilter=v=>pendingNavigation.push(['filter',v]),setProviderView=v=>pendingNavigation.push(['view',v]);
  document.addEventListener('click',event=>{const openPendingBookings=event.target.closest('[data-open-pending-bookings]');
    ${source.slice(source.indexOf('  if (openPendingBookings) {'),source.indexOf('  if (reportPeriodButton) {',source.indexOf('  if (openPendingBookings) {')))}
  });
  var notify=()=>{},reportExportFilename=(r,ext)=>'synthetic-report.'+ext;
  window.exports=[];var reportExportDownload=(blob,filename)=>exports.push({blob,filename});
  window.pdfText=[];const originalFillText=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){pdfText.push(String(text));return originalFillText.call(this,text,...args);};
  ${moduleSource}
  ${names.map(declaration).join('\n')}
  var actualLoadReportScopedBookings=${declaration('loadReportScopedBookings')};
  var bookingUsesDemoData=()=>false,sessionIsCurrent=(id,generation)=>id===currentUser.id&&generation===sessionGeneration;
  var reportQueryWindows=r=>[r],rpcCalls=0,reportResponse,db={rpc:()=>{rpcCalls++;return new Promise(resolve=>reportResponse=resolve);}};
  ${source.slice(source.indexOf("$('#reportLoadState')?.addEventListener("),source.indexOf('\n});',source.indexOf("$('#reportLoadState')?.addEventListener("))+4)}
  // The production UX initializer inserts this report node dynamically.
  ${source.slice(source.indexOf("  const evidence = document.createElement('details');"),source.indexOf('  // Secondary starter commands'))}
`;
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try{
  for(const width of [390,760,1440]){
    const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>route.request().url()==='https://analytics.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'}):route.abort());
    await page.goto('https://analytics.test/');
    await page.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html');const panel=doc.querySelector('[data-provider-panel="analytics"]');if(!panel)throw Error('Actual analytics panel missing');document.documentElement.className='provider-ready';document.body.className='provider-body';document.body.dataset.providerTheme='sage';document.body.dataset.providerLayout='soft';document.body.dataset.providerTextScale='default';document.body.append(panel.cloneNode(true));document.querySelectorAll('[hidden]').forEach(node=>{if(node.matches('[data-provider-panel]'))node.hidden=false;});},html);
    for(const [,href] of html.matchAll(/<link rel="stylesheet" href="([^\"]+)"/g)) await page.addStyleTag({content:readFileSync(new URL(`../${href.split('?')[0]}`,import.meta.url),'utf8')});
    await page.addScriptTag({content:script});
    await page.evaluate(()=>renderAnalytics());
    const number=async id=>Number((await page.locator(id).textContent()).replace(/[^0-9-]/g,''));
    assert.equal(await number('#reportRevenue'),700);assert.equal(await number('#reportCompletedValue'),2300);assert.equal(await number('#reportPaymentUnknownValue'),1000);assert.equal(await number('#reportDebt'),600);assert.equal(await number('#reportAverage'),350);
    assert.match(await page.locator('#reportPaymentUnknown').textContent(),/1 визит/);
    assert.match(await page.locator('#reportUnpaid').textContent(),/2 визита.*подтверждённым долгом/);
    assert.match(await page.locator('#reportPaymentEvidence').textContent(),/2 из 3/);
    assert.match(await page.locator('#reportPaymentEvidence').textContent(),/Оплата не указана/);
    assert.match(await page.locator('#reportTrendTitle').textContent(),/^Фактически получено/);
    assert.match(await page.locator('#reportTrendCoverage').textContent(),/Оплата указана: 2 из 3/);
    assert.equal(await page.locator('#reportRevenueChart .report-chart-column').count(),5);
    assert.match(await page.locator('#reportRevenueChart .is-unknown').first().textContent(),/Нет данных/);
    assert.match(await page.locator('#reportRevenueChart .is-empty').first().textContent(),/Нет визитов/);
    const partialTrendBucket=page.locator('#reportRevenueChart .report-chart-column').last();
    assert.match(await partialTrendBucket.getAttribute('data-report-label'),/2 дня/);
    assert.match(await partialTrendBucket.locator('small').textContent(),/^\d+–\d+\s/);
    await page.locator('#reportRevenueChart .is-best').first().evaluate(button=>selectReportTrendBucket(button));
    assert.equal(await page.locator('#reportTrendDetail').isVisible(),true);
    assert.match(await page.locator('#reportTrendDetail').textContent(),/Оплата указана: 2 из 2|Данные об оплате заполнены полностью/);
    assert.equal(await page.locator('#reportTrendDetail [data-report-open-range]').count(),1);
    await page.locator('#reportRevenueChart .is-unknown').first().evaluate(button=>selectReportTrendBucket(button));
    assert.match(await page.locator('#reportTrendDetail').textContent(),/Нет данных об оплате/);
    const data=await page.evaluate(()=>reportExportData('full'));
    assert.equal(data.rows.reduce((sum,row)=>sum+Number(row[10]||0),0),700);
    assert.equal(data.rows.reduce((sum,row)=>sum+Number(row[11]||0),0),600);
    assert.equal(data.team[0][6],-321);assert.equal(data.clientRows[0][4],3);
    const history=data.rows.find(row=>row[12].includes('Нет данных'));assert.equal(history[10],null);assert.equal(history[11],null);
    await page.evaluate(()=>{exportBookingsCsv('full');exportBookingsXlsx('full');exportBookingsPdf('full');});
    const artifacts=await page.evaluate(async()=>{const csv=await exports[0].blob.text(),xlsx=new Uint8Array(await exports[1].blob.arrayBuffer()),pdf=await exports[2].blob.text();return {csv,zip:[...xlsx.slice(0,4)],pdf:pdf.slice(0,8),pdfText,xml:reportExportSheets(reportExportData()).map(sheet=>reportExportSheet(sheet.rows,sheet.options))};});
    assert.match(artifacts.csv,/Нет данных об оплате \(история\)/);assert.deepEqual(artifacts.zip,[80,75,3,4]);assert.match(artifacts.pdf,/^%PDF-1.4/);
    assert.ok(artifacts.pdfText.some(text=>text==='Нет данных'));assert.ok(artifacts.pdfText.some(text=>text.includes('Оплата не указана:')&&text.includes('визитов: 1 из 3')));
    assert.ok(artifacts.xml[0].includes('Оплата не указана'));assert.ok(artifacts.xml[0].includes('Подтверждённый долг'));assert.ok(artifacts.xml[0].includes('Визиты с отметкой: 2 из 3'));
    await page.evaluate(()=>{window.n21Imported=importedBookingHistory;previousReportRange=()=>({start:'2026-08-01',end:'2026-08-31',period:'previous'});renderAnalytics();});
    assert.match(await page.locator('#reportInsight').textContent(),/Сравнение полученного пока недоступно/);
    assert.doesNotMatch(await page.locator('#reportInsight').textContent(),/\d+%|Подтверждённый долг|Оплата не указана:/);
    assert.match(await page.locator('#reportPaymentUnknown').textContent(),/1 визит/);
    assert.match(await page.locator('#reportDebt').textContent(),/600/);
    assert.match(await page.locator('#reportOutcomeList [data-report-outcome="pending"]').textContent(),/1/);
    await page.locator('.report-period-details > summary').click();
    assert.equal(await page.locator('.report-period-details').evaluate(node=>node.open),true,`${width}px disclosure click`);
    const insightLayout=await page.locator('#reportInsight').evaluate(node=>({visible:!!node.getClientRects().length,overflow:node.scrollWidth>node.clientWidth,labelSize:parseFloat(getComputedStyle(node.querySelector('small')).fontSize),messageSize:parseFloat(getComputedStyle(node.querySelector('li')).fontSize)}));
    assert.ok(insightLayout.visible&&!insightLayout.overflow&&insightLayout.labelSize>=12&&insightLayout.messageSize>=12,`${width}px disclosure layout: ${JSON.stringify(insightLayout)}`);
    if(process.env.REPORT_N21_ARTIFACT_DIR){await mkdir(process.env.REPORT_N21_ARTIFACT_DIR,{recursive:true});await page.locator('.report-period-details').screenshot({path:path.join(process.env.REPORT_N21_ARTIFACT_DIR,`partial-${width}.png`)});}
    await page.evaluate(()=>{importedBookingHistory=[];renderAnalytics();});
    assert.match(await page.locator('#reportInsight').textContent(),/17% больше/);
    if(process.env.REPORT_N21_ARTIFACT_DIR) await page.locator('.report-period-details').screenshot({path:path.join(process.env.REPORT_N21_ARTIFACT_DIR,`confirmed-${width}.png`)});
    await page.evaluate(()=>{previousReportRange=()=>null;importedBookingHistory=window.n21Imported;renderAnalytics();});
    for(const total of [1,2,11,21]){
      await page.evaluate(count=>{
        window.languageRows ||= {allBookings,importedBookingHistory};
        allBookings=Array.from({length:count},(_,index)=>row(`language-${index}`,{value:100,booking_outcomes:{visit_status:'completed',payment_method:index?'cash':'imported',amount_rub:index?100:0}}));
        importedBookingHistory=[];renderAnalytics();
      },total);
      const expected=`${total-1} из ${total}`;
      assert.match(await page.locator('#reportTrendCoverage').textContent(),new RegExp(`Оплата указана: ${expected}`));
      assert.match(await page.locator('#reportPaymentEvidence').textContent(),new RegExp(`Оплата указана · ${expected}`));
      assert.match(await page.locator('#reportPaymentUnknown').textContent(),/1 визит/);
      assert.doesNotMatch(await page.locator('#reportInsight').textContent(),/Оплата не указана:/);
      if(total<=2) assert.match(await page.locator('#reportInsight').textContent(),/Сравнение полученного пока недоступно/);
    }
    await page.evaluate(()=>{allBookings=window.languageRows.allBookings;importedBookingHistory=window.languageRows.importedBookingHistory;renderAnalytics();});
    assert.equal(await page.evaluate(xml=>xml.some(text=>new DOMParser().parseFromString(text,'application/xml').querySelector('parsererror')),artifacts.xml),false);
    await page.evaluate(()=>{range={start:'2025-01-01',end:'2025-01-07',period:'custom'};reportPeriod='custom';reportSubview='clients';$('#analyticsView').dataset.reportTab='clients';$('#reportFilterSummary').textContent='1–7 янв. 2025 · Вся команда';renderAnalytics();});
    assert.equal(await page.locator('.report-clients').isVisible(),true,`Клиентская вкладка скрыта при ${width}px`);
    assert.equal(await page.locator('#reportClientsEmpty').isVisible(),true);
    assert.match(await page.locator('#reportClientsEmptyText').textContent(),/Нет состоявшихся визитов.*1.*янв.*2025.*7.*янв.*2025/);
    assert.match(await page.locator('#reportInsight').textContent(),/нет состоявшихся визитов/);
    assert.equal(await page.locator('.report-clients .report-metric-row').isVisible(),false);
    assert.equal(await page.locator('.report-retention').isVisible(),false);
    assert.equal(await page.locator('.report-summary').isVisible(),false);
    if(process.env.REPORT_CLIENT_EMPTY_ARTIFACT_DIR){await mkdir(process.env.REPORT_CLIENT_EMPTY_ARTIFACT_DIR,{recursive:true});await page.locator('#analyticsView').screenshot({path:path.join(process.env.REPORT_CLIENT_EMPTY_ARTIFACT_DIR,`empty-clients-${width}.png`)});}
    await page.evaluate(()=>{setReportFiltersExpanded(true);$('.report-periods [data-report-period].active')?.focus();});
    assert.equal(await page.locator('#reportFilterToggle').getAttribute('aria-expanded'),'true');
    assert.equal(await page.locator('.report-periods [data-report-period].active').evaluate(button=>button===document.activeElement),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Клиентская вкладка переполнена при ${width}px`);
    await page.evaluate(()=>{window.savedClientRows={allBookings,importedBookingHistory};allBookings=allBookings.filter(item=>item.id==='scheduled');importedBookingHistory=[];range={start:'2026-09-01',end:'2026-09-30',period:'month'};renderAnalytics();});
    assert.equal(await page.locator('#analyticsView').getAttribute('data-report-empty'),'false');
    assert.match(await page.locator('#reportInsight').textContent(),/Нужно завершить: 1 визит\./);
    assert.equal(await page.locator('#reportInsight [data-open-pending-bookings]').count(),1);
    await page.evaluate(()=>{$('#analyticsView').dataset.reportTab='overview';});
    await page.locator('#reportInsight [data-open-pending-bookings]').click();
    assert.deepEqual(await page.evaluate(()=>({status:bookingStatusFilter,route:pendingNavigation})),{status:'needs-result',route:[['mode','list'],['filter','all'],['view','bookings']]});
    await page.evaluate(()=>{$('#analyticsView').dataset.reportTab='clients';});
    assert.deepEqual(await page.evaluate(()=>[0,30,60,90,125,-10].map(reportHours)),['0 ч','0,5 ч','1 ч','1,5 ч','2,1 ч','0 ч']);
    assert.deepEqual(await page.evaluate(()=>[0,1,2,4,5,11,12,14,21,22,25,101].map(reportClientWord)),['клиентов','клиент','клиента','клиента','клиентов','клиентов','клиентов','клиентов','клиент','клиента','клиентов','клиент']);
    assert.equal(await page.locator('#reportClientsEmpty').isVisible(),true,'Будущая запись без состоявшихся визитов должна оставлять пустое клиентское состояние');
    assert.equal(await page.locator('.report-summary').isVisible(),false,'Финансовые нули не должны подменять клиентов');
    await page.evaluate(()=>{allBookings=window.savedClientRows.allBookings;importedBookingHistory=window.savedClientRows.importedBookingHistory;renderAnalytics();});
    assert.equal(await page.locator('#reportClientsEmpty').isVisible(),false);
    assert.equal(await page.locator('.report-clients .report-metric-row').isVisible(),true);
    assert.equal(await page.locator('.report-summary').isVisible(),false,'Client metrics should lead the populated Clients tab');
    if(process.env.REPORT_N07_ARTIFACT_DIR){await mkdir(process.env.REPORT_N07_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.REPORT_N07_ARTIFACT_DIR,`clients-${width}.png`),fullPage:false});}
    await page.evaluate(()=>{$('#analyticsView').dataset.reportTab='team';});
    assert.equal(await page.locator('.report-summary').isVisible(),false,'Team metrics should lead the Team tab');
    await page.evaluate(()=>{reportCanViewTeam=true;renderReportTeamRows([]);});
    assert.match(await page.locator('#reportPerformersList .report-team-person small').first().textContent(),/1 клиент · 2,5 ч/);
    assert.match(await page.locator('#reportPerformersList .report-performer-value').first().textContent(),/2,5 ч/);
    await page.locator('[data-report-team-metric="visits"]').click();
    assert.match(await page.locator('#reportPerformersList .report-performer-value').first().textContent(),/3 визита/);
    await page.locator('[data-report-team-metric="hours"]').click();
    if(process.env.REPORT_LANGUAGE_ARTIFACT_DIR){await mkdir(process.env.REPORT_LANGUAGE_ARTIFACT_DIR,{recursive:true});await page.locator('#reportPerformers').screenshot({path:path.join(process.env.REPORT_LANGUAGE_ARTIFACT_DIR,`language-team-${width}.png`)});}
    await page.evaluate(()=>{reportCanViewTeam=false;});
    assert.equal(await page.locator('.report-utilization').isVisible(),true);
    if(process.env.REPORT_N07_ARTIFACT_DIR)await page.screenshot({path:path.join(process.env.REPORT_N07_ARTIFACT_DIR,`team-${width}.png`),fullPage:false});
    await page.evaluate(()=>{$('#analyticsView').dataset.reportTab='money';});
    assert.equal(await page.locator('.report-summary').isVisible(),true,'Full financial cards remain in Money');
    await page.evaluate(()=>{$('#analyticsView').dataset.reportTab='overview';});
    assert.equal(await page.locator('.report-summary').isVisible(),true,'Full financial cards remain in Overview');
    await page.evaluate(()=>{$('#analyticsView').dataset.reportTab='clients';});
    await page.evaluate(()=>{range={start:'2026-09-04',end:'2026-09-18',period:'custom'};reportPeriod='custom';reportPerformerFilter='master-A';reportUsesScopedBookings=()=>true;reportScopedBookingsState={key:'synthetic-failure',status:'failed',rows:[]};renderAnalytics();});
    const assertUnconfirmedHidden=async status=>{
      assert.equal(await page.locator('#analyticsView').getAttribute('data-report-load-state'),status);
      // Only visit-report metrics depend on this loader. Finance owns its own
      // loading/error state, covered by finance-center-ui-browser-test.
      for(const selector of ['#reportCommandCenter','.report-summary','.report-secondary','.report-business-grid','#reportPaymentEvidence']) {
        if(await page.locator(selector).count()) {
          const visible=await page.locator(selector).isVisible();
          assert.equal(visible,false,`${status}: ${selector} must not present unconfirmed metrics`);
        }
      }
      assert.equal(await page.locator('#reportLoadState').isVisible(),true);
      assert.doesNotMatch(await page.locator('#reportPeriodLabel').textContent(),/обновлено/i);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${status}: overflow at ${width}px`);
    };
    await assertUnconfirmedHidden('failed');
    assert.equal(await page.locator('#reportLoadState [data-report-retry]').count(),1,'Ошибка статистики не предлагает повторить загрузку');
    const retryBox=await page.locator('#reportLoadState [data-report-retry]').evaluate(element=>{const rect=element.getBoundingClientRect();return {height:rect.height,right:rect.right,viewport:innerWidth};});
    assert.ok(retryBox.height>=44&&retryBox.right<=retryBox.viewport,`Кнопка повтора недостаточно доступна при ${width}px: ${JSON.stringify(retryBox)}`);
    if(process.env.REPORT_RETRY_ARTIFACT_DIR){await mkdir(process.env.REPORT_RETRY_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.REPORT_RETRY_ARTIFACT_DIR,`report-retry-${width}.png`),fullPage:false});}
    await page.locator('#reportLoadState [data-report-retry]').click();
    const retry=await page.evaluate(()=>({calls:retryCalls,status:reportScopedBookingsState.status,period:reportPeriod,performer:reportPerformerFilter,message:$('#reportLoadState').textContent}));
    assert.deepEqual(retry.calls,[{query:{start:'2026-09-04',end:'2026-09-18'},performer:'master-A'}]);
    assert.equal(retry.status,'loading');
    assert.equal(retry.period,'custom');
    assert.equal(retry.performer,'master-A');
    assert.match(retry.message,/Обновляем статистику/);
    await assertUnconfirmedHidden('loading');
    await page.evaluate(()=>{reportScopedBookingsState={status:'idle',rows:[]};renderAnalytics();});
    await assertUnconfirmedHidden('idle');
    await page.evaluate(()=>{reportScopedBookingsState={status:'ready',rows:[]};importedBookingHistory=[];reportSubview='overview';$('#analyticsView').dataset.reportTab='overview';renderAnalytics();});
    assert.equal(await page.locator('#reportLoadState').isVisible(),false);
    assert.equal(await page.locator('.report-summary').isVisible(),true,'A confirmed empty result remains visible');
    assert.equal(await number('#reportRevenue'),0,'A confirmed empty result is genuinely zero');
    await page.evaluate(()=>{reportScopedBookingsState={status:'loading',rows:[]};renderAnalytics();});
    await assertUnconfirmedHidden('loading');
    await page.evaluate(()=>{range={start:'2026-09-01',end:'2026-09-30',period:'month'};reportScopedBookingsState={status:'ready',rows:window.savedClientRows.allBookings};importedBookingHistory=window.savedClientRows.importedBookingHistory;renderAnalytics();});
    assert.equal(await page.locator('.report-summary').isVisible(),true,'A successful retry reveals confirmed metrics');
    assert.equal(await number('#reportRevenue'),700);
    assert.match(await page.locator('#reportPaymentEvidence').textContent(),/Оплата указана · 2 из 3/);
    if(process.env.REPORT_LOAD_ARTIFACT_DIR){await mkdir(process.env.REPORT_LOAD_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.REPORT_LOAD_ARTIFACT_DIR,`ready-${width}.png`),fullPage:false});}
    await page.evaluate(()=>{const panel=$('#analyticsView');panel.classList.add('finance-center-mounted');panel.dataset.reportTab='money';reportScopedBookingsState.status='failed';renderAnalytics();});
    assert.equal(await page.locator('#reportLoadState [data-report-retry]').isVisible(),true,'Финансовая вкладка скрыла ошибку и повтор загрузки');
    await context.setOffline(true);
    await page.evaluate(async()=>{
      reportCanViewTeam=true;
      reportScopedBookingsState={key:reportSessionKey('org-A',range.start,range.end,'master-A'),status:'ready',rows:window.savedClientRows.allBookings};
      await actualLoadReportScopedBookings(range,'master-A');
    });
    assert.equal(await page.evaluate(()=>reportScopedBookingsState.status),'ready','Offline same-query cache is preserved');
    await page.evaluate(async()=>{range={start:'2026-09-04',end:'2026-09-18',period:'custom'};await actualLoadReportScopedBookings(range,'master-A');});
    await assertUnconfirmedHidden('failed');
    assert.deepEqual(await page.evaluate(()=>({calls:rpcCalls,rows:reportScopedBookingsState.rows})),{calls:0,rows:[]},'Offline changed query cannot retain previous results or send RPC');
    await context.setOffline(false);
    await page.evaluate(()=>{window.pendingReport=actualLoadReportScopedBookings(range,'master-A');renderAnalytics();});
    await assertUnconfirmedHidden('loading');
    await page.evaluate(async()=>{reportResponse({data:{bookings:window.savedClientRows.allBookings,has_more:false},error:null});await window.pendingReport;});
    assert.equal(await page.locator('#analyticsView').getAttribute('data-report-load-state'),'ready');
    assert.equal(await page.evaluate(()=>rpcCalls),1,'Online retry loads exactly once');
    assert.equal(await page.locator('#reportLoadState').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS '+width+'px: actual analytics DOM totals, CSV/XLSX/PDF generation, unknown payment labels; synthetic data, secondary charts/network stubbed');
    await context.close();
  }
}finally{await browser.close();}
