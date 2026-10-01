import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {startFixture} from './new-booking-card-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();
const browser=await chromium.launch();
const out=process.env.MINUTA_SCREENSHOT_DIR;
if(out)mkdirSync(out,{recursive:true});
try {
 for(const theme of ['pink-porcelain','noir-rose','midnight','sage'])for(const width of [390,760,1440]){
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
  await page.goto(url);await page.waitForFunction(()=>window.fixtureReady||window.fixtureError);
  assert.equal(await page.evaluate(()=>window.fixtureError),undefined);
  await page.addScriptTag({content:readFileSync(new URL('../provider-selects.js',import.meta.url),'utf8')});
  await page.addScriptTag({content:readFileSync(new URL('../provider-porcelain-matrix.js',import.meta.url),'utf8')});
  await page.evaluate(t=>{
   document.body.dataset.providerTheme=t;
   const palette=MinutaProviderPorcelainMatrix.paletteFor('petal','gentle-pink');
   document.body.style.setProperty('--porcelain-action-bg',palette.actionBg);
   document.body.style.setProperty('--porcelain-action-ink',palette.actionInk);
  },theme);
  await page.locator('#newBookingName').fill('Ан');
  assert.equal(await page.locator('[data-new-booking-client] .client-framed-avatar').getAttribute('data-session-tier'),'50');
  await page.locator('[data-new-booking-client]').click();
  assert.equal(await page.locator('#newBookingSelectedClient').isVisible(),true);
  assert.equal(await page.locator('#newBookingClientEntry').isVisible(),false);
  assert.equal(await page.locator('#newBookingSelectedClient .client-framed-count').textContent(),'50');
  assert.equal(await page.getByRole('button',{name:'Карточка и история'}).isVisible(),true);
  await page.locator('[data-new-booking-time="10:30"]').click();
  assert.match(await page.locator('#newBookingWhen').innerText(),/10:30–11:30/);
  await page.locator('#newBookingServiceOpen').click();
  await page.locator('[data-pick-new-booking-service="s2"]').click();
  await page.locator('#newBookingWhen').click();
  await page.locator('[data-new-booking-time="11:00"]').click();
  assert.match(await page.locator('#newBookingWhen').innerText(),/11:00–12:30/);
  assert.match(await page.locator('#newBookingServiceMeta').innerText(),/90 мин/);
  const layout=await page.evaluate(()=>{
   const panel=document.querySelector('.booking-sheet-panel');
   const avatar=document.querySelector('#newBookingSelectedClient .client-framed-avatar');
   const copy=document.querySelector('.new-booking-selected-copy');
   return {overflow:panel.scrollWidth-panel.clientWidth,page:document.documentElement.scrollWidth-innerWidth,
    gap:copy.getBoundingClientRect().left-avatar.getBoundingClientRect().right,
    tabRadius:getComputedStyle(document.querySelector('.new-booking-mode-toggle')).borderRadius};
  });
  assert.ok(layout.overflow<=1,JSON.stringify(layout));assert.ok(layout.page<=1);assert.ok(layout.gap>=16);assert.equal(layout.tabRadius,'0px');
  if(out&&width===390)await page.screenshot({path:resolve(out,`new-booking-${theme}.png`)});
  await page.locator('#newBookingSelectedClient').getByRole('button',{name:'Изменить',exact:true}).click();
  assert.equal(await page.locator('#newBookingName').isVisible(),true);
  await page.locator('#newBookingName').fill('Ан');await page.locator('[data-new-booking-client]').click();
  await page.locator('[data-new-booking-mode="block"]').click();
  assert.equal(await page.locator('#bookingSheet').evaluate(e=>e.classList.contains('new-booking-card')),false);
  assert.equal(await page.locator('#newBookingSelectionSummary').isVisible(),false);
  await page.locator('[data-new-booking-mode="client"]').click();
  assert.equal(await page.locator('#bookingSheet').evaluate(e=>e.classList.contains('new-booking-card')),true);
  if(!await page.locator('[data-new-booking-time="10:00"]').isVisible())await page.locator('#newBookingWhen').click();
  await page.locator('[data-new-booking-time="10:00"]').click();
  await page.locator('#newBookingSubmit').click();
  const result=await page.evaluate(()=>window.fixtureSubmitted);
  assert.equal(result.name,'Анна');assert.equal(result.time,'10:00');assert.equal(result.service,'s2');
  await page.evaluate(()=>{document.querySelector('#newBookingPhone').value='+7 900 000-00-02';fixtureRefresh();});
  assert.equal(await page.getByRole('button',{name:'Карточка и история'}).isVisible(),false);
  await page.evaluate(()=>fixtureOpen({clientName:'Анна',clientPhone:'79000000000',serviceId:'s1',repeatVisit:{
   source_booking_id:'00000000-0000-4000-8000-000000000777',source_signature:'a'.repeat(64),
   client_name:'Анна',client_phone:'79000000000',duration_minutes:80,total_price_rub:3600,comment:'Без изменений',
   items:[{kind:'primary',service_id:'s1',title:'Основная услуга',duration_minutes:60,price_rub:3000},
    {kind:'addon',service_id:'s2',title:'Дополнение',duration_minutes:20,price_rub:600,extends_duration:true}],
   materials:[{inventory_item_id:'mat-1',name:'Масло',unit:'мл',quantity:12}]
  }}));
  assert.equal(await page.locator('#newBookingModeToggle').isVisible(),false,'repeat has one fixed mode');
  assert.equal(await page.locator('#compactRepeatDetails').getAttribute('open'),null,'composition is initially compact');
  assert.match(await page.locator('#compactRepeatDetails>summary').innerText(),/Основная услуга \+ ещё 1/);
  await page.locator('#compactRepeatDetails>summary').click();
  assert.equal(await page.locator('#repeatVisitPreview .repeat-visit-row').count(),2);
  assert.match(await page.locator('.repeat-visit-materials').innerText(),/Масло/);
  assert.equal(await page.locator('#repeatVisitTotalPrice').inputValue(),'3600');
  assert.equal(await page.locator('#repeatVisitComment').inputValue(),'Без изменений');
  await page.locator('#repeatVisitComment').fill('Пожелание для повтора');
  await page.locator('#repeatVisitTotalPrice').fill('3700');
  await page.locator('#compactRepeatDetails>summary').click();
  await page.locator('[data-new-booking-time="10:30"]').click();
  assert.equal(await page.locator('#newBookingDateTimeEditor').isVisible(),false);
  assert.match(await page.locator('#newBookingWhen').innerText(),/10:30–11:50/);
  await page.locator('#newBookingWhen').click();
  assert.equal(await page.locator('#newBookingDateTimeEditor').isVisible(),true);
  await page.locator('[data-new-booking-time="11:00"]').click();
  assert.match(await page.locator('#newBookingWhen').innerText(),/11:00–12:20/);
  await page.locator('#compactRepeatDetails>summary').click();
  assert.equal(await page.locator('#repeatVisitTotalPrice').inputValue(),'3700','price survives date/time redraw');
  assert.equal(await page.locator('#repeatVisitComment').inputValue(),'Пожелание для повтора','comment survives redraw');
  assert.ok(await page.locator('#newBookingForm').evaluate(form=>form.querySelector('.new-booking-advanced').compareDocumentPosition(form.querySelector('#newBookingWhen'))&Node.DOCUMENT_POSITION_FOLLOWING),'extras before date/time');
  assert.ok(await page.locator('.booking-sheet-panel').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'repeat no overflow');
  await page.locator('#compactRepeatDetails>summary').click();
  if(out&&theme==='pink-porcelain')await page.screenshot({path:resolve(out,`repeat-compact-${width}.png`)});
  for(const selector of ['#newBookingHistoricalPayment','#newBookingFlexibleEndField']){
   await page.evaluate(selector=>{document.querySelector(selector).hidden=false;fixtureRefresh();},selector);
   assert.equal(await page.locator('#newBookingDateTimeEditor').isVisible(),true,`${selector}: special controls remain expanded`);
   assert.equal(await page.locator('#newBookingWhen').isVisible(),false,`${selector}: no compact duplicate`);
   await page.evaluate(selector=>{document.querySelector(selector).hidden=true;fixtureRefresh();},selector);
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage({viewport:{width:360,height:640},reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);
 await page.addScriptTag({content:readFileSync(new URL('../provider-selects.js',import.meta.url),'utf8')});
 await page.evaluate(()=>fixtureSelect());
 await page.locator('#newBookingServiceOpen').click();await page.locator('[data-pick-new-booking-service="s3"]').click();
 await page.locator('#newBookingDuration').fill('75');await page.locator('#newBookingDuration').press('Tab');
 await page.locator('[data-new-booking-time="10:30"]').click();
 assert.match(await page.locator('#newBookingWhen').innerText(),/10:30–11:45/);
 assert.match(await page.locator('#newBookingServiceMeta').innerText(),/75 мин · 3\s750 ₽/);
 await page.locator('#newBookingSubmit').click();assert.equal(await page.evaluate(()=>fixtureSubmitted.service),'s3');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.close();
 console.log('PASS: new booking real renderer, client search/framed selection/edit, service/time/summary, mode roundtrip and synthetic submit; 4 themes × 3 widths.');
}finally{await browser.close();server.close();}
