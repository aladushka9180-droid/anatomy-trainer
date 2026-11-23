/* Finite adapters for the approved dated-hours and one-off day actions. */
(function(root){
'use strict';
const iso=/^\d{4}-\d{2}-\d{2}$/;
const key=c=>[c.userId,c.organizationId,c.locationId,c.sessionGeneration].join(':');
const storageKey=c=>['minuta-day-hours-v192',c.userId,c.organizationId,c.locationId,c.date].join(':');
function create(p){
 if(p.read){const read=p.read;p={...p,getContext(){const s=read(),l=s.locations.find(l=>l.id===s.locationId);return s.userId&&s.organizationId&&s.locationId?{userId:s.userId,organizationId:s.organizationId,locationId:s.locationId,date:s.date,timeZone:l?.timezone||'Europe/Samara',sessionGeneration:s.sessionGeneration}:null;},canWrite:()=>read().write};}
 let scope='',rows=new Map(),pendingRange=null,available=false,failedRange='',epoch=0,force=false;
 const context=()=>p.getContext();
 const current=c=>{const n=context();return n&&key(n)===key(c)&&n.date===c.date;};
 const requireCurrent=c=>{if(!current(c)||!p.canWrite(c))throw Error('day_context_changed');};
 const rpc=async(name,args)=>{const r=await p.db.rpc(name,args);if(r.error)throw r.error;return r.data;};
 const params=c=>({p_organization:c.organizationId,p_location:c.locationId});
 const reset=()=>{const c=context();const next=c?key(c):'';if(next!==scope){scope=next;rows=new Map();available=false;failedRange='';epoch++;force=false;}return c;};
 const readPending=c=>{const text=p.storage.getItem(storageKey(c));return text?JSON.parse(text):null;};
 const remember=(c,attempt)=>{const text=JSON.stringify(attempt);p.storage.setItem(storageKey(c),text);if(p.storage.getItem(storageKey(c))!==text)throw Error('day_request_not_persisted');};
 const acknowledge=(c,data)=>{if(data?.date===c.date&&(data.confirmed===true||data.notApplied===true)){const a=readPending(c);if(a?.requestId===data.requestId)p.storage.removeItem(storageKey(c));}return data;};
 const controller=root.PrimeTimeProviderDayActions.create({
   getContext:context,canWrite:p.canWrite,
   async loadDay(c){requireCurrent(c);const day=await rpc('get_minuta_provider_day_v192',{...params(c),p_date:c.date});if(!current(c))throw Error('day_context_changed');return {...day,pendingHours:readPending(c)};},
   async saveHours(c,a){requireCurrent(c);remember(c,a);const data=await rpc('save_minuta_provider_day_v192',{...params(c),p_date:c.date,p_request_id:a.requestId,p_start:a.start,p_end:a.end,p_online:a.onlineEnabled,p_expected_revision:a.expectedRevision});return acknowledge(c,data);},
   async resolveHours(c,id){requireCurrent(c);return acknowledge(c,await rpc('resolve_minuta_provider_day_v192',{...params(c),p_date:c.date,p_request_id:id}));},
   openAppointment:c=>{requireCurrent(c);p.openBooking(c,false);},
   openBlockedTime:c=>{requireCurrent(c);p.openBooking(c,true);},
   async refresh(c){requireCurrent(c);rows.clear();failedRange='';await load();if(current(c))await p.refresh();}
 });
 async function load(){
   const c=reset();if(!c||!iso.test(c.date)||!navigator.onLine)return;
   if((rows.has(c.date)&&!force)||pendingRange||failedRange===c.date)return;
   const revision=scope,generation=epoch;pendingRange=c.date;
   try{
     const date=new Date(c.date+'T12:00:00Z');const shift=n=>{const d=new Date(date);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
     const data=await rpc('list_minuta_provider_days_v192',{...params(c),p_start:shift(-31),p_end:shift(31)});
     if(!Array.isArray(data)||data.some(d=>!iso.test(d.date)||typeof d.working!=='boolean'||!Array.isArray(d.closures)))throw Error('day_response_invalid');
     if(scope!==revision||generation!==epoch||key(context()||{})!==key(c))return;
     for(const day of data)rows.set(day.date,day);available=true;force=false;p.render();
   }catch{if(scope===revision){available=false;failedRange=c.date;}}
   finally{pendingRange=null;if(context()?.date!==c.date||generation!==epoch)void load();}
 }
 function day(date){reset();return rows.get(date);}
 function state(date,base){const d=day(date);if(!d?.hasOverride)return base;const closures=d.closures.map(o=>({off_date:date,all_day:o.allDay,start_time:o.start,end_time:o.end}));return {weekly:{...base.weekly,enabled:true,start_time:d.start,end_time:d.end,break_start:d.breakStart,break_end:d.breakEnd,slot_interval_minutes:d.slotInterval},fullDayOff:closures.find(o=>o.all_day),partialDayOff:closures.some(o=>!o.all_day),working:d.working};}
 function closures(date,base){const d=day(date);return d?.hasOverride?d.closures.map(o=>({off_date:date,all_day:o.allDay,start_time:o.start,end_time:o.end})):base.filter(o=>o.off_date===date);}
 function markup(date,label){const c=reset();return c&&c.date===date&&date>=p.today()&&available&&p.canWrite(c)?controller.markup({date,label}):'';}
 function prepare(form,c){if(!c)return;requireCurrent(c);form.dataset.dayException=JSON.stringify(c);for(const id of ['newBookingDate','newBookingLocation','newBookingOccurrences']){const el=form.querySelector('#'+id);if(el){if(id==='newBookingOccurrences')el.value='1';el.disabled=true;}}const note=document.createElement('p');note.className='booking-time-warning';note.textContent='Разовая запись на выбранную дату. Остальная онлайн-запись останется закрытой.';form.prepend(note);}
 function exception(form){const value=form?.dataset.dayException;if(!value)return null;const c=JSON.parse(value);requireCurrent(c);return c;}
 async function slots(args,form,duration){const c=exception(form);if(c)return p.db.rpc('get_minuta_day_exception_slots_v192',{...params(c),p_date:c.date,p_service:args?.p_service||null,p_duration:duration});const n=reset();if(!n||!available||!p.services().some(s=>s.id===args.p_service))return null;
 const booking=args.p_ignore_booking?p.bookings().find(b=>b.id===args.p_ignore_booking):null;
 if(booking&&(booking.performer_id!==n.userId||booking.organization_id!==n.organizationId))return null;
 if(args.p_start===args.p_end&&!rows.has(args.p_start)){
   const d=await rpc('get_minuta_provider_day_v192',{...params(n),p_date:args.p_start});if(key(context()||{})!==key(n))return {data:null,error:{message:'stale_day_context'}};rows.set(d.date,d);
 }
 return p.db.rpc('get_minuta_provider_day_slots_v192',{...params(n),...(booking?.location_id?{p_location:booking.location_id}:{}),...args});}
 async function book(c,id,args,duration,price,exception=true){if(!context()||key(c)!==key(context())||!p.canWrite(c))throw Error('day_context_changed');return p.db.rpc(exception?'book_minuta_day_exception_v192':'book_minuta_provider_day_v192',{...params(c),p_request_id:id,...args,p_expected_duration_minutes:duration,p_expected_price_rub:price});}
 async function block(c,args){requireCurrent(c);return p.db.rpc('block_minuta_day_exception_v192',{...args,...params(c)});}
 function bookingContext(payload){const c=reset();return c&&available&&rows.get(payload.date)?.hasOverride&&p.services().some(s=>s.id===payload.service)?{...c,date:payload.date}:null;}
 return Object.freeze({bookingContext,load,day,state,closures,markup,prepare,exception,slots,book,block,attach:controller.attach,invalidate(){failedRange='';epoch++;force=true;void load();},close:controller.close});
}
root.PrimeTimeProviderDayRuntime=Object.freeze({create});
})(window);
