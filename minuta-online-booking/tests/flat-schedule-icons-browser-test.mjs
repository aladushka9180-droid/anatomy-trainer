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
 const orgSprite = 'ui-icons.svg?v=1023#icon-org';
 assert.deepEqual(await page.locator('[data-provider-view="organization"] svg use').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href'))),[orgSprite,orgSprite],'Both static organization icons must be buildings before scripts run');
 assert.ok(readFileSync(resolve(root,'ui-icons.svg'),'utf8').includes('<symbol id="icon-org" viewBox="0 0 24 24"><path d="M4 21V3'),'Building symbol must exist in the cached sprite');
 await page.addScriptTag({path:resolve(root,'schedule-break-icons.js')}); const flatStyle=await page.addStyleTag({path:resolve(root,'schedule-flat.css')});
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting','requires-top-level');document.querySelector('#providerBoot')?.remove();
  document.querySelector('#authCard').hidden=true;
  document.querySelector('#dashboard').hidden=false;document.querySelector('#dashboard').dataset.activeView='bookings';
  document.querySelectorAll('.provider-view').forEach(e=>e.hidden=e.dataset.providerPanel!=='bookings');
  document.body.dataset.providerTheme='pink-porcelain';document.body.dataset.providerLayout='soft';
  document.querySelector('[data-calendar-view="day"]').classList.add('active');
  document.querySelector('#dateStrip').innerHTML=[24,25,26,27,28,29,30,1,2].map((d,i)=>`<button data-booking-date="2026-${d<3?'10-0':'09-'}${d}" class="${d===26?'active':d===28?'is-today':''}"><span>${['Чт','Пт','Сб','Вс','Пн','Вт','Ср','Чт','Пт'][i]}</span><strong>${d}</strong><small>${d<3?'окт':'сент'}</small></button>`).join('');
  document.querySelector('#selectedDateTitle').innerHTML='<span class="selected-date-title-default">Суббота</span><span class="selected-date-title-mobile">Суббота</span>';
  document.querySelector('#dateStrip').hidden=false;
  document.querySelector('#scheduleDatePicker').value='2026-09-26';
  document.querySelector('#dateStrip button.active').setAttribute('aria-pressed','true');
 });
 await page.addScriptTag({content:`
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
 const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 ${actual('uiIcon')}
 ${source.match(/const PROVIDER_MOBILE_NAV_ITEMS = Object\.freeze\(\[[\s\S]*?\]\);/)[0]}
 const navigationForRole=()=>['bookings','clients','analytics','organization'],providerMobileMoreIsOpen=()=>false;
 ${actual('renderMobileNavigation')}
 let displayPreferences={break_icons:{automatic:'pause',bookings:{}},show_notes:false};
 let selectedDate='2026-09-26',recentlyCreatedBookingId='';
 const businessTodayIso=()=> '2026-09-28',automaticBookingBreaks=()=>[],timelineBounds=()=>({start:600,end:1050}),stackMinuteTimelineItems=()=>{};
 const minutesFromTime=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),timeFromMinutes=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const bookingStatus=i=>i.status,bookingStatusClass=i=>i.status,isScheduleBlock=i=>i.status==='block',bookingDisplayNote=()=>'',compactBookingCardsEnabled=()=>false;
 const bookingVisitSummaryText=()=>'',bookingVisitSummaryMarkup=()=>'',clientHighlightClasses=()=>'',clientBadgeText=()=>'',clientBadgeMarkup=()=>'',timelineMoveRestriction=()=>'';
 const timelineServiceNameMarkup=n=>escapeHtml(n),bookingNotePresenceMarkup=()=>'',bookingColor=()=> 'auto',serviceName=n=>n,scheduleNowMarkerMarkup=()=>'',timelineEmptyHintOffsetMinutes=()=>120,scheduleCreateHintMarkup=()=>'';
 const base={booking_date:selectedDate,status:'confirmed',client_name:'Анна',client_phone:'79000000000',services:{name:'Массаж спины + ШВЗ — углублённый'}};
 let items=[{...base,id:'online',booking_time:'10:00',duration_minutes:60,booking_source:'client_online'}, {...base,id:'auto',booking_time:'11:00',duration_minutes:120,status:'block',automatic_break:true}, {...base,id:'manual',booking_time:'13:00',duration_minutes:60,booking_source:'provider_manual',client_name:'Екатерина'}, {...base,id:'break',booking_time:'14:00',duration_minutes:60,status:'block',client_name:'Личное'}, {...base,id:'short',booking_time:'15:00',duration_minutes:30,status:'block'}, {...base,id:'long',booking_time:'16:00',duration_minutes:90,client_name:'Очень длинное имя клиента для проверки переноса'}];
 ${actual('renderTimeline')}
 let automaticBreakSheetInvoker=null;
 const automaticBookingBreaksRemoteAvailable=false, AUTOMATIC_BREAK_COLOR_KEYS=['neutral','theme'],BOOKING_COLOR_LABELS={};
 const parseLocalIsoDate=v=>new Date(v+'T12:00:00'),applyWriteAvailability=()=>{};
 ${actual('openAutomaticBreakSheet')}
 window.fixtureOpenAuto=()=>openAutomaticBreakSheet($('[data-open-automatic-break]'));
 window.redraw=()=>renderTimeline(items);redraw();
 window.fixturePreferences=()=>displayPreferences;
 window.fixtureAccount=p=>{displayPreferences=p;redraw();};
 let sourceReads=0,comparisons=0;
 PrimeTimeBreakIcons.init({preferences:()=>displayPreferences,save:p=>{displayPreferences=p;localStorage.setItem('synthetic-preferences',JSON.stringify(p));redraw();},bookings:()=>{sourceReads++;return items;},booking:id=>items.find(i=>{comparisons++;return i.id===id;}),isBlock:isScheduleBlock});
 window.fixturePerf=async()=>{
  $('#bookingSheet').hidden=true;
  const sample=$('[data-open-booking="manual"]').cloneNode(true),holder=$('#providerBookings');
  items=Array.from({length:2000},(_,i)=>({...base,id:'history-'+i}));holder.innerHTML='';
  for(let i=0;i<40;i++){const id='visible-'+i;items.push({...base,id});const card=sample.cloneNode(true);card.dataset.openBooking=id;holder.append(card);}
  await new Promise(r=>setTimeout(r,0));sourceReads=0;comparisons=0;
  holder.firstElementChild.append(document.createTextNode(' '));await new Promise(r=>setTimeout(r,0));
  const relevantReads=sourceReads;sourceReads=0;comparisons=0;
  const unrelated=document.createElement('div');document.body.append(unrelated);
  const start=performance.now();
  for(let i=0;i<20;i++){unrelated.textContent=String(i);await new Promise(r=>setTimeout(r,0));}
  const result={relevantReads,sourceReads,comparisons,elapsedMs:Math.round(performance.now()-start)};
  unrelated.remove();return result;
 };
 window.openIconSettings=automatic=>{const sheet=$('#bookingSheet');sheet.dataset.assistantContext=automatic?'automatic-break':'booking';sheet.dataset.bookingId=automatic?'':'break';$('#bookingSheetContent').innerHTML='<h2>Перерыв</h2>';sheet.hidden=false;};
 `});
 for(const theme of ['pink-porcelain','carbon-crimson'])for(const width of [390,760,981,1024,1100,1440,2048]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(theme=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerResolvedColorMode=theme==='carbon-crimson'?'dark':'light';redraw();},theme);
  await page.waitForTimeout(250); const state=await page.evaluate(()=>{
   const online=document.querySelector('[data-open-booking="online"]'),manual=document.querySelector('[data-open-booking="manual"]'),auto=document.querySelector('[data-open-automatic-break]');
   const style=e=>getComputedStyle(e),rect=e=>e.getBoundingClientRect();
   const time=auto.querySelector('.timeline-booking-client-row'),label=auto.querySelector('.timeline-booking-copy>strong');
   return {overflow:document.documentElement.scrollWidth>innerWidth+2,onlineBorder:style(online).borderLeftWidth,manualShadow:style(manual).boxShadow,manualWidth:style(manual).borderLeftWidth,manualBorder:style(manual).borderLeftColor,timeFirst:rect(time).bottom<=rect(label).top+1,manualTimeFirst:[...document.querySelectorAll('[data-open-booking].status-block:not(.compact):not(.minute-only)')].every(e=>rect(e.querySelector('.timeline-booking-client-row')).height>0 && style(e.querySelector('.timeline-booking-time')).display==='none' && rect(e.querySelector('.timeline-booking-client-row')).bottom<=rect(e.querySelector('.timeline-booking-copy>strong')).top+1),pause:auto.querySelector('.schedule-break-icon')?.dataset.breakIcon,gradients:[...document.querySelectorAll('#dashboard[data-active-view="bookings"] :is(.timeline-booking,.schedule-card,.timeline-view,.date-strip>button,#newBookingButton)')].filter(e=>style(e).backgroundImage.includes('gradient')).length,titleWeight:style(document.querySelector('.schedule-view-title h2')).fontWeight,sourceDisplay:style(auto.querySelector('.timeline-automatic-break-source')).display,todayBorder:style(document.querySelector('.date-strip .is-today')).borderTopWidth};
  });
  assert.equal(state.overflow,false,`${theme}/${width}: overflow`);assert.equal(state.onlineBorder,'3px');assert.equal(state.manualShadow,'none');assert.ok(state.manualWidth==='0px'||state.manualBorder==='rgba(0, 0, 0, 0)',JSON.stringify(state));assert.equal(state.timeFirst,true,`${width} break time first`);assert.equal(state.manualTimeFirst,true,'Manual break time must precede title');assert.equal(state.pause,'pause');assert.equal(state.sourceDisplay,'none');assert.equal(state.gradients,0);assert.equal(state.titleWeight,'600');assert.equal(state.todayBorder,'1px');
  if(width<=760){
   const layout=await page.evaluate(()=>{
    const rect=e=>e.getBoundingClientRect(),q=s=>document.querySelector(s);
    const title=rect(q('.schedule-view-title h2'));
    const summary=q('.schedule-title-line .dashboard-summary'),rows=[...summary.querySelectorAll(':scope>div')];
    return {
     months:[...document.querySelectorAll('.date-strip>button')].map(button=>{
      const month=rect(button.querySelector('small')),day=rect(button.querySelector('strong')),outer=rect(button);
      return {visible:month.height>0,below:month.top>=day.bottom-1,inside:month.bottom<=outer.bottom+1};
     }),
     aligned:[summary,rows[0],rows[2]].every(e=>Math.abs(rect(e).left-title.left)<1),
     lefts:[title.left,...[summary,rows[0],rows[2]].map(e=>rect(e).left)],
     labelPadding:getComputedStyle(rows[2],'::before').paddingLeft,
     cards:['online','manual','long'].map(id=>{
      const card=q(`[data-open-booking="${id}"]`),time=rect(card.querySelector('.timeline-mobile-time')),name=rect(card.querySelector('.timeline-client-name')),service=rect(card.querySelector('.timeline-booking-copy>strong'));
      return {id,timeVisible:time.height>0,nameVisible:name.height>0,separate:time.bottom<=name.top+1 && name.bottom<=service.top+1};
     })
    };
   });
   assert.ok(layout.months.every(m=>m.visible && m.below && m.inside),`${theme}/${width}: month labels ${JSON.stringify(layout.months)}`);
   // The compact mobile schedule moves counters beside the selected weekday.
   assert.equal(layout.labelPadding,'0px');
   for(const card of layout.cards)assert.ok(card.timeVisible && card.nameVisible && card.separate,`${theme}/${width}: time, client and service need separate rows: ${JSON.stringify(card)}`);
   const header=await page.evaluate(()=>{
    const css=s=>getComputedStyle(document.querySelector(s));
    return {todayInk:css('.date-today-button').color,tabInk:css('.calendar-view-toggle button.active').color,selectedBg:css('.date-strip>button.active').backgroundColor,tab:css('.calendar-view-toggle button.active').backgroundColor,navBorder:css('.date-navigation').borderTopWidth,stripBorder:css('.date-strip-frame').borderBottomWidth,dateBorder:css('.schedule-date-picker').borderTopWidth,todayBorder:css('.date-today-button').borderTopWidth,dateWeight:css('.schedule-date-picker input').fontWeight,buttonInk:css('#newBookingButton span').color,buttonBg:css('#newBookingButton').backgroundColor,topbarBorder:css('#providerTopbarToolsButton').borderTopWidth};
   });
   const contrast=await page.locator('.date-today-button').evaluate(e=>{
    const s=getComputedStyle(e),l=c=>c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
    const ratio=()=>{const style=getComputedStyle(e),a=l(style.webkitTextFillColor||style.color),b=l(style.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
    const otherDay=ratio();e.classList.add('is-current');const currentDay=ratio(),currentInk=getComputedStyle(e).color,currentBg=getComputedStyle(e).backgroundColor;e.classList.remove('is-current');return {otherDay,currentDay,currentInk,currentBg};
   });
   assert.ok(contrast.otherDay>=4.5 && contrast.currentDay>=4.5,`${theme}: mobile Today label remains readable in both date states ${JSON.stringify(contrast)}`);
   assert.notEqual(header.selectedBg,'rgba(0, 0, 0, 0)');
   assert.equal(header.tab,'rgba(0, 0, 0, 0)','Period tabs must only use an underline');
   assert.equal(header.navBorder,'0px');assert.equal(header.stripBorder,'0px');assert.equal(header.dateBorder,'0px');assert.equal(header.topbarBorder,'0px');assert.equal(header.todayBorder,'1px');assert.equal(header.dateWeight,'500');
   if(theme==='pink-porcelain')assert.equal(header.buttonInk,'rgb(255, 255, 255)');
  }
  if(width>760){
   const desktop=await page.evaluate(()=>{
    const q=s=>document.querySelector(s),css=s=>getComputedStyle(q(s)),rect=s=>q(s).getBoundingClientRect();
    const title=rect('.schedule-title-line h2'),summary=rect('.dashboard-summary');
    const baseline=element=>{const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';element.append(marker);const y=marker.getBoundingClientRect().top;marker.remove();return y;};
    const titleBaseline=baseline(q('.schedule-title-line h2'));
    const counterBaselines=[...q('.dashboard-summary').querySelectorAll(':scope>div>:is(span,strong)')].map(baseline);
    return {
     borders:['.calendar-view-toggle',...['day','week','month'].map(v=>`[data-calendar-view="${v}"]`),'.date-today-button','.schedule-date-picker','.date-strip-shift'].map(s=>css(s).borderTopWidth),
     counterInk:css('.dashboard-summary strong').color,titleInk:css('.schedule-title-line h2').color,
     baselineDeltas:counterBaselines.map(y=>Math.abs(titleBaseline-y)),
     summaryRight:summary.right,buttonLeft:rect('#newBookingButton').left,
     dateBg:css('.schedule-date-picker').backgroundColor,iconInk:css('.schedule-date-picker>.ui-icon').color,
     iconWidth:rect('.schedule-date-picker>.ui-icon').width,buttonHeight:rect('#newBookingButton').height,
     buttonWeight:css('#newBookingButton span').fontWeight,
     months:[...q('#dateStrip').children].every(b=>{const m=b.querySelector('small').getBoundingClientRect(),d=b.querySelector('strong').getBoundingClientRect();return m.height>0 && m.top>=d.bottom-1 && m.bottom<=b.getBoundingClientRect().bottom+1;}),
     activeInk:css('.date-strip>button.active strong').color,
     accent:css('.date-strip>button.active').getPropertyValue('--theme-accent').trim()
    };
   });
   assert.ok(desktop.borders.every(b=>b==='0px'),`${theme}/${width}: desktop borders ${desktop.borders}`);
   assert.equal(desktop.counterInk,desktop.titleInk);assert.ok(desktop.baselineDeltas.every(delta=>delta<=1),`${width}: title and counter baselines ${desktop.baselineDeltas}`);
   assert.ok(desktop.summaryRight<=desktop.buttonLeft,`${theme}/${width}: counters overlap the new booking button`);
   assert.equal(desktop.dateBg,'rgba(0, 0, 0, 0)');assert.equal(desktop.iconInk,desktop.titleInk);assert.ok(desktop.iconWidth>=16);
   assert.equal(desktop.buttonHeight,36);assert.equal(desktop.buttonWeight,'500');assert.ok(desktop.months);
   await page.keyboard.press('Tab');
   await page.locator('[data-calendar-view="week"]').focus();
   assert.equal(await page.locator('[data-calendar-view="week"]').evaluate(e=>getComputedStyle(e).outlineStyle),'solid','Borderless tabs keep keyboard focus');
   await page.locator('#scheduleDatePicker').focus();
   assert.equal(await page.locator('.schedule-date-picker').evaluate(e=>getComputedStyle(e).outlineStyle),'solid','Borderless date picker keeps focus');
   await page.locator('.schedule-title-line h2').click();
  }
  if(output)await page.screenshot({path:resolve(output,`${theme}-${width}.png`),fullPage:true});
  if(output && width===390)await page.screenshot({path:resolve(output,`${theme}-header-390.png`),clip:{x:0,y:0,width:390,height:310}});
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
 await page.evaluate(()=>{
  document.querySelector('#bookingSheet').hidden=true;document.body.classList.remove('booking-sheet-open');
  renderMobileNavigation();
 });
 const organizationIcon=page.locator('.provider-mobile-nav [data-provider-view="organization"] svg');
 const initialIcon=await organizationIcon.evaluate(node=>node.outerHTML);
 assert.equal(await organizationIcon.locator('use').getAttribute('href'),orgSprite,'First actual navigation render must use the new building sprite');
 assert.equal(await page.locator('.provider-mobile-nav [data-provider-view="organization"]').isVisible(),true);
 for(let i=0;i<3;i++){
  await page.evaluate(()=>renderMobileNavigation());
  assert.equal(await organizationIcon.evaluate(node=>node.outerHTML),initialIcon,'Building remains unchanged after navigation rerenders and observer callbacks');
 }
 assert.equal(await page.locator('.provider-mobile-nav [data-provider-view="clients"] use').getAttribute('href'),'ui-icons.svg?v=1023#icon-users','Clients keep the people icon');
 if(output)await page.screenshot({path:resolve(output,'organization-navigation-390.png')});
 const workload=await page.evaluate(()=>fixturePerf());
 assert.equal(workload.sourceReads,0,'Unrelated DOM changes must not read bookings');
 assert.equal(workload.comparisons,0,'Unrelated DOM changes must not scan booking history');
 assert.equal(workload.relevantReads,1,'One index must serve the entire visible schedule refresh');
 console.log('Schedule refresh workload:',workload);
 await page.evaluate(()=>{
  items=[];redraw();
  document.querySelector('#todayBookingsLabel').textContent='Сегодня';document.querySelector('#tomorrowBookingsLabel').textContent='Завтра';
  window.emptyHintClicks=0;document.querySelector('.timeline-stage').addEventListener('click',()=>window.emptyHintClicks++);
 });
 for(const theme of ['pink-porcelain','carbon-crimson'])for(const width of [360,390,760,800,900,1024,1100,1199,1440])for(const counts of [[0,1,2],[12,34,108]]){
  await page.setViewportSize({width,height:1000});
  await page.evaluate(({theme,counts})=>{
   document.body.dataset.providerTheme=theme;document.body.dataset.providerResolvedColorMode=theme==='carbon-crimson'?'dark':'light';
   ['todayBookingsCount','tomorrowBookingsCount','newBookingsCount'].forEach((id,i)=>document.getElementById(id).textContent=counts[i]);
  },{theme,counts});
  await page.waitForTimeout(250);
  const label=JSON.stringify({theme,width,counts});
  const state=await page.evaluate(()=>{
   const r=s=>document.querySelector(s).getBoundingClientRect(),p='.schedule-title-line .dashboard-summary';
   const hint=document.querySelector('.timeline-empty-state'),copy=hint.querySelector('small'),icon=hint.querySelector('span'),h=hint.getBoundingClientRect(),c=copy.getBoundingClientRect(),i=icon.getBoundingClientRect(),stage=hint.parentElement.getBoundingClientRect(),s=getComputedStyle(hint);
   return {right:Math.abs(r('#tomorrowBookingsCount').right-r('#newBookingsCount').right),left:Math.abs(r(p+'>div:first-child').left-r(p+'>div:last-child').left),heading:Math.abs(r(p).left-r('.schedule-view-title h2').left),separate:r('#tomorrowBookingsCount').bottom<=r('#newBookingsCount').top+1,clearance:r(p).right+4<=r('#newBookingButton').left,overflow:document.documentElement.scrollWidth>innerWidth+1,copy:copy.innerText,rows:Math.round(c.height/parseFloat(getComputedStyle(copy).lineHeight)),center:Math.abs(h.x+h.width/2-stage.x-stage.width/2),delta:Math.abs(i.y+i.height/2-c.y-c.height/2),inside:h.left>=stage.left&&h.right<=stage.right,background:s.backgroundColor,gradient:s.backgroundImage,pointer:s.pointerEvents};
  });
  assert.ok(!state.overflow,label+' no overflow');
  if(width>760){
   assert.equal(state.copy,'Нажмите нужное время, чтобы записать клиента или поставить перерыв','Desktop wording preserved');
   const desktop=await page.evaluate(()=>{
    const rect=id=>document.getElementById(id).getBoundingClientRect();
    return {order:[['todayBookingsLabel','todayBookingsCount'],['tomorrowBookingsLabel','tomorrowBookingsCount'],['upcomingBookingsLabel','newBookingsCount']].map(([label,count])=>rect(label).right<rect(count).left),headingGap:getComputedStyle(document.querySelector('.schedule-title-line')).gap,summaryGap:getComputedStyle(document.querySelector('.dashboard-summary')).gap};
   });
   assert.deepEqual(desktop.order,[true,true,true],label+' label precedes each count');
   assert.ok(state.clearance,label+' summary clear of main action');
   if(width>1100)assert.equal(desktop.headingGap,desktop.summaryGap,label+' consistent summary spacing');
   if(output&&counts[0]===0)await page.screenshot({path:resolve(output,`desktop-summary-${theme}-${width}.png`)});
   continue;
  }
  // Mobile counters now live in the selected-day toolbar; their layout is covered
  // by compact-mobile-schedule-browser-test.mjs.
  assert.equal(state.copy.replace(/\s+/g,' ').trim(),'Нажмите на время, чтобы добавить запись',label+' short mobile wording');
  assert.equal(state.rows,2,label+' two hint lines');assert.ok(state.center<1&&state.delta<1&&state.inside,label+' centered hint');
  assert.notEqual(state.background,'rgba(0, 0, 0, 0)',label+' opaque background covers grid');assert.equal(state.gradient,'none');assert.equal(state.pointer,'none');
  if(output&&counts[0]===0)await page.screenshot({path:resolve(output,`mobile-polish-${theme}-${width}.png`)});
 }
 await page.setViewportSize({width:390,height:1000});await page.waitForTimeout(250);
 const hintBox=await page.locator('.timeline-empty-state').boundingBox();
 await page.mouse.click(hintBox.x+hintBox.width/2,hintBox.y+hintBox.height/2);
 assert.equal(await page.evaluate(()=>emptyHintClicks),1,'Hint passes the click to the timeline');
 await page.evaluate(()=>{document.querySelector('#dashboard').hidden=true;});
 assert.equal(await flatStyle.evaluate(element=>[...element.sheet.cssRules].filter(rule=>rule.selectorText?.includes(':has(#dashboard') && document.body.matches(rule.selectorText)).length),0,'Schedule body rules must not match a hidden dashboard');
 console.log('PASS flat schedule: light/dark 390/760/1440, online/manual borders, break time, six icons, persistence and account separation');
} finally {await browser.close();}
