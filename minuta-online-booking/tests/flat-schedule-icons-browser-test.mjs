import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=readFileSync(resolve(root,'provider.js'),'utf8');
const actual=name=>{
  const start=source.search(new RegExp(`^function ${name}\\(`,'m'));
  const next=source.slice(start+1).search(/^(?:async )?function /m);
  assert.ok(start>=0,name); return source.slice(start,start+next+1);
};
const {chromium}=process.env.MINUTA_PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href) : createRequire(import.meta.url)('playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.MINUTA_CHROME_PATH});
const output=process.env.MINUTA_SCHEDULE_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
try {
 const context=await browser.newContext({viewport:{width:390,height:1000},bypassCSP:true});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='https://schedule.fixture.invalid'||route.request().method()!=='GET')return route.abort();
  const file=resolve(root,'.'+url.pathname); if(!file.startsWith(root))return route.abort();
  try{let body=readFileSync(file); if(file.endsWith('.html'))body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
   return route.fulfill({body,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});
  }catch{return route.abort();}
 });
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://schedule.fixture.invalid/provider.html');
 await page.addScriptTag({path:resolve(root,'schedule-break-icons.js')}); await page.addStyleTag({path:resolve(root,'schedule-flat.css')});
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting','requires-top-level');document.querySelector('#providerBoot')?.remove();
  document.querySelector('#authCard').hidden=true;
  document.querySelector('#dashboard').hidden=false;document.querySelector('#dashboard').dataset.activeView='bookings';
  document.querySelectorAll('.provider-view').forEach(e=>e.hidden=e.dataset.providerPanel!=='bookings');
  document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';
  document.querySelector('[data-calendar-view="day"]').classList.add('active');
  document.querySelector('#dateStrip').innerHTML=[24,25,26,27,28].map((d,i)=>`<button data-booking-date="2026-09-${d}" class="${d===26?'active':d===28?'is-today':''}"><span>${['Чт','Пт','Сб','Вс','Пн'][i]}</span><strong>${d}</strong><small>сент</small></button>`).join('');
  document.querySelector('#selectedDateTitle').innerHTML='<span class="selected-date-title-default">Суббота</span><span class="selected-date-title-mobile">Суббота</span>';
  document.querySelector('#dateStrip').hidden=false;
 });
 await page.addScriptTag({content:`
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uiIcon=id=>'<svg class="ui-icon"><use href="ui-icons.svg#icon-'+id+'"></use></svg>';
 let displayPreferences={break_icons:{automatic:'pause',bookings:{}},show_notes:false};
 let selectedDate='2026-09-26',recentlyCreatedBookingId='';
 const businessTodayIso=()=> '2026-09-28',automaticBookingBreaks=()=>[],timelineBounds=()=>({start:600,end:1020}),stackMinuteTimelineItems=()=>{};
 const minutesFromTime=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),timeFromMinutes=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const bookingStatus=i=>i.status,bookingStatusClass=i=>i.status,isScheduleBlock=i=>i.status==='block',bookingDisplayNote=()=>'',compactBookingCardsEnabled=()=>false;
 const bookingVisitSummaryText=()=>'',bookingVisitSummaryMarkup=()=>'',clientHighlightClasses=()=>'',clientBadgeText=()=>'',clientBadgeMarkup=()=>'',timelineMoveRestriction=()=>'';
 const timelineServiceNameMarkup=n=>escapeHtml(n),bookingNotePresenceMarkup=()=>'',bookingColor=()=> 'auto',serviceName=n=>n,scheduleNowMarkerMarkup=()=>'',timelineEmptyHintOffsetMinutes=()=>120,scheduleCreateHintMarkup=()=>'';
 const base={booking_date:selectedDate,status:'confirmed',client_name:'Анна',client_phone:'79000000000',services:{name:'Массаж спины + ШВЗ — углублённый'}};
 let items=[{...base,id:'online',booking_time:'10:00',duration_minutes:60,booking_source:'client_online'}, {...base,id:'auto',booking_time:'11:00',duration_minutes:120,status:'block',automatic_break:true}, {...base,id:'manual',booking_time:'13:00',duration_minutes:60,booking_source:'provider_manual',client_name:'Екатерина'}, {...base,id:'break',booking_time:'14:00',duration_minutes:60,status:'block',client_name:'Личное'}, {...base,id:'short',booking_time:'15:00',duration_minutes:30,status:'block'}, {...base,id:'long',booking_time:'16:00',duration_minutes:60,client_name:'Очень длинное имя клиента для проверки переноса'}];
 ${actual('renderTimeline')}
 let automaticBreakSheetInvoker=null;
 const automaticBookingBreaksRemoteAvailable=false, AUTOMATIC_BREAK_COLOR_KEYS=['neutral','theme'],BOOKING_COLOR_LABELS={};
 const parseLocalIsoDate=v=>new Date(v+'T12:00:00'),applyWriteAvailability=()=>{};
 ${actual('openAutomaticBreakSheet')}
 window.fixtureOpenAuto=()=>openAutomaticBreakSheet($('[data-open-automatic-break]'));
 window.redraw=()=>renderTimeline(items);redraw();
 window.fixturePreferences=()=>displayPreferences;
 window.fixtureAccount=p=>{displayPreferences=p;redraw();};
 PrimeTimeBreakIcons.init({preferences:()=>displayPreferences,save:p=>{displayPreferences=p;localStorage.setItem('synthetic-preferences',JSON.stringify(p));redraw();},booking:id=>items.find(i=>i.id===id),isBlock:isScheduleBlock});
 window.openIconSettings=automatic=>{const sheet=$('#bookingSheet');sheet.dataset.assistantContext=automatic?'automatic-break':'booking';sheet.dataset.bookingId=automatic?'':'break';$('#bookingSheetContent').innerHTML='<h2>Перерыв</h2>';sheet.hidden=false;};
 `});
 for(const theme of ['pink-porcelain','carbon-crimson'])for(const width of [390,760,1440]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(theme=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerResolvedColorMode=theme==='carbon-crimson'?'dark':'light';redraw();},theme);
  await page.waitForTimeout(250); const state=await page.evaluate(()=>{
   const online=document.querySelector('[data-open-booking="online"]'),manual=document.querySelector('[data-open-booking="manual"]'),auto=document.querySelector('[data-open-automatic-break]');
   const style=e=>getComputedStyle(e),rect=e=>e.getBoundingClientRect();
   const time=auto.querySelector('.timeline-booking-client-row'),label=auto.querySelector('.timeline-booking-copy>strong');
   return {overflow:document.documentElement.scrollWidth>innerWidth+2,onlineBorder:style(online).borderLeftWidth,manualShadow:style(manual).boxShadow,manualWidth:style(manual).borderLeftWidth,manualBorder:style(manual).borderLeftColor,timeFirst:rect(time).bottom<=rect(label).top+1,manualTimeFirst:[...document.querySelectorAll('[data-open-booking].status-block:not(.compact):not(.minute-only)')].every(e=>rect(e.querySelector('.timeline-booking-client-row')).height>0 && style(e.querySelector('.timeline-booking-time')).display==='none' && rect(e.querySelector('.timeline-booking-client-row')).bottom<=rect(e.querySelector('.timeline-booking-copy>strong')).top+1),pause:auto.querySelector('.schedule-break-icon')?.dataset.breakIcon,gradients:[...document.querySelectorAll('#dashboard[data-active-view="bookings"] :is(.timeline-booking,.schedule-card,.timeline-view,.date-strip>button,#newBookingButton)')].filter(e=>style(e).backgroundImage.includes('gradient')).length,titleWeight:style(document.querySelector('.schedule-view-title h2')).fontWeight,sourceDisplay:style(auto.querySelector('.timeline-automatic-break-source')).display,todayBorder:style(document.querySelector('.date-strip .is-today')).borderTopWidth};
  });
  assert.equal(state.overflow,false,`${theme}/${width}: overflow`);assert.equal(state.onlineBorder,'3px');assert.equal(state.manualShadow,'none');assert.ok(state.manualWidth==='0px'||state.manualBorder==='rgba(0, 0, 0, 0)',JSON.stringify(state));assert.equal(state.timeFirst,true,`${width} break time first`);assert.equal(state.manualTimeFirst,true,'Manual break time must precede title');assert.equal(state.pause,'pause');assert.equal(state.sourceDisplay,'none');assert.equal(state.gradients,0);assert.equal(state.titleWeight,'600');assert.equal(state.todayBorder,'1px');
  if(output)await page.screenshot({path:resolve(output,`${theme}-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:390,height:1000});
 await page.evaluate(()=>fixtureOpenAuto());
 const picker=page.locator('#bookingSheetContent .schedule-break-icon-picker');await picker.locator('summary').click();
 assert.equal(await picker.evaluate(e=>e.previousElementSibling.classList.contains('automatic-break-sheet-color')),true,'Icon settings must follow colour in the actual automatic-break sheet');
 assert.equal(await page.locator('#bookingBufferDuration .schedule-break-icon-picker').count(),0,'No duplicate icon setting in general settings');
 if(output)await page.screenshot({path:resolve(output,'automatic-break-icons-390.png')});
 for(const icon of ['coffee','meal','personal','travel','none','pause']){
  await picker.locator(`label:has(input[value="${icon}"])`).click();
  assert.equal(await page.locator('[data-open-automatic-break] .schedule-break-icon').getAttribute('data-break-icon'),icon);
 }
 await page.evaluate(()=>openIconSettings(false));await picker.locator('summary').click();
 await picker.locator('label:has(input[value="personal"])').click();
 assert.equal(await page.locator('[data-open-booking="break"] .schedule-break-icon').getAttribute('data-break-icon'),'personal');
 assert.equal(await page.locator('[data-open-automatic-break] .schedule-break-icon').getAttribute('data-break-icon'),'pause');
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('synthetic-preferences')));
 await page.evaluate(()=>fixtureAccount({}));assert.equal(await page.locator('[data-open-booking="break"] .schedule-break-icon').getAttribute('data-break-icon'),'pause');
 await page.evaluate(p=>fixtureAccount(p),stored);assert.equal(await page.locator('[data-open-booking="break"] .schedule-break-icon').getAttribute('data-break-icon'),'personal');
 assert.deepEqual(errors,[]);
 console.log('PASS flat schedule: light/dark 390/760/1440, online/manual borders, break time, six icons, persistence and account separation');
} finally {await browser.close();}
