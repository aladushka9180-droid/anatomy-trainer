import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const moduleSource=readFileSync(new URL('../report-reconciliation.js',import.meta.url),'utf8');
function declaration(name){const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));assert.ok(start>=0,name);const lineEnd=source.indexOf('\n',start);return source.slice(start,source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n}',start)+2);}
const names=['reportBookings','reportCompletedItems','reportRevenue','reportClientIdentity','reportClientMetrics','reportExportData','reportExportVisit','reportSessionKey','reportDataQueryRange',
  'reportServiceValue','reportReceivedAmount','reportImportedValue','reportDebtAmount','reportEffectivePerformerId','reportReconciledTeamRows','reportExportValue','reportExportDuration',
  'reportExportSheets','reportExportCell','reportExportPhone','reportExportMaster','reportExportPerformers','reportExportCreator','reportCurrentTeamRows','renderAnalytics',
  'reportExportSheet','reportProfessionalWorkbook','reportZip','reportCrc32','reportXmlText','reportColumnName','exportBookingsXlsx','exportBookingsCsv',
  'exportBookingsPdf','reportPdfText','reportPdfPage','reportPdfImageBytes','reportPdfBlob'];
const script=`
  var $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  var currentUser={id:'master-A'},sessionGeneration=1,reportDataSource='own',reportPeriod='month',reportCanViewTeam=false,reportPerformerFilter='all';
  var reportServiceMetric='revenue',reportServicesExpanded=false,reportSubview='overview';
  var range={start:'2026-09-01',end:'2026-09-30',period:'month'};
  var row=(id,changes={})=>({id,booking_date:'2026-09-10',booking_time:'10:00:00',duration_minutes:60,performer_id:'master-A',organization_id:'org-A',client_name:'Тестовый клиент',client_phone:'79990000000',status:'confirmed',value:1000,booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:600},...changes});
  var allBookings=[row('paid'),row('minute',{minute:true,value:600,booking_outcomes:{visit_status:'completed',payment_method:'cash',amount_rub:100,actual_duration_minutes:30}}),
    row('cancelled',{status:'cancelled'}),row('scheduled',{booking_outcomes:{visit_status:'scheduled',payment_method:'cash',amount_rub:400}}),row('old',{booking_date:'2026-08-10'})];
  var importedBookingHistory=[row('import',{is_imported_history:true,booking_outcomes:{visit_status:'completed',payment_method:'imported',amount_rub:1000,completion_source:'imported'}})];
  var reportScopedBookingsState={status:'ready',rows:allBookings},reportTeamAnalyticsState={status:'ready',key:'1:master-A:org-A:2026-09-01:2026-09-30',rows:[{performer_id:'master-A',performer_name:'Тестовый мастер',payroll_rub:-321}]},reportEventState={rows:[]};
  var reportRange=()=>range,reportOrganizationId=()=> 'org-A',reportUsesScopedBookings=()=>false;
  var bookingOutcome=i=>i.booking_outcomes,isScheduleBlock=i=>Boolean(i.is_schedule_block),isPerMinuteBooking=i=>Boolean(i.minute),bookingMinuteRate=i=>i.minute?10:0;
  var bookingSessionTotal=i=>i.value,bookingSession=i=>[{title:'Тестовая услуга',price_rub:i.value}],bookingSessionDuration=()=>60;
  var normalizePhone=v=>String(v||'').replace(/\\D/g,''),parseLocalIsoDate=v=>new Date(v+'T00:00:00Z');
  var money=v=>new Intl.NumberFormat('ru-RU').format(v)+' ₽',serviceName=v=>v,escapeHtml=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;');
  var reportExportDate=v=>v,reportExportEnd=()=> '11:00',reportExportSource=()=> 'Мастер',reportExportCreator=()=> 'Мастер',bookingDisplayNote=()=>'',paymentMethodLabel=v=>v;
  var reportSourceMetrics=()=>({online:0,manual:0,unknown:0}),reportDateText=v=>v,reportVisitWord=()=> 'визитов',reportShare=(v,total)=>total?Math.round(v/total*100)+'%':'0%';
  var reportPerformerName=()=> 'Тестовый мастер',reportHours=v=>v/60+' ч',reportEventTitle=()=>'';
  var setReportText=(s,v)=>{const n=$(s);if(n)n.textContent=v;},setReportSubview=()=>{},updateReportFilterSummary=()=>{},previousReportRange=()=>null,setReportTrend=()=>{};
  var bookingIsCompleted=()=>true,renderReportUtilization=()=>40,renderReportRetention=()=>{},loadReportTeamAnalytics=()=>{},renderReportUtmFunnel=()=>{},loadReportUtmFunnel=()=>{},loadReportEvents=()=>{};
  var reportTrendMarkup=()=>{},renderReportFunnel=()=>{},renderReportHeatmap=()=>{},renderReportCommandCenter=()=>{},providerPerformance={measure:()=>1,record(){}};
  var notify=()=>{},reportExportFilename=(r,ext)=>'synthetic-report.'+ext;
  window.exports=[];var reportExportDownload=(blob,filename)=>exports.push({blob,filename});
  window.pdfText=[];const originalFillText=CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText=function(text,...args){pdfText.push(String(text));return originalFillText.call(this,text,...args);};
  ${moduleSource}
  ${names.map(declaration).join('\n')}
  // The production UX initializer inserts this report node dynamically.
  ${source.slice(source.indexOf("  const evidence = document.createElement('p');"),source.indexOf('  // Secondary starter commands'))}
`;
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
try{
  for(const width of [390,1280]){
    const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',route=>route.request().url()==='https://analytics.test/'?route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'}):route.abort());
    await page.goto('https://analytics.test/');
    await page.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html');const panel=doc.querySelector('[data-provider-panel="analytics"]');if(!panel)throw Error('Actual analytics panel missing');document.body.append(panel.cloneNode(true));document.querySelectorAll('[hidden]').forEach(node=>{if(node.matches('[data-provider-panel]'))node.hidden=false;});},html);
    await page.addStyleTag({content:readFileSync(new URL('../styles.css',import.meta.url),'utf8')});
    await page.addScriptTag({content:script});
    await page.evaluate(()=>renderAnalytics());
    const number=async id=>Number((await page.locator(id).textContent()).replace(/[^0-9-]/g,''));
    assert.equal(await number('#reportRevenue'),700);assert.equal(await number('#reportCompletedValue'),2300);assert.equal(await number('#reportDebt'),600);assert.equal(await number('#reportAverage'),350);
    assert.match(await page.locator('#reportPaymentEvidence').textContent(),/2 из 3/);
    assert.match(await page.locator('#reportPaymentEvidence').textContent(),/нет данных об оплате/);
    const data=await page.evaluate(()=>reportExportData('full'));
    assert.equal(data.rows.reduce((sum,row)=>sum+Number(row[10]||0),0),700);
    assert.equal(data.rows.reduce((sum,row)=>sum+Number(row[11]||0),0),600);
    assert.equal(data.team[0][6],-321);assert.equal(data.clientRows[0][4],3);
    const history=data.rows.find(row=>row[12].includes('Нет данных'));assert.equal(history[10],null);assert.equal(history[11],null);
    await page.evaluate(()=>{exportBookingsCsv('full');exportBookingsXlsx('full');exportBookingsPdf('full');});
    const artifacts=await page.evaluate(async()=>{const csv=await exports[0].blob.text(),xlsx=new Uint8Array(await exports[1].blob.arrayBuffer()),pdf=await exports[2].blob.text();return {csv,zip:[...xlsx.slice(0,4)],pdf:pdf.slice(0,8),pdfText,xml:reportExportSheets(reportExportData()).map(sheet=>reportExportSheet(sheet.rows,sheet.options))};});
    assert.match(artifacts.csv,/Нет данных об оплате \(история\)/);assert.deepEqual(artifacts.zip,[80,75,3,4]);assert.match(artifacts.pdf,/^%PDF-1.4/);
    assert.ok(artifacts.pdfText.some(text=>text==='Нет данных'));assert.ok(artifacts.pdfText.some(text=>text.includes('История:')));
    assert.ok(artifacts.xml[0].includes('Данные об оплате'));assert.ok(artifacts.xml[0].includes('2 из 3'));
    assert.equal(await page.evaluate(xml=>xml.some(text=>new DOMParser().parseFromString(text,'application/xml').querySelector('parsererror')),artifacts.xml),false);
    assert.deepEqual(errors,[]);
    console.log('PASS '+width+'px: actual analytics DOM totals, CSV/XLSX/PDF generation, unknown payment labels; synthetic data, secondary charts/network stubbed');
    await context.close();
  }
}finally{await browser.close();}
