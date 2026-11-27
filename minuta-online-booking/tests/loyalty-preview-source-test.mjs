import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(process.env.O19_SOURCE_MODULE_PATH || new URL('../loyalty-program-v166.js',import.meta.url),'utf8');
function fixture(){
const nodes=new Map(), listeners={},calls=[],storage=new Map();let handler,session=true,id=0,userId='user',generation=1,writesAllowed=true;
const node=(key)=>{if(nodes.has(key))return nodes.get(key);const x={id:key.slice(1),value:'',textContent:'',hidden:false,disabled:false,dataset:{},querySelectorAll:()=>[],parentElement:{querySelector:()=>null,firstChild:{nodeType:3,textContent:''}},classList:{contains:()=>false,toggle(){},add(){}},setAttribute(){},removeAttribute(){},setCustomValidity(){},focus(){},reset(){},closest:s=>s==='#loyaltyAdjustmentForm'?node('#loyaltyAdjustmentForm'):null,insertBefore(item){nodes.set('#'+item.id,item);}};nodes.set(key,x);return x;};
node('#loyaltyAdjustmentForm').id='loyaltyAdjustmentForm';
const button=node('#loyaltyAdjustmentForm button[type="submit"]');
const doc={currentScript:null,addEventListener:(type,fn)=>listeners[type]=fn,createElement:()=>({setAttribute(){}})};
const window={};const context={document:doc,window,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},navigator:{onLine:true},console,crypto:{randomUUID:()=>String(++id)},URL,Date};
vm.runInNewContext(source,context);
const workspace={enabled:true,rule:{id:'rule',goal_visits:10,reward_kind:'text',reward_title:'Бонус',validity_days:null},clients:[{id:'client',client_name:'Synthetic client'}],accounts:[{client_account_id:'client',progress:0,goal_visits:10}],rewards:[{id:'reward',client_account_id:'client',status:'pending',reward_kind:'text',reward_title:'Бонус'}],history:[{event_type:'reward_issued',client_account_id:'client'}],stats:{issued:1,redeemed:0}};
const db={rpc:async(name,parameters)=>{calls.push({name,parameters:JSON.parse(JSON.stringify(parameters))});if(name==='get_minuta_loyalty_program_workspace_v166')return {data:workspace};if(handler)return handler(name,parameters);return {data:{before:-1,after:-1+parameters.p_delta,delta:parameters.p_delta,goal_visits:10,rule_id:'rule',cycle_number:2,allowed:-1+parameters.p_delta>=0&&-1+parameters.p_delta<=10,reaches_goal:false}};}};
const controller=window.MinutaLoyalty.createController({db,$:node,escapeHtml:String,notify(){},requireWrites:()=>writesAllowed,getCurrentUser:()=>({id:userId}),getSessionGeneration:()=>generation,sessionIsCurrent:(actor,epoch)=>session&&actor===userId&&epoch===generation,applyWriteAvailability(){}});
controller.bind();
const flush=()=>new Promise(resolve=>setImmediate(resolve));
return {node,button,calls,storage,controller,workspace,flush,setHandler:fn=>handler=fn,setSession:value=>session=value,setUser:value=>{userId=value;generation++;},setWritesAllowed:value=>writesAllowed=value,
async delta(value){node('#loyaltyAdjustmentClient').value='client';node('#loyaltyAdjustmentPoints').value=String(value);listeners.input({target:node('#loyaltyAdjustmentPoints')});await flush();},
async submit(){node('#loyaltyAdjustmentReason').value='Synthetic correction';await listeners.submit({target:node('#loyaltyAdjustmentForm'),submitter:button,preventDefault(){}});}};
}
(async()=>{
let count=0;const done=(name)=>{count++;console.log('PASS '+name)};
const f=fixture();await f.controller.setOrganization({id:'organization'});
assert.equal(f.button.disabled,true);done('No save before exact preview');
assert.match(f.node('#loyaltyRewardsList').innerHTML,/Бонус/);assert.match(f.node('#loyaltyLedgerList').innerHTML,/Награда выдана/);done('Filled reward and history still render');
await f.delta(100);assert.match(f.node('#loyaltyAdjustmentPreview').textContent,/Было -1 → станет 99/);assert.equal(f.button.disabled,true);await f.submit();assert.equal(f.calls.filter(x=>x.name==='confirm_minuta_loyalty_adjustment_v166').length,0);done('Out-of-range preview refuses confirm');
await f.delta(1);assert.match(f.node('#loyaltyAdjustmentPreview').textContent,/Было -1 → станет 0/);assert.equal(f.button.disabled,false);done('Exact debt is used instead of clamped visible zero');
let confirmations=0;f.setHandler((name,parameters)=>{if(name==='confirm_minuta_loyalty_adjustment_v166'){confirmations++;return confirmations===1?{error:{code:'FETCH_FAILED'}}:{data:{recovered:true}};}return {data:{before:-1,after:0,delta:1,goal_visits:10,rule_id:'rule',cycle_number:2,allowed:true}};});
await f.submit();await f.submit();const writes=f.calls.filter(x=>x.name==='confirm_minuta_loyalty_adjustment_v166');assert.equal(writes.length,2);assert.equal(writes[0].parameters.p_request_id,writes[1].parameters.p_request_id);assert.equal(writes[0].parameters.p_expected_before,-1);assert.equal(writes[0].parameters.p_expected_cycle,2);assert.equal(writes[0].parameters.p_expected_rule,'rule');assert.equal(f.storage.size,0);done('Unknown outcome retries original id and expected snapshot');
await f.delta(1);f.setHandler((name)=>name==='confirm_minuta_loyalty_adjustment_v166'?{error:{code:'55000'}}:{data:{before:2,after:3,delta:1,goal_visits:10,rule_id:'rule',cycle_number:3,allowed:true}});
await f.submit();assert.match(f.node('#loyaltyAdjustmentPreview').textContent,/Было 2 → станет 3/);assert.equal(f.storage.size,0);done('Known stale error refreshes preview');
const before=f.calls.length;await f.delta(1.5);await f.submit();assert.equal(f.calls.length,before);assert.equal(f.button.disabled,true);done('Fractional delta is rejected without truncation or RPC');
let resolvePreview;f.setHandler(()=>new Promise(resolve=>resolvePreview=resolve));await f.delta(1);const pendingText=f.node('#loyaltyAdjustmentPreview').textContent;await f.delta(0);resolvePreview({data:{before:0,after:1,delta:1,goal_visits:10,rule_id:'rule',cycle_number:1,allowed:true}});await f.flush();assert.equal(f.button.disabled,true);assert.notEqual(f.node('#loyaltyAdjustmentPreview').textContent,pendingText);assert.doesNotMatch(f.node('#loyaltyAdjustmentPreview').textContent,/станет 1/);done('Late preview cannot revive changed input');
f.setHandler(()=>({data:{before:0,after:1,delta:1,goal_visits:10,rule_id:'rule',cycle_number:1,allowed:true}}));await f.delta(1);assert.equal(f.button.disabled,false);const switchPromise=f.controller.setOrganization({id:'other-organization'});assert.equal(f.button.disabled,true);await switchPromise;done('Organization switch invalidates preview before load completes');
f.setHandler(()=>({error:{code:'42883'}}));await f.delta(1);assert.equal(f.button.disabled,true);assert.match(f.node('#loyaltyAdjustmentPreview').textContent,/Не удалось проверить/);done('Missing SQL contract stays unavailable');
const staleSession=fixture();await staleSession.controller.setOrganization({id:'organization'});await staleSession.delta(1);staleSession.setUser('other-user');await staleSession.submit();
assert.equal(staleSession.calls.filter(x=>x.name==='confirm_minuta_loyalty_adjustment_v166').length,0,'An old-session preview must not reach confirm');done('Submit refuses preview from an earlier user/session');
const staleClient=fixture();await staleClient.controller.setOrganization({id:'organization'});await staleClient.delta(1);staleClient.node('#loyaltyAdjustmentClient').value='other-client';await staleClient.submit();
assert.equal(staleClient.calls.filter(x=>x.name==='confirm_minuta_loyalty_adjustment_v166').length,0,'Preview must be bound to selected client even without an input event');done('Submit refuses preview for another client');
const revoked=fixture();await revoked.controller.setOrganization({id:'organization'});await revoked.delta(1);revoked.setWritesAllowed(false);await revoked.submit();
assert.equal(revoked.calls.filter(x=>x.name==='confirm_minuta_loyalty_adjustment_v166').length,0);done('Current write gate refuses confirm');
const denied=fixture();await denied.controller.setOrganization({id:'organization'});await denied.delta(1);denied.setHandler(()=>({error:{code:'42501'}}));await denied.submit();await denied.submit();
assert.equal(denied.button.disabled,true);assert.equal(denied.storage.size,0);assert.equal(denied.calls.filter(x=>x.name==='confirm_minuta_loyalty_adjustment_v166').length,1);done('Server role denial clears intent and disables further confirm');
const logout=fixture();await logout.controller.setOrganization({id:'organization'});await logout.delta(1);logout.controller.reset();await logout.submit();
assert.equal(logout.calls.filter(x=>x.name==='confirm_minuta_loyalty_adjustment_v166').length,0);assert.equal(logout.button.disabled,true);done('Reset invalidates preview without a confirm');
const pending=fixture();await pending.controller.setOrganization({id:'organization'});let resolveOld;pending.setHandler(()=>new Promise(resolve=>resolveOld=resolve));await pending.delta(1);pending.setUser('new-user');resolveOld({data:{before:0,after:1,delta:1,goal_visits:10,rule_id:'rule',cycle_number:1,allowed:true}});await pending.flush();
assert.equal(pending.button.disabled,true);done('Old session response cannot enable submit');
console.log(JSON.stringify({passed:count,browser:false,network:false,db:false}));
})().catch(error=>{console.error(error);process.exitCode=1;});
