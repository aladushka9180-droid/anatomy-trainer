import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {startFixture} from './new-booking-card-fixture.mjs';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const {server,url}=await startFixture();
const browser=await chromium.launch();
const out=process.env.MINUTA_SCREENSHOT_DIR;
if(out)mkdirSync(out,{recursive:true});

// Diagnostic only: preserve the existing fixture, assertions and fail-fast order.
const fontMetricSource=(()=>{
 const files=['new-booking-card.css','new-booking-card.js','provider.js','provider.html','styles.css','provider-selects.js','provider-porcelain-matrix.js','client-loyalty-frames.js'].map(name=>[name,new URL('../'+name,import.meta.url)]);
 files.push(['tests/new-booking-card-fixture.mjs',new URL('./new-booking-card-fixture.mjs',import.meta.url)],['tests/new-booking-card-browser-test.mjs',new URL(import.meta.url)]);
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),ciSha=process.env.GITHUB_SHA;
 return {baselineCommit:'b4ac34d6b3cbcbaee2b021091a29ae7d616ad416',runtimeCommitFromCi:typeof ciSha==='string'&&/^[a-f0-9]{40}$/i.test(ciSha)?ciSha.toLowerCase():null,platform:process.platform,arch:process.arch,node:process.version,browser:browser.version(),files:files.map(([path,url])=>{
  try{const raw=readFileSync(url);return {path,bytes:raw.length,rawSha256:sha(raw),lfNormalizedSha256:sha(raw.toString('utf8').replace(/\r\n/g,'\n'))};}catch{return {path,status:'SOURCE_PIN_UNPROVEN'};}
 })};
})();
function publishTitleDiagnostic(row){
 const record={format:'new-booking-title-font-metric-v1',...row,source:fontMetricSource};
 const json=JSON.stringify(record);
 // Synchronous file/stdout publication completes before the following original assertion.
 if(out)try{writeFileSync(resolve(out,'new-booking-title-'+row.stage+'-'+row.theme+'-'+row.width+'.json'),json+'\n',{flag:'wx'});}
 catch{record.filePersistence='UNPROVEN';}
 try{writeFileSync(1,'NEW_BOOKING_TITLE_FONT '+JSON.stringify(record)+'\n');}catch{/* Original QA must not be swallowed or replaced by an output error. */}
 return record;
}
async function recordTitle(page,{theme,width,stage}){
 let measured={status:'FONT_MEASUREMENT_UNPROVEN'},client;
 try{
  await page.evaluate(()=>document.fonts.ready);
  measured=await page.locator('#newBookingServiceOpenName').evaluate(title=>{
   const style=getComputedStyle(title),copy=title.parentElement,button=copy.parentElement,arrow=button.lastElementChild;
   const rect=e=>e.getBoundingClientRect().toJSON();
   const boxes=()=>({title:rect(title),copy:rect(copy),button:rect(button),arrow:rect(arrow)});
   const before=boxes(),probe=document.createElement('span');probe.textContent=title.textContent;probe.setAttribute('aria-hidden','true');
   probe.style.cssText='all:initial!important;position:fixed!important;left:0!important;top:-1000px!important;visibility:hidden!important;pointer-events:none!important;white-space:pre!important;width:max-content!important;max-width:none!important;';
   for(const key of ['font','letterSpacing','wordSpacing','fontKerning','fontFeatureSettings','fontVariationSettings','fontStretch','textTransform'])probe.style.setProperty(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),style[key],'important');
   let naturalWidth;
   try{document.body.append(probe);naturalWidth=probe.getBoundingClientRect().width;}finally{probe.remove();}
   const after=boxes(),geometryUnchanged=JSON.stringify(before)===JSON.stringify(after);
   return {status:'GEOMETRY_MEASURED',text:title.textContent,font:style.font,fontFamily:style.fontFamily,fontWeight:style.fontWeight,fontSize:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),letterSpacing:style.letterSpacing,wordSpacing:style.wordSpacing,whiteSpace:style.whiteSpace,overflowWrap:style.overflowWrap,textOverflow:style.textOverflow,...before,availableColumnWidth:before.copy.width,naturalWidth,horizontalOverflow:title.scrollWidth-title.clientWidth,fontSetStatus:document.fonts.status,declaredFaces:[...document.fonts].slice(0,64).map(f=>({family:f.family,weight:f.weight,status:f.status})),geometryUnchanged,afterProbe:after,stylesheetOrder:[...document.querySelectorAll('link[rel="stylesheet"]')].map(link=>link.getAttribute('href')),userAgent:navigator.userAgent};
  });
  measured.glyphFacesStatus='UNPROVEN';
  client=await page.context().newCDPSession(page); // Only the page created by this test's own browser.
  await client.send('DOM.enable');await client.send('CSS.enable');
  const {root:dom}=await client.send('DOM.getDocument');
  const {nodeId}=await client.send('DOM.querySelector',{nodeId:dom.nodeId,selector:'#newBookingServiceOpenName'});
  const faces=(await client.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
  if(!Array.isArray(faces)||!faces.length||faces.length>64||!faces.every(f=>typeof f.familyName==='string'&&f.familyName.length<=256&&typeof f.postScriptName==='string'&&f.postScriptName.length<=256&&typeof f.isCustomFont==='boolean'&&Number.isSafeInteger(f.glyphCount)&&f.glyphCount>=0&&f.glyphCount<=1048576)||!faces.some(f=>f.glyphCount>0))throw Error('FONT_GLYPH_FACES_UNPROVEN');
  measured.glyphFaces=faces.map(({familyName,postScriptName,isCustomFont,glyphCount})=>({familyName,postScriptName,isCustomFont,glyphCount}));
  measured.glyphFacesStatus='MEASURED';
  measured.actualNumericFaceWeight='NOT_EXPOSED_BY_PLATFORM_FONTS_API; fontWeight is computed CSS and glyphFaces identify the rendered faces';
  measured.status=measured.fontSetStatus==='loaded'&&measured.geometryUnchanged?'MEASURED':'FONT_MEASUREMENT_UNPROVEN';
 }catch{measured.status='FONT_MEASUREMENT_UNPROVEN';measured.glyphFacesStatus??='UNPROVEN';}
 finally{if(client)try{await client.detach();measured.protocolDetach='DETACHED';}catch{measured.protocolDetach='UNPROVEN';measured.status='FONT_MEASUREMENT_UNPROVEN';}}
 return publishTitleDiagnostic({theme,width,stage,...measured});
}

