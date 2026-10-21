import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

// Whole real payroll controller. Only nonfinancial plan save + workspace RPC
// names are accepted by the synthetic port; all payments/adjustments are poison.
const source = readFileSync(new URL('../payroll-management.js', import.meta.url), 'utf8');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve=done; }); return { promise,resolve }; };
function fixture() {
  const nodes=new Map(), listeners=new Map(), roles=new Map(), notices=[], calls=[];
  const write=deferred(), read=deferred(), readEntered=deferred(); let held=false, user='synthetic-owner-A', generation=1;
  const fields=['payrollPlanId','payrollPlanPerformer','payrollPlanName','payrollPlanFrom','payrollPlanTo','payrollPlanRate','payrollPlanTiers'];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id,{ id,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:false,open:false,dataset:{},
      setAttribute() {},removeAttribute() {},focus() {},
      querySelectorAll(selector) { return id==='payrollPanel' && selector==='[data-payroll-write]' ? [node('submit')] : id==='payrollPlanCreator' ? fields.map(node) : []; },
      querySelector(selector) { return node(id+' '+selector); },closest(selector) { return selector==='#payrollPanel' ? node('payrollPanel') : null; },
      reset() { if(id==='payrollPlanForm') for(const field of fields) node(field).value=''; }
    });
    return nodes.get(id);
  }
  const workspace=id=>({ organization_id:id,current_role:roles.get(id)||'owner',can_manage:true,enabled:true,ledger_enabled:true,
    members:[{id:'synthetic-performer',display_name:'Synthetic specialist',is_bookable:true}],locations:[],plans:[],periods:[],items:[],adjustments:[],
    typed_adjustments:[],accruals:[],payments:[],advances:[],advance_offsets:[],debts:[],ledger_accounts:[],payment_accounts:[],cash_accounts:[],transactions:[],history:[],audit:[] });
  const box={ Date,Intl,Map,WeakMap,Set,Array,Object,Number,String,Boolean,JSON,RegExp,Error,document:{addEventListener:(name,fn)=>listeners.set(name,fn)},
    history:{state:{},replaceState(value){this.state=value}} };
  box.window=box; vm.runInNewContext(source,box,{filename:'actual-payroll-management.js',timeout:1000});
  const controller=box.MinutaPayroll.createController({
    db:{async rpc(name,parameters){calls.push({name,organization:parameters.p_organization});
      if(name==='get_minuta_payroll_ledger_workspace_v136'){if(held){held=false;readEntered.resolve();return read.promise}return{data:workspace(parameters.p_organization),error:null}}
      assert.equal(name,'upsert_minuta_payroll_plan','Only synthetic plan edit is permitted');return write.promise;
    }},$:selector=>node(selector.replace(/^#/,'')),escapeHtml:String,notify:message=>notices.push(message),requireWrites:()=>true,
    getCurrentUser:()=>({id:user}),getSessionGeneration:()=>generation,sessionIsCurrent:(id,gen)=>id===user&&gen===generation,applyWriteAvailability(){}
  });controller.bind();node('payrollStartDate').value='2026-10-01';node('payrollEndDate').value='2026-10-31';
  return{controller,node,workspace,calls,notices,write,read,readEntered,
    setOrganization(id,role='owner'){roles.set(id,role);return controller.setOrganization({id,current_role:role})},
    changeSession(){user='synthetic-owner-B';generation++},
    fill(label){node('payrollPlanName').value=label;node('payrollPlanId').value='synthetic-edit-'+label;node('payrollPlanPerformer').value='synthetic-performer';node('payrollPlanFrom').value='2026-10-01';node('payrollPlanRate').value='40';node('payrollPlanTiers').value='';node('payrollPlanCreator').open=true},
    submit:()=>listeners.get('submit')({target:node('payrollPlanForm'),submitter:node('submit'),preventDefault(){}}),
    changePeriod:()=>{node('payrollStartDate').value='2026-11-01';node('payrollEndDate').value='2026-11-30';return controller.load()},
    holdRead(){held=true},snapshot:()=>({name:node('payrollPlanName').value,id:node('payrollPlanId').value,open:node('payrollPlanCreator').open})
  };
}
async function start(){const f=fixture();await f.setOrganization('synthetic-A');f.fill('old');const pending=f.submit();assert.equal(f.calls.filter(c=>c.name==='upsert_minuta_payroll_plan').length,1);return{f,pending}}
async function acknowledgeIntoHeldRead(f){f.holdRead();f.write.resolve({data:{organization_id:'synthetic-A'},error:null});await f.readEntered.promise}

for(const change of ['organization','ABA','session-reset','role','period','fresh-load']) test('payroll plan ACK-refresh cannot clear new '+change+' draft',async()=>{
  const{f,pending}=await start();await acknowledgeIntoHeldRead(f);
  if(change==='organization')await f.setOrganization('synthetic-B');
  if(change==='ABA'){await f.setOrganization('synthetic-B');await f.setOrganization('synthetic-A')}
  if(change==='session-reset'){f.changeSession();f.controller.reset();await f.setOrganization('synthetic-A')}
  if(change==='role')await f.setOrganization('synthetic-A','admin');
  if(change==='period')await f.changePeriod();
  if(change==='fresh-load')await f.controller.load();
  f.fill('new');const before=f.snapshot(),mark=f.notices.length;
  f.read.resolve({data:f.workspace('synthetic-A'),error:null});await pending;
  assert.deepEqual(f.snapshot(),before);assert.equal(f.notices.length,mark);assert.equal(f.controller.availability,'ready');
});

for(const outcome of ['success','known-error','unknown']) test('payroll plan current '+outcome+' preserves ordinary behavior',async()=>{
  const{f,pending}=await start();f.write.resolve(outcome==='success'?{data:{organization_id:'synthetic-A'},error:null}:{data:null,error:{code:outcome==='known-error'?'42501':'FETCH_FAILED',message:'Synthetic refusal'}});await pending;
  assert.equal(f.node('payrollPlanName').value,outcome==='success'?'':'old');assert.equal(f.node('payrollPlanCreator').open,outcome!=='success');
  if(outcome!=='success'){assert.equal(f.node('payrollPlanError').hidden,false);assert.ok(f.node('payrollPlanError').textContent)}
  assert.equal(f.calls.filter(c=>c.name==='upsert_minuta_payroll_plan').length,1);
});

test('payroll plan queued organization is handed off after its own RPC',async()=>{
  const{f,pending}=await start();const queued=await f.setOrganization('synthetic-B');assert.equal(queued.pending,true);
  f.write.resolve({data:{organization_id:'synthetic-A'},error:null});await pending;
  assert.equal(f.controller.payload.organization_id,'synthetic-B');assert.equal(f.controller.availability,'ready');
});

test('payroll plan repeat submit while current RPC is pending sends only once',async()=>{
  const{f,pending}=await start();await f.submit();assert.equal(f.calls.filter(c=>c.name==='upsert_minuta_payroll_plan').length,1);
  f.write.resolve({data:{organization_id:'synthetic-A'},error:null});await pending;assert.equal(f.node('payrollPlanName').value,'');
});
