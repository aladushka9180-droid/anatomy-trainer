import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {startFixture} from './booking-detail-card-fixture.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),source=readFileSync(resolve(root,'provider.js'),'utf8');
function actual(name){const start=source.search(new RegExp(`^function ${name}\\(`,'m'));assert.ok(start>=0,name);const next=source.slice(start+1).search(/^(?:async )?function /m);return source.slice(start,next<0?undefined:start+next+1);}
const {chromium}=process.env.MINUTA_PLAYWRIGHT_MODULE?await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href):createRequire(import.meta.url)('playwright');
const output=process.env.MINUTA_SCHEDULE_OUTPUT;if(output)mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.MINUTA_CHROME_PATH});
try {
 const context=await browser.newContext({viewport:{width:390,height:1000},locale:'ru-RU',bypassCSP:true});
 let forbidden=0;await context.route('**/*',route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!=='https://schedule.fixture.invalid'||req.method()!=='GET'){forbidden++;return route.abort();}
  const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root))return route.abort();
  try{let body=readFileSync(file);if(file.endsWith('.html'))body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');return route.fulfill({body,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.abort();}
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://schedule.fixture.invalid/provider.html');
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting','requires-top-level');document.querySelector('#providerBoot')?.remove();document.querySelector('#authCard').hidden=true;
  document.querySelector('#dashboard').hidden=false;document.querySelector('#dashboard').dataset.activeView='bookings';document.querySelectorAll('.provider-view').forEach(e=>e.hidden=e.dataset.providerPanel!=='bookings');
  document.body.dataset.providerTheme='warm';document.body.dataset.providerLayout='soft';document.body.dataset.providerResolvedColorMode='light';
  document.querySelector('.booking-filters').hidden=true;document.querySelector('#scheduleMobileSummary').hidden=false;
  document.querySelector('#selectedDateTitle .selected-date-title-mobile').textContent='Среда';
  document.querySelector('#scheduleDatePicker').value='2026-10-14';
  document.querySelector('#dateStrip').innerHTML=[12,13,14,15,16].map((d,i)=>`<button data-booking-date="2026-10-${d}" class="${d===14?'active':''}"><span>${['Пн','Вт','Ср','Чт','Пт'][i]}</span><strong>${d}</strong><small>окт</small></button>`).join('');
 });
 await page.addScriptTag({content:`
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let selectedDate='2026-10-14',recentlyCreatedBookingId='',displayPreferences={show_notes:false},fixtureItems=[],timelineBookingDrag=null,timelineMovePending=false,timelineMoveConfirmationPending=false,scheduleDaySwipe=null;
 const scheduleEmptyDayLabel=()=>'',businessTodayIso=()=> '2026-10-13',automaticBookingBreaks=()=>[],timelineBounds=()=>({start:600,end:1080}),stackMinuteTimelineItems=()=>{};
 const minutesFromTime=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),timeFromMinutes=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const bookingStatus=i=>i.status,bookingStatusClass=i=>i.status,isScheduleBlock=i=>i.status==='block',bookingDisplayNote=()=>'',compactBookingCardsEnabled=()=>false,bookingVisitSummaryText=()=>'',bookingVisitSummaryMarkup=()=>'',clientHighlightClasses=()=>'',clientBadgeText=()=>'',clientBadgeMarkup=()=>'',timelineMoveRestriction=()=>'',timelineServiceNameMarkup=n=>escapeHtml(n),bookingNotePresenceMarkup=()=>'',bookingColor=()=> 'auto',serviceName=n=>n,timelineEmptyHintOffsetMinutes=()=>120,scheduleCreateHintMarkup=()=>'',scheduleStepForDate=()=>5,NEW_BOOKING_GRID_MINUTES=5;
 ${actual('uiIcon')}${actual('syncCompactScheduleOrder')}${actual('syncScheduleDateDisplay')}${actual('renderTimeline')}${actual('timelineTimeFromClick')}${actual('timelineMinuteFromPointer')}${actual('scheduleNowMarkerMarkup')}${actual('updateScheduleNowMarkers')}
 const businessClock=()=>({minutes:675,label:'11:15'});
 function renderBookings(){renderTimeline(fixtureItems);}
 let opened='',dragStarts=0,creates=0;
 document.addEventListener('pointerdown',event=>{if(event.target.closest('.timeline-booking'))dragStarts++;});
 document.addEventListener('click',event=>{const card=event.target.closest('[data-open-booking]');if(card)opened=card.dataset.openBooking;else if(event.target.closest('[data-create-booking-at]'))creates++;});
 window.fixtureSet=d=>{fixtureItems=[{id:'short',booking_date:selectedDate,booking_time:'10:00',duration_minutes:d,status:'confirmed',client_name:'Тестовый клиент',provider_note:'Полный комментарий',services:{name:'Полное название услуги'}}];renderBookings();};
 window.fixtureDuration=d=>{fixtureItems[0].duration_minutes=d;renderBookings();};
 window.fixtureAdjacent=()=>{fixtureItems=[10,10,15,20,30,40,60].map((d,i,a)=>({id:'adjacent-'+i,booking_date:selectedDate,booking_time:timeFromMinutes(600+a.slice(0,i).reduce((s,v)=>s+v,0)),duration_minutes:d,status:'confirmed',client_name:'Клиент '+i,services:{name:'Тестовая услуга'}}));renderBookings();};
 window.fixtureReset=()=>{opened='';dragStarts=creates=0;};
 window.fixtureState=()=>({opened,dragStarts,creates,items:JSON.parse(JSON.stringify(fixtureItems))});
 window.fixturePoint=()=>{const stage=$('.timeline-stage'),h=Number(stage.dataset.timelineNaturalHeight),top=stage.getBoundingClientRect().top;return{time:timelineTimeFromClick(stage,{clientY:top+h*75/480}),drag:timelineMinuteFromPointer(stage,top+h*75/480,0,10),now:$('.timeline-now-marker')?.dataset.hourHeight};};
 window.fixtureActive=value=>timelineBookingDrag=value?{active:true}:null;
 syncCompactScheduleOrder();syncScheduleDateDisplay();fixtureSet(40);
 `});
 await page.addScriptTag({path:resolve(root,'schedule-break-icons.js')});
 const reports=[];
 const geometry=()=>page.evaluate(()=>{
  const visible=e=>!!e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().height>0;
  const cards=[...document.querySelectorAll('.timeline-booking')].map(card=>{
   const r=card.getBoundingClientRect(),parts=[...card.querySelectorAll('.timeline-mobile-time,.timeline-client-name')].filter(visible).map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return{top:b.top,bottom:b.bottom,font:[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight]};});
   return{id:card.dataset.openBooking,duration:+card.dataset.bookingDuration,top:r.top,bottom:r.bottom,height:r.height,parts,serviceVisible:visible(card.querySelector('.timeline-booking-copy>strong')),cue:visible(card.querySelector('.timeline-details-cue')),time:card.querySelector('.timeline-mobile-time')?.textContent};
  });return{cards,overflow:document.documentElement.scrollWidth>innerWidth+1,scaleHeight:+document.querySelector('.timeline-stage').dataset.timelineNaturalHeight};
 });
 for(const theme of ['warm','pink-porcelain','carbon-crimson'])for(const width of [320,390,760,1440]){
  await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerResolvedColorMode=theme==='carbon-crimson'?'dark':'light';},theme);
  for(const duration of [10,15,20,30,40]){
   await page.evaluate(d=>{fixtureSet(40);fixtureDuration(d);},duration);await page.waitForTimeout(30);const state=await geometry(),card=state.cards[0];reports.push({theme,width,duration,...state});
   assert.equal(state.overflow,false,`${theme}/${width}/${duration}: page overflow`);
   if(width<=760){assert.equal(card.parts.length,2,'both time and name visible');assert.equal(card.cue,true,'existing details entry');
    assert.ok(card.parts.every(p=>p.top>=card.top-.5&&p.bottom<=card.bottom+.5),`${theme}/${width}/${duration}: text clipped`);
    assert.equal(card.serviceVisible,duration===40,'only compact short visits move service to details');
    assert.equal(card.time.replaceAll(' ','').slice(0,5),'10:00','real start preserved');
   }else{assert.equal(state.scaleHeight,608,'desktop hourly scale preserved');assert.equal(card.cue,false,'desktop unchanged');}
  }
  await page.evaluate(()=>fixtureAdjacent());await page.waitForTimeout(30);const adjacent=await geometry();
  if(width<=760)for(let i=1;i<adjacent.cards.length;i++)assert.ok(adjacent.cards[i].top>=adjacent.cards[i-1].bottom+3,`adjacent visits overlap at ${width}`);
  if(output&&width===390){writeFileSync(resolve(output,'short-grid-geometry.json'),JSON.stringify(reports,null,2));await page.screenshot({path:resolve(output,theme+'-short-grid.png'),fullPage:true});}
 }
 await page.setViewportSize({width:390,height:1000});await page.evaluate(()=>{fixtureSet(10);fixtureReset();document.querySelector('#scheduleViewMenu').open=true;});
 const before=await geometry(),itemsBefore=await page.evaluate(()=>fixtureState().items);
 assert.equal((await page.evaluate(()=>fixturePoint())).time,'11:15','click time before scaling');
 assert.equal((await page.evaluate(()=>fixturePoint())).drag,675,'drag minute before scaling');
 await page.locator('[data-grid-scale="1"]').click();await page.waitForTimeout(30);const after=await geometry();assert.ok(after.scaleHeight>before.scaleHeight,'plus scales all time');
 assert.deepEqual(after.cards[0].parts.map(p=>p.font),before.cards[0].parts.map(p=>p.font),'zoom keeps the existing fonts');
 assert.deepEqual(await page.evaluate(()=>fixtureState().items),itemsBefore,'zoom never changes booking data');
 assert.equal((await page.evaluate(()=>fixturePoint())).time,'11:15','click time after scaling');assert.equal((await page.evaluate(()=>fixturePoint())).drag,675,'drag minute after scaling');
 await page.evaluate(()=>{document.querySelector('#scheduleViewMenu').open=false;fixtureReset();});await page.locator('[data-open-booking="short"] .timeline-details-cue').click();
 const details=await page.evaluate(()=>fixtureState());assert.equal(details.opened,'short','cue follows existing data-open-booking entry');assert.equal(details.dragStarts,0,'cue does not start drag');assert.equal(details.creates,0,'cue does not create a booking');
 await page.evaluate(()=>{fixtureReset();const stage=document.querySelector('.timeline-stage');const touch=(id,x)=>new Touch({identifier:id,target:stage,clientX:x,clientY:600});const dispatch=(name,touches)=>stage.dispatchEvent(new TouchEvent(name,{bubbles:true,cancelable:true,touches,targetTouches:touches,changedTouches:touches}));
  dispatch('touchstart',[touch(1,150),touch(2,250)]);dispatch('touchmove',[touch(1,110),touch(2,290)]);dispatch('touchend',[]);stage.click();
 });await page.waitForTimeout(30);assert.ok((await geometry()).scaleHeight>after.scaleHeight,'two-finger gesture scales the whole grid');assert.equal((await page.evaluate(()=>fixtureState())).creates,0,'pinch suppresses create click');
 const pinchHeight=(await geometry()).scaleHeight;
 await page.evaluate(()=>{fixtureActive(true);const stage=document.querySelector('.timeline-stage');const a=new Touch({identifier:1,target:stage,clientX:150,clientY:600}),b=new Touch({identifier:2,target:stage,clientX:250,clientY:600});stage.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[a,b]}));stage.dispatchEvent(new TouchEvent('touchend',{bubbles:true,cancelable:true,touches:[]}));fixtureActive(false);});
 assert.equal((await geometry()).scaleHeight,pinchHeight,'pinch leaves an active drag alone');
 await page.evaluate(()=>{document.querySelector('#scheduleViewMenu').open=true;});
 while(await page.locator('[data-grid-scale="-1"]').isEnabled())await page.locator('[data-grid-scale="-1"]').click();
 assert.equal((await geometry()).scaleHeight,before.scaleHeight,'minus returns to minimum readable scale');
 assert.equal(await page.locator('.schedule-scale-controls small').isVisible(),true,'minimum for short visits is explained');
 const reduced=(await geometry()).scaleHeight;
 await page.evaluate(()=>{const stage=document.querySelector('.timeline-stage');const t=(id,x)=>new Touch({identifier:id,target:stage,clientX:x,clientY:600});for(const [name,pair] of [['touchstart',[t(1,100),t(2,300)]],['touchmove',[t(1,160),t(2,240)]],['touchend',[]]])stage.dispatchEvent(new TouchEvent(name,{bubbles:true,cancelable:true,touches:pair}));});
 assert.equal((await geometry()).scaleHeight,reduced,'pinch cannot reduce below readable minimum');
 await page.locator('[data-grid-scale="1"]').click();
 const larger=(await geometry()).scaleHeight;
 await page.evaluate(()=>{const stage=document.querySelector('.timeline-stage');const t=(id,x)=>new Touch({identifier:id,target:stage,clientX:x,clientY:600});for(const [name,pair] of [['touchstart',[t(1,100),t(2,300)]],['touchmove',[t(1,120),t(2,280)]],['touchend',[]]])stage.dispatchEvent(new TouchEvent(name,{bubbles:true,cancelable:true,touches:pair}));});
 assert.ok((await geometry()).scaleHeight<larger,'converging fingers reduce the grid');
 while(await page.locator('[data-grid-scale="1"]').isEnabled())await page.locator('[data-grid-scale="1"]').click();
 assert.equal((await geometry()).scaleHeight,before.scaleHeight*3,'maximum scale is bounded');
 await page.evaluate(()=>fixtureSet(60));await page.waitForTimeout(30);
 assert.equal(await page.locator('.schedule-scale-controls small').isVisible(),false,'no short-visit floor on another day');
 while(await page.locator('[data-grid-scale="-1"]').isEnabled())await page.locator('[data-grid-scale="-1"]').click();
 assert.equal((await geometry()).scaleHeight,600,'day without short visits returns to original 75px/hour');
 await page.evaluate(()=>{fixtureReset();const stage=document.querySelector('.timeline-stage');stage.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,cancelable:true,touches:[new Touch({identifier:1,target:stage,clientX:150,clientY:600})]}));});
 assert.equal((await geometry()).scaleHeight,600,'single-finger gesture does not change scale');
 const fixture=await startFixture();
 try {
  const detailContext=await browser.newContext({viewport:{width:390,height:900},locale:'ru-RU'}),origin=new URL(fixture.url).origin;
  await detailContext.route('**/*',route=>new URL(route.request().url()).origin===origin&&route.request().method()==='GET'?route.continue():(forbidden++,route.abort()));
  const detailPage=await detailContext.newPage();detailPage.on('pageerror',e=>errors.push(e.message));await detailPage.goto(fixture.url);
  await detailPage.addScriptTag({content:actual('bookingVisitComment')});
  const comment='Полный комментарий клиента. '.repeat(24),service='Полное название выбранной услуги';
  await detailPage.evaluate(({comment,service})=>{
   document.querySelector('#bookingSheet').hidden=true;
   renderFixture({item:{duration_minutes:10,provider_note:comment,services:{name:service,duration_minutes:10,price_rub:1000}},outcome:{visit_status:'scheduled'}});
   const button=document.createElement('button');button.dataset.openBooking=fixtureBooking.id;button.innerHTML='<span class="timeline-details-cue">›</span>';document.body.append(button);
   document.addEventListener('click',event=>{const card=event.target.closest('[data-open-booking]');if(card)openBookingSheet(card.dataset.openBooking);});
   document.querySelector('#bookingSheet').hidden=true;
  },{comment,service});
  await detailPage.locator('.timeline-details-cue').click();
  assert.equal(await detailPage.locator('#bookingSheet').isVisible(),true,'existing sheet opens');
  assert.equal(await detailPage.locator('.booking-visit-comment p').textContent(),comment.trim(),'full comment is outside the grid');
  assert.ok((await detailPage.locator('#bookingSheetContent').textContent()).includes(service),'full service is in the existing sheet');
  await detailContext.close();
 }finally{await new Promise(resolve=>fixture.server.close(resolve));}
 assert.equal(forbidden,0,'no network writes or external requests');assert.deepEqual(errors,[]);
 console.log('PASS: 60 short-visit renders, 40→10/15/20/30/40, adjacent real slots, whole-grid scale and minute conversion, details routing, guarded synthetic pinch; no writes');
}finally{await browser.close();}
