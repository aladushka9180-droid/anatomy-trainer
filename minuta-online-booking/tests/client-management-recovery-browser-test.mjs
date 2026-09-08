import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname} from 'node:path';
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
import {readFileSync,writeFileSync} from 'node:fs';import {createServer} from 'node:http';import {resolve,extname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const capture=async(p,name)=>{if(process.env.MINUTA_AUDIT_SCREENSHOTS)await p.screenshot({path:resolve(process.env.MINUTA_AUDIT_SCREENSHOTS,name+'.png'),fullPage:true});};
const html=readFileSync(resolve(root,'booking.html'),'utf8').replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/script>/gi,(tag,src)=>/^(?:vendor\/supabase[^/]*\.js|config\.js|theme-catalog\.js|booking\.js)(?:\?|$)/.test(src)?tag:'');
let mode='normal',calls=[],pending=[],readFail=false,record,origin;const token='55555555-5555-4555-8555-555555555555';const reset=()=>{record={booking_code:'SYNTHETIC',booking_date:'2026-09-18',booking_time:'12:00:00',service_name:'Изолированная услуга',performer_name:'Тест',duration_minutes:60,price_rub:1000,status:'new',reschedule_allowed:true,cancel_allowed:true,reschedules_remaining:2,reschedule_deadline:'2026-09-17T08:00:00Z',cancel_deadline:'2026-09-17T08:00:00Z'};calls=[];pending=[];readFail=false;};
const json=(r,v,status=200)=>{r.writeHead(status,{'content-type':'application/json'});r.end(JSON.stringify(v));};
const server=createServer(async(req,res)=>{const u=new URL(req.url,origin);if(req.method==='POST'){let s='';for await(const c of req)s+=c;let args=JSON.parse(s);let name=u.pathname.split('/').at(-1);calls.push({name,args});
 if(name==='get_booking_management_v2')return readFail?json(res,{message:'read unavailable'},503):json(res,[record]);
 if(name==='get_yookassa_payment_capability')return json(res,{available:false});
 if(name==='get_reschedule_slots_v101')return json(res,[{booking_date:args.p_start,booking_time:'10:00:00'},{booking_date:args.p_start,booking_time:'11:00:00'}]);
 if(name==='reschedule_booking_v2'){if(mode==='hold'){pending.push(res);return;}if(mode==='conflict')return json(res,{code:'23P01',message:'slot_unavailable'},409);record.booking_date=args.p_date;record.booking_time=args.p_time;if(mode==='lost'){return res.destroy();}if(mode==='lost-read-fail'){readFail=true;return res.destroy();}return json(res,'SYNTHETIC');}
 if(name==='cancel_booking_v2'){record.status='cancelled';if(mode==='lost')return res.destroy();return json(res,'SYNTHETIC');}
 if(name==='confirm_booking_by_token'){record.status='confirmed';if(mode==='lost')return res.destroy();return json(res,'SYNTHETIC');}
 if(name==='event')return json(res,{ok:true});return json(res,{message:'unexpected '+name},500);}
 const rel=u.pathname.slice(1)||'booking.html';if(rel==='config.js'){res.setHeader('content-type','text/javascript');return res.end('window.MINUTA_CONFIG='+JSON.stringify({supabaseUrl:origin,supabaseKey:'synthetic-only'})+';');}try{res.setHeader('content-type',rel.endsWith('.html')?'text/html; charset=utf-8':extname(rel)==='.js'?'text/javascript':extname(rel)==='.css'?'text/css':'image/svg+xml');res.end(rel==='booking.html'?html:readFileSync(resolve(root,rel)));}catch{res.statusCode=404;res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;const b=await chromium.launch({...(process.env.MINUTA_CHROME_PATH ? {executablePath:process.env.MINUTA_CHROME_PATH} : {channel:'chrome'}),headless:true});const results=[];
async function page(width=390,timezoneId='Europe/Samara'){let c=await b.newContext({viewport:{width,height:900},timezoneId,serviceWorkers:'block'});await c.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());let p=await c.newPage();await p.clock.install({time:new Date('2026-09-08T04:00:00Z')});await p.goto(origin+'/booking.html#token='+token);await p.locator('#manageContent').waitFor({state:'visible'});return p;}
for(const width of [390,760,1440]){reset();mode='normal';const p=await page(width);await capture(p,`candidate-${width}-manage`);await p.locator('#openReschedule').click();await p.locator('[data-manage-time]').first().waitFor();await capture(p,`candidate-${width}-reschedule`);results.push({case:'layout',width,overflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});mode='lost';await p.locator('#confirmReschedule').click();await p.locator('#manageRecovery').waitFor({state:'visible'});await capture(p,`candidate-${width}-recovery`);await p.context().close();}
reset();mode='hold';{const p=await page();await p.locator('#openReschedule').click();await p.locator('[data-manage-time]').first().waitFor();await p.locator('#confirmReschedule').click();await p.waitForTimeout(60);let before=await p.locator('#confirmReschedule').isDisabled();await p.locator('[data-manage-time="11:00"]').dispatchEvent('click');let after=await p.locator('#confirmReschedule').isEnabled();if(after)await p.locator('#confirmReschedule').click();await p.waitForTimeout(80);results.push({case:'change-slot-during-pending',initiallyDisabled:before,enabledAfterSlotChange:after,rpcCount:calls.filter(c=>c.name==='reschedule_booking_v2').length});for(const r of pending)json(r,'SYNTHETIC');await p.context().close();}
for(const scenario of ['lost','lost-read-fail','conflict']){reset();mode=scenario;let p=await page();await p.locator('#openReschedule').click();await p.locator('[data-manage-time]').first().waitFor();await p.locator('#confirmReschedule').click();await p.waitForTimeout(350);results.push({case:'reschedule-'+scenario,toast:await p.locator('#toast').innerText(),error:await p.locator('#manageFormError').innerText(),disabled:await p.locator('#confirmReschedule').isDisabled(),panelHidden:!(await p.locator('#reschedulePanel').isVisible())});await p.context().close();}
reset();mode='lost';{let p=await page();p.on('dialog',d=>d.accept());await p.locator('#cancelBooking').click();await p.waitForTimeout(350);results.push({case:'cancel-lost',status:await p.locator('#manageStatus').innerText(),toast:await p.locator('#toast').innerText()});await p.context().close();}
reset();mode='lost';{let p=await page();await p.locator('#confirmAttendance').click();await p.waitForTimeout(350);results.push({case:'attendance-lost',serverStatus:record.status,displayedStatus:await p.locator('#manageStatus').innerText(),toast:await p.locator('#toast').innerText(),enabled:await p.locator('#confirmAttendance').isEnabled()});await p.context().close();}
reset();mode='lost';{
  const p=await page();await p.locator('#openReschedule').click();await p.locator('[data-manage-time]').first().waitFor();await p.locator('#confirmReschedule').click();await p.locator('#manageRecovery').waitFor({state:'visible'});
  const first=calls.find(c=>c.name==='reschedule_booking_v2').args;
  await p.reload();await p.locator('#manageRecovery').waitFor({state:'visible'});await p.locator('#manageContent').waitFor({state:'visible'});
  assert.equal(await p.locator('#openReschedule').isDisabled(),true,'Unresolved attempt must survive reload and block new target');
  mode='normal';await p.locator('#checkManageResult').click();await p.locator('#manageRecovery').waitFor({state:'hidden'});
  const replays=calls.filter(c=>c.name==='reschedule_booking_v2');assert.ok(replays.length>=2);for(const replay of replays)assert.deepEqual(replay.args,first,'Every SDK transport retry and reload recovery must retain exactly the original request identity and target');
  assert.equal(await p.locator('#openReschedule').isEnabled(),true);await p.context().close();
}
await b.close();server.close();
const find=name=>results.find(row=>row.case===name);
assert.equal(find('change-slot-during-pending').enabledAfterSlotChange,false);
assert.equal(find('change-slot-during-pending').rpcCount,1);
assert.equal(find('attendance-lost').displayedStatus.toLowerCase(),'подтверждена');
assert.equal(find('cancel-lost').status.toLowerCase(),'отменена');
assert.equal(find('reschedule-lost').disabled,true);
assert.equal(find('reschedule-lost-read-fail').disabled,true);
assert.equal(find('reschedule-conflict').disabled,false);
for(const row of results.filter(row=>row.case==='layout'))assert.equal(row.overflow,false);
console.log('PASS client management pending-lock, attendance reconciliation, reschedule uncertainty/conflict and 390/760/1440 native DOM');
