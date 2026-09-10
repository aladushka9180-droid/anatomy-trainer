import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Execute the actual provider controllers, not copied implementations. Only DOM,
// transport and unrelated screen refresh boundaries are synthetic. No network.
const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8');
const extract=(start,end)=>{
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,`actual controller boundary missing: ${start}`);
 return source.slice(a,b);
};
const contextCode=extract('function activeProviderBlockContext(', 'function providerBlockLocationOptions(');
const slotsCode=extract('async function loadNewBookingSlots()', 'function renderNewBookingTimePicker(');
const createCode=extract('async function createNewBooking(event)', 'function closeBookingSheet(');
const idCode=extract('function bookingIdFromRpcResult(', 'function findCreatedBooking(');
const uuid='00000000-0000-4000-8000-000000123001';
const plain=value=>JSON.parse(JSON.stringify(value));

function fixture({duration=15,serviceDuration=60,servicesAvailable=true,organization=true,online=true,responses=[],visibleBooking=true}={}){
 const fields={
  '#newBookingForm':{dataset:{}},'#newBookingSubmit':{disabled:false,textContent:'Занять время'},
  '#newBookingService':{value:servicesAvailable?'service-60':''},'#newBookingDate':{value:'2099-01-04'},
  '#newBookingBlockTitle':{value:'Личный перерыв'},'#newBookingBlockNote':{value:'Важная заметка'},
  '#newBookingLocation':{value:'branch-selected'},'#newBookingInterval':{value:'1'},
  '#newBookingTimes':{innerHTML:''},'#bookingSheet':{hidden:false}
 };
 const calls=[],writes=[],errors=[],notices=[];let generated=0;
 const organizations=organization?{id:'organization-explicit',locations:[
  {id:'branch-primary',active:true,is_primary:true},{id:'branch-selected',active:true},
  {id:'branch-disabled',active:false}
 ]}:null;
 const sandbox={console,Date,JSON,Set,Number,String,navigator:{onLine:online},$:selector=>fields[selector],
  currentUser:{id:'actor'},sessionGeneration:3,sessionIsCurrent:()=>true,
  organizationController:{getActiveOrganization:()=>organizations},
  newBookingMode:'block',newBookingHistoricalMode:false,newBookingOutsideSchedule:false,
  newBookingTime:'10:00',newBookingPreferredTime:'10:00',newBookingSlots:[],newBookingHour:'',newBookingSlotsRequestId:0,
  editingOfflineBookingId:'',SCHEDULE_BLOCK_PHONE:'0000000000',BOOKING_COLOR_DEFAULT:'default',
  readProviderBookingAttempt:()=>null,
  ownServices:servicesAvailable?[{id:'service-60',name:'Technical service',active:true,duration_minutes:serviceDuration}]:[],allBookings:[],
  testDuration:duration,newBookingDurationMinutes:()=>sandbox.testDuration,businessTodayIso:()=> '2098-12-01',
  requireBookingWrites:()=>true,bookingPlacementIssue:()=>'',bookingMoveTimeIsPast:()=>false,
  minutesFromTime:value=>Number(value.slice(0,2))*60+Number(value.slice(3,5)),
  normalizePhone:value=>String(value).replace(/\D/g,''),
  createOfflineBookingId:()=>{generated++;return uuid;},
  showFormError:(selector,message)=>errors.push(message),clearFormError(){},
  updateNewBookingSubmitCaption(){},updateNewBookingDurationControl(){},renderNewBookingTimePicker(){},
  recordConnectionEvent(){},selectScheduleDate(){},clearNewBookingDraft(){},closeBookingSheet(){},
  refreshAfterWrite:async()=>true,notify:message=>notices.push(message),focusCreatedBooking(){},
  findCreatedBooking:criteria=>visibleBooking&&criteria.service===''?{id:uuid}:null,ensureCreatedBookingVisible:async()=>null,
  // Color is an explicitly allowed optional setting AFTER confirmed creation.
  saveBookingColor:async(...args)=>{writes.push({kind:'color',args});return true;},
  saveClientNoteValue:async()=>{writes.push({kind:'client-note'});throw Error('client note must not be written for a block');},
  applyPerMinuteBookingTerms:async()=>{writes.push({kind:'duration-update'});throw Error('post-create duration update forbidden');},
  rollbackCreatedBookings:async()=>{writes.push({kind:'delete'});throw Error('post-create delete forbidden');},
  deliverTelegramClientNotification:async()=>{writes.push({kind:'telegram'});throw Error('client notification forbidden');},
  loadBookings:async()=>{throw Error('legacy post-create duration lookup forbidden');},
  loadNewBookingSlots:async()=>{},
  getProviderAvailableSlots:async()=>{throw Error('service-duration availability fallback forbidden');},
  db:{from:()=>{throw Error('direct booking UPDATE/DELETE forbidden');},rpc:async(name,args)=>{
   calls.push({name,args:plain(args)});
   if(name==='get_provider_block_slots_v141')return {data:[{booking_time:'10:00:00'},{booking_time:'10:05:00'}],error:null};
   assert.equal(name,'create_provider_block_v141','no provider_book_appointment/book_appointment fallback');
   const next=responses.shift();
   if(typeof next==='function')return next(args);
   if(next)return next;
   return {data:{booking_id:args.p_request_id,booking_code:'MIN-0123456789',duration_minutes:args.p_duration,
    payment_required:false,notifications_suppressed:true},error:null};
  }}
 };
 vm.createContext(sandbox);vm.runInContext(contextCode+idCode+createCode,sandbox);
 const submit=()=>sandbox.createNewBooking({preventDefault(){},currentTarget:fields['#newBookingForm'],submitter:fields['#newBookingSubmit']});
 const slots=async()=>{vm.runInContext(slotsCode,sandbox);await sandbox.loadNewBookingSlots();};
 return {sandbox,fields,calls,writes,errors,notices,submit,slots,get generated(){return generated;}};
}

