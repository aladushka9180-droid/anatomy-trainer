import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'benefit-management.js'), 'utf8');
assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*(?:payload|remaining_visits|remaining_amount_rub|client_name|client_phone)/i, 'client balances and details must not be cached in the browser');

class MockElement {
  constructor(id='') { this.id=id; this.hidden=false; this.innerHTML=''; this.textContent=''; this.value=''; this.checked=false; this.disabled=false; this.open=false; this.dataset={}; }
  querySelectorAll() { return []; }
  closest(selector) { return selector==='#benefitsPanel' ? this : null; }
  reset() {}
}
const ids = [
  'benefitsPanel','benefitsLoading','benefitsUnavailable','benefitsUnavailableText','benefitsWorkspace','benefitsEnabled',
  'benefitProductsCount','benefitInstrumentsCount','benefitProductsList','benefitInstrumentsList','benefitRedemptionsList',
  'benefitProductCreator','benefitIssueCreator','benefitApplyCreator','benefitIssueProduct','benefitIssueClient',
  'benefitApplyInstrument','benefitApplyBooking','benefitApplyAmount','benefitApplyAmountHint','benefitProductServices','benefitProductKind'
];
function makeDom() {
  const elements=Object.fromEntries(ids.map(id=>[id,new MockElement(id)]));
  elements.benefitProductKind.value='visit_pass';
  elements.benefitsPanel.querySelectorAll=()=>[];
  return { elements, $:selector=>elements[selector.replace(/^#/,'')]||new MockElement(selector) };
}
function workspace(id,overrides={}) {
  return { organization_id:id,current_role:'owner',enabled:false,services:[],clients:[],bookings:[],products:[],instruments:[],redemptions:[],audit:[],...overrides };
}
function deferred() { let resolve; const promise=new Promise(done=>{resolve=done;}); return {promise,resolve}; }

const listeners={};
globalThis.window={};
globalThis.document={addEventListener(type,handler){(listeners[type]||=[]).push(handler);}};
await import(`${pathToFileURL(join(root,'benefit-management.js')).href}?test=${Date.now()}`);
const escapeHtml=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
function controller(dom,rpc,overrides={}) {
  return window.MinutaBenefits.createController({db:{rpc},$:dom.$,escapeHtml,notify(){},requireWrites:()=>true,getCurrentUser:()=>({id:'owner'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability(){},...overrides});
}

{
  const dom=makeDom();
  const instance=controller(dom,async()=>({data:null,error:{code:'PGRST202',message:'get_minuta_benefit_workspace does not exist'}}));
  const result=await instance.setOrganization({id:'org-1',current_role:'owner'});
  assert.equal(result.unsupported,true);
  assert.equal(dom.elements.benefitsPanel.hidden,true);
}
{
  const dom=makeDom();
  const instance=controller(dom,async()=>({data:workspace('foreign'),error:null}));
  await instance.setOrganization({id:'org-1',current_role:'owner'});
  assert.equal(instance.payload,null);
  assert.equal(dom.elements.benefitsWorkspace.hidden,true);
  assert.match(dom.elements.benefitsUnavailableText.textContent,/другой организации/);
}
{
  const dom=makeDom(); const old=deferred(); const fresh=deferred();
  const instance=controller(dom,async(_name,args)=>args.p_organization==='old'?old.promise:fresh.promise);
  const first=instance.setOrganization({id:'old',current_role:'owner'}); const second=instance.setOrganization({id:'fresh',current_role:'owner'});
  fresh.resolve({data:workspace('fresh',{products:[{id:'p',name:'Свежий',kind:'visit_pass',sale_price_rub:100,visits_count:5,validity_days:30,active:true}],instruments:[]}),error:null});
  await second; old.resolve({data:workspace('old'),error:null});
  assert.equal((await first).stale,true);
  assert.match(dom.elements.benefitProductsList.innerHTML,/Свежий/);
}
{
  const dom=makeDom(); const pending=deferred(); let active=true;
  const instance=controller(dom,async()=>pending.promise,{getCurrentUser:()=>active?{id:'owner'}:null,sessionIsCurrent:()=>active});
  const request=instance.setOrganization({id:'org',current_role:'owner'}); active=false; instance.reset(); pending.resolve({data:workspace('org'),error:null});
  assert.equal((await request).stale,true);
  assert.equal(dom.elements.benefitsPanel.hidden,true);
}
{
  const dom=makeDom();let writeCalls=0;
  const instance=controller(dom,async name=>{
    if(name==='get_minuta_benefit_workspace')return {data:workspace('org-retry'),error:null};
    if(name==='set_minuta_benefits_enabled'){
      writeCalls+=1;
      if(writeCalls===1)throw new TypeError('network request failed');
      return {data:workspace('org-retry',{enabled:true}),error:null};
    }
    throw new Error(`unexpected rpc: ${name}`);
  });
  instance.bind();
  await instance.setOrganization({id:'org-retry',current_role:'owner'});
  dom.elements.benefitsEnabled.checked=true;
  const change=listeners.change.at(-1);
  await change({target:dom.elements.benefitsEnabled});
  dom.elements.benefitsEnabled.checked=true;
  await change({target:dom.elements.benefitsEnabled});
  assert.equal(writeCalls,2,'Отклонённый Promise не должен навсегда блокировать следующую запись льгот');
}

{
  const dom=makeDom();const calls=[];
  const data=workspace('org-apply',{enabled:true,
    services:[{id:'service-a',name:'Массаж спины'},{id:'service-b',name:'Массаж лица'}],
    clients:[{id:'client-a',client_name:'Клиент',client_phone:'+70000000000'}],
    bookings:[
      {id:'booking-good',client_account_id:'client-a',client_name:'Клиент',service_id:'service-a',service_name:'Массаж спины',booking_date:'2026-09-20',status:'confirmed'},
      {id:'booking-wrong-service',client_account_id:'client-a',client_name:'Клиент',service_id:'service-b',service_name:'Массаж лица',booking_date:'2026-09-20',status:'confirmed'},
      {id:'booking-used',client_account_id:'client-a',client_name:'Клиент',service_id:'service-a',service_name:'Уже списано',booking_date:'2026-09-21',status:'confirmed'}
    ],
    instruments:[{id:'instrument-a',product_id:'product-a',client_account_id:'client-a',public_code:'MIN-APPLY',status:'active',expires_on:'2026-12-01',remaining_visits:2,remaining_amount_rub:0,product_snapshot:{name:'Пакет массажа',kind:'package'},service_balances:[{service_id:'service-a',remaining_units:2}]}],
    redemptions:[{id:'redemption-used',instrument_id:'instrument-a',booking_id:'booking-used',status:'reserved'}]
  });
  const instance=controller(dom,async(name,args)=>{
    calls.push({name,args});
    if(name==='get_minuta_benefit_workspace')return {data,error:null};
    if(name==='apply_minuta_benefit_v149')return {data:{id:'redemption-new',organization_id:'org-apply',status:'reserved'},error:null};
    throw new Error(`unexpected rpc: ${name}`);
  });
  instance.bind();await instance.setOrganization({id:'org-apply',current_role:'owner'});
  dom.elements.benefitApplyInstrument.value='instrument-a';
  await listeners.change.at(-1)({target:dom.elements.benefitApplyInstrument});
  assert.match(dom.elements.benefitApplyBooking.innerHTML,/Массаж спины/);
  assert.doesNotMatch(dom.elements.benefitApplyBooking.innerHTML,/Массаж лица|Уже списано/);
  dom.elements.benefitApplyBooking.value='booking-good';
  const form=new MockElement('benefitApplyForm');
  await listeners.submit.at(-1)({target:form,submitter:new MockElement('apply'),preventDefault(){}});
  const application=calls.find(call=>call.name==='apply_minuta_benefit_v149');
  assert.equal(application.args.p_booking,'booking-good');
  assert.match(application.args.p_request_id,/^[0-9a-f-]{36}$/i);
}

for (const rpc of ['get_minuta_benefit_workspace','set_minuta_benefits_enabled','upsert_minuta_benefit_product','issue_minuta_benefit','set_minuta_benefit_status','apply_minuta_benefit_v149']) assert.match(source,new RegExp(rpc));
assert.doesNotMatch(source,/db\.rpc\('apply_minuta_benefit'/,'legacy application RPC must not bypass the v149 request journal');
console.log('benefit management controller tests passed');
