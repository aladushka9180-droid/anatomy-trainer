import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function startFixture({before=false}={}){
 const html=readFileSync(resolve(root,'provider.html'),'utf8');
 const source=readFileSync(resolve(root,'provider.js'),'utf8');
 const actual=name=>{const start=source.search(new RegExp(`^(?:async )?function ${name}\\(`,'m'));if(start<0)throw Error(name);const next=source.slice(start+1).search(/^(?:async )?function /m);return source.slice(start,next<0?undefined:start+next+1);};
 const functions=['openNewBookingSheet','setNewBookingMode','layoutNewBookingBlockFields','updateNewBookingHeading','selectedNewBookingService','newBookingDurationMinutes','normalizePerMinuteDuration','updateNewBookingDurationControl','updateNewBookingHistoricalPayment','updateNewBookingSubmitCaption','refreshNewBookingCard','updateNewBookingServiceOpen','openNewBookingServiceDialog','selectNewBookingService','applyNewBookingClient','restoreNewBookingClientLookupStatus','hideNewBookingClientSuggestions','renderNewBookingClientSuggestions','selectNewBookingClient','renderNewBookingTimePicker','clientAvatarContent','clientFramedAvatarMarkup','clientAvatarEditorMarkup'];
 const styles=[...html.matchAll(/<link rel="stylesheet" href="[^"]+"[^>]*>/g)].map(m=>m[0]).join('\n');
 functions.push('renderClients','newBookingClientPhoneLabel');
 const page=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}${before?'':'<link rel="stylesheet" href="new-booking-card.css">'}<body class="provider-body" data-provider-theme="pink-porcelain" data-provider-layout="quiet"><script src="client-loyalty-frames.js"></script>${before?'':'<script src="new-booking-card.js"></script>'}<script src="fixture.js"></script></body></html>`;
 const script=`(async()=>{
 const parsed=new DOMParser().parseFromString(await(await fetch('provider.html')).text(),'text/html');for(const id of ['bookingSheet','newBookingServiceDialog'])document.body.append(document.importNode(parsed.getElementById(id),true));
 window.$=s=>document.querySelector(s);window.$$=s=>[...document.querySelectorAll(s)];
 const escapeHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const uiIcon=id=>'<svg class="ui-icon" aria-hidden="true"><use href="ui-icons.svg#icon-'+id+'"></use></svg>';
 const money=v=>Number(v).toLocaleString('ru-RU')+' ₽';const normalizePhone=v=>String(v||'').replace(/\\D/g,'');
 const ownServices=[{id:'s1',name:'Массаж спины + ШВЗ — базовый',duration_minutes:60,price_rub:3000,active:true},{id:'s2',name:'Комплексный массаж всего тела с дополнительной проработкой',duration_minutes:90,price_rub:5800,active:true},{id:'s3',name:'Массаж по минутам',duration_minutes:1,price_rub:50,active:true}];
 let newBookingMode='client',newBookingRepeatVisit=null,newBookingModeState={},newBookingTime='',newBookingSlots=[],newBookingHour='',newBookingPreferredTime='',newBookingHistoricalMode=false,newBookingAutoFilledPhone='',newBookingAutoFilledName='',newBookingClientBaseTitle='',newBookingClientBaseSubtitle='';
 const selectedDate='2026-09-29',bookingPolicy={},displayPreferences={},PER_MINUTE_BOOKING_MIN=1,PER_MINUTE_BOOKING_MAX=480,BOOKING_COLOR_DEFAULT='auto',currentUser={id:'synthetic'},writesAllowed=true,bookingCreationReady=true,editingOfflineBookingId='';
 const clientNotes=new Map();let newBookingClientSuggestionMap=new Map();
 window.fixtureClient={phone:'79000000000',displayPhone:'+7 (900) 000-00-00',name:'Анна',bookings:[],imported:{visit_count:50}};
 const buildClients=()=>[fixtureClient],bookingOutcome=i=>i.outcome||{},clientAvatar=()=>window.fixturePhoto?{signed_url:window.fixturePhoto}:null;
 const clientDirectoryController=null,clientRenderLimit=50,selectedClientPhone='',clientUpcoming=()=>null,clientRelationshipFacts=()=>({visits:50,title:'Лояльный'}),clientHighlightClasses=()=>'',clientBadgeMarkup=()=>'';
 const bookingUsesDemoData=()=>false,notify=()=>{},normalizeRepeatVisitPreview=v=>v||null,readNewBookingDraft=()=>null,activeProviderBlockContext=()=>({locations:[],locationId:''}),businessTodayIso=()=> '2026-09-28',serviceDefaultDuration=()=>60,normalizedOutcomePaymentMethod=v=>v,validBookingColor=()=> 'auto',bookingDateLabel=v=>v;
 const serviceOptions=id=>ownServices.map(s=>'<option value="'+s.id+'" '+(s.id===id?'selected':'')+'>'+s.name+'</option>').join('');
 const providerBlockLocationOptions=()=>'',blockDurationChoices=()=>'<option value="60">60 мин</option>',repeatVisitPreviewMarkup=()=>'',compactBookingColorPicker=()=>'<input type="radio" name="newBookingColor" value="auto" checked>',applyClientHighlightClasses=()=>{},createOfflineBookingId=()=> '00000000-0000-4000-8000-000000000001';
 const saveNewBookingDraft=()=>{},chooseNewBookingContact=()=>{window.contactClicked=true;},chooseNewBookingRecentCall=()=>{},refreshNewBookingContactPicker=()=>{},refreshNewBookingRecentCalls=()=>{},clearFormError=()=>{},bookingDeferredMode=()=>false,canQueueOfflineBooking=()=>false,offlineBookingStatusText=()=>'',updateNewBookingConnectivity=()=>updateNewBookingSubmitCaption();
 const newBookingClientCandidates=query=>String(query).length>=2?[fixtureClient]:[],scheduleNewBookingClientSuggestions=q=>renderNewBookingClientSuggestions(q),handleNewBookingPhoneInput=()=>{};
 const bookingNearbyTimeSlots=slots=>slots.slice(0,3),newBookingPreferredUnavailableMarkup=()=>'',activateBookingRemainingTimeScroll=()=>{};
 const bookingRemainingTimeMarkup=(slots,nearby)=>'<details class="booking-more-times"><summary><span>Ещё '+(slots.length-nearby.length)+' вариантов</span></summary><div class="booking-time-slots">'+slots.slice(3).map(t=>'<button type="button" data-new-booking-time="'+t+'">'+t+'</button>').join('')+'</div></details>';
 const minutesFromTime=t=>Number(t.slice(0,2))*60+Number(t.slice(3)),timeFromMinutes=m=>String(Math.floor(m/60)%24).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
 const loadNewBookingSlots=()=>{newBookingSlots=['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00'];renderNewBookingTimePicker();updateNewBookingServiceOpen();updateNewBookingSubmitCaption();};
 const createNewBooking=event=>{event.preventDefault();window.fixtureSubmitted={name:$('#newBookingName').value,phone:$('#newBookingPhone').value,service:$('#newBookingService').value,time:newBookingTime};};
 ${functions.map(actual).join('\n')}
 document.addEventListener('click',e=>{const time=e.target.closest('[data-new-booking-time]');if(time){newBookingTime=time.dataset.newBookingTime;renderNewBookingTimePicker();updateNewBookingSubmitCaption();}if(e.target.closest('#newBookingServiceOpen'))openNewBookingServiceDialog();const service=e.target.closest('[data-pick-new-booking-service]');if(service)selectNewBookingService(service.dataset.pickNewBookingService);});
 $('#closeNewBookingServiceDialog').addEventListener('click',()=>$('#newBookingServiceDialog').close());
 window.fixtureOpen=preset=>openNewBookingSheet('',preset||{});window.fixtureSelect=()=>applyNewBookingClient(fixtureClient);window.fixtureRefresh=refreshNewBookingCard;window.fixtureCompact=(count,size=76)=>PrimeTimeLoyaltyFrames.compact({total:count,size,content:'А'});
 window.fixtureClients=()=>{const box=document.createElement('section');box.id='fixtureClients';box.style.cssText='max-width:390px;padding:12px;background:var(--theme-surface)';box.innerHTML='<input id="clientSearch" value=""><span id="clientsCount"></span><div id="clientsList"></div>';document.body.append(box);renderClients();};
 fixtureOpen();window.fixtureReady=true;
 })().catch(e=>{window.fixtureError=e.stack;});`;
 const server=createServer((req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://fixture').pathname);if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(page);}if(name==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');return res.end(script);}const file=resolve(root,'.'+name);if(!file.startsWith(root.endsWith(sep)?root:root+sep))throw Error('path');res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.html':'text/html','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,url:'http://127.0.0.1:'+server.address().port+'/'};
}
if(process.argv.includes('--serve')){const {url}=await startFixture({before:process.argv.includes('--before')});console.log(url);}
