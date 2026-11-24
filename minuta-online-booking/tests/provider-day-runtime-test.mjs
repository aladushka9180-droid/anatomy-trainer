import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../provider-day-runtime.js',import.meta.url),'utf8');
let ports;const window={PrimeTimeProviderDayActions:{create(p){ports=p;return {markup:d=>'day:'+d.date,attach(){},close(){}};}}};
vm.runInNewContext(source,{window,navigator:{onLine:true},Date,Map,JSON,Error,document:{}});
let c={userId:'u',organizationId:'o',locationId:'l',date:'2026-11-25',sessionGeneration:1,timeZone:'Europe/Samara'};
const values=new Map(),calls=[];let failStorage=false;let reply;
const storage={getItem:k=>values.get(k)||null,setItem(k,v){if(failStorage)throw Error('full');values.set(k,v);},removeItem:k=>values.delete(k)};
const runtime=window.PrimeTimeProviderDayRuntime.create({db:{async rpc(name,args){calls.push({name,args,stored:values.size});return {data:reply,error:null};}},getContext:()=>c,canWrite:()=>true,storage,services:()=>[{id:'s'}],bookings:()=>[],today:()=>c.date,render(){},refresh(){},openBooking(){}});
reply=[{date:c.date,working:true,hasOverride:true,start:'11:00',end:'17:00',closures:[],slotInterval:15}];await runtime.load();
assert.equal(calls[0].name,'list_minuta_provider_days_v192');assert.equal(calls[0].args.p_location,'l');
assert.equal(runtime.state(c.date,{weekly:{enabled:false}}).weekly.start_time,'11:00');
assert.equal(runtime.markup(c.date,'Выходной'),'day:'+c.date);
const attempt={date:c.date,requestId:'request',start:'11:00',end:'17:00',onlineEnabled:true,expectedRevision:'old'};
reply={date:c.date,requestId:attempt.requestId,confirmed:true};await ports.saveHours(c,attempt);
assert.equal(calls.at(-1).stored,1,'persist before sending mutation');assert.equal(values.size,0,'acknowledged request cleared');
failStorage=true;const before=calls.length;await assert.rejects(ports.saveHours(c,attempt),/full/);assert.equal(calls.length,before);failStorage=false;
reply={};await ports.saveHours(c,attempt);assert.equal(values.size,1,'unknown acknowledgement retained');
reply={date:c.date,requestId:'request',notApplied:true};await ports.resolveHours(c,'request');assert.equal(values.size,0);assert.equal(calls.at(-1).name,'resolve_minuta_provider_day_v192');
await runtime.slots({p_service:'s',p_start:c.date,p_end:c.date,p_ignore_booking:null});assert.equal(calls.at(-1).name,'get_minuta_provider_day_slots_v192');
const form={dataset:{dayException:JSON.stringify(c)}};await runtime.slots({p_service:'s'},form,60);assert.equal(calls.at(-1).name,'get_minuta_day_exception_slots_v192');assert.equal(calls.at(-1).args.p_duration,60);
await runtime.book(c,'request',{p_service:'s',p_date:c.date,p_time:'12:00'},60,2500);assert.equal(calls.at(-1).name,'book_minuta_day_exception_v192');assert.equal(calls.at(-1).args.p_organization,'o');
const dated=runtime.bookingContext({service:'s',date:c.date});assert.ok(dated);await runtime.book(dated,'normal',{p_service:'s',p_date:c.date,p_time:'12:00'},60,2500,false);assert.equal(calls.at(-1).name,'book_minuta_provider_day_v192');
assert.equal(await runtime.slots({p_service:'foreign',p_start:c.date,p_end:c.date}),null,'foreign performer keeps native availability path');
const old=c;c={...c,sessionGeneration:2};await assert.rejects(ports.saveHours(old,attempt),/context_changed/);assert.throws(()=>runtime.exception(form),/context_changed/);
assert.equal(runtime.day(c.date),undefined,'cache invalidated across session generation');
c={...c,organizationId:'other'};assert.equal(runtime.markup(c.date,'Выходной'),'');
console.log('PASS: dated-day runtime scope, persisted requests, unknown response, resolve-only retry, native RPC bindings and stale sessions');

// Execute the native form's actual routing declaration: a repeat keeps its native writer.
const native=fs.readFileSync(new URL('../provider.js',import.meta.url),'utf8');
const routing=native.match(/^  const dayContext=.*bookingContext\(\{service,date\}\);$/m)?.[0];assert.ok(routing);
for(const repeat of [true,false]){let routed=0;const probe={repeatVisit:repeat?{}:null,service:'s',date:c.date,providerDayRuntime:{bookingContext(){routed++;return {dated:true};}}};vm.runInNewContext(routing+'\nthis.result=dayContext;',probe);assert.equal(routed,repeat?0:1);if(repeat)assert.equal(probe.result,false);}
