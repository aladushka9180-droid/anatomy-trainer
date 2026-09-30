import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
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
  await page.evaluate(t=>document.body.dataset.providerTheme=t,theme);
  await page.locator('#newBookingName').fill('Ан');
  assert.equal(await page.locator('[data-new-booking-client] .client-framed-avatar').getAttribute('data-session-tier'),'50');
  await page.locator('[data-new-booking-client]').click();
  assert.equal(await page.locator('#newBookingSelectedClient').isVisible(),true);
  assert.equal(await page.locator('#newBookingClientEntry').isVisible(),false);
  assert.equal(await page.locator('#newBookingSelectedClient .client-framed-count').textContent(),'50');
  assert.equal(await page.getByRole('button',{name:'Карточка и история'}).isVisible(),true);
  await page.locator('[data-new-booking-time="10:30"]').click();
  assert.match(await page.locator('#newBookingSelectionSummary').innerText(),/10:30–11:30/);
  await page.locator('#newBookingServiceOpen').click();
  await page.locator('[data-pick-new-booking-service="s2"]').click();
  await page.locator('[data-new-booking-time="11:00"]').click();
  assert.match(await page.locator('#newBookingSelectionSummary').innerText(),/11:00–12:30/);
  assert.match(await page.locator('#newBookingServiceMeta').innerText(),/90 мин/);
  const layout=await page.evaluate(()=>{
   const panel=document.querySelector('.booking-sheet-panel');
   const avatar=document.querySelector('#newBookingSelectedClient .client-framed-avatar');
   const copy=document.querySelector('.new-booking-selected-copy');
   return {overflow:panel.scrollWidth-panel.clientWidth,page:document.documentElement.scrollWidth-innerWidth,
    gap:copy.getBoundingClientRect().left-avatar.getBoundingClientRect().right,
    tabRadius:getComputedStyle(document.querySelector('.new-booking-mode-toggle')).borderRadius};
  });
  assert.ok(layout.overflow<=1,JSON.stringify(layout));assert.ok(layout.page<=1);assert.ok(layout.gap>=0);assert.equal(layout.tabRadius,'0px');
  if(out&&width===390)await page.screenshot({path:resolve(out,`new-booking-${theme}.png`)});
  await page.getByRole('button',{name:'Изменить'}).click();
  assert.equal(await page.locator('#newBookingName').isVisible(),true);
  await page.locator('#newBookingName').fill('Ан');await page.locator('[data-new-booking-client]').click();
  await page.locator('[data-new-booking-mode="block"]').click();
  assert.equal(await page.locator('#bookingSheet').evaluate(e=>e.classList.contains('new-booking-card')),false);
  assert.equal(await page.locator('#newBookingSelectionSummary').isVisible(),false);
  await page.locator('[data-new-booking-mode="client"]').click();
  assert.equal(await page.locator('#bookingSheet').evaluate(e=>e.classList.contains('new-booking-card')),true);
  await page.locator('[data-new-booking-time="10:00"]').click();
  await page.locator('#newBookingSubmit').click();
  const result=await page.evaluate(()=>window.fixtureSubmitted);
  assert.equal(result.name,'Анна');assert.equal(result.time,'10:00');assert.equal(result.service,'s2');
  await page.evaluate(()=>{document.querySelector('#newBookingPhone').value='+7 900 000-00-02';fixtureRefresh();});
  assert.equal(await page.getByRole('button',{name:'Карточка и история'}).isVisible(),false);
  assert.deepEqual(errors,[]);await page.close();
 }
 const page=await browser.newPage({viewport:{width:360,height:640},reducedMotion:'reduce'});
 await page.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>fixtureSelect());
 await page.locator('#newBookingServiceOpen').click();await page.locator('[data-pick-new-booking-service="s3"]').click();
 await page.locator('#newBookingDuration').fill('75');await page.locator('#newBookingDuration').press('Tab');
 await page.locator('[data-new-booking-time="10:30"]').click();
 assert.match(await page.locator('#newBookingSelectionSummary').innerText(),/10:30–11:45/);
 assert.match(await page.locator('#newBookingServiceMeta').innerText(),/75 мин · 3\s750 ₽/);
 await page.locator('#newBookingSubmit').click();assert.equal(await page.evaluate(()=>fixtureSubmitted.service),'s3');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.close();
 console.log('PASS: new booking real renderer, client search/framed selection/edit, service/time/summary, mode roundtrip and synthetic submit; 4 themes × 3 widths.');
}finally{await browser.close();server.close();}
