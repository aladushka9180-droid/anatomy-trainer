import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Actual slot-controller function, synthetic duration-aware server boundary.
// This diagnoses the short-block UI contract, not concurrent PostgreSQL behavior.
const source=readFileSync(new URL('../provider.js',import.meta.url),'utf8');
const start=source.indexOf('async function loadNewBookingSlots()');
const end=source.indexOf('function renderNewBookingTimePicker(',start);
assert.ok(start>=0&&end>start);
async function fixture(serviceDuration){
 const fields={'#newBookingService':{value:'service'},'#newBookingDate':{value:'2027-01-04'},'#newBookingTimes':{innerHTML:''},'#newBookingLocation':{value:'location'}};
 const calls=[];
 const sandbox={console,Date,navigator:{onLine:true},$:s=>fields[s],newBookingMode:'block',newBookingHistoricalMode:false,
  newBookingOutsideSchedule:false,newBookingPreferredTime:'10:00',newBookingSlots:[],newBookingTime:'',newBookingHour:'',newBookingSlotsRequestId:0,
  newBookingDurationMinutes:()=>15,businessTodayIso:()=> '2026-09-08',
  bookingMoveTimeIsPast:()=>false,bookingPlacementIssue:()=>'',minutesFromTime:()=>600,
  renderNewBookingOutsideSchedulePrompt:()=>fields['#newBookingTimes'].innerHTML='outside-schedule',
  renderNewBookingTimePicker(){},updateNewBookingDurationControl(){},updateNewBookingSubmitCaption(){},clearFormError(){},
  activeProviderBlockContext:()=>({organizationId:'organization',locationId:'location'}),
  db:{rpc:async(name,args)=>{assert.equal(name,'get_provider_block_slots_v123');calls.push(args);return {data:[{booking_time:'10:00:00'}],error:null};}},
  getProviderAvailableSlots:async()=>{throw Error(`legacy service-duration RPC called for ${serviceDuration}`);}};
 vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);await sandbox.loadNewBookingSlots();return {sandbox,calls};
}
test('control: fifteen-minute block offered when service also fits twenty-minute gap',async()=>{
 const f=await fixture(15);assert.equal(f.sandbox.newBookingTime,'10:00');
});
test('fifteen-minute block must fit twenty-minute gap even if shortest service is sixty minutes',async()=>{
 const f=await fixture(60);assert.equal(f.sandbox.newBookingTime,'10:00','Duration-aware RPC must offer a valid shorter time block');
 assert.equal(f.calls[0].p_duration,15);assert.equal(f.calls[0].p_service,'service');
});

test('late response for an old service and date cannot replace the selected 18:00',async()=>{
 const fields={'#newBookingService':{value:'service-a'},'#newBookingDate':{value:'2027-01-04'},'#newBookingTimes':{innerHTML:''},'#newBookingLocation':{value:''}};
 const pending=[];
 const sandbox={console,Date,navigator:{onLine:true},$:s=>fields[s],newBookingMode:'client',newBookingHistoricalMode:false,
  newBookingOutsideSchedule:false,newBookingPreferredTime:'18:00',newBookingSlots:[],newBookingTime:'',newBookingHour:'',newBookingSlotsRequestId:0,
  newBookingDurationMinutes:()=>60,businessTodayIso:()=> '2026-09-08',bookingMoveTimeIsPast:()=>false,
  bookingPlacementIssue:()=>'',minutesFromTime:value=>Number(value.slice(0,2))*60+Number(value.slice(3,5)),
  renderNewBookingOutsideSchedulePrompt(){},renderNewBookingTimePicker(){},updateNewBookingDurationControl(){},clearFormError(){},
  getProviderAvailableSlots:args=>new Promise(resolve=>pending.push({args,resolve})),db:{rpc:async()=>({data:[],error:null})}};
 vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);
 const oldRequest=sandbox.loadNewBookingSlots();
 fields['#newBookingService'].value='service-b';fields['#newBookingDate'].value='2027-01-05';
 const currentRequest=sandbox.loadNewBookingSlots();
 pending[1].resolve({data:[{booking_time:'18:00:00'}],error:null});await currentRequest;
 pending[0].resolve({data:[{booking_time:'11:00:00'}],error:null});await oldRequest;
 assert.equal(sandbox.newBookingTime,'18:00');
 assert.deepEqual([...sandbox.newBookingSlots],['18:00']);
});
