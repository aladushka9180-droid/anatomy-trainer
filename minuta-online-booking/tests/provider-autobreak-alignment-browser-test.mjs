import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=readFileSync(resolve(root,'provider.js'),'utf8');
function actual(name){const start=source.search(new RegExp(`^function ${name}\\(`,'m'));assert.ok(start>=0,name);const next=source.slice(start+1).search(/^(?:async )?function /m);return source.slice(start,next<0?undefined:start+next+1);}
const {chromium}=process.env.MINUTA_PLAYWRIGHT_MODULE?await import(pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href):createRequire(import.meta.url)('playwright');
const output=process.env.MINUTA_SCHEDULE_OUTPUT;
const candidateCSS=readFileSync(resolve(root,'schedule-flat.css'),'utf8');
const referenceCSS=process.env.MINUTA_BREAK_REFERENCE_CSS?readFileSync(process.env.MINUTA_BREAK_REFERENCE_CSS,'utf8'):null;
if(output)mkdirSync(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.MINUTA_CHROME_PATH});
const reports=[];
try{
 const context=await browser.newContext({viewport:{width:390,height:1000},deviceScaleFactor:2,locale:'ru-RU',bypassCSP:true});
 let forbiddenRequests=0;
 await context.route('**/*',route=>{const request=route.request(),url=new URL(request.url());if(url.origin!=='https://schedule.fixture.invalid'||request.method()!=='GET'){forbiddenRequests++;return route.abort();}const file=resolve(root,'.'+url.pathname);if(!file.startsWith(root))return route.abort();try{let body=referenceCSS&&url.pathname==='/schedule-flat.css'?referenceCSS:readFileSync(file);if(file.endsWith('.html'))body=body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');return route.fulfill({body,contentType:({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.abort();}});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://schedule.fixture.invalid/provider.html');
 await page.addScriptTag({path:resolve(root,'schedule-break-icons.js')});
 const flatStyle=await page.addStyleTag({content:candidateCSS});
 const appearance=()=>page.evaluate(()=>{
  const font=e=>{const s=getComputedStyle(e);return Object.fromEntries(['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','color'].map(k=>[k,s[k]]));};
  const frame=e=>{const s=getComputedStyle(e);return Object.fromEntries(['backgroundColor','backgroundImage','borderColor','borderStyle','borderWidth','borderRadius','boxShadow'].map(k=>[k,s[k]]));};
  const relative=(e,card)=>{const r=e.getBoundingClientRect(),b=card.getBoundingClientRect();return{x:r.x-b.x,y:r.y-b.y,width:r.width,height:r.height};};
  const breaks=[...document.querySelectorAll('[data-open-automatic-break]')].map(card=>{
   const icon=card.querySelector('.schedule-break-icon>.ui-icon'),s=getComputedStyle(icon);
   return{duration:card.dataset.bookingDuration,label:font(card.querySelector('.timeline-automatic-break-label')),time:[...card.querySelectorAll('.timeline-mobile-time,.timeline-booking-time,.timeline-booking-time b,.timeline-booking-time small,.timeline-break-short-time')].map(font),icon:{width:s.width,height:s.height,stroke:s.stroke,strokeWidth:s.strokeWidth},frame:frame(card),...(innerWidth>760?{layout:[...card.querySelectorAll('.timeline-mobile-time,.timeline-automatic-break-label,.schedule-break-icon')].map(e=>relative(e,card))}:{})};
  });
  const visit=document.querySelector('[data-open-booking="visit"]');
  return{breaks,visit:{frame:frame(visit),height:visit.getBoundingClientRect().height,width:visit.getBoundingClientRect().width,parts:[...visit.querySelectorAll('.timeline-mobile-time,.timeline-client-name,.timeline-booking-copy>strong')].map(e=>({font:font(e),box:relative(e,visit)}))}};
 });
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting','requires-top-level');document.querySelector('#providerBoot')?.remove();document.querySelector('#authCard').hidden=true;
  document.querySelector('#dashboard').hidden=false;document.querySelector('#dashboard').dataset.activeView='bookings';document.querySelectorAll('.provider-view').forEach(e=>e.hidden=e.dataset.providerPanel!=='bookings');
  document.body.dataset.providerTheme='warm';document.body.dataset.providerLayout='soft';document.body.dataset.providerResolvedColorMode='light';
  document.querySelector('.booking-filters').hidden=true;document.querySelector('#scheduleMobileSummary').hidden=false;document.querySelector('.schedule-menu-journal').hidden=false;
  document.querySelector('#dateStrip').innerHTML=[12,13,14,15,16].map((d,i)=>`<button data-booking-date="2026-10-${d}" class="${d===14?'active':''}"><span>${['Пн','Вт','Ср','Чт','Пт'][i]}</span><strong>${d}</strong><small>окт</small></button>`).join('');
  document.querySelector('#scheduleDatePicker').value='2026-10-14';document.querySelector('#selectedDateTitle .selected-date-title-mobile').textContent='Среда';
 });
 await page.addScriptTag({content:`
 const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let selectedDate='2026-10-14',recentlyCreatedBookingId='',displayPreferences={break_icons:{automatic:'pause'},show_notes:false};
 const scheduleDirty=false,daysOff=[],scheduleRows=[{weekday:3,enabled:true}],parseLocalIsoDate=v=>new Date(v+'T12:00:00');
 ${actual('scheduleStateForDate')}${actual('scheduleEmptyDayLabel')}${actual('uiIcon')}${actual('syncCompactScheduleOrder')}${actual('syncScheduleDateDisplay')}
 const businessTodayIso=()=> '2026-10-13',automaticBookingBreaks=()=>[],timelineBounds=()=>({start:600,end:1080}),stackMinuteTimelineItems=()=>{};
 const minutesFromTime=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5)),timeFromMinutes=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const bookingStatus=i=>i.status,bookingStatusClass=i=>i.status,isScheduleBlock=i=>i.status==='block',bookingDisplayNote=()=>'',compactBookingCardsEnabled=()=>false,bookingVisitSummaryText=()=>'',bookingVisitSummaryMarkup=()=>'',clientHighlightClasses=()=>'',clientBadgeText=()=>'',clientBadgeMarkup=()=>'',timelineMoveRestriction=()=>'',timelineServiceNameMarkup=n=>escapeHtml(n),bookingNotePresenceMarkup=()=>'',bookingColor=()=> 'auto',serviceName=n=>n,scheduleNowMarkerMarkup=()=>'',timelineEmptyHintOffsetMinutes=()=>120,scheduleCreateHintMarkup=()=>'';
 const items=[20,30,40,60,90].map((d,i)=>({id:'auto-'+d,booking_date:selectedDate,booking_time:['10:00','11:00','12:00','13:00','14:30'][i],duration_minutes:d,status:'block',automatic_break:true}));
 items.push({id:'visit',booking_date:selectedDate,booking_time:'16:30',duration_minutes:40,status:'confirmed',client_name:'Тестовый клиент',services:{name:'Тестовая услуга'}});
 ${actual('renderTimeline')}
 function redraw(){syncScheduleDateDisplay();syncCompactScheduleOrder();renderTimeline(items);}
 window.fixtureRedraw=redraw;redraw();
 PrimeTimeBreakIcons.init({preferences:()=>displayPreferences,save:p=>{displayPreferences=p;redraw();},bookings:()=>items,isBlock:isScheduleBlock});
 window.fixtureIcon=key=>{displayPreferences={...displayPreferences,break_icons:{automatic:key}};redraw();};
 `});
 for(const theme of ['warm','pink-porcelain','carbon-crimson'])for(const width of [320,390,760,1440]){
  await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{document.body.dataset.providerTheme=theme;document.body.dataset.providerResolvedColorMode=theme==='carbon-crimson'?'dark':'light';fixtureRedraw();},theme);await page.waitForTimeout(100);await page.evaluate(()=>document.fonts.ready);
  if(referenceCSS){await flatStyle.evaluate((e,css)=>e.textContent=css,referenceCSS);const before=await appearance();await flatStyle.evaluate((e,css)=>e.textContent=css,candidateCSS);assert.deepEqual(await appearance(),before,`${theme}/${width}: retain typography, icon, frame and ordinary visit layout`);}
  const state=await page.evaluate(()=>{
   const r=e=>{const b=e.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height,top:b.top,bottom:b.bottom,left:b.left,right:b.right,cy:(b.top+b.bottom)/2};};
   const visible=e=>e&&r(e).width>0&&r(e).height>0&&getComputedStyle(e).display!=='none';
   const textRect=e=>{if(!visible(e))return null;const range=document.createRange();range.selectNodeContents(e);const b=range.getBoundingClientRect();return{top:b.top,bottom:b.bottom,height:b.height,cy:(b.top+b.bottom)/2,left:b.left,right:b.right};};
   const cards=[...document.querySelectorAll('[data-open-automatic-break]')].map(card=>{
    const duration=Number(card.dataset.bookingDuration),box=r(card),icon=card.querySelector('.schedule-break-icon'),label=card.querySelector('.timeline-automatic-break-label'),time=[...card.querySelectorAll('.timeline-break-short-time,.timeline-mobile-time,.timeline-booking-time')].find(visible);
    const t=textRect(time),l=textRect(label),parts=[t,l].filter(Boolean),content=l?{top:Math.min(...parts.map(b=>b.top)),bottom:Math.max(...parts.map(b=>b.bottom))}:null;
    const horizontal=l?{left:Math.min(...parts.map(b=>b.left),r(icon).left),right:Math.max(...parts.map(b=>b.right),r(icon).right)}:null;
    const singleLine=!!card.querySelector('.timeline-break-short-time')||!card.querySelector('.timeline-booking-client-row');
    return{duration,height:box.height,iconCenterDelta:visible(icon)?Math.abs(r(icon).cy-box.cy):null,textCenterDelta:content?Math.abs((content.top+content.bottom)/2-box.cy):null,groupCenterXDelta:horizontal?Math.abs((horizontal.left+horizontal.right)/2-(box.left+box.right)/2):null,timeVisible:!!t,labelVisible:!!l,textFits:!!content&&content.top>=box.top-.5&&content.bottom<=box.bottom+.5&&parts.every(b=>b.left>=box.left-.5&&b.right<=box.right+.5),timeBeforeLabel:!t||!!l&&(singleLine?t.right<=l.left+1:t.bottom<=l.top+1),backgroundImage:getComputedStyle(card).backgroundImage};
   });
   const summary=document.querySelector('.schedule-toolbar'),timeline=document.querySelector('.schedule-workspace'),stage=document.querySelector('.timeline-stage');
   const active=document.querySelector('#dateStrip .active'),month=active.querySelector('small');
   return{cards,summary:r(summary),timeline:r(timeline),stageHeight:r(stage).height,gradient:getComputedStyle(active).backgroundImage,monthsVisible:visible(month),overflow:document.documentElement.scrollWidth>innerWidth+1};
  });
  reports.push({theme,width,...state});
  if(output){writeFileSync(resolve(output,'geometry.json'),JSON.stringify(reports,null,2));await page.screenshot({path:resolve(output,`${theme}-${width}.png`),fullPage:true});if(width===390)await page.locator('[data-booking-duration="60"][data-open-automatic-break]').screenshot({path:resolve(output,`${theme}-break-60.png`)});}
  assert.equal(state.overflow,false,`${theme}/${width}: page overflow`);assert.equal(state.gradient,'none');assert.equal(state.monthsVisible,true);
  if(width<=760){assert.ok(Math.abs(state.summary.left-state.timeline.left)<1,`${theme}/${width}: shared left edge`);assert.ok(Math.abs(state.summary.right-state.timeline.right)<1,`${theme}/${width}: shared right edge`);}
  if(width<=760)for(const card of state.cards){const id=`${theme}/${width}/${card.duration}`;assert.equal(card.timeVisible,![20,40].includes(card.duration),`${id}: preserve existing time visibility`);assert.equal(card.labelVisible,true,`${id}: label visible`);assert.equal(card.textFits,true,`${id}: text stays inside real time slot`);assert.ok(card.iconCenterDelta<=.75,`${id}: pause centered (${card.iconCenterDelta})`);assert.ok(card.textCenterDelta<=2,`${id}: text centered (${card.textCenterDelta})`);assert.ok(card.groupCenterXDelta<=1.5,`${id}: entire group centered horizontally (${card.groupCenterXDelta})`);assert.equal(card.timeBeforeLabel,true,`${id}: existing compact line or two centered rows`);assert.equal(card.backgroundImage,'none');}
 }
 for(const [value,month] of [['2026-12-31','декабрь 2026'],['2027-01-01','январь 2027'],['2026-10-14','октябрь 2026']]){
  await page.evaluate(value=>{document.querySelector('#scheduleDatePicker').value=value;syncScheduleDateDisplay();},value);
  assert.equal(await page.locator('#scheduleDateDisplay').textContent(),month,'Visible month/year follows the actual date');
  assert.equal(await page.locator('#scheduleDatePicker').inputValue(),value,'Presentation does not change the ISO date');
 }
 for(const key of ['coffee','none','pause']){
  await page.evaluate(key=>fixtureIcon(key),key);await page.waitForTimeout(20);
  assert.equal(await page.locator('[data-open-automatic-break][data-booking-duration="20"] .schedule-break-icon').getAttribute('data-break-icon'),key,'Existing icon preference survives');
  assert.equal(await page.locator('[data-open-automatic-break][data-booking-duration="20"] .timeline-booking-time').isVisible(),false,'Centering does not reveal a previously hidden time');
 }
 assert.equal(forbiddenRequests,0,'fixture made no external requests or writes');assert.deepEqual(errors,[]);
 console.log(`PASS: ${reports.length} theme/width layouts, 20/30/40/60/90-minute automatic breaks, both center axes, shared card edges, flat dates, no writes${referenceCSS?', unchanged fonts/icons/frames/ordinary visit':''}`);
}finally{await browser.close();}
