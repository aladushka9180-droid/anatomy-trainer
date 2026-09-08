import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const source=readFileSync(new URL('../benefit-management.js',import.meta.url),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
async function fixture({storage=new Map(),issueReply=null,readReply=null,actor='owner',org='org-a'}={}) {
 const elements=new Map(),handlers=new Map(),calls=[],reads=[],notices=[];
 let sequence=0,currentActor=actor,generation=1;
 const $=selector=>{
  if(!elements.has(selector)){
   const field={id:selector.replace(/^#/,''),hidden:false,value:'',disabled:false,dataset:{},textContent:'',checked:false,open:false,
    querySelectorAll:()=>[],closest:s=>s==='#benefitsPanel'?field:null,reset(){for(const id of ['Product','Client','Expiry'])$('#benefitIssue'+id).value='';},
    get options(){return [...(field.innerHTML||'').matchAll(/<option value="([^"]+)"/g)].map(m=>({value:m[1]}));}};
   field.querySelector=()=>null;elements.set(selector,field);
  }return elements.get(selector);
 };
 const payload={organization_id:org,current_role:'owner',enabled:true,services:[],bookings:[],instruments:[],redemptions:[],audit:[],
  products:[{id:'product-a',name:'Абонемент',kind:'visit_pass',active:true,visits_count:5,validity_days:30}],
  clients:[{id:'client-a',client_name:'Не сохранять имя',client_phone:'Не сохранять телефон'}]};
 let exactRow=null;
 const context={crypto:{randomUUID:()=>`request-${++sequence}`},window:{localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
  document:{addEventListener:(name,fn)=>handlers.set(name,fn)}};
 runInNewContext(source,context);
 const db={rpc:async(name,args)=>{
  if(name==='get_minuta_benefit_workspace')return {data:{...payload,organization_id:args.p_organization},error:null};
  assert.equal(name,'issue_minuta_benefit');
  assert.equal(JSON.parse(storage.get(`minuta_benefit_issue_v1:${currentActor}:${args.p_organization}`)).request_id,args.p_request_id,'intent must be durable before RPC');
  calls.push(clone(args));
  if(issueReply)return typeof issueReply==='function'?issueReply(args):issueReply;
  exactRow={id:'instrument-'+calls.length,organization_id:args.p_organization,request_id:args.p_request_id,product_id:args.p_product,
    client_account_id:args.p_client_account,public_code:'MIN-fixture',expires_on:args.p_expires_on||'2027-01-01'};
  return {data:clone(exactRow),error:null};
 },from:name=>{
  assert.equal(name,'client_benefit_instruments');const filters=[];
  const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},maybeSingle:async()=>{reads.push(filters);return readReply
    ? typeof readReply==='function'?readReply(filters):readReply :{data:exactRow,error:null};}};return q;
 }};
 const controller=context.window.MinutaBenefits.createController({db,$,escapeHtml:v=>String(v??''),notify:m=>notices.push(m),requireWrites:()=>true,
  getCurrentUser:()=>currentActor?{id:currentActor}:null,getSessionGeneration:()=>generation,sessionIsCurrent:(a,g)=>a===currentActor&&g===generation,applyWriteAvailability(){}});
 controller.bind();await controller.setOrganization({id:org,current_role:'owner'});
 if(!$('#benefitIssueProduct').value)$('#benefitIssueProduct').value='product-a';
 if(!$('#benefitIssueClient').value)$('#benefitIssueClient').value='client-a';
 return {controller,$,calls,reads,notices,storage,payload,
  async submit(){await handlers.get('submit')({target:$('#benefitIssueForm'),submitter:$('#issueSubmit'),preventDefault(){}});},
  newIssue:()=>handlers.get('click')({target:{closest:s=>s==='#benefitIssueNew'?{}:null}}),
  change:()=>handlers.get('change')({target:$('#benefitIssueForm')}),
  switchActor(a){currentActor=a;generation++;controller.reset();},
 };
}

test('lost successful issuance survives reload and exact lookup avoids another issue RPC',async()=>{
 const first=await fixture({issueReply:{data:null,error:{message:'response lost'}}});await first.submit();
 const original=first.calls[0];const persisted=JSON.parse([...first.storage.values()][0]);
 assert.equal(persisted.request_id,original.p_request_id);
 assert.deepEqual(Object.keys(persisted).sort(),['actor_id','client_account_id','expires_on','organization_id','product_id','request_id']);
 const reopened=await fixture({storage:first.storage,readReply:{data:{id:'instrument-original',organization_id:'org-a',request_id:original.p_request_id,
  product_id:'product-a',client_account_id:'client-a',public_code:'MIN-original',expires_on:'2027-01-01'},error:null}});
 await reopened.submit();assert.equal(reopened.calls.length,0);assert.match(reopened.notices.at(-1),/уже выдан/);
 assert.deepEqual(reopened.reads[0],[['organization_id','org-a'],['request_id',original.p_request_id]]);
});

test('absent exact row retries original parameters and ID after reload and attempted edits',async()=>{
 const first=await fixture({issueReply:{data:null,error:{message:'unknown'}}});first.$('#benefitIssueExpiry').value='2027-02-01';await first.submit();
 const reopened=await fixture({storage:first.storage});
 reopened.$('#benefitIssueProduct').value='wrong';reopened.$('#benefitIssueClient').value='wrong';reopened.$('#benefitIssueExpiry').value='2028-01-01';
 await reopened.change();await reopened.submit();assert.deepEqual(reopened.calls[0],first.calls[0]);assert.equal(reopened.reads.length,1);
});

test('only explicit New issuance permits another request after acknowledged success',async()=>{
 const ui=await fixture();await ui.submit();await ui.submit();assert.equal(ui.calls.length,1);
 await ui.newIssue();ui.$('#benefitIssueProduct').value='product-a';ui.$('#benefitIssueClient').value='client-a';await ui.submit();
 assert.equal(ui.calls.length,2);assert.notEqual(ui.calls[0].p_request_id,ui.calls[1].p_request_id);
});

test('unknown response cannot be discarded through New issuance',async()=>{
 const ui=await fixture({issueReply:{error:{message:'unknown'},data:null}});await ui.submit();await ui.newIssue();
 assert.equal(ui.storage.size,1);assert.equal(ui.calls.length,1);
});

test('journal error or foreign/mismatched row never issues another product',async()=>{
 const first=await fixture({issueReply:{error:{message:'unknown'},data:null}});await first.submit();
 for(const readReply of [{data:null,error:{message:'offline'}},{data:{id:'wrong',organization_id:'foreign',request_id:first.calls[0].p_request_id,product_id:'product-a',client_account_id:'client-a',public_code:'MIN'},error:null}]){
  const reopened=await fixture({storage:first.storage,readReply});await reopened.submit();assert.equal(reopened.calls.length,0);assert.match(reopened.$('#benefitIssueError').textContent,/Не удалось сверить/);
 }
});

test('quota failure before dispatch does not claim issuance',async()=>{
 const storage=new Map();storage.set=()=>{throw Error('QuotaExceededError');};const ui=await fixture({storage});await ui.submit();
 assert.equal(ui.calls.length,0);assert.match(ui.$('#benefitIssueError').textContent,/Операция не отправлена/);
});

test('malformed acknowledgement remains attached to original issuance',async()=>{
 const ui=await fixture({issueReply:{data:{organization_id:'org-a'},error:null}});await ui.submit();await ui.newIssue();
 assert.equal(ui.storage.size,1);assert.equal(ui.notices.length,0);assert.match(ui.$('#benefitIssueError').textContent,/не подтверждена/);
});

test('actor and organization scopes do not inherit another pending issue',async()=>{
 const first=await fixture({issueReply:{error:{message:'unknown'},data:null}});await first.submit();
 const actor=await fixture({storage:first.storage,actor:'other'});await actor.submit();assert.equal(actor.reads.length,0);
 const org=await fixture({storage:first.storage,org:'org-b'});await org.submit();assert.equal(org.reads.length,0);assert.equal(first.storage.size,3);
});

test('definitive server rejection plus exact absence enables a separately requested correction',async()=>{
 const ui=await fixture({issueReply:{error:{code:'P0002',message:'benefit_product_not_found'},data:null}});await ui.submit();
 assert.equal(ui.reads.length,1);assert.match(ui.$('#benefitIssueRecoveryStatus').textContent,/отклонена/);
 await ui.newIssue();assert.equal(ui.storage.size,0);
});

test('reload of definite rejection still verifies absence before permitting correction',async()=>{
 const first=await fixture({issueReply:{error:{code:'P0002',message:'benefit_product_not_found'},data:null}});await first.submit();
 const reopened=await fixture({storage:first.storage});await reopened.submit();
 assert.equal(reopened.calls.length,0);assert.equal(reopened.reads.length,1);await reopened.newIssue();assert.equal(reopened.storage.size,0);
});

test('late success after actor reset cannot change destination or erase durable original intent',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const ui=await fixture({issueReply:()=>pending});const task=ui.submit();
 assert.equal(ui.calls.length,1);ui.switchActor('other');resolve({data:{id:'issued',organization_id:'org-a',public_code:'MIN',expires_on:'2027-01-01'},error:null});
 await task;assert.equal(ui.notices.length,0);assert.equal(ui.storage.size,1);
});

test('duplicate controller submits while dispatch is pending produce a single issuance',async()=>{
 let resolve;const pending=new Promise(r=>resolve=r);const ui=await fixture({issueReply:()=>pending});const first=ui.submit();await ui.submit();
 assert.equal(ui.calls.length,1);resolve({data:null,error:{message:'unknown'}});await first;
});
