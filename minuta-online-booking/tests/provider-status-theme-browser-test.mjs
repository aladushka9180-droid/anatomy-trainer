import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {startFixture} from './client-profile-card-fixture.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const provider=readFileSync(resolve(root,'provider.js'),'utf8').replaceAll('\r\n','\n');
const actual=name=>{
  const start=provider.search(new RegExp(`^function ${name}\\(`,'m'));
  assert.ok(start>=0,name);
  const next=provider.slice(start+1).search(/^(?:async )?function /m);
  assert.ok(next>=0,name+' boundary');
  return provider.slice(start,start+next+1);
};
const output=process.env.MINUTA_STATUS_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture(),browser=await chromium.launch({headless:true});
const errors=[],blocked=[],results=[];
try{
  const page=await browser.newPage({viewport:{width:390,height:950},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    if(!route.request().url().startsWith(url)||route.request().method()!=='GET'){
      blocked.push(route.request().method()+' '+route.request().url());return route.abort();
    }
    return route.continue();
  });
  await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);
  await page.addScriptTag({url:url+'theme-catalog.js'});
  await page.addScriptTag({content:`(()=>{
    const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const isScheduleBlock=()=>false,bookingOutcome=item=>item.outcome,bookingIsCompleted=()=>false,serviceName=name=>name;
    ${actual('bookingStatus')}${actual('bookingStatusClass')}${actual('bookingDetailHeaderMarkup')}
    const item={id:'synthetic-only',status:'confirmed',booking_time:'12:00:00',services:{name:'Проверочная услуга'},outcome:{visit_status:'scheduled'}};
    const fixture=document.createElement('section');fixture.id='statusColorFixture';fixture.style.cssText='max-width:700px;margin:auto';
    fixture.innerHTML='<div id="bookingSheet" class="booking-sheet-reference"><div class="booking-repeat-actions"></div>'+bookingDetailHeaderMarkup(item,new Date('2099-10-16T12:00:00'),60,bookingStatus(item),bookingStatusClass(item),'3 000 ₽')+
      '<div class="booking-sheet-meta"><span class="booking-status status-confirmed" data-status-case="team">Подтверждена</span></div>'+
      '<span class="booking-status status-visited detail-card-completed" data-status-case="detail-completed">Состоялся</span></div>'+
      '<div class="schedule-list"><article class="provider-booking status-confirmed"><div class="provider-booking-signals"><span class="booking-status" data-status-case="schedule-list">Подтверждена</span></div></article></div>'+
      '<div class="client-history-item status-confirmed"><span data-status-case="legacy-history">Подтверждена</span></div>'+
      '<div class="client-booking-item status-confirmed"><div class="client-booking-item-head"><span data-status-case="legacy-bookings">Подтверждена</span></div></div>'+
      '<div class="timeline-booking status-visited"><span class="timeline-booking-status" data-status-case="timeline-completed">Состоялся</span></div>'+
      '<div class="timeline-booking status-confirmed"><span class="timeline-booking-status" data-status-case="timeline-confirmed">Подтверждена</span></div>'+
      '<div class="status-no-show"><span class="booking-status" data-status-case="no-show">Не пришёл</span></div>'+
      '<div class="status-cancelled"><span class="booking-status" data-status-case="cancelled">Отменена</span></div>'+
      '<div class="timeline-booking status-visited is-imported-history"><span class="timeline-booking-status" data-status-case="imported">Импортировано</span></div>'+
      '<article class="timeline-booking status-confirmed color-mint" data-status-case="manual-card">Ручной цвет карточки</article>';
    fixture.querySelector('.booking-detail-heading .booking-status').dataset.statusCase='detail';
    document.body.append(fixture);
    window.statusThemeCases=MinutaThemeCatalog.themes.map(t=>({name:t.key,key:t.key,palette:t.palette}));
    for(const shade of MinutaThemeCatalog.porcelainShades)statusThemeCases.push({name:'porcelain/'+shade.key,key:'pink-porcelain',palette:shade.palette});
    window.applyStatusTheme=c=>{
      document.body.dataset.providerTheme=c.key;
      for(const [key,value] of Object.entries(c.palette)){
        const property={surfaceAlt:'surface-alt',accentSoft:'accent-soft',contrast:'accent-contrast'}[key]||key;
        if(typeof value==='string')document.body.style.setProperty('--theme-'+property,value);
      }
    };
    window.statusColors=e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,display:s.display,font:s.font,padding:s.padding,border:s.borderWidth+' '+s.borderStyle,borderColor:s.borderColor,radius:s.borderRadius,rect:e.getBoundingClientRect().toJSON()};};
    window.statusContrast=e=>{
      const s=getComputedStyle(e),canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d',{willReadFrequently:true});
      const lum=value=>{c.clearRect(0,0,1,1);c.fillStyle=value;c.fillRect(0,0,1,1);const [r,g,b]=c.getImageData(0,0,1,1).data;return [r,g,b].map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);};
      const a=lum(s.color),b=lum(s.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    };
  })();`});
  const boundStylesheet=page.locator('link[rel="stylesheet"][href^="provider-status-theme.css"]');
  assert.ok(await boundStylesheet.count()<=1,'one production stylesheet binding');
  const stylesheet=await boundStylesheet.count()?await boundStylesheet.elementHandle():await page.addStyleTag({url:url+'provider-status-theme.css'});
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
  assert.equal(await page.locator('.profile-card-status.is-confirmed').count(),2,'confirmed is not completed in the real profile renderer');
  assert.equal(await page.locator('.profile-card-status.is-success').count(),1,'only the real completed visit is success');
  assert.equal(await page.locator('.profile-card-status.is-success').textContent(),'Состоялся');
  const confirmed='.profile-card-status.is-confirmed,[data-status-case="detail"],[data-status-case="team"],[data-status-case="schedule-list"],[data-status-case="legacy-history"],[data-status-case="legacy-bookings"],[data-status-case="timeline-confirmed"]';
  const completed='.profile-card-status.is-success,[data-status-case="detail-completed"],[data-status-case="timeline-completed"]';
  const unchanged='.profile-card-status.is-muted,.profile-card-status.is-imported,[data-status-case="cancelled"],[data-status-case="no-show"],[data-status-case="imported"],[data-status-case="manual-card"]';
  const cases=await page.evaluate(()=>statusThemeCases);
  for(const theme of cases)for(const width of [390,760,1440]){
    await page.setViewportSize({width,height:950});await page.evaluate(c=>applyStatusTheme(c),theme);
    await stylesheet.evaluate(e=>e.sheet.disabled=true);
    const before=await page.locator(unchanged).evaluateAll(es=>es.map(statusColors));
    const metricsBefore=await page.locator(confirmed+','+completed).evaluateAll(es=>es.map(statusColors));
    await stylesheet.evaluate(e=>e.sheet.disabled=false);
    const after=await page.locator(unchanged).evaluateAll(es=>es.map(statusColors));
    assert.deepEqual(after,before,theme.name+'/'+width+': unrelated states and manual card color unchanged');
    const state=await page.evaluate(({confirmed,completed})=>{
      const probe=document.createElement('span');probe.style.cssText='display:none;background:var(--theme-accent-soft);color:var(--theme-ink)';document.body.append(probe);
      const expected=getComputedStyle(probe),background=expected.backgroundColor,color=expected.color;probe.remove();
      const read=selector=>[...document.querySelectorAll(selector)].map(e=>({label:e.textContent.trim(),...statusColors(e),contrast:statusContrast(e)}));
      return {background,color,confirmed:read(confirmed),completed:read(completed),overflow:document.documentElement.scrollWidth>innerWidth+1};
    },{confirmed,completed});
    assert.equal(state.overflow,false,theme.name+'/'+width+': page overflow');
    for(const status of state.confirmed){
      assert.equal(status.background,state.background,theme.name+': confirmed follows accent soft');
      assert.equal(status.color,state.color,theme.name+': confirmed follows readable theme ink');
      assert.ok(status.contrast>=4.5,theme.name+': confirmed text contrast '+status.contrast);
    }
    for(const status of state.completed){assert.equal(status.color,state.color);assert.ok(status.contrast>=4.5,theme.name+': completed contrast '+status.contrast);}
    const metricsAfter=[...state.confirmed,...state.completed];
    for(let i=0;i<metricsBefore.length;i++){
      const previous=metricsBefore[i],next=await page.locator(confirmed+','+completed).nth(i).evaluate(e=>statusColors(e));
      for(const key of ['font','padding','border','radius','rect','display'])assert.deepEqual(next[key],previous[key],theme.name+': preserve '+key);
    }
    results.push({theme:theme.name,width,confirmedCount:state.confirmed.length,completedCount:state.completed.length,minContrast:Math.min(...metricsAfter.map(s=>s.contrast))});
  }
  await page.setViewportSize({width:390,height:950});await page.evaluate(c=>applyStatusTheme(c),cases.find(t=>t.name==='pink-porcelain'));
  await page.locator('[data-client-profile-jump="history"]').click();
  await page.locator('.profile-card-visit-open[data-open-booking="future"]').click();
  assert.equal(await page.evaluate(()=>fixtureClicks.at(-1)),'future','original profile booking target retained');
  if(output){
    await page.locator('#clientProfileVisitHistory').scrollIntoViewIfNeeded();await page.screenshot({path:resolve(output,'after-390.png')});
    for(const theme of ['sage','graphite']){await page.evaluate(c=>applyStatusTheme(c),cases.find(t=>t.name===theme));await page.screenshot({path:resolve(output,'after-'+theme+'.png')});}
    writeFileSync(resolve(output,'REPORT.json'),JSON.stringify({status:'PASS_SOURCE_ONLY',themes:cases.length,widths:[390,760,1440],cases:results.length,errors,blocked,limits:['synthetic isolated fixture','booking router boundary observed only; no authenticated transition','HTML/SW binding is owned by release coordinator'],results},null,2));
  }
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
  console.log('Provider status theme: '+results.length+' theme/width cases PASS; confirmed, completed, unchanged states, geometry, and profile click PASS.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
