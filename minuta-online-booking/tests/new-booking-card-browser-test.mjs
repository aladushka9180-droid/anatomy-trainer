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
  await page.evaluate(()=>{const e=document.querySelector('#newBookingError');e.textContent='Укажите полный номер телефона.';e.hidden=false;});
  assert.equal(await page.locator('[data-new-booking-client] .client-framed-avatar').getAttribute('data-session-tier'),'50');
  await page.locator('[data-new-booking-client]').click();
  assert.equal(await page.locator('#newBookingSelectedClient').isVisible(),true);
  assert.equal(await page.locator('#newBookingClientEntry').isVisible(),false);
  assert.equal(await page.locator('#newBookingError').isVisible(),false,'valid selection clears only the stale phone error');
  assert.equal(await page.locator('#newBookingSectionTitle').isVisible(),false,'selected client needs no duplicate heading');
  const actionRows=await page.locator('.new-booking-selected-actions button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().top));
  assert.equal(actionRows[0],actionRows[1],'client actions share one row at all target widths');
  assert.equal(await page.locator('#newBookingSelectedClient .client-framed-count').textContent(),'50');
  assert.equal(await page.getByRole('button',{name:'Карточка и история'}).isVisible(),true);
  await page.locator('[data-new-booking-time="10:30"]').click();
  assert.match(await page.locator('#newBookingWhen').innerText(),/10:30–11:30/);
  await page.locator('#newBookingServiceOpen').click();
  await page.locator('[data-pick-new-booking-service="s2"]').click();
  await page.locator('#newBookingWhen').click();
  await page.locator('[data-new-booking-time="11:00"]').click();
  assert.match(await page.locator('#newBookingWhen').innerText(),/11:00–12:30/);
  assert.match(await page.locator('#newBookingWhen').innerText(),/Дата и время/);
  assert.equal(await page.locator('#newBookingSelectionSummary').isVisible(),false,'footer does not repeat service price and duration');
  if(theme==='pink-porcelain'){
   const button=await page.locator('#newBookingSubmit').evaluate(b=>({ink:getComputedStyle(b).color,fill:getComputedStyle(b).backgroundImage,radius:getComputedStyle(b).borderRadius}));
   assert.equal(button.ink,'rgb(56, 37, 50)','dark ink on the selected pastel action');
   assert.equal(button.fill,'none','flat action with no gradient');assert.equal(button.radius,'24px');
  }
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
  assert.equal(await page.locator('#newBookingSectionTitle').isVisible(),true,'change client restores entry heading');
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
  assert.ok(await page.locator('#newBookingForm').evaluate(form=>form.querySelector('#newBookingWhen').compareDocumentPosition(form.querySelector('.new-booking-advanced'))&Node.DOCUMENT_POSITION_FOLLOWING),'explicit date/time before extras, matching the selected mock');
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
 const phonePage=await browser.newPage({viewport:{width:390,height:950}});
 await phonePage.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 await phonePage.goto(url);await phonePage.waitForFunction(()=>window.fixtureReady);
 const preserved=await phonePage.evaluate(()=>{
  const error=document.querySelector('#newBookingError'),client={...fixtureClient};
  const rows=[];
  const cleared=[];
  for(const phone of ['+7 (900) 000-00-00','8 (900) 000-00-00','9000000000']){
   fixtureClient.displayPhone=phone;error.textContent='Укажите полный номер телефона.';error.hidden=false;
   fixtureSelect();cleared.push(error.hidden);
  }
  for(const phone of ['9000','0079000000000','01234567890','7900000000000000']){
   fixtureClient.phone=phone;fixtureClient.displayPhone=phone;
   error.textContent='Укажите полный номер телефона.';error.hidden=false;fixtureSelect();
   rows.push({phone,hidden:error.hidden});
  }
  Object.assign(fixtureClient,client);
  for(const message of ['Укажите свободное время.','Не удалось сохранить запись.']){
   error.textContent=message;error.hidden=false;fixtureSelect();rows.push({message,hidden:error.hidden});
  }
  document.querySelector('#newBookingName').value='Другое имя';
  error.textContent='Укажите полный номер телефона.';error.hidden=false;
  const refused=fixtureSelect({automatic:true});
  return {rows,cleared,refused,hidden:error.hidden};
 });
 assert.ok(preserved.rows.every(row=>!row.hidden),'invalid phones and unrelated errors remain visible: '+JSON.stringify(preserved));
 assert.ok(preserved.cleared.every(Boolean),'accepted full Russian phone formats clear the stale error');
 assert.equal(preserved.refused,false);assert.equal(preserved.hidden,false,'refused automatic selection keeps validation');
 await phonePage.close();
 console.log('PASS: new booking real renderer, client search/framed selection/edit, service/time/summary, mode roundtrip and synthetic submit; 4 themes × 3 widths.');
}finally{await browser.close();server.close();}
