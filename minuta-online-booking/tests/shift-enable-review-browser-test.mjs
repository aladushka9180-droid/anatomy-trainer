import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||undefined});
const output=process.env.SHIFT_REVIEW_OUTPUT;if(output)mkdirSync(output,{recursive:true});
try{
 for(const width of [390,760,1440]){
  const page=await browser.newPage({viewport:{width,height:900},bypassCSP:true});const errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='https://shift-review.test'||route.request().method()!=='GET'){external.push(u.href);return route.abort();}try{const path=resolve(root,'.'+u.pathname);assert.ok(path.startsWith(root));let body=readFileSync(path);if(path.endsWith('provider.html'))body=Buffer.from(body.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,''));return route.fulfill({body,contentType:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(path)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}});
  await page.goto('https://shift-review.test/provider.html');
  await page.evaluate(()=>{document.documentElement.classList.remove('provider-booting','requires-top-level');document.querySelector('#providerBoot')?.remove();const panel=document.querySelector('#shiftsPanel');document.body.replaceChildren(panel);panel.hidden=false;document.querySelector('#shiftStartDate').value='2099-01-01';document.querySelector('#shiftPeriod').value='7';});
  await page.addScriptTag({url:'https://shift-review.test/shift-management.js?v=1107'});
  await page.evaluate(async()=>{
   window.mode='zero';window.enabled=false;window.calls=[];window.actor=1;window.notices=[];
   const db={rpc:async(name,p)=>{calls.push({name,p});if(name==='get_minuta_shift_workspace'){
    if(mode==='error')return {error:{message:'unavailable'}};
    return {data:{organization_id:p.p_organization,current_role:'owner',can_manage_team:true,enabled,
     performers:[{id:'p1',display_name:'Тестовый специалист'}],locations:[{id:'l1',name:'Тестовый филиал',active:true}],services:[],absences:[],bookings:[],utilization:[],audit:[],
     shifts:mode==='zero'?[]:[{id:'s1',performer_id:'p1',location_id:'l1',shift_date:p.p_start,start_time:'10:00',end_time:'18:00',active:true}]}};
   }if(name==='set_minuta_branch_shifts_enabled'){enabled=p.p_enabled;return {data:enabled};}throw Error('unexpected write');}};
   window.controller=MinutaShifts.createController({db,escapeHtml:String,notify:s=>notices.push(s),requireWrites:()=>true,applyWriteAvailability(){},getCurrentUser:()=>({id:'actor'}),getSessionGeneration:()=>actor,sessionIsCurrent:(id,g)=>g===actor,loadTimeoutMs:100});controller.bind();await controller.setOrganization({id:'org-a'});
  });
  const boundaries=await page.evaluate(async()=>{
   const {coverage}=await import('https://shift-review.test/shift-enable-review.js?v=1107');
   const data={locations:[{id:'l1',active:true}],performers:[{id:'p1'}],absences:[],bookings:[],shifts:[{active:true,location_id:'l1',performer_id:'p1',shift_date:'2099-01-01',start_time:'10:00',end_time:'18:00',break_start:'13:00',break_end:'14:00'}]};
   const booking={status:'confirmed',location_id:'l1',performer_id:'p1',booking_date:'2099-01-01',booking_time:'12:30',duration_minutes:60};
   const check=changes=>coverage({...data,...changes},'2099-01-01','2099-01-02');
   return {base:check({}).shifts,break:check({bookings:[booking]}).uncovered,edge:check({bookings:[{...booking,booking_time:'12:00'}]}).uncovered,wrongBranch:check({bookings:[{...booking,location_id:'l2'}]}).uncovered,cancelled:check({bookings:[{...booking,status:'cancelled'}]}).uncovered,absence:check({absences:[{active:true,performer_id:'p1',starts_on:'2099-01-01',ends_on:'2099-01-01'}]}).shifts,inactive:check({locations:[{id:'l1',active:false}]}).shifts};
  });
  assert.deepEqual(boundaries,{base:1,break:1,edge:0,wrongBranch:1,cancelled:0,absence:0,inactive:0});
  const toggle=page.locator('#shiftSchedulingEnabled');const dialog=page.locator('.shift-enable-review');
  await toggle.click();await dialog.waitFor();assert.match(await dialog.textContent(),/Включение запрещено/);assert.equal(await dialog.getByRole('button',{name:'Включить учёт смен'}).count(),0);assert.equal(await toggle.isChecked(),false);
  if(output)await dialog.screenshot({path:resolve(output,'zero-'+width+'.png')});
  await dialog.getByRole('button',{name:'Понятно'}).click();assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='set_minuta_branch_shifts_enabled').length),0);
  await page.evaluate(()=>mode='partial');await toggle.click();await dialog.waitFor();assert.match(await dialog.textContent(),/Дни без смен/);assert.equal(await dialog.getByRole('button',{name:'Включить учёт смен'}).isDisabled(),true);
  if(output)await dialog.screenshot({path:resolve(output,'partial-'+width+'.png')});
  await dialog.getByRole('button',{name:'Отмена'}).click();assert.equal(await toggle.isChecked(),false);
  await toggle.click();await dialog.waitFor();await dialog.locator('input[type=checkbox]').check();await page.evaluate(()=>mode='zero');await dialog.getByRole('button',{name:'Включить учёт смен'}).click();await page.waitForFunction(()=>notices.length>0);assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='set_minuta_branch_shifts_enabled').length),0,'changed coverage must be reviewed again');await page.evaluate(()=>{mode='partial';notices=[];});
  await toggle.click();await dialog.waitFor();await dialog.locator('input[type=checkbox]').check();await dialog.getByRole('button',{name:'Включить учёт смен'}).click();await page.waitForFunction(()=>enabled===true);assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='set_minuta_branch_shifts_enabled').length),1);
  // Disabling does not require the enable review and retains the original mutation path.
  await page.waitForFunction(()=>document.querySelector('#shiftSchedulingEnabled').checked);await toggle.click();await page.waitForFunction(()=>enabled===false);
  await page.evaluate(()=>mode='error');await toggle.click();await page.waitForFunction(()=>notices.some(x=>x.includes('Не удалось проверить')));assert.equal(await toggle.isChecked(),false);
  const before=await page.evaluate(()=>calls.filter(c=>c.name==='set_minuta_branch_shifts_enabled').length);
  await page.evaluate(()=>mode='partial');await toggle.click();await dialog.waitFor();await page.evaluate(()=>{actor++;controller.reset();});await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>calls.filter(c=>c.name==='set_minuta_branch_shifts_enabled').length),before);
  const reads=await page.evaluate(()=>calls.filter(c=>c.name==='get_minuta_shift_workspace'&&c.p.p_end!==c.p.p_start));assert.ok(reads.some(c=>c.p.p_start!=='2099-01-01'&&Math.round((new Date(c.p.p_end)-new Date(c.p.p_start))/86400000)===62),'review is independent of selected week');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();
 }
 console.log('Shift enable review PASS: zero blocked, partial review/cancel/confirm, canonical 63 days, read failure, actor reset, original disable; 390/760/1440; no external writes.');
}finally{await browser.close();}
