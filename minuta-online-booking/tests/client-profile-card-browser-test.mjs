import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {startFixture} from './client-profile-card-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>route.request().url().startsWith(url)?route.continue():route.abort());await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);
 for(const theme of ['pink-porcelain','sage','noir-rose','midnight']){
  await page.locator('body').evaluate((el,t)=>el.dataset.providerTheme=t,theme);
  for(const width of [390,760,1440]){
   await page.setViewportSize({width,height:950});
   const geometry=await page.evaluate(()=>{const r=s=>document.querySelector(s).getBoundingClientRect().toJSON();return {avatar:r('#clientAvatar'),plaque:r('#clientProfileOrbit .loyalty-frame-count'),action:r('#clientQuickRepeat'),tabs:r('.client-profile-tabs'),name:r('#clientName'),overflow:document.documentElement.scrollWidth-innerWidth};});
   assert.ok(geometry.overflow<=1,`${theme}/${width}: overflow`);
   assert.ok(geometry.avatar.right<geometry.name.left,`${theme}/${width}: avatar beside name`);
   assert.ok(geometry.name.left-geometry.avatar.right<115,`${theme}/${width}: identity stays next to avatar`);
   assert.ok(geometry.plaque.top>=geometry.avatar.top+geometry.avatar.height*.65,`${theme}/${width}: face centre clear`);
   assert.ok(geometry.action.top<550&&geometry.action.height>=48,`${theme}/${width}: primary action prominent`);
   assert.ok(geometry.action.width>geometry.name.right-geometry.avatar.left,`${theme}/${width}: primary action spans header`);
   assert.equal(await page.locator('.profile-card-totals .client-summary-icon').first().isVisible(),false);
   assert.ok(geometry.tabs.top>geometry.action.bottom);
   assert.equal(await page.locator('#clientRecords [data-cr-view=history]').isVisible(),false);
   assert.equal(await page.locator('#clientProfileCall').getAttribute('href'),'tel:79000000000');
   const contactStyles=await page.evaluate(()=>['clientContactButton','clientProfileCall'].map(id=>{const s=getComputedStyle(document.getElementById(id));return [s.backgroundColor,s.color,s.borderWidth];}));
   assert.deepEqual(contactStyles[0],contactStyles[1],`${theme}/${width}: both contact actions follow theme equally`);
   const history=await page.locator('#clientProfileVisitHistory').innerText();
   assert.match(history,/Предстоящие записи/);assert.match(history,/Прошлые записи/);assert.match(history,/Долг 1\s000 ₽/);assert.match(history,/Импортировано/);assert.match(history,/Не пришёл/);
   if(process.env.MINUTA_SCREENSHOT_DIR){mkdirSync(process.env.MINUTA_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.MINUTA_SCREENSHOT_DIR}/profile-${theme}-${width}.png`,fullPage:true});}
  }
 }
 await page.setViewportSize({width:390,height:950});
 for(const total of [0,3,6,9,10,20,30,40,50,60,70,80,90,100]){
  await page.evaluate(total=>{PrimeTimeLoyaltyFrames.render({client:{phone:'fixture-frame',bookings:[],imported:{visit_count:total}},outcome:item=>item.outcome,complete:true});},total);
  assert.equal(await page.locator('#clientProfileOrbit .loyalty-frame-count').innerText(),String(total));
 }
 await page.evaluate(()=>renderProfile());
 const [photoChooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('.client-profile-photo-open').click()]);
 assert.equal(await photoChooser.element().getAttribute('id'),'clientAvatarInput','Mobile avatar opens the existing photo picker');
 assert.equal(await page.locator('dialog[open]').count(),0);
 await page.locator('#clientLoyaltyLevel').click();assert.equal(await page.getByRole('dialog').isVisible(),true);await page.keyboard.press('Escape');
 for(const id of ['clientQuickRepeat','clientContactButton','clientBirthdayEdit','clientLoyaltyOpenSettings','clientCopyPhone'])await page.locator('#'+id).click();
 await page.locator('.profile-card-menu summary').click();await page.locator('#clientMoreButton').click();
 await page.locator('[data-open-booking=future]').click();
 assert.deepEqual(await page.evaluate(()=>fixtureClicks),['clientQuickRepeat','clientContactButton','clientBirthdayEdit','clientLoyaltyOpenSettings','clientCopyPhone','clientMoreButton','future']);
 for(const key of ['notes','files','history']){await page.locator(`[data-client-profile-jump=${key}]`).click();assert.equal(await page.locator(`[data-client-profile-panel=${key}]`).isVisible(),true);if(key!=='history')assert.equal(await page.locator(`[data-cr-view=${key}]`).isVisible(),true);}
 await page.evaluate(()=>{fixtureClient.bookings.push(...Array.from({length:20},(_,i)=>({...fixtureClient.bookings[1],id:'extra-'+i})));renderProfile();renderProfile();});
 assert.equal(await page.locator('.profile-card-toolbar').count(),1);assert.equal(await page.locator('.profile-card-avatar-slot').count(),1);
 assert.equal(await page.locator('.profile-card-visit').count(),9);await page.locator('[data-profile-history-more]').click();assert.equal(await page.locator('.profile-card-visit').count(),21);
 await page.evaluate(()=>{fixtureClient.phone='';renderProfile();});assert.equal(await page.locator('#clientProfileCall').getAttribute('aria-disabled'),'true');
 await page.evaluate(()=>{fixtureClient.bookings=[];fixtureClient.imported={};renderProfile();});assert.match(await page.locator('#clientProfileVisitHistory').innerText(),/после первой записи/);
 assert.deepEqual(errors,[]);console.log('Compact profile: 4 themes × 390/760/1440, photo clearance, actions, history grouping/debt/import, tabs, pagination, empty phone/history PASS (isolated fixture)');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