test('actual duration-aware slots admit 15 minutes independently of a 60-minute technical service',async()=>{
 const f=fixture();await f.slots();
 assert.deepEqual(f.calls,[{name:'get_provider_block_slots_v141',args:{p_organization:'organization-explicit',p_location:'branch-selected',
  p_date:'2099-01-04',p_duration:15,p_ignore_booking:null}}]);
 assert.deepEqual(plain(f.sandbox.newBookingSlots),['10:00','10:05']);assert.equal(f.sandbox.newBookingTime,'10:00');
});
test('actual context excludes disabled locations and uses an explicit active organization',()=>{
 const f=fixture();assert.equal(f.sandbox.activeProviderBlockContext('branch-disabled').locationId,'branch-primary');
 assert.deepEqual(plain(f.sandbox.activeProviderBlockContext('branch-selected')).locations.map(l=>l.id),['branch-primary','branch-selected']);
});
test('missing tenant context prevents both slots and creation RPCs',async()=>{
 const f=fixture({organization:false});await f.slots();f.sandbox.newBookingTime='10:00';await f.submit();
 assert.equal(f.calls.length,0);assert.match(f.fields['#newBookingTimes'].innerHTML,/активный филиал/);assert.match(f.errors.at(-1),/активный филиал/);
});
test('actual create sends the complete exact-duration/tenant/request/title/note envelope',async()=>{
 const f=fixture();await f.submit();
 assert.deepEqual(f.calls,[{name:'create_provider_block_v141',args:{p_organization:'organization-explicit',p_location:'branch-selected',
  p_date:'2099-01-04',p_time:'10:00:00',p_duration:15,p_request_id:uuid,p_title:'Личный перерыв',p_note:'Важная заметка'}}]);
 assert.deepEqual(f.writes.map(w=>w.kind),['color']);assert.equal(f.generated,1);assert.equal(f.notices.at(-1),'Время занято');
});
test('actual create does not require any active service',async()=>{
 const f=fixture({servicesAvailable:false});await f.submit();
 assert.deepEqual(f.calls.map(call=>call.name),['create_provider_block_v141']);
 assert.equal(f.calls[0].args.p_service,undefined);assert.equal(f.errors.length,0);
});
test('even per-minute technical services never cause block duration UPDATE/delete/client note/Telegram after creation',async()=>{
 const f=fixture({serviceDuration:1,duration:45});await f.submit();
 assert.equal(f.calls[0].args.p_duration,45);assert.deepEqual(f.writes.map(w=>w.kind),['color']);assert.equal(f.errors.length,0);
});
test('lost response retry executes same actual controller with the same UUID and immutable envelope',async()=>{
 const f=fixture({responses:[{data:null,error:{message:'Failed to fetch'}}]});
 await f.submit();assert.match(f.errors.at(-1),/повторите попытку без изменений/);assert.ok(f.fields['#newBookingForm'].dataset.blockRequestPayload);
 assert.equal(f.writes.length,0);await f.submit();
 assert.equal(f.calls.length,2);assert.deepEqual(f.calls[1],f.calls[0]);assert.equal(f.generated,1);assert.equal(f.notices.at(-1),'Время занято');
});
for(const field of ['#newBookingBlockNote','#newBookingBlockTitle','#newBookingLocation']){
 test(`changed ${field} is refused after unknown transport outcome`,async()=>{
  const f=fixture({responses:[{data:null,error:{message:'NetworkError: Failed to fetch'}}]});await f.submit();
  f.fields[field].value=field==='#newBookingLocation'?'branch-primary':'Изменено';await f.submit();
  assert.equal(f.calls.length,1);assert.match(f.errors.at(-1),/данные изменились/);assert.equal(f.writes.length,0);
 });
}
for(const [label,change] of [
 ['duration',f=>{f.sandbox.testDuration=30;}],['time',f=>{f.sandbox.newBookingTime='10:05';}],
 ['date',f=>{f.fields['#newBookingDate'].value='2099-01-05';}]
]){
 test(`changed ${label} is refused after unknown transport outcome`,async()=>{
  const f=fixture({responses:[{data:null,error:{message:'Failed to fetch'}}]});await f.submit();change(f);await f.submit();
  assert.equal(f.calls.length,1);assert.match(f.errors.at(-1),/данные изменились/);assert.equal(f.writes.length,0);
 });
}
test('incomplete success acknowledgement locks repeat and performs no post-create writes',async()=>{
 const f=fixture({responses:[{data:{booking_id:uuid,duration_minutes:15,payment_required:false},error:null}]});
 await f.submit();assert.equal(f.fields['#newBookingForm'].dataset.creationUncertain,'true');
 await f.submit();assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);assert.match(f.errors.at(-1),/Проверьте созданные записи/);
});
for(const error of [{code:'PGRST202',message:'Could not find create_provider_block_v141 in the schema cache'},
 {code:'42501',message:'permission denied for function create_provider_block_v141'}]){
 test(`technical block failure ${error.code} never invokes legacy creation fallback`,async()=>{
  const f=fixture({responses:[{data:null,error}]});await f.submit();
  assert.deepEqual(f.calls.map(c=>c.name),['create_provider_block_v141']);assert.equal(f.writes.length,0);assert.ok(f.errors.length);
 });
}
test('offline block does not create, queue, or send client notifications',async()=>{
 const f=fixture({online:false});await f.submit();assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);assert.match(f.errors.at(-1),/не блокировку времени/);
});
