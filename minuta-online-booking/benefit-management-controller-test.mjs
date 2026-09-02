import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(root, 'benefit-management.js'), 'utf8');
assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, 'client balances must not be cached in the browser');

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
  'benefitApplyInstrument','benefitApplyBooking','benefitProductServices','benefitProductKind'
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

globalThis.window={};
globalThis.document={addEventListener(){}};
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

for (const rpc of ['get_minuta_benefit_workspace','set_minuta_benefits_enabled','upsert_minuta_benefit_product','issue_minuta_benefit','set_minuta_benefit_status','apply_minuta_benefit']) assert.match(source,new RegExp(rpc));
console.log('benefit management controller tests passed');
