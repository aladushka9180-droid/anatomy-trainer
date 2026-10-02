import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {scheduleRuntime} from './work-hours-soft-fixture.mjs';

// Full provider document and its real stylesheet order. Transport, identity and
// saved rows are synthetic; production provider bootstrap/save is never run.
const root=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(root,'..');
const ref=process.env.MINUTA_HOURS_SOURCE_REF;
const files=new Map();
const read=file=>{if(!files.has(file))files.set(file,ref?execFileSync('git',['-C',repo,'show',`${ref}:minuta-online-booking/${file}`],{maxBuffer:8*1024*1024}):readFileSync(resolve(root,file)));return files.get(file);};
const html=read('provider.html').toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const layers=[...html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi,'').matchAll(/<link\s+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>m[1]);
const hash=text=>createHash('sha256').update(text.toString().replace(/\r\n/g,'\n')).digest('hex');
const receipts={html:hash(read('provider.html')),provider:hash(read('provider.js')),runtime:null,styles:layers.map(url=>({url,sha256:hash(read(url.split('?')[0]))}))};
const enhanced=layers.some(file=>file.startsWith('work-hours-soft.css'));
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const results=[],failures=[];
const output=process.env.MINUTA_HOURS_OVERFLOW_OUTPUT;
if(output)mkdirSync(output,{recursive:true});
const rows=Array.from({length:7},(_,i)=>({performer_id:'fixture-performer',weekday:i+1,enabled:i>0,start_time:'10:00',end_time:'20:00',break_start:null,break_end:null}));
const runtime=scheduleRuntime.replace('writesAllowed = true','writesAllowed = false')
 .replace(/const daysOff = \[[\s\S]*?\];/,'const daysOff = [];')
 .replace('scheduleRows = defaultScheduleRows(currentUser.id);',`scheduleRows = ${JSON.stringify(rows)};`);
