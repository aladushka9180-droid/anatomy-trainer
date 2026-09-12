import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const storage = new Map();
const listeners = {};
class Element {
  constructor(id='') { this.id=id; this.hidden=false; this.innerHTML=''; this.textContent=''; this.dataset={}; this.disabled=false; }
  addEventListener(type, handler) { listeners[`${this.id}:${type}`]=handler; }
}
const elements = Object.fromEntries(['clientBenefitLifecycle','clientBenefitLifecycleList','clientBenefitLifecycleTitle'].map(id => [id,new Element(id)]));
globalThis.window = {
  localStorage:{
    getItem:key => storage.has(key) ? storage.get(key) : null,
    setItem:(key,value) => storage.set(key,String(value)),
    removeItem:key => storage.delete(key)
  }
};
await import(`${pathToFileURL(join(root,'..','benefit-lifecycle.js')).href}?test=${Date.now()}`);

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
let frozen = false;
const calls = [];
const notices = [];
const instrument = () => ({
  id:'instrument-1',name:'Абонемент 10',kind:'visit_pass',public_code:'PASS-150',status:frozen?'frozen':'active',
  expires_on:'2026-12-31',remaining_visits:7,remaining_amount_rub:0,total_frozen_days:frozen?2:0,
  allowed_actions:[frozen?'unfreeze':'freeze'],current_freeze:frozen?{frozen_at:'2026-09-10T08:00:00Z',reason:''}:null,
  history:[{id:1,event_type:frozen?'frozen':'issued',created_at:'2026-09-10T08:00:00Z',actor_id:'owner',actor_name:'Анна',visits_balance:7,amount_balance_rub:0,details:{extended_days:frozen?2:0}}]
});
const db = { rpc:async(name,args) => {
  calls.push([name,args]);
  if (name === 'get_minuta_benefit_lifecycle_v150') return { data:{organization_id:'org-1',client_account_id:'client-1',instruments:[instrument()]}, error:null };
  if (name === 'set_minuta_benefit_lifecycle_v150') { frozen=args.p_action==='freeze'; return { data:{id:'instrument-1',organization_id:'org-1',status:frozen?'frozen':'active',extended_days:frozen?0:2}, error:null }; }
  throw new Error(`unexpected rpc ${name}`);
}};
const controller = window.MinutaBenefitLifecycle.createClientController({
  db,$:selector=>elements[selector.replace(/^#/,'')],escapeHtml,notify:value=>notices.push(value),requireWrites:()=>true,
  getCurrentUser:()=>({id:'owner'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,
  createRequestId:()=>'00000000-0000-4000-8000-000000001500'
});
controller.bind();
await controller.setClient({clientAccountId:'client-1'},{id:'org-1',current_role:'owner'});
assert.match(elements.clientBenefitLifecycleList.innerHTML,/Абонемент 10/);
assert.match(elements.clientBenefitLifecycleList.innerHTML,/Заморозить/);
assert.match(elements.clientBenefitLifecycleList.innerHTML,/История действ/);
assert.match(elements.clientBenefitLifecycleList.innerHTML,/Анна/);

const button = { dataset:{clientBenefitAction:'freeze',clientBenefitInstrument:'instrument-1'},disabled:false,textContent:'Заморозить' };
listeners['clientBenefitLifecycle:click']({ target:{ closest:selector => selector==='[data-client-benefit-action]' ? button : null } });
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls.filter(([name]) => name==='set_minuta_benefit_lifecycle_v150').length,1);
assert.equal(calls.find(([name]) => name==='set_minuta_benefit_lifecycle_v150')[1].p_request_id,'00000000-0000-4000-8000-000000001500');
assert.equal(storage.size,0,'confirmed lifecycle request must clear local retry intent');
assert.match(elements.clientBenefitLifecycleList.innerHTML,/Разморозить/);
assert.match(notices.join(' '),/Срок поставлен на паузу/);

controller.reset();
assert.equal(elements.clientBenefitLifecycle.hidden,true);
console.log('PrimeTime Pro benefit lifecycle controller tests passed');
