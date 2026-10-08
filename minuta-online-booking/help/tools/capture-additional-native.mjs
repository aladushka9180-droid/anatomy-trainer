import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { serveNativeCaptureFixture, appRoot, date } from './native-capture-fixture.mjs';

// Original app on loopback, ordinary clicks only. No production requests or writes.
assert.equal(process.env.NATIVE_CAPTURE_ADDITIONAL, '1', 'Explicit fictional fixture required');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');
const plan = JSON.parse(readFileSync(resolve(appRoot, 'help/tools/additional-visual-plan.json')));
const selected = process.env.NATIVE_ADDITIONAL_KEYS?.split(',');
const output = resolve(appRoot, 'help/images/native-local');
const raw = resolve(appRoot, '../outputs/knowledge-all-visuals-20261008/raw');
mkdirSync(raw, { recursive: true });
const fixture = await serveNativeCaptureFixture();
const browser = await chromium.launch({headless:true, executablePath:process.env.MINUTA_BROWSER_EXECUTABLE});
const manifest = {schemaVersion:1, environment:'isolated-local-native-fixture', capturedAt:new Date().toISOString(), fixtureDate:date, theme:'pink-porcelain', domModified:false, rendererModified:false, liveVerified:false, productionRequests:0, captures:[], failures:[]};
const manifestPath=resolve(raw,'../additional-capture-manifest.json');
if(process.env.NATIVE_ADDITIONAL_MERGE==='1'&&existsSync(manifestPath)){
 const prior=JSON.parse(readFileSync(manifestPath));assert.equal(prior.fixtureDate,date);
 for(const [file,hash]of Object.entries(prior.sources))assert.equal(createHash('sha256').update(readFileSync(resolve(appRoot,file))).digest('hex'),hash,'Original source changed: '+file);
 manifest.captures=prior.captures;manifest.sources=prior.sources;
 const widths=process.env.NATIVE_ADDITIONAL_WIDTHS?.split(',').map(Number)||[390,760,1440];
 manifest.failures=prior.failures.filter(f=>!(widths.includes(f.width)&&(!selected||selected.includes(f.id))));
}
try {
 for (const width of process.env.NATIVE_ADDITIONAL_WIDTHS?.split(',').map(Number) || [390,760,1440]) {
  const context = await browser.newContext({viewport:{width,height:1200}, timezoneId:'Europe/Samara',serviceWorkers:'block'});
  const external=[],errors=[];
  await context.route('**/*', route => new URL(route.request().url()).origin===fixture.origin ? route.continue() : (external.push(route.request().url()),route.abort()));
  await context.routeWebSocket('**/*', socket => new URL(socket.url()).host===new URL(fixture.origin).host ? socket.connectToServer() : (external.push(socket.url()),socket.close()));
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(fixture.origin+'/minuta-online-booking/provider.html');
  await page.locator('#loginEmail').fill(fixture.credentials.email);await page.locator('#loginPassword').fill(fixture.credentials.password);
  await page.locator('#loginForm button[type=submit]').click();await page.locator('#dashboard').waitFor({state:'visible',timeout:20000});
  async function navigate(view){await page.goto(fixture.origin+'/minuta-online-booking/provider.html?view='+view+'&date='+date);await page.locator('[data-provider-panel="'+view+'"]:visible').waitFor();await page.waitForFunction(()=>document.querySelector('#serviceManageList .managed-service')&&!synchronizationPromise);await page.waitForLoadState('networkidle');await page.waitForTimeout(250);}
  async function details(selector){const el=page.locator(selector);await el.waitFor({state:'visible'});if(await el.getAttribute('open')===null)await el.locator('summary').first().click();}
  async function choice(id,value){const select=page.locator('#'+id),trigger=page.locator('#'+id+' + .pro-select-trigger');if(await trigger.isVisible()){const label=await select.locator('option[value="'+value+'"]').textContent();await trigger.click();await page.locator('.pro-select-option').filter({hasText:label.trim()}).click();}else await select.selectOption(value);}
  async function section(id){await navigate('organization');const select=page.locator('#organizationSectionSelect'),trigger=page.locator('#organizationSectionSelect + .pro-select-trigger');const group={inventoryPanel:'team',retentionPanel:'sales',commercePanel:'sales',payrollPanel:'finance'}[id];
   if(await page.locator('#retentionMobileGroup:visible, #retentionMobileGroup + .pro-select-trigger:visible').count()){
    await choice('retentionMobileGroup',group);await page.waitForTimeout(200);
    if(await page.locator('#retentionMobileSection:visible, #retentionMobileSection + .pro-select-trigger:visible').count())await choice('retentionMobileSection',id);
    else await page.locator('#organizationSectionNav [data-section-target="'+id+'"]:visible').click();
   }else if(await trigger.isVisible()){const label=await select.locator('option[value="'+id+'"]').textContent();await trigger.click();await page.locator('.pro-select-option').filter({hasText:label.trim()}).click();}else if(await select.isVisible())await select.selectOption(id);else{await page.locator('[data-organization-group="'+group+'"]:visible').click();await page.locator('#organizationSectionNav [data-section-target="'+id+'"]:visible').click();}await page.locator('#'+id).waitFor({state:'visible'});await page.waitForTimeout(350);}
  async function client(){await navigate('clients');await page.waitForFunction(()=>Boolean(activeClientOrganizationId));await page.locator('.client-list-item[data-client-phone="70000000001"]').click();}
  async function inventory(kind){await section('inventoryPanel');await page.locator('[data-inventory-section=operations]').click();await page.locator('#inventoryMovementKind').selectOption(kind);await page.locator('#inventoryMovementReason').fill('Учебный пример, не проведён');}
  const setups={
   'client-phone-lookup':async()=>{await navigate('bookings');const button=page.locator('#newBookingButton:visible, #mobileNewBookingButton:visible').first();if(await button.count())await button.click();else{await page.locator('[data-create-booking-at]:visible').focus();await page.keyboard.press('Enter');}await page.locator('#newBookingPhone').fill('70000000001');await page.waitForFunction(()=>document.querySelector('#newBookingName').value.includes('Клиент'));},
   'client-directory-filters':async()=>{await navigate('clients');await page.locator('[data-client-filters]').click();},
   'client-online-block':async()=>{await client();const menu=page.locator('details:has(> div > #clientMoreButton)');if(await menu.count())await details('details:has(> div > #clientMoreButton)');await page.locator('#clientMoreButton').click();await page.locator('#clientBlockAction').click();},
   'client-record-files':async()=>{await client();await page.locator('#clientProfileTabFiles').click();await details('[data-cr-panel=upload]');},
   'client-private-result':async()=>{await navigate('bookings');await page.locator('[data-open-booking="77777777-7777-4777-8777-777777777777"]:visible').first().click();await details('#bookingClientResultDisclosure');await details('.booking-result-description');},
   'client-retention-settings':async()=>{await section('retentionPanel');if(await page.locator('#retentionSettingsDisclosure').count())await details('#retentionSettingsDisclosure');},
   'inventory-receipt-form':async()=>{await inventory('receipt');await page.locator('#inventoryMovementQuantity').fill('100');},
   'inventory-writeoff-form':async()=>{await inventory('write_off');await page.locator('#inventoryMovementQuantity').fill('10');},
   'inventory-transfer-form':async()=>{await inventory('transfer');await page.locator('#inventoryTransferDestination').selectOption('15151515-1515-4515-8515-151515151515');await page.locator('#inventoryMovementQuantity').fill('50');},
   'inventory-count-form':async()=>{await inventory('inventory');await page.locator('#inventoryCountedQuantity').fill('990');},
   'inventory-history':async()=>{await section('inventoryPanel');await page.locator('[data-inventory-section=history]').click();},
   'client-page-theme':async()=>{await navigate('settings');const b=page.locator('[data-provider-panel=settings] [data-section-target=clientAppearanceSettingsCard]');if(await b.isVisible())await b.click();else{await details('.settings-section-picker');await page.locator('[data-settings-section-target=clientAppearanceSettingsCard]').click();}await page.locator('input[name=providerClientTheme][value=pink-porcelain]').waitFor({state:'attached'});assert.equal(await page.locator('input[name=providerClientTheme][value=pink-porcelain]').isChecked(),true);},
   'service-editor':async()=>{await navigate('services');await page.locator('[data-edit-service]').first().click();},
   'service-actions':()=>navigate('services'),
   'service-price-list':async()=>{await navigate('services');await page.locator('#openPriceList').click();},
   'booking-widget-code':async()=>{await setups['client-page-theme']();await page.locator('#openBookingWidgets').focus();await page.locator('#openBookingWidgets').press('Enter');await page.locator('[data-booking-widget-mode=widget]').click();},
   'commerce-sale':async()=>{await section('commercePanel');await details('#commerceSaleCreator');await page.locator('#commerceUnitPrice').fill('2500');const options=page.locator('#commerceSaleOptions');if(await options.getAttribute('open')!==null)await options.locator('summary').click();},
   'commerce-refund':async()=>{await section('commercePanel');await page.locator('[data-commerce-refund]').first().click();await page.locator('#commerceRefundQuantity').fill('1');},
   'payroll-advance':async()=>{await section('payrollPanel');if(await page.locator('#payrollOperationsDisclosure').count())await details('#payrollOperationsDisclosure');await details('#payrollAdvancePanel');await page.locator('#payrollAdvanceAmount').fill('1000');},
   'payroll-offset':async()=>{await section('payrollPanel');if(await page.locator('#payrollOperationsDisclosure').count())await details('#payrollOperationsDisclosure');await details('#payrollOffsetPanel');},
   'provider-waitlist':()=>navigate('waitlist')
  };
  for (const screen of plan.screens.filter(s=>!selected||selected.includes(s.id))) {
   try {
    await setups[screen.id]();const target=page.locator(screen.target);await target.waitFor({state:'visible'});await page.waitForTimeout(250);await target.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('body').getAttribute('data-provider-theme'),'pink-porcelain');
    const png=resolve(raw,screen.id+'-'+width+'.png');await target.evaluate(el=>el.scrollIntoView({block:el.closest('dialog[open]')?'nearest':'start',behavior:'instant'}));
    // Keep the original sticky navigation above the captured region by scrolling,
    // without hiding controls or changing the app's DOM or styles.
    await target.evaluate(el=>{
     if(el.closest('dialog[open], .dialog[open]'))return;
     const rect=el.getBoundingClientRect();let top=12;
     for(const node of document.querySelectorAll('.organization-group-navigation, .settings-nav-scroll-shell, .settings-workspace > .provider-section-nav')){
      const r=node.getBoundingClientRect(),style=getComputedStyle(node);
      if(['sticky','fixed'].includes(style.position)&&r.width&&r.height&&r.top<250&&r.right>rect.left&&r.left<rect.right)top=Math.max(top,r.bottom+12);
     }
     window.scrollBy({top:rect.top-top,behavior:'instant'});
    });
    await page.waitForTimeout(100);
    if(screen.endTarget)await page.locator(screen.endTarget).scrollIntoViewIfNeeded();
    const overlay=await target.evaluate(el=>Boolean(el.closest('dialog[open], #bookingSheet')));
    const box=await target.boundingBox(),nav=!overlay&&await page.locator('.provider-mobile-nav:visible').count()?await page.locator('.provider-mobile-nav:visible').boundingBox():null;
    const end=screen.endTarget?await page.locator(screen.endTarget).boundingBox():null;
    const regionHeight=end?end.y+end.height-box.y+12:box.height;
    const clip={x:Math.max(0,box.x),y:Math.max(0,box.y),width:Math.min(box.width,width-Math.max(0,box.x)),height:Math.min(regionHeight,1100,(nav?.y||1200)-Math.max(0,box.y)-(nav?8:0))};
    assert.ok(clip.height>=100,'Key instructional region remains visible');await page.screenshot({path:png,clip});
    const file=screen.id+'-20261008-'+width+'.webp',bytes=readFileSync(png);await sharp(bytes).webp({lossless:true}).toFile(resolve(output,file));
    assert.deepEqual(await sharp(bytes).ensureAlpha().raw().toBuffer(),await sharp(resolve(output,file)).ensureAlpha().raw().toBuffer());
    const size=await sharp(bytes).metadata();
    let detail;
    if(screen.focusTarget){
     const focus=await page.locator(screen.focusTarget).first().boundingBox();
     const x=Math.max(0,Math.floor(focus.x-clip.x)-8),y=Math.max(0,Math.floor(focus.y-clip.y)-8);
     detail=width<=430?{x:0,y:0,width:size.width,height:size.height}:{x,y,width:Math.min(size.width-x,Math.ceil(focus.width)+16),height:Math.min(size.height-y,Math.ceil(focus.height)+16)};
    }
    manifest.captures=manifest.captures.filter(c=>c.id!==screen.id||c.viewportWidth!==width);manifest.captures.push({id:screen.id,viewportWidth:width,src:'images/native-local/'+file,width:size.width,height:size.height,sha256:createHash('sha256').update(readFileSync(resolve(output,file))).digest('hex'),articleSteps:screen.articles,caption:screen.caption+'. Учебные данные.',coverageExact:true,...(detail?{detail}:{}),visibleText:await target.innerText(),fields:await target.locator('input, select, textarea').evaluateAll(nodes=>nodes.map(n=>({id:n.id,name:n.name,type:n.type,value:n.type==='file'?'':n.value}))),overflowX:await target.evaluate(el=>getComputedStyle(el).overflowX),horizontalOverflow:await target.evaluate(el=>el.scrollWidth>el.clientWidth+1)});
    console.log(JSON.stringify({captured:screen.id,width}));
   } catch(error){const parents=await page.locator(screen.target).first().evaluate(el=>{const rows=[];for(let p=el;p&&rows.length<6;p=p.parentElement)rows.push({tag:p.tagName,id:p.id,hidden:p.hidden,open:p.open,summary:p.querySelector(':scope > summary')?.innerText});return rows;}).catch(()=>[]);manifest.failures.push({id:screen.id,width,error:error.message,parents});console.log(JSON.stringify({failed:screen.id,width,error:error.message.split('\n')[0],parents}));await page.screenshot({path:resolve(raw,screen.id+'-'+width+'-failed.png'),fullPage:true}).catch(()=>{});}
  }
  assert.deepEqual(external,[],'No external requests');assert.deepEqual(errors,[],'No native app errors');await context.close();
 }
} finally {
 manifest.sources={...manifest.sources,...fixture.sourceHashes};manifest.unsupportedReads=[...new Set(fixture.unsupported)];manifest.deniedMutations=fixture.mutations.length;manifest.transportFailures=fixture.requests.filter(r=>r.status>=400).length;
 writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
 await browser.close();await new Promise(done=>fixture.server.close(done));
}
assert.equal(manifest.deniedMutations,0,'No write attempt');assert.equal(manifest.failures.length,0,'All requested captures complete; details are saved in the manifest');
