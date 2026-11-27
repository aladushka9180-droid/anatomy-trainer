// Node DOM and mocked RPC only; no browser, network, credentials or live writes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const runtime=process.env.X07_RUNTIME_ROOT?path.resolve(process.env.X07_RUNTIME_ROOT):fileURLToPath(new URL('./waitlist-offers-runtime/',import.meta.url));
const {JSDOM}=await import(pathToFileURL(path.join(runtime,'node_modules/jsdom/lib/api.js')));
const dir=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,dir),'utf8');
const tree='';
const results=[],id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const offer=id(7),token=id(6),request=id(5),bookingToken=id(30);
const base={state:'offered',offerId:offer,bookingDate:'2026-10-11',bookingTime:'10:00:00',expiresAt:'2026-10-10T20:00:00Z',serverNow:'2026-10-09T08:00:00Z',priceRub:1500,durationMinutes:60,reason:null,booking:null};
const settled=()=>new Promise(resolve=>setImmediate(resolve));
async function check(name,fn){await fn();results.push({name,pass:true});}
function clientDOM({state='offered',failAccept=false,badOffer=false}={}) {
  const dom=new JSDOM(read(tree+'waitlist.html'),{url:`https://example.invalid/waitlist.html?scope=organization#token=${token}&offer=${offer}`,runScripts:'outside-only'});
  let next=state;const calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});
    if(name==='get_minuta_waitlist_request_v111')return{data:[{status:'waiting',desired_date:'2026-10-11',service_name:'Generated service',performer_name:'Generated specialist',request_code:'SYN',time_period:'any'}]};
    if(name==='accept_minuta_waitlist_offer_v196'){if(failAccept)throw Error('lost_response');next='accepted';}
    return{data:{...base,state:next,offerId:badOffer?id(99):offer,booking:next==='accepted'?{bookingCode:'GEN',manageToken:bookingToken,requestId:id(31),status:'new'}:null,reason:next==='busy'?'slot_busy':next==='expired'?'deadline':null}};
  }};
  dom.window.MINUTA_CONFIG={};dom.window.supabase={createClient:()=>db};
  dom.window.eval(read(tree+'waitlist-offers.js'));dom.window.eval(read(tree+'waitlist.js'));
  return{dom,calls,api:dom.window.MinutaWaitlistOffers};
}
for(const [state,label] of Object.entries({offered:'Предложено',accepted:'Принято',expired:'Истекло',busy:'Уже занято'})) {
  await check('client DOM state '+state,async()=>{const {dom,calls}=clientDOM({state});await settled();const doc=dom.window.document;
    assert.equal(doc.querySelector('#waitlistOfferState').textContent,label);assert.equal(doc.querySelector('#waitlistOfferAccept').disabled,state!=='offered');
    assert.equal(doc.querySelector('#waitlistOfferBooking').hidden,state!=='accepted');
    if(state==='accepted'){const url=new URL(doc.querySelector('#waitlistOfferBooking').href);assert.equal(url.pathname,'/booking.html');assert.equal(url.search,'');assert.equal(new URLSearchParams(url.hash.slice(1)).get('token'),bookingToken);}
    assert(calls.every(call=>!call.name.startsWith('book_minuta')));await settled();dom.window.close();});
}
await check('client double click makes one accept RPC with exact capability+offer',async()=>{const {dom,calls}=clientDOM();await settled();const button=dom.window.document.querySelector('#waitlistOfferAccept');button.click();button.click();await settled();const writes=calls.filter(call=>call.name==='accept_minuta_waitlist_offer_v196');assert.equal(writes.length,1);assert.deepEqual(JSON.parse(JSON.stringify(writes[0].args)),{p_offer:offer,p_token:token});assert.equal(dom.window.document.querySelector('#waitlistOfferState').textContent,'Принято');await settled();dom.window.close();});
await check('lost acceptance response disables success and requires fresh read',async()=>{const {dom,calls}=clientDOM({failAccept:true});await settled();const doc=dom.window.document;doc.querySelector('#waitlistOfferAccept').click();await settled();assert.match(doc.querySelector('#waitlistOfferReason').textContent,/не подтверждён/);assert(doc.querySelector('#waitlistOfferBooking').hidden);assert(doc.querySelector('#waitlistOfferAccept').disabled);doc.querySelector('#waitlistOfferReload').click();await settled();assert.equal(doc.querySelector('#waitlistOfferState').textContent,'Предложено');assert.equal(calls.filter(c=>c.name==='accept_minuta_waitlist_offer_v196').length,1);await settled();dom.window.close();});
await check('misbound server acknowledgement never enables accept or success',async()=>{const {dom}=clientDOM({badOffer:true});await settled();assert(dom.window.document.querySelector('#waitlistOfferAccept').disabled);assert(dom.window.document.querySelector('#waitlistOfferBooking').hidden);await settled();dom.window.close();});
await check('Samara manual deadline crosses midnight and rejects normalized invalid dates',async()=>{const{dom,api}=clientDOM();assert.equal(api.samaraInputToISO('2026-10-10T00:01'),'2026-10-09T20:01:00.000Z');assert.equal(api.samaraInput('2026-10-09T19:59:00Z'),'2026-10-09T23:59');assert.throws(()=>api.samaraInputToISO('2026-02-30T10:00'),/invalid_deadline/);const link=new URL(api.offerLink('https://example.invalid/provider.html',offer,token));assert.equal(link.search,'?scope=organization');assert.equal(new URLSearchParams(link.hash.slice(1)).get('token'),token);assert(!link.search.includes(token));await settled();dom.window.close();});
await check('employee lost create response retries same immutable offer ID',async()=>{const{dom,api}=clientDOM();const calls=[];let count=0,ids=0;const controller=api.employee({request,newUUID:()=>{ids++;return offer;},db:{rpc:async(name,args)=>{calls.push({name,args});if(++count===1)throw Error('lost_response');return{data:{...base,clientToken:token}};}}});const draft={date:'2026-10-11',time:'10:00:00',expires:'2026-10-10T20:00:00Z'};await assert.rejects(controller.create(draft),/lost_response/);const result=await controller.create(draft);assert.equal(result.offerId,offer);assert.equal(ids,1);assert.equal(calls[0].args.p_offer,calls[1].args.p_offer);assert.equal(calls[0].name,'create_minuta_waitlist_offer_v196');await settled();dom.window.close();});
function employeeDOM({authenticated=true}={}) {
  const dom=new JSDOM(read(tree+'waitlist-offer-provider.html'),{url:`https://example.invalid/waitlist-offer-provider.html#request=${request}`,runScripts:'outside-only'});
  const calls=[];dom.window.MINUTA_CONFIG={};dom.window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:authenticated?{id:id(1)}:null}})},rpc:async(name,args)=>{calls.push({name,args});return{data:name==='get_minuta_waitlist_employee_v196'?{requestId:request,requestStatus:'waiting',clientName:'Generated client',desiredDate:'2026-10-11',serverNow:'2026-10-09T08:00:00Z',slots:[{date:'2026-10-11',time:'10:00:00'}],offer:null}: {...base,offerId:args.p_offer,clientToken:token}};}})};
  dom.window.eval(read(tree+'waitlist-offers.js'));dom.window.eval(read(tree+'waitlist-offer-provider.js'));return{dom,calls};
}
await check('employee entry selects slot, manual >24h deadline and creates secure link',async()=>{const{dom,calls}=employeeDOM();await settled();const doc=dom.window.document;doc.querySelector('#employeeDeadline').value='2026-10-10T23:59';doc.querySelector('#employeeOfferForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settled();const write=calls.find(call=>call.name==='create_minuta_waitlist_offer_v196');assert(write);assert.equal(write.args.p_request,request);assert.equal(write.args.p_expires,'2026-10-10T19:59:00.000Z');assert.equal(doc.querySelector('#employeeOfferState').textContent,'Предложено');assert(new URL(doc.querySelector('#employeeOfferLink').value).hash.includes(token));assert(calls.every(call=>!call.name.startsWith('book_')));await settled();dom.window.close();});
await check('employee slot-start equality never calls create RPC',async()=>{const{dom,calls}=employeeDOM();await settled();dom.window.document.querySelector('#employeeDeadline').value='2026-10-11T10:00';dom.window.document.querySelector('#employeeOfferForm').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await settled();assert(!calls.some(call=>call.name==='create_minuta_waitlist_offer_v196'));await settled();dom.window.close();});
await check('unauthenticated employee never reads or mutates request',async()=>{const{dom,calls}=employeeDOM({authenticated:false});await settled();assert.equal(calls.length,0);assert(dom.window.document.querySelector('#employeeContent').hidden);await settled();dom.window.close();});
// Source entry and existing route preservation, not a rendered-layout claim.
// Shared provider integration belongs to ROOT; optionally check its unapplied patch.
const hookAnchor='waitlist-offer-provider.html#request=${encodeURIComponent(item.id)}';
const sharedHookVerified=process.env.X07_SHARED_HOOK_PATCH ? (()=>{assert(readFileSync(process.env.X07_SHARED_HOOK_PATCH,'utf8').includes(hookAnchor));return true;})() : read(tree+'provider.js').includes(hookAnchor);
assert(!read(tree+'waitlist-offers.js').includes('book_minuta_appointment_v2'));
const report={sharedHookVerified,checks:results.length,passed:results.length,results,nodeDOMOnly:true,browserUsed:false,layoutVisualVerified:false,realSend:false,realBooking:false};
writeFileSync(pathToFileURL(path.join(runtime,'UI-RESULT.json')),JSON.stringify(report,null,2)+'\n');
console.log('PASS '+results.length+'/'+results.length+' Node DOM/RPC scenarios; no browser/live data.');
