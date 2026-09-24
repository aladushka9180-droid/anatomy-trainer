import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url),'utf8');
const start = source.indexOf('async function flushOfflineBookings(');
const end = source.indexOf('\nconst bookingFormLauncherSelector',start);
assert.ok(start >= 0 && end > start);
const actual = source.slice(start,end);

async function scenario(reply) {
  const item = { id:'00000000-0000-4000-8000-000000000178',userId:'provider',status:'pending',
    serviceId:'service',date:'2026-09-26',time:'10:00',latestTime:'18:00',clientName:'Тест',clientPhone:'+79990000000',durationMinutes:60 };
  const calls = [];
  let booking = null;
  let finalized = false;
  const context = vm.createContext({
    offlineBookingQueue:[item],offlineBookingFlushPromise:null,currentUser:{id:'provider'},providerSessionTrust:'verified',
    navigator:{onLine:true},writesAllowed:true,bookingCreationReady:true,sessionGeneration:1,
    sessionIsCurrent:()=>true,businessTodayIso:()=> '2026-09-25',
    queuedBookingMatch:()=>booking,queuedBookingSlotMatch:()=>({id:'occupied-at-ten'}),
    renderOfflineBookingQueue:()=>{},saveOfflineBookingQueue:async()=>true,
    renderBookingData:()=>{},stageOfflineBookingProviderNotice:()=>null,deliverOfflineBookingProviderNotice:()=>{},
    loadBookings:async()=>{ if (reply.result_code==='ok') booking={id:'booking',request_id:item.id,booking_time:'13:00:00'}; return {ok:true}; },
    ownServices:[{id:'service',duration_minutes:60}],applyPerMinuteBookingTerms:async()=>({ok:true}),
    finalizeQueuedBooking:async()=>{finalized=true;return true;},rollbackCreatedBookings:async()=>({ok:true}),
    db:{rpc:async(name,args)=>{calls.push({name,args});return {data:reply,error:null};}},
    Number,Date,String,Math,Promise
  });
  vm.runInContext(actual,context);
  await context.flushOfflineBookings();
  return { item,calls,finalized };
}

const success = await scenario({result_code:'ok',booking_time:'13:00:00'});
assert.equal(success.calls.length,1);
assert.equal(success.calls[0].name,'book_flexible_appointment_v178');
assert.equal(success.calls[0].args.p_earliest,'10:00:00');
assert.equal(success.calls[0].args.p_latest,'18:00:00');
assert.equal(success.calls[0].args.p_request_id,success.item.id);
assert.equal(success.calls[0].args.p_kind,'provider');
assert.equal(success.item.time,'13:00');
assert.equal(success.finalized,true);

const conflict = await scenario({result_code:'no_slot_in_range'});
assert.equal(conflict.calls.length,1);
assert.equal(conflict.item.status,'conflict');
assert.equal(conflict.item.reason,'no_slot_in_range');
assert.equal(conflict.finalized,false);
console.log('Provider offline flexible queue: nearest confirmed time and bounded conflict passed');
