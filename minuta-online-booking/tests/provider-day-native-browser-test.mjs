// Reuse the existing isolated native-form harness; all network traffic stays blocked.
import fs from 'node:fs';
const harnessUrl=new URL('./historical-booking-context-browser-test.mjs',import.meta.url);
const text=fs.readFileSync(harnessUrl,'utf8');const end=text.indexOf('const cases=');if(end<0)throw Error('native harness boundary changed');
const prefix=text.slice(0,end).replaceAll('import.meta.url',JSON.stringify(harnessUrl.href));
const controller=fs.readFileSync(new URL('../provider-day-actions.js',import.meta.url),'utf8');const runtime=fs.readFileSync(new URL('../provider-day-runtime.js',import.meta.url),'utf8');
const scenario=`
browser=await chromium.launch({headless:true});
try{
 const f=await fixture();const page=f.page;
 await page.addScriptTag({content:${JSON.stringify(controller)}});await page.addScriptTag({content:${JSON.stringify(runtime)}});
 await page.evaluate(async()=>{
  selectedDate='2026-12-01';hold='none';
  organizationController.getActiveOrganization=()=>({id:activeClientOrganizationId,locations:[{id:'fixture-location',name:'Филиал',active:true,is_primary:true,timezone:'Europe/Samara'}]});
  const day={date:selectedDate,start:'10:00',end:'18:00',working:false,onlineEnabled:false,revision:'fixture-revision',closures:[]};
  const original=db.rpc;db.rpc=async(name,args)=>{
   effects.push({kind:'day-rpc',name,args:structuredClone(args),pendingStored:Object.keys(localStorage).some(k=>k.startsWith('minuta-day-hours-v192'))});
   if(name==='list_minuta_provider_days_v192')return {data:[day],error:null};
   if(name==='get_minuta_provider_day_v192')return {data:day,error:null};
   if(name==='save_minuta_provider_day_v192')return {data:{date:args.p_date,requestId:args.p_request_id,confirmed:true},error:null};
   if(name==='get_minuta_day_exception_slots_v192')return {data:[{booking_date:args.p_date,booking_time:'14:00'},{booking_date:args.p_date,booking_time:'15:00'}],error:null};
   if(name==='block_minuta_day_exception_v192')return {data:null,error:{code:'23P01',message:'block_slot_unavailable'}};
   return original(name,args);
  };
  globalThis.providerDayRuntime=PrimeTimeProviderDayRuntime.create({db,storage:localStorage,getContext:()=>({userId:currentUser.id,organizationId:activeClientOrganizationId,locationId:'fixture-location',date:selectedDate,timeZone:'Europe/Samara',sessionGeneration}),canWrite:()=>true,today:()=>businessTodayIso(),render(){},refresh:refreshAfterWrite,openBooking:(c,block)=>openNewBookingSheet('',{date:c.date,mode:block?'block':'client',dayException:c})});
  const holder=document.createElement('div');holder.id='day-card';document.body.append(holder);await providerDayRuntime.load();holder.innerHTML=providerDayRuntime.markup(selectedDate,'Выходной');providerDayRuntime.attach(holder);
  globalThis.submitProviderBookingAttempt=async payload=>{effects.push({kind:'one-off-client-write',payload:structuredClone(payload)});return {ok:false,definite:true,error:{code:'23P01',message:'slot_unavailable'},attempt:{requestId:'fixture-request'}};};
 });
 await page.locator('[data-schedule-day-action="hours"]').click();await page.locator('dialog.schedule-day-hours-dialog input[name=start]').fill('11:00');await page.locator('dialog.schedule-day-hours-dialog input[name=end]').fill('17:00');await page.locator('dialog.schedule-day-hours-dialog button[type=submit]').click();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
 const hours=await page.evaluate(()=>effects.find(e=>e.name==='save_minuta_provider_day_v192'));assert.equal(hours.args.p_date,'2026-12-01');assert.equal(hours.args.p_start,'11:00');assert.equal(hours.pendingStored,true);
 await page.locator('[data-schedule-day-action="booking"]').click();await page.locator('[data-new-booking-time="14:00"]').waitFor();assert.equal(await page.locator('#newBookingDate').isDisabled(),true,'one-off date stays fixed');assert.equal(await page.locator('#newBookingOccurrences').inputValue(),'1');assert.equal(await page.locator('#newBookingOccurrences').isDisabled(),true,'one-off recurrence stays fixed');
 await page.locator('#newBookingName').fill('Тестовый клиент');await page.locator('#newBookingPhone').fill('+7 999 000-00-01');await page.locator('[data-new-booking-time="14:00"]').click();await page.locator('#newBookingForm button[type=submit]').click();
 const client=await page.evaluate(()=>effects.find(e=>e.kind==='one-off-client-write'));assert.ok(client?.payload.dayException);assert.equal(client.payload.date,'2026-12-01');assert.equal(client.payload.durationMinutes,60);
 await page.evaluate(()=>closeBookingSheet());await page.locator('[data-schedule-day-action="block"]').click();await page.locator('[data-new-booking-time="14:00"]').waitFor();await page.locator('[data-new-booking-time="14:00"]').click();await page.locator('#newBookingForm button[type=submit]').click();
 const block=await page.evaluate(()=>effects.find(e=>e.name==='block_minuta_day_exception_v192'));assert.ok(block);assert.equal(block.args.p_location,'fixture-location');assert.equal(block.args.p_date,'2026-12-01');assert.equal(block.args.p_duration,60);
 assert.equal(await page.evaluate(()=>effects.some(e=>e.name==='create_minuta_historical_booking')),false);assert.deepEqual(f.traffic,[]);assert.deepEqual(f.errors,[]);
 await f.context.close();console.log('PASS: actual native form and day runtime: hours, future client request, client-free block, fixed date/branch, single occurrence, no historical or real network writes');
}finally{await browser.close();}
`;
try{await import('data:text/javascript;base64,'+Buffer.from(prefix+scenario).toString('base64'));}catch(error){console.error(String(error.stack||error.message).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'isolated-native-scenario').slice(0,1800));process.exitCode=1;}
