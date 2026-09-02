import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const source=readFileSync(join(root,'booking-policy-management.js'),'utf8');
assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB/i,'policy snapshots must stay server-owned');
for(const rpc of ['get_minuta_booking_policy_workspace','set_minuta_booking_policies_enabled','upsert_minuta_booking_policy_rule','delete_minuta_booking_policy_rule'])assert.match(source,new RegExp(rpc));

class MockElement{
  constructor(){this.hidden=false;this.innerHTML='';this.textContent='';this.value='';this.checked=false;this.disabled=false;this.dataset={};this.open=false;}
  addEventListener(){} querySelectorAll(){return [];} closest(){return null;}
}
const ids=['organizationBookingPolicyPanel','organizationBookingPolicyLoading','organizationBookingPolicyUnavailable','organizationBookingPolicyUnavailableText','organizationBookingPolicyWorkspace','organizationBookingPoliciesEnabled','organizationBookingPolicyRules','organizationBookingPolicyLocation','organizationBookingPolicyService','organizationBookingPolicyRuleId','organizationCancelCutoffHours','organizationRescheduleCutoffHours','organizationMaxReschedules','organizationDepositMode','organizationDepositValue','organizationDepositValueLabel','organizationPaymentTimeoutMinutes','organizationAutoCancelUnpaid','organizationRefundPolicy','organizationPaymentUrlTemplate','organizationDepositSettings','organizationBookingPolicyError'];
function dom(){const elements=Object.fromEntries(ids.map(id=>[id,new MockElement()]));const legacy=new MockElement();const legacySubmit=new MockElement();return{elements,legacy,legacySubmit,$:selector=>selector==='[data-legacy-booking-policy]'?legacy:selector==='#bookingPolicyForm button[type="submit"]'?legacySubmit:elements[selector.replace(/^#/,'')]||new MockElement()};}
function workspace(id,enabled=false){return{organization_id:id,current_role:'owner',enabled,locations:[],services:[],rules:[{id:'default',location_id:null,service_id:null,cancel_cutoff_hours:12,reschedule_cutoff_hours:12,max_reschedules:2,deposit_mode:'none',deposit_value:0,payment_timeout_minutes:30,auto_cancel_unpaid:false,refund_policy:'full_before_cutoff',payment_url_template:''}],audit:[]};}
globalThis.window={};globalThis.document={querySelector(){return null;}};
await import(`${pathToFileURL(join(root,'booking-policy-management.js')).href}?test=${Date.now()}`);
const escapeHtml=value=>String(value??'');
function controller(view,rpc){return window.MinutaBookingPolicies.createController({db:{rpc},$:view.$,escapeHtml,notify(){},requireWrites:()=>true,getCurrentUser:()=>({id:'owner'}),getSessionGeneration:()=>1,sessionIsCurrent:()=>true,applyWriteAvailability(){}});}
{
  const view=dom();const item=controller(view,async()=>({data:null,error:{code:'PGRST202',message:'function does not exist'}}));
  const result=await item.setOrganization({id:'org',current_role:'owner'});assert.equal(result.unsupported,true);assert.equal(view.legacy.hidden,false);
}
{
  const view=dom();const item=controller(view,async()=>({data:workspace('foreign'),error:null}));
  await item.setOrganization({id:'org',current_role:'owner'});assert.equal(item.payload,null);assert.match(view.elements.organizationBookingPolicyUnavailableText.textContent,/другой организации/);
}
{
  const view=dom();const item=controller(view,async()=>({data:workspace('org'),error:null}));
  const result=await item.setOrganization({id:'org',current_role:'owner'});assert.equal(result.ok,true);assert.equal(view.legacy.hidden,false);assert.equal(view.legacySubmit.textContent,'Сохранить действующие правила');assert.match(view.elements.organizationBookingPolicyRules.innerHTML,/Вся организация/);
}
{
  const view=dom();const item=controller(view,async()=>({data:workspace('org',true),error:null}));
  const result=await item.setOrganization({id:'org',current_role:'owner'});assert.equal(result.ok,true);assert.equal(view.legacy.hidden,true);assert.equal(view.legacySubmit.textContent,'Сохранить автоматизацию');
}
assert.match(source,/начнёт действовать после включения модуля/);
console.log('booking policy management controller tests passed');
