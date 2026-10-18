import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
function actual(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const rest = source.slice(start + 1);
  const next = rest.search(/^(?:async )?function /m);
  return source.slice(start, next < 0 ? undefined : start + 1 + next);
}
function context(names, values) {
  const box = vm.createContext(values);
  box.window = box;
  vm.runInContext(names.map(actual).join('\n'), box);
  return box;
}
const sdkBox = vm.createContext({ console, URL, URLSearchParams, Headers, Request, Response, AbortController, DOMException, WebSocket, fetch, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, crypto:webcrypto });
vm.runInContext(readFileSync(new URL('../vendor/supabase-2.112.4.min.js', import.meta.url), 'utf8'), sdkBox);
const booking = { id:'b', performer_id:'owner', service_id:'service', booking_date:'2099-09-09', booking_time:'14:00:00', duration_minutes:60, status:'confirmed' };
const rpcAck = { booking_id:'b', performer_id:'owner', service_id:'service', booking_date:'2099-09-09',
  booking_time:'16:00:00', duration_minutes:60, status:'confirmed', notifications_suppressed:false };
for (const [name, response, valid] of [
  ['empty acknowledgement', null, false],
  ['wrong returned time', {...rpcAck,booking_time:'15:00:00'}, false],
  ['notification contract drift', {...rpcAck,notifications_suppressed:true}, false],
  ['confirmed exact acknowledgement', rpcAck, true]
]) test(`move uses the protected RPC and rejects ${name} unless exact`, async () => {
  let requested;
  const db = sdkBox.supabase.createClient('https://fixture.invalid', 'fixture-key', {
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false},
    global:{fetch:async (url, init) => { requested={url,init}; return new Response(JSON.stringify(response), {status:200,headers:{'content-type':'application/json'}}); }}
  });
  const box = context(['providerRescheduleRpcMissing','updateBookingAtExpectedStateLegacy','updateBookingAtExpectedState'], {db});
  const result = await box.updateBookingAtExpectedState(booking, {booking_time:'16:00:00'}, 'owner');
  assert.equal(!result.error, valid);
  assert.match(new URL(requested.url).pathname,/\/rpc\/reschedule_minuta_provider_booking_v143$/);
  assert.deepEqual(JSON.parse(requested.init.body), {p_booking:'b',p_date:'2099-09-09',p_time:'16:00:00',p_expected_date:'2099-09-09',p_expected_time:'14:00:00'});
});
test('missing v143 RPC alone falls back to the guarded legacy update during rollout', async () => {
  const requested=[];
  const db=sdkBox.supabase.createClient('https://fixture.invalid','fixture-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false},
    global:{fetch:async(url,init)=>{
      requested.push({url,init});
      if(new URL(url).pathname.includes('/rpc/'))return new Response(JSON.stringify({code:'PGRST202',message:'Could not find reschedule_minuta_provider_booking_v143 in the schema cache'}),{status:404,headers:{'content-type':'application/json'}});
      return new Response(JSON.stringify([{...booking,booking_time:'16:00:00'}]),{status:200,headers:{'content-type':'application/json'}});
    }}
  });
  const box=context(['providerRescheduleRpcMissing','updateBookingAtExpectedStateLegacy','updateBookingAtExpectedState'],{db});
  const result=await box.updateBookingAtExpectedState(booking,{booking_time:'16:00:00'},'owner');
  assert.equal(result.error,null); assert.equal(requested.length,2);
  const params=new URL(requested[1].url).searchParams;
  for(const key of ['service_id','booking_date','booking_time','duration_minutes','status'])assert.equal(params.get(key),`eq.${booking[key]}`);
  assert.match(params.get('select'),/id.*performer_id/);
});
test('protected RPC rejection is not retried as a direct table update',async()=>{
  let calls=0;
  const db={rpc:async()=>{calls++;return{data:null,error:{code:'23P01',message:'provider_booking_slot_unavailable'}};},from(){calls++;throw new Error('direct fallback forbidden');}};
  const box=context(['providerRescheduleRpcMissing','updateBookingAtExpectedStateLegacy','updateBookingAtExpectedState'],{db});
  const result=await box.updateBookingAtExpectedState(booking,{booking_date:'2099-09-10',booking_time:'16:00:00'},'owner');
  assert.equal(result.error.code,'23P01');assert.equal(calls,1);
});
for (const [name, result, ok] of [['deleted',{data:'deleted',error:null},true],['already absent',{data:'not_found',error:null},true],['server refused',{data:null,error:{message:'access_denied'}},false],['empty acknowledgement',{data:null,error:null},false]]) {
  test(`rollback verifies ${name}`,async()=>{
    const box=context(['rollbackCreatedBookings'],{db:{rpc:async()=>result}});
    const outcome=await box.rollbackCreatedBookings(['b']);
    assert.equal(outcome.ok,ok);assert.equal(outcome.unresolvedIds.length,ok?0:1);
  });
}
for (const mode of ['saved','quota','mismatch']) test(`local outcome durability: ${mode}`,()=>{
  let value;
  const box=context(['writeLocalOutcomes'],{outcomeStorageKey:()=> 'fixture',bookingOutcomes:new Map([['b',{visit_status:'completed'}]]),localStorage:{setItem(_key,next){if(mode==='quota')throw new DOMException('Quota','QuotaExceededError');value=next;},getItem(){return mode==='mismatch'?'{}':value;}}});
  assert.equal(box.writeLocalOutcomes(),mode==='saved');
});
test('older finance module preserves the legacy outcome writer during rollout',async()=>{
  const calls=[];
  const box=context(['persistBookingOutcome','cleanOutcomeRecord'],{
    MinutaFinanceProvider:{createController(){}},outcomesRemoteAvailable:false,
    currentUser:{id:'owner'},bookingOutcomes:new Map(),navigator:{onLine:true},
    captureBookingMetadataContext:()=>{throw new Error('missing optional bridge must not evaluate its arguments');},
    db:{rpc:async(name,params)=>{calls.push({name,params});return {data:{booking_id:'b',visit_status:'completed'}};}}
  });
  assert.equal((await box.persistBookingOutcome({booking_id:'b',visit_status:'completed',payment_method:'cash',amount_rub:1500,completion_source:'manual'})).ok,true);
  assert.deepEqual(calls.map(call=>call.name),['save_minuta_booking_outcome_v106']);
  const queued=await box.persistBookingOutcome({booking_id:'b',_finance:{requestId:'pending-atomic-request'}});
  assert.equal(queued.cancelled,true,'an older cached adapter cannot redirect a pending atomic payment to the legacy writer');
  assert.equal(calls.length,1);
});
test('remote plus local failure preserves outcome form and never reports saved',async()=>{
  const notices=[],rendered=[];const old={visit_status:'scheduled'};
  const form={dataset:{bookingId:'b'},querySelector(){return null;},append(node){this.error=node;}};
  const fields={'#outcomeVisitStatus':{value:'completed'},'#outcomePaymentMethod':{value:'cash'},'#outcomeAmount':{value:'1500'}};
  const box=context(['saveBookingOutcome','cleanOutcomeRecord','pendingOutcomeRecord'],{
    requireOutcomeWrites:()=>true,currentUser:{id:'owner'},sessionGeneration:1,sessionIsCurrent:()=>true,navigator:{onLine:true},
    allBookings:[booking],$:id=>fields[id],isPerMinuteBooking:()=>false,bookingMinuteRate:()=>0,
    persistBookingOutcome:async()=>({ok:false,error:{message:'network'}}),writeLocalOutcomes:()=>false,
    bookingOutcomes:new Map([['b',old]]),notify:message=>notices.push(message),
    document:{createElement:()=>({dataset:{},setAttribute(){}})},renderBookings:()=>rendered.push('bookings'),renderClients:()=>rendered.push('clients'),renderAnalytics:()=>rendered.push('analytics'),openBookingSheet:()=>rendered.push('sheet')
  });
  const button={disabled:false,textContent:''};
  await box.saveBookingOutcome({preventDefault(){},currentTarget:form,submitter:button});
  assert.equal(box.bookingOutcomes.get('b'),old);assert.equal(button.disabled,false);
  assert.equal(fields['#outcomeAmount'].value,'1500');assert.equal(rendered.length,0);
  assert.match(form.error.textContent,/Данные остались в форме/);
  assert.ok(notices.every(message=>!message.includes('Сохранено на устройстве')));
});
for (const reason of ['cancelled','noLocalSave']) test(`payment ${reason} preserves the form without a local success`,async()=>{
  const notices=[],rendered=[];let localWrites=0;
  const old={visit_status:'scheduled'},button={disabled:false,textContent:'Сохранить результат',isConnected:true};
  const form={dataset:{bookingId:'b'},querySelector(){return button;}};
  const fields={'#outcomeVisitStatus':{value:'completed'},'#outcomePaymentMethod':{value:'cash'},'#outcomeAmount':{value:'1500'}};
  const box=context(['saveBookingOutcome','cleanOutcomeRecord','pendingOutcomeRecord'],{
    requireOutcomeWrites:()=>true,currentUser:{id:'owner'},sessionGeneration:1,sessionIsCurrent:()=>true,navigator:{onLine:true},
    allBookings:[booking],$:id=>fields[id],isPerMinuteBooking:()=>false,bookingMinuteRate:()=>0,
    persistBookingOutcome:async()=>({ok:false,[reason]:true,error:{message:'Проверьте дату оплаты'}}),writeLocalOutcomes:()=>{localWrites++;return true;},
    bookingOutcomes:new Map([['b',old]]),notify:message=>notices.push(message),
    renderBookings:()=>rendered.push('bookings'),renderClients:()=>rendered.push('clients'),renderAnalytics:()=>rendered.push('analytics'),openBookingSheet:()=>rendered.push('sheet')
  });
  vm.runInContext(readFileSync(new URL('../finance-center-provider.js',import.meta.url),'utf8'),box);
  await box.saveBookingOutcome({preventDefault(){},currentTarget:form,submitter:button});
  assert.equal(box.bookingOutcomes.get('b'),old);assert.equal(localWrites,0);assert.equal(rendered.length,0);
  assert.equal(fields['#outcomeAmount'].value,'1500');assert.equal(button.disabled,false);
  assert.deepEqual(notices,reason==='cancelled'?[]:['Проверьте дату оплаты']);
});
for (const storage of ['available','quota','mismatch']) for (const mode of ['retry','thrown-response','inflight-edit','adapter-reload','stored-reload','capability-missing','finance-disabled','older-adapter','organization-change','changed-amount','changed-method','backgrounds-ready','backgrounds-capability-missing','backgrounds-older-adapter','offline-edit']) {
  if(mode==='stored-reload'&&storage!=='available')continue;
  test(`actual payment form retry: ${mode}, storage ${storage}`,async()=>{
    const stored=storage==='available';let serialized;
    const actor='10000000-0000-4000-8000-000000000001',org='20000000-0000-4000-8000-000000000001';
    const id='30000000-0000-4000-8000-000000000001',account='40000000-0000-4000-8000-000000000001';
    const receipts=new Map(),requests=[],legacy=[],notices=[];
    let releaseFirst;const firstResponse=new Promise(resolve=>{releaseFirst=resolve;});
    let active={id:org,current_role:'owner'},capability=true,enabled=true,confirmations=0;
    const fields={'#outcomeVisitStatus':{value:'completed'},'#outcomePaymentMethod':{value:'cash'},'#outcomeAmount':{value:'1500'}};
    const old={visit_status:'scheduled'},button={disabled:false,textContent:'Сохранить результат',isConnected:true};
    const form=()=>({dataset:{bookingId:id},querySelector(selector){return selector==='[data-outcome-save-error]'?this.error:button;},append(node){this.error=node;}});
    const box=context(['saveBookingOutcome','persistBookingOutcome','cleanOutcomeRecord','pendingOutcomeRecord','writeLocalOutcomes','quickCompleteBookingOutcome','applyAutomaticVisitOutcomes','syncPendingBookingOutcomes','completedOutcomeDraft','bookingOutcome'],{
      crypto:webcrypto,requireOutcomeWrites:()=>true,currentUser:{id:actor},sessionGeneration:1,sessionIsCurrent:()=>true,navigator:{onLine:true},
      allBookings:[{...booking,id,performer_id:actor}],$:selector=>fields[selector],isPerMinuteBooking:()=>false,bookingMinuteRate:()=>0,
      captureBookingMetadataContext:()=>()=>true,organizationController:{getActiveOrganization:()=>active},outcomesRemoteAvailable:false,
      requireWrites:()=>true,writesAllowed:true,isScheduleBlock:()=>false,bookingSessionEnd:()=>new Date('2020-01-01'),bookingCalculatedValue:()=>1000,autoCompletePaymentMethod:()=> 'cash',bookingPolicy:{auto_complete_visits:true},
      bookingOutcomes:new Map([[id,old]]),outcomeStorageKey:()=>`outcomes-${actor}`,notify:message=>notices.push(message),
      localStorage:{setItem(_key,value){if(storage==='quota')throw new DOMException('Quota','QuotaExceededError');serialized=value;},getItem(){return storage==='mismatch'?'{}':serialized;}},
      document:{createElement:()=>({dataset:{},setAttribute(){}})},renderBookings(){},renderClients(){},renderAnalytics(){},openBookingSheet(){},
      db:{rpc:async(name,params)=>{
        if(name==='get_minuta_visit_payment_capabilities_v1')return capability?{data:{schema:'minuta-visit-payment-v1',organization_id:org,enabled,today:'2026-10-18',accounts:[{id:account,name:'Касса',type:'cash'}]}}:{error:{code:'PGRST202'}};
        if(name!=='save_minuta_visit_payment_v1'){legacy.push(name);throw new Error('legacy writer is forbidden after an atomic attempt');}
        requests.push(JSON.parse(JSON.stringify(params)));
        const attempt=requests.length;if(mode==='inflight-edit'&&attempt===1)await firstResponse;
        if(!receipts.has(params.p_request_id))receipts.set(params.p_request_id,{id:'60000000-0000-4000-8000-000000000001',organization_id:org,outcome:{booking_id:id,visit_status:'completed',completion_source:'manual',payment_method:'cash',amount_rub:1500}});
        if(attempt===1){if(mode==='thrown-response')throw new Error('lost response');return {error:{message:'lost response'}};}
        return {data:receipts.get(params.p_request_id)};
      },from(){legacy.push('table upsert');throw new Error('legacy table write is forbidden');}},
      MinutaFinanceCenter:{confirmVisitPayment:async()=>{confirmations++;return {requestId:webcrypto.randomUUID(),paidOn:'2026-10-10',destinationAccount:account};}}
    });
    vm.runInContext(readFileSync(new URL('../finance-center-provider.js',import.meta.url),'utf8'),box);
    const submit=()=>box.saveBookingOutcome({preventDefault(){},currentTarget:form(),submitter:button});
    const firstSubmit=submit();
    if(mode==='inflight-edit'){
      while(!requests.length)await new Promise(resolve=>setImmediate(resolve));
      fields['#outcomeAmount'].value='2000';await submit();
      assert.equal(requests.length,1,'in-flight input is immutable before any response has been received');
      fields['#outcomeAmount'].value='1500';releaseFirst();
    }
    await firstSubmit;
    assert.equal(requests.length,1);assert.equal(receipts.size,1);assert.equal(confirmations,1);
    assert.equal(box.MinutaVisitPaymentRetries.get(actor+id).requestId,requests[0].p_request_id,'retry is owned before relying on browser storage');
    if(!stored)assert.equal(box.bookingOutcomes.get(id),old,'storage rejection restores the old business result while retaining retry ownership');
    const adapter=box.MinutaFinanceProvider;
    if(mode==='adapter-reload')vm.runInContext(readFileSync(new URL('../finance-center-provider.js',import.meta.url),'utf8'),box);
    if(mode==='stored-reload'){box.MinutaVisitPaymentRetries.clear();box.bookingOutcomes=new Map(Object.entries(JSON.parse(serialized)));}
    if(mode==='capability-missing')capability=false;
    if(mode==='finance-disabled')enabled=false;
    if(mode==='older-adapter')box.MinutaFinanceProvider={createController(){}};
    if(mode==='organization-change')active={id:'20000000-0000-4000-8000-000000000002',current_role:'owner'};
    if(mode==='changed-amount')fields['#outcomeAmount'].value='2000';
    if(mode==='changed-method')fields['#outcomePaymentMethod'].value='transfer';
    if(mode.startsWith('backgrounds-')){
      if(mode.endsWith('capability-missing'))capability=false;
      if(mode.endsWith('older-adapter'))box.MinutaFinanceProvider={createController(){}};
      const employee='90000000-0000-4000-8000-000000000002';box.allBookings[0].performer_id=employee;
      const writers=[
        ['quick',()=>box.quickCompleteBookingOutcome({dataset:{quickCompleteBooking:id},disabled:false,textContent:'Завершить'})],
        ['automatic',()=>box.applyAutomaticVisitOutcomes()],
        ['old-pending-sync',()=>box.syncPendingBookingOutcomes()],
        ['fresh-boundary',()=>box.persistBookingOutcome({booking_id:id,performer_id:employee,visit_status:'completed',payment_method:'cash',amount_rub:1000,completion_source:'auto'})]
      ];
      for(const [name,write] of writers){
        box.bookingOutcomes.set(id,{booking_id:id,performer_id:employee,visit_status:'scheduled',payment_method:'unpaid',amount_rub:0,completion_source:'manual',_sync_pending:true});
        await write();
        assert.equal(legacy.length,0,`${name} cannot bypass unresolved ownership`);
        assert.equal(requests.length,1,`${name} cannot change the pending payment`);
        assert.equal(confirmations,1,`${name} never opens a new payment confirmation`);
        assert.equal(box.MinutaVisitPaymentRetries.get(actor+id).requestId,requests[0].p_request_id,`${name} retains the original request`);
      }
    }
    if(mode==='offline-edit'){
      box.navigator.onLine=false;fields['#outcomeAmount'].value='2000';await submit();
      assert.equal(requests.length,1);assert.equal(legacy.length,0);
      if(stored){box.MinutaVisitPaymentRetries.clear();box.bookingOutcomes=new Map(Object.entries(JSON.parse(serialized)));}
      box.navigator.onLine=true;fields['#outcomeAmount'].value='1500';
    }
    await submit();
    assert.equal(legacy.length,0,'a fresh form record never falls back after an unresolved atomic write');
    if(!['retry','thrown-response','inflight-edit','adapter-reload','stored-reload','offline-edit','backgrounds-ready'].includes(mode)){
      assert.equal(requests.length,1,'context/adapter/input change sends no new atomic write');
      assert.equal(box.MinutaVisitPaymentRetries.get(actor+id).requestId,requests[0].p_request_id);
      capability=true;enabled=true;box.MinutaFinanceProvider=adapter;active={id:org,current_role:'owner'};fields['#outcomeAmount'].value='1500';fields['#outcomePaymentMethod'].value='cash';
      await submit();
    }
    assert.equal(requests.length,2);assert.deepEqual(requests[1],requests[0],'new submit reuses the exact UUID, organization, date, account and amount');
    assert.equal(receipts.size,1);assert.equal(confirmations,1,'new form does not ask for a second payment confirmation');
    assert.equal(box.bookingOutcomes.get(id).amount_rub,1500);assert.equal(box.MinutaVisitPaymentRetries.size,0,'confirmed response releases retry ownership');
    assert.equal(box.bookingOutcomes.get(id)._finance,undefined,'confirmed business result contains no pending envelope');
  });
}
test('offline outcome is accepted locally and queued without a server request',async()=>{
  const notices=[],rendered=[];let remoteCalls=0;
  const button={disabled:false,textContent:'Сохранить результат',isConnected:true};
  const form={dataset:{bookingId:'b'},querySelector(selector){return selector==='button[type="submit"]'?button:null;},append(){}};
  const fields={'#outcomeVisitStatus':{value:'completed'},'#outcomePaymentMethod':{value:'cash'},'#outcomeAmount':{value:'3000'}};
  const box=context(['saveBookingOutcome','persistBookingOutcome','cleanOutcomeRecord','pendingOutcomeRecord'],{
    requireOutcomeWrites:()=>true,currentUser:{id:'owner'},sessionGeneration:1,sessionIsCurrent:()=>true,navigator:{onLine:false},MinutaFinanceProvider:{createController(){}},
    allBookings:[booking],$:id=>fields[id],isPerMinuteBooking:()=>false,bookingMinuteRate:()=>0,
    db:{rpc:async()=>{remoteCalls++;throw new Error('offline must not dispatch');}},writeLocalOutcomes:()=>true,
    bookingOutcomes:new Map(),notify:message=>notices.push(message),
    renderBookings:()=>rendered.push('bookings'),renderClients:()=>rendered.push('clients'),renderAnalytics:()=>rendered.push('analytics'),openBookingSheet:()=>rendered.push('sheet')
  });
  await box.saveBookingOutcome({preventDefault(){},currentTarget:form,submitter:null});
  const pending=box.bookingOutcomes.get('b');
  assert.equal(remoteCalls,0);
  assert.equal(button.disabled,false);
  assert.equal(pending.visit_status,'completed');
  assert.equal(pending.payment_method,'cash');
  assert.equal(pending.amount_rub,3000);
  assert.equal(pending._sync_pending,true);
  assert.deepEqual(rendered,['bookings','clients','analytics','sheet']);
  assert.ok(notices.some(message=>message.includes('ожидает синхронизации')));
});
test('offline outcome controls stay enabled only for a signed-in user',()=>{
  const box=context(['canQueueOfflineOutcome'],{currentUser:{id:'owner'},navigator:{onLine:false}});
  assert.equal(box.canQueueOfflineOutcome(),true);
  box.currentUser=null;
  assert.equal(box.canQueueOfflineOutcome(),false);
  box.currentUser={id:'owner'};
  box.navigator.onLine=true;
  assert.equal(box.canQueueOfflineOutcome(),false);
});
test('write availability keeps the offline outcome submit button actionable',()=>{
  const control={disabled:true,dataset:{reliabilityDisabled:'true'},matches:selector=>selector==='#bookingOutcomeForm button[type="submit"]'};
  const box=context(['canQueueOfflineOutcome','applyWriteAvailability'],{
    currentUser:{id:'owner'},navigator:{onLine:false},writesAllowed:false,bookingCreationReady:false,
    writeSelectors:['#bookingOutcomeForm button[type="submit"]'],bookingFormLauncherSelector:'#launcher',bookingCreationWriteSelector:'#new',offlineBookingCreateSelector:'#new',offlineOutcomeWriteSelector:'#bookingOutcomeForm button[type="submit"]',
    canQueueOfflineBooking:()=>false,$$:()=>[control],updateScheduleSaveState:()=>{}
  });
  box.applyWriteAvailability();
  assert.equal(control.disabled,false);
  assert.equal(Object.hasOwn(control.dataset,'reliabilityDisabled'),false);
});
test('booking form launcher stays actionable while submit remains protected',()=>{
  const selector='#newBookingButton, #mobileNewBookingButton, [data-create-empty-booking]';
  const launcher={disabled:true,dataset:{reliabilityDisabled:'true'},matches:value=>value===selector};
  const submit={disabled:false,dataset:{},matches:value=>value==='#newBookingForm button[type="submit"]'};
  const box=context(['canQueueOfflineOutcome','applyWriteAvailability'],{
    currentUser:{id:'owner'},navigator:{onLine:true},writesAllowed:false,bookingCreationReady:false,
    writeSelectors:['#newBookingButton','#newBookingForm button[type="submit"]'],bookingFormLauncherSelector:selector,
    bookingCreationWriteSelector:'#newBookingForm button[type="submit"]',offlineBookingCreateSelector:'#newBookingForm button[type="submit"]',offlineOutcomeWriteSelector:'#outcome',
    canQueueOfflineBooking:()=>false,$$:()=>[launcher,submit],updateScheduleSaveState:()=>{}
  });
  box.applyWriteAvailability();
  assert.equal(launcher.disabled,false);
  assert.equal(submit.disabled,true);
  assert.equal(submit.dataset.reliabilityDisabled,'true');
});
test('a queued outcome is sent and cleared after synchronization returns',async()=>{
  const pending={booking_id:'b',performer_id:'owner',visit_status:'completed',payment_method:'cash',amount_rub:3000,_sync_pending:true};
  const saved=[];
  const box=context(['syncPendingBookingOutcomes','cleanOutcomeRecord'],{
    currentUser:{id:'owner'},sessionGeneration:1,writesAllowed:true,bookingOutcomes:new Map([['b',pending]]),
    persistBookingOutcome:async record=>({ok:true,outcome:{...record,updated_at:'server-time'}}),sessionIsCurrent:()=>true,
    writeLocalOutcomes:()=>{saved.push(true);return true;}
  });
  assert.equal(await box.syncPendingBookingOutcomes(),1);
  const synced=box.bookingOutcomes.get('b');
  assert.equal(synced._sync_pending,undefined);
  assert.equal(synced.updated_at,'server-time');
  assert.equal(saved.length,1);
});
test('block duration does not depend on service duration',()=>{
  const box=context(['newBookingDurationMinutes','blockDurationChoices'],{newBookingMode:'block',$:()=>({value:'45'}),selectedNewBookingService:()=>({duration_minutes:120})});
  assert.equal(box.newBookingDurationMinutes(),45);
  assert.deepEqual([...box.blockDurationChoices().matchAll(/value="(\d+)"/g)].map(match=>Number(match[1])),[15,30,45,60,90,120]);
});
test('move content puts time before optional metadata and labels the slot group',()=>{
  const markup=actual('openBookingEditor');
  assert.ok(markup.indexOf('id="editBookingDate"')<markup.indexOf('id="editBookingNote"'));
  assert.match(markup,/role="group" aria-labelledby="editBookingTimesLabel"/);
  assert.match(markup,/id="editBookingSelection" role="status"/);
  assert.match(markup,/<details class="booking-move-advanced"><summary>Дополнительно/);
});

test('slot cutoff uses Samara clock, not browser timezone',()=>{
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:['2026-09-08T06:10:20Z']));} }
  const box=context(['bookingMoveTimeIsPast'],{Date:FixedDate,businessTodayIso:()=> '2026-09-08'});
  assert.equal(box.bookingMoveTimeIsPast('2026-09-08','10:05'),true);
  assert.equal(box.bookingMoveTimeIsPast('2026-09-08','10:10'),true);
  assert.equal(box.bookingMoveTimeIsPast('2026-09-08','10:15'),false);
  assert.equal(box.bookingMoveTimeIsPast('2026-09-09','00:00'),false);
});
test('returned booking id is authoritative and never matches a different cancelled record',()=>{
  const box=context(['createdBookingMatches','findCreatedBooking'],{allBookings:[{id:'other',service_id:'service',booking_date:'2099-09-09',booking_time:'14:00:00',client_phone:'123',status:'cancelled'}],normalizePhone:x=>x});
  const criteria={id:'returned-id',service:'service',date:'2099-09-09',time:'14:00',phone:'123'};
  assert.equal(box.findCreatedBooking(criteria),null);assert.equal(box.findCreatedBooking({...criteria,id:''}),null);
});