receipts.runtime=hash(runtime);
try{
 for(const width of [390,760,1440]){
  const page=await browser.newPage({viewport:{width,height:1100},serviceWorkers:'block',reducedMotion:'reduce',bypassCSP:true});
  page.setDefaultTimeout(4000);
  page.setDefaultNavigationTimeout(30000);
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='https://hours-overflow.test'){external.push(url.href);return route.abort();}
   const file=decodeURIComponent(url.pathname).slice(1);
   if(file.includes('..'))return route.abort();
   try{return route.fulfill({body:file==='provider.html'?html:read(file),contentType:({'.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff'})[extname(file)]||'application/octet-stream'});}
   catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto('https://hours-overflow.test/provider.html');
  // These unrelated lazy layers were also present in the reported live DOM.
  await page.addStyleTag({content:read('payroll-soft-minimalism.css').toString()});
  await page.addStyleTag({content:read('inventory-soft-ui.css').toString()});
  await page.addStyleTag({content:read('provider-selects.css').toString()});
  await page.addStyleTag({content:'html{scrollbar-gutter:stable}'});
  await page.evaluate(()=>{
   document.documentElement.classList.remove('provider-booting','requires-top-level');document.querySelector('#providerBoot')?.remove();
   document.querySelector('#dashboard').hidden=false;document.querySelector('#dashboard').dataset.activeView='schedule';
   Object.assign(document.body.dataset,{providerTheme:'pink-porcelain',providerLayout:'soft',providerTextScale:'default',providerResolvedColorMode:'light',providerPorcelainCharacter:'petal',providerPorcelainShade:'gentle-pink'});
   document.querySelectorAll('.provider-view').forEach(node=>{node.hidden=node.dataset.providerPanel!=='schedule';});
   document.querySelectorAll('[data-provider-view]').forEach(node=>node.classList.toggle('active',node.dataset.providerView==='schedule'));
  });
  await page.addScriptTag({content:read('provider-porcelain-matrix.js').toString()});
  await page.evaluate(()=>{
   const p=MinutaProviderPorcelainMatrix.paletteFor('petal','gentle-pink');
   for(const [key,token] of Object.entries({bg:'bg',surface:'surface','surface-alt':'surfaceAlt',ink:'ink',muted:'muted',line:'line',accent:'accent','accent-soft':'accentSoft','accent-contrast':'contrast'}))document.body.style.setProperty(`--theme-${key}`,p[token]);
   document.body.style.setProperty('--porcelain-action-bg',p.actionBg);document.body.style.setProperty('--porcelain-action-ink',p.actionInk);
  });
  await page.addScriptTag({content:runtime});
  await page.addScriptTag({content:read('provider-selects.js').toString()});
  if(enhanced)await page.addScriptTag({content:read('work-hours-soft.js').toString()});
  await page.evaluate(()=>{document.querySelector('#scheduleWeekEditor').open=true;document.querySelector('#weeklyScheduleDetails').open=true;});
  await page.evaluate(()=>document.fonts.ready);
  // Allow final CSS/layout two animation frames; no theme transition is sampled.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const result=await page.evaluate(()=>{
   const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,width:r.width,height:r.height};};
   const toggles=[...document.querySelectorAll('.day-toggle input[data-schedule-enabled]')].map(e=>({rect:rect(e),label:rect(e.closest('label')),position:getComputedStyle(e).position,opacity:getComputedStyle(e).opacity,pointerEvents:getComputedStyle(e).pointerEvents,tabIndex:e.tabIndex,checked:e.checked,offsetParent:e.offsetParent?.id||e.offsetParent?.tagName,containingRect:e.offsetParent?rect(e.offsetParent):null}));
   const input=document.querySelector('.day-toggle input'),matched=[];
   const scan=(rules,href)=>{for(const rule of rules){if(rule.media&&!matchMedia(rule.media.mediaText).matches)continue;try{if(rule.selectorText&&input.matches(rule.selectorText)&&['position','width','min-width','height','min-height','left','right','inset','padding','margin'].some(p=>rule.style.getPropertyValue(p)))matched.push({href,selector:rule.selectorText,css:rule.style.cssText});}catch{}if(rule.cssRules?.length)scan(rule.cssRules,href);}};
   for(const sheet of document.styleSheets)try{scan(sheet.cssRules,sheet.href);}catch{}
   return{width:innerWidth,client:document.documentElement.clientWidth,bodyWidth:document.body.getBoundingClientRect().width,scroll:document.documentElement.scrollWidth,layers:document.querySelectorAll('link[rel=stylesheet]').length,styleSheetCount:document.styleSheets.length,toggles,matched};
  });
  result.stylesheetUrls=layers;
  assert.ok(result.styleSheetCount>=layers.length+3,'All head CSS and the reported three extra lazy layers must be loaded');
  if(output)await page.screenshot({path:resolve(output,`${ref||'working'}-${width}.png`),fullPage:true});
  // Each hidden native checkbox must remain operable through its own label and
  // by native keyboard focus. Check every day, including initially closed Mon.
  result.clicks=[];result.keys=[];result.clickTargets=[];result.tabStops=[];result.focusRings=[];
  const inputs=page.locator('.day-toggle input[data-schedule-enabled]');
  for(let i=0;i<7;i++){
   const input=inputs.nth(i),label=input.locator('..');const before=await input.isChecked();
   const toggle=label.locator('span');
   // Sample the actual pointer hit after Playwright has positioned the target,
   // rather than an off-screen center left underneath a sticky mobile header.
   await label.evaluate(e=>{window.hoursLastHit=false;e.addEventListener('click',event=>{window.hoursLastHit=event.isTrusted&&event.target.closest('.day-toggle')===e&&document.elementFromPoint(event.clientX,event.clientY)?.closest('.day-toggle')===e;},{once:true});});
   await toggle.click();result.clickTargets.push(await page.evaluate(()=>hoursLastHit));result.clicks.push((await input.isChecked())!==before);
   await label.locator('span').click();assert.equal(await input.isChecked(),before,'Label roundtrip must restore local saved state');
   await input.focus();await page.keyboard.press('Shift+Tab');await page.keyboard.press('Tab');result.tabStops.push(await input.evaluate(e=>document.activeElement===e));
   // Chromium can expose 0px while the real span outline transition starts,
   // even under reduced motion. Wait for the native focus ring, not a sleep.
   if(enhanced){
    const handle=await input.elementHandle();
    await page.waitForFunction(e=>{const s=getComputedStyle(e.nextElementSibling);return document.activeElement===e&&e.matches(':focus-visible')&&s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2;},handle,{timeout:1000,polling:'raf'});
    await handle.dispose();
   }
   result.focusRings.push(await input.evaluate(e=>{const s=getComputedStyle(e.nextElementSibling);return s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>=2;}));
   await page.keyboard.press('Space');result.keys.push((await input.isChecked())!==before);
   await page.keyboard.press('Space');assert.equal(await input.isChecked(),before,'Native Space roundtrip must restore local saved state');
  }
  result.afterScroll=await page.evaluate(()=>document.documentElement.scrollWidth);
  result.writes=await page.evaluate(()=>hoursFixtureWrites.length);
  await page.evaluate(()=>document.querySelector('#weeklyScheduleDetails').open=false);
  result.closedScroll=await page.evaluate(()=>document.documentElement.scrollWidth);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(result.writes,0);
  results.push(result);
  if(result.scroll>width||result.afterScroll>width)failures.push(`${width}: open document overflow ${result.scroll}/${result.afterScroll}`);
  if(!result.clicks.every(Boolean)||!result.keys.every(Boolean))failures.push(`${width}: native label/Space accessibility failed`);
  if(!result.clickTargets.every(Boolean)||!result.tabStops.every(Boolean))failures.push(`${width}: label hit targets/native Tab accessibility failed`);
  if(enhanced&&!result.focusRings.every(Boolean))failures.push(`${width}: hidden native checkbox has no visible keyboard focus`);
  if(result.toggles.some(t=>t.rect.width>t.label.width+1||t.rect.height>t.label.height+1||t.rect.left<t.label.left-1||t.rect.right>t.label.right+1||t.tabIndex<0))failures.push(`${width}: hidden checkbox extends outside its label or leaves keyboard order`);
  await page.close();
 }
}finally{await browser.close();if(output)writeFileSync(resolve(output,`evidence-${ref||'working'}.json`),JSON.stringify({ref:ref||'working',layers:layers.length,rows,receipts,results,failures},null,2));}
assert.deepEqual(failures,[]);
console.log(`PASS weekly hidden checkboxes: full provider DOM/${layers.length} CSS, 390/760/1440, all 7 label clicks/native Space, no writes`);