try {
 for(const theme of ['pink-porcelain','noir-rose','midnight','sage'])for(const width of [320,360,390,760,1440]){
  const page=await browser.newPage({viewport:{width,height:950},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  publishTitleDiagnostic({theme,width,stage:'fixture-start',status:'PRE_MEASUREMENT'});
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
  await page.evaluate(()=>document.fonts.ready);
  const serviceTrigger=await page.locator('#newBookingServiceOpen').evaluate(button=>{
   const title=button.querySelector('strong'),arrow=button.lastElementChild;
   const titleStyle=getComputedStyle(title),arrowStyle=getComputedStyle(arrow),mask=getComputedStyle(arrow,'::before');
   return {title:title.textContent,font:parseFloat(titleStyle.fontSize),height:title.getBoundingClientRect().height,lineHeight:parseFloat(titleStyle.lineHeight),overflow:title.scrollWidth-title.clientWidth,
    arrow:{width:arrow.getBoundingClientRect().width,height:arrow.getBoundingClientRect().height,font:arrowStyle.fontSize,mask:mask.maskImage||mask.webkitMaskImage}};
  });
  await recordTitle(page,{theme,width,stage:'basic'});
  assert.equal(serviceTrigger.title,'Массаж спины + ШВЗ — базовый');
  assert.ok(serviceTrigger.font>=14&&serviceTrigger.font<=16,JSON.stringify(serviceTrigger));
  assert.ok(serviceTrigger.height<=serviceTrigger.lineHeight+1&&serviceTrigger.overflow<=1,'the requested basic title stays on one line at each target width: '+JSON.stringify({theme,width,...serviceTrigger}));
  assert.equal(serviceTrigger.arrow.width,18);assert.equal(serviceTrigger.arrow.height,18);assert.equal(serviceTrigger.arrow.font,'0px');assert.notEqual(serviceTrigger.arrow.mask,'none');
  if(out)await page.screenshot({path:resolve(out,`service-trigger-${theme}-${width}.png`)});
  // The added320/360 coverage targets the requested service trigger; preserve the original390/760/1440 functional/layout scope.
  if(width<390){assert.deepEqual(errors,[]);await page.close();continue;}
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
  await page.evaluate(()=>document.fonts.ready);
  const longService=await page.locator('#newBookingServiceOpen strong').evaluate(t=>({title:t.textContent,height:t.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(t).lineHeight),overflow:t.scrollWidth-t.clientWidth,whiteSpace:getComputedStyle(t).whiteSpace}));
  await recordTitle(page,{theme,width,stage:'longS2'});
  assert.match(longService.title,/Комплексный массаж/);assert.equal(longService.whiteSpace,'normal');assert.ok(longService.overflow<=1,JSON.stringify({theme,width,...longService}));
  if(width===390)assert.ok(longService.height>=longService.lineHeight*1.8,'long service names retain ordinary multi-line wrapping: '+JSON.stringify({theme,width,...longService}));
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
