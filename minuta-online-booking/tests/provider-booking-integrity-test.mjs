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
  vm.runInContext(names.map(actual).join('\n'), box);
  return box;
}
const sdkBox = vm.createContext({ console, URL, URLSearchParams, Headers, Request, Response, AbortController, DOMException, WebSocket, fetch, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder, crypto:webcrypto });
vm.runInContext(readFileSync(new URL('../vendor/supabase-2.112.4.min.js', import.meta.url), 'utf8'), sdkBox);
const booking = { id:'b', performer_id:'owner', service_id:'service', booking_date:'2099-09-09', booking_time:'14:00:00', duration_minutes:60, status:'confirmed' };
for (const [name, response, valid] of [
  ['zero-row HTTP 204', null, false], ['empty returned rows', [], false],
  ['wrong returned time', [{...booking,booking_time:'15:00:00'}], false],
  ['confirmed exact row', [{...booking,booking_time:'16:00:00'}], true]
]) test(`move uses real SDK and rejects ${name} unless exact`, async () => {
  let requested;
  const db = sdkBox.supabase.createClient('https://fixture.invalid', 'fixture-key', {
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false},
    global:{fetch:async (url, init) => { requested={url,init}; return new Response(response === null ? null : JSON.stringify(response), {status:response === null ? 204 : 200,headers:{'content-type':'application/json'}}); }}
  });
  const box = context(['updateBookingAtExpectedState'], {db});
  const result = await box.updateBookingAtExpectedState(booking, {booking_time:'16:00:00'}, 'owner');
  assert.equal(!result.error, valid);
  const params = new URL(requested.url).searchParams;
  for (const key of ['service_id','booking_date','booking_time','duration_minutes','status']) assert.equal(params.get(key), `eq.${booking[key]}`);
  assert.match(params.get('select'), /id.*performer_id/);
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
test('remote plus local failure preserves outcome form and never reports saved',async()=>{
  const notices=[],rendered=[];const old={visit_status:'scheduled'};
  const form={dataset:{bookingId:'b'},querySelector(){return null;},append(node){this.error=node;}};
  const fields={'#outcomeVisitStatus':{value:'completed'},'#outcomePaymentMethod':{value:'cash'},'#outcomeAmount':{value:'1500'}};
  const box=context(['saveBookingOutcome','cleanOutcomeRecord','pendingOutcomeRecord'],{
    requireWrites:()=>true,currentUser:{id:'owner'},sessionGeneration:1,sessionIsCurrent:()=>true,
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
  const box=context(['findCreatedBooking'],{allBookings:[{id:'other',service_id:'service',booking_date:'2099-09-09',booking_time:'14:00:00',client_phone:'123',status:'cancelled'}],normalizePhone:x=>x});
  const criteria={id:'returned-id',service:'service',date:'2099-09-09',time:'14:00',phone:'123'};
  assert.equal(box.findCreatedBooking(criteria),null);assert.equal(box.findCreatedBooking({...criteria,id:''}),null);
});
