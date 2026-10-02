import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {scheduleRuntime} from './work-hours-soft-fixture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),repo=resolve(root,'..');
const mode=process.env.MINUTA_HOURS_SAVE_MODE||'working';
const ref=mode==='baseline'?'cb17f0cf24b621f1307be166559371c9bd6306b0':mode==='old'||mode==='static'?'a31f9ea99ed136cdd7b84827f89e7ffa1ea83c4e':'';
const files=new Map();
const read=file=>{if(!files.has(file))files.set(file,ref?execFileSync('git',['-C',repo,'show',`${ref}:minuta-online-booking/${file}`],{maxBuffer:8*1024*1024}):readFileSync(resolve(root,file)));return files.get(file);};
const sourceHtml=read('provider.html').toString(),html=sourceHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
const layers=[...html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi,'').matchAll(/<link\s+rel="stylesheet"[^>]*href="([^"]+)"/g)].map(m=>m[1]);
const enhanced=layers.some(file=>file.startsWith('work-hours-soft.css'));
const selector='html body.provider-body[data-provider-theme][data-provider-layout] #dashboard .provider-view.work-hours-soft[data-provider-panel="schedule"] #saveSchedule';
const candidate=`@media(max-width:760px){${selector}{position:static!important;inset:auto!important;box-shadow:none!important}}`;
const hash=text=>createHash('sha256').update(text.toString().replace(/\r\n/g,'\n')).digest('hex');
const receipts={html:hash(sourceHtml),hoursCss:enhanced?hash(read('work-hours-soft.css')):null,candidate:mode==='static'?candidate:null};
const rows=Array.from({length:7},(_,i)=>({performer_id:'fixture-performer',weekday:i+1,enabled:i>0,start_time:'10:00',end_time:'20:00',break_start:null,break_end:null}));
const runtime=scheduleRuntime.replace(/const daysOff = \[[\s\S]*?\];/,'const daysOff = [];').replace('scheduleRows = defaultScheduleRows(currentUser.id);',`scheduleRows = ${JSON.stringify(rows)};`);
receipts.runtime=hash(runtime);
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
const output=process.env.MINUTA_HOURS_OVERFLOW_OUTPUT;if(output)mkdirSync(output,{recursive:true});
const results=[],failures=[];
try{for(const width of [390,760,1440]){
 const page=await browser.newPage({viewport:{width,height:960},serviceWorkers:'block',reducedMotion:'reduce',bypassCSP:true});page.setDefaultTimeout(5000);
 page.setDefaultNavigationTimeout(30000);
 const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!=='https://hours-save.test'){external.push(url.href);return route.abort();}const file=decodeURIComponent(url.pathname).slice(1);if(file.includes('..'))return route.abort();try{return route.fulfill({body:file==='provider.html'?html:read(file),contentType:({'.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
 await page.goto('https://hours-save.test/provider.html');
 for(const file of ['payroll-soft-minimalism.css','inventory-soft-ui.css','provider-selects.css'])await page.addStyleTag({content:read(file).toString()});
 await page.addStyleTag({content:'html{scrollbar-gutter:stable}'});
 await page.evaluate(()=>{
  document.documentElement.classList.remove('provider-booting','requires-top-level');document.querySelector('#providerBoot')?.remove();
  document.querySelector('#dashboard').hidden=false;document.querySelector('#dashboard').dataset.activeView='schedule';
  Object.assign(document.body.dataset,{providerTheme:'pink-porcelain',providerLayout:'soft',providerTextScale:'default',providerResolvedColorMode:'light',providerPorcelainCharacter:'petal',providerPorcelainShade:'gentle-pink'});
  document.querySelectorAll('.provider-view').forEach(node=>node.hidden=node.dataset.providerPanel!=='schedule');
 });
 await page.addScriptTag({content:read('provider-porcelain-matrix.js').toString()});
 await page.evaluate(()=>{const p=MinutaProviderPorcelainMatrix.paletteFor('petal','gentle-pink');for(const[key,token]of Object.entries({bg:'bg',surface:'surface','surface-alt':'surfaceAlt',ink:'ink',muted:'muted',line:'line',accent:'accent','accent-soft':'accentSoft','accent-contrast':'contrast'}))document.body.style.setProperty(`--theme-${key}`,p[token]);document.body.style.setProperty('--porcelain-action-bg',p.actionBg);document.body.style.setProperty('--porcelain-action-ink',p.actionInk);});
 await page.addScriptTag({content:runtime});await page.addScriptTag({content:read('provider-selects.js').toString()});if(enhanced)await page.addScriptTag({content:read('work-hours-soft.js').toString()});
 await page.evaluate(()=>document.querySelector('#scheduleWeekEditor').open=true);
 for(const day of [1,2,3,4,5,6,7]){const input=page.locator(`[data-schedule-quick-day="${day}"]`);if(await input.isChecked()!==[1,2,4,5].includes(day))await input.locator('..').click();}
 await page.locator('#scheduleQuickStart').fill('11:00');await page.locator('#scheduleQuickEnd').fill('19:00');await page.locator('#scheduleQuickBreak').check();await page.locator('#scheduleQuickBreakStart').fill('13:30');await page.locator('#scheduleQuickBreakEnd').fill('14:15');
 await page.selectOption('#slotInterval','15');await page.locator('#applyQuickSchedule').click();
 // A second schedule-shaped negative control must retain the global contract.
 await page.evaluate(()=>{const panel=document.createElement('section');panel.className='provider-view';panel.dataset.providerPanel='schedule';panel.hidden=true;panel.id='hoursCssNegativeControl';const button=document.createElement('button');button.id='saveSchedule';panel.append(button);document.querySelector('#dashboard').append(panel);});
 const negativeBefore=await page.evaluate(()=>getComputedStyle(document.querySelector('#hoursCssNegativeControl button')).position);
 assert.equal(negativeBefore,({390:'fixed',760:'static',1440:'static'})[width],'Other schedule panels retain the exact baseline Save positioning');
 if(mode==='static')await page.addStyleTag({content:candidate});
 const negativeAfter=await page.evaluate(()=>getComputedStyle(document.querySelector('#hoursCssNegativeControl button')).position);
 assert.equal(negativeAfter,negativeBefore,'Scoped candidate must not change the global schedule Save rule');
 await page.evaluate(()=>{window.hoursPointerTargets=[];document.addEventListener('click',event=>{const target=event.target.closest('#saveSchedule,#applyQuickSchedule');if(!target)return;hoursPointerTargets.push(target.id);if(target.id==='saveSchedule'){event.preventDefault();event.stopImmediatePropagation();}},true);});
 await page.evaluate(()=>scrollTo(0,0));await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const state=await page.evaluate(()=>{
  const rect=e=>{const r=e.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const panel=document.querySelector('[data-provider-panel=schedule].work-hours-soft')||document.querySelector('[data-provider-panel=schedule]');
  const apply=document.querySelector('#applyQuickSchedule'),save=panel.querySelector('#saveSchedule'),a=rect(apply),s=rect(save),style=getComputedStyle(save);
  const area=Math.max(0,Math.min(a.right,s.right)-Math.max(a.left,s.left))*Math.max(0,Math.min(a.bottom,s.bottom)-Math.max(a.top,s.top));
  const points=[{name:'center',x:a.left+a.width/2,y:a.top+a.height/2},{name:'right-12',x:a.right-12,y:a.top+a.height/2}].map(p=>({...p,target:document.elementFromPoint(p.x,p.y)?.closest('button')?.id||null}));
  return{width:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,styles:document.styleSheets.length,apply:a,save:s,savePosition:style.position,saveEnabled:!save.disabled&&!save.hidden,status:document.querySelector('#scheduleSaveState').textContent,overlap:area,points,draft:{days:[...document.querySelectorAll('[data-schedule-quick-day]:checked')].map(e=>Number(e.dataset.scheduleQuickDay)),start:document.querySelector('#scheduleQuickStart').value,end:document.querySelector('#scheduleQuickEnd').value,breakStart:document.querySelector('#scheduleQuickBreakStart').value,breakEnd:document.querySelector('#scheduleQuickBreakEnd').value,step:document.querySelector('#slotInterval').value}};
 });
 if(output){await page.screenshot({path:resolve(output,`save-${mode}-${width}-viewport.png`)});await page.screenshot({path:resolve(output,`save-${mode}-${width}-fullpage.png`),fullPage:true});}
 for(const point of state.points){await page.mouse.click(point.x,point.y);point.actual=await page.evaluate(()=>hoursPointerTargets.at(-1));}
 const save=page.locator('[data-provider-panel=schedule]').first().locator('#saveSchedule');await save.focus();state.saveKeyboardFocus=await save.evaluate(e=>document.activeElement===e);
 await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');state.saveTabStop=await save.evaluate(e=>document.activeElement===e);
 state.writes=await page.evaluate(()=>hoursFixtureWrites.length);state.negative={before:negativeBefore,after:negativeAfter};
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(state.writes,0);assert.deepEqual(state.draft,{days:[1,2,4,5],start:'11:00',end:'19:00',breakStart:'13:30',breakEnd:'14:15',step:'15'});
 results.push(state);
 if(state.overlap!==0||state.points.some(p=>p.target!=='applyQuickSchedule'||p.actual!=='applyQuickSchedule'))failures.push(`${width}: Save overlays Apply (${state.overlap}) or intercepts pointer hit`);
 if(!state.saveEnabled||!state.saveKeyboardFocus||!state.saveTabStop)failures.push(`${width}: Save is not natively keyboard accessible`);
 if(state.scroll>width)failures.push(`${width}: document overflow`);
 await page.close();
}}finally{await browser.close();if(output)writeFileSync(resolve(output,`save-evidence-${mode}.json`),JSON.stringify({mode,ref,layers:layers.length,receipts,results,failures},null,2));}
assert.deepEqual(failures,[]);console.log(`PASS working-hours Save placement: ${mode}, full provider DOM, 390/760/1440, Apply center/right pointer and Save Tab, no persistence writes`);
