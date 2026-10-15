import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const source=readFileSync(process.env.MINUTA_PAYROLL_SOURCE||new URL('../payroll-management.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const sdk=readFileSync(new URL('../vendor/supabase-2.112.4.min.js',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={org:id(1),actor:id(2),performer:id(3),period:id(4),account:id(5),accrual:id(6),advance:id(7)};
const definitions={
  payment:{rpc:'pay_minuta_payroll_debt_v136',form:'payrollPaymentForm',amount:'payrollPaymentAmount',success:'Выплата записана, долг обновлён'},
  advance:{rpc:'create_minuta_payroll_advance_v136',form:'payrollAdvanceForm',amount:'payrollAdvanceAmount',success:'Аванс записан'},
  offset:{rpc:'offset_minuta_payroll_advance_v136',form:'payrollOffsetForm',amount:'payrollOffsetAmount',success:'Аванс зачтён, долг обновлён'},
  accrue:{rpc:'accrue_minuta_payroll_period_v136',success:'Начисление записано. Теперь доступны частичные выплаты.'},
  reverse:{rpc:'reverse_minuta_payroll_transaction_v136',success:'Обратная операция добавлена в журнал'}
};
const cases=[];
for(const operation of ['payment','advance','offset']){
  cases.push([operation+': SDK fetch failure preserves the replay key across retry and reload',async h=>{
    await h.mode('lost');await h.submit();const first=await h.state();
    assert.equal(first.rows.length,1);assert.match(first.replies[0].error.message,/Failed to fetch/);
    await h.reload();await h.fill(500);await h.submit();const after=await h.state();
    assert.equal(after.rows.length,1,'one logical write must remain one row');
    assert.equal(after.calls[0].p_request_id,after.calls[1].p_request_id,'retry must reuse the first request ID');
    assert.ok(after.notices.includes(h.definition.success));
  },operation]);
  cases.push([operation+': empty acknowledgement is unknown and safely replayable',async h=>{
    await h.mode('empty');await h.submit();const first=await h.state();
    assert.equal(first.rows.length,1);assert.equal(first.notices.includes(h.definition.success),false,'empty response cannot acknowledge a financial operation');
    await h.reload();await h.fill(500);await h.submit();const after=await h.state();
    assert.equal(after.rows.length,1);assert.equal(after.calls[0].p_request_id,after.calls[1].p_request_id);
  },operation]);
  cases.push([operation+': wrong amount acknowledgement is not accepted',async h=>{
    await h.mode('wrong-amount');await h.submit();
    assert.equal((await h.state()).notices.includes(h.definition.success),false);
    await h.reload();await h.fill(500);await h.submit();assert.equal((await h.state()).rows.length,1);
  },operation]);
  cases.push([operation+': changed amount cannot silently replace an unresolved write',async h=>{
    await h.mode('lost');await h.submit();await h.fill(700);await h.submit();
    const after=await h.state();assert.equal(after.calls.length,1);assert.equal(after.rows.length,1);
    assert.equal(after.notices.includes(h.definition.success),false);
  },operation]);
  cases.push([operation+': two acknowledged explicit equal operations remain distinct',async h=>{
    await h.submit();await h.fill(500);await h.submit();const after=await h.state();
    assert.equal(after.rows.length,2);assert.notEqual(after.calls[0].p_request_id,after.calls[1].p_request_id);
    assert.equal(after.notices.filter(m=>m===h.definition.success).length,2);
  },operation]);
  cases.push([operation+': exact server refusal permits an independently corrected request',async h=>{
    await h.mode('refuse');await h.submit();assert.equal((await h.state()).rows.length,0);
    await h.fill(700);await h.submit();const after=await h.state();
    assert.equal(after.rows.length,1);assert.notEqual(after.calls[0].p_request_id,after.calls[1].p_request_id);
  },operation]);
}
for(const operation of ['accrue','reverse'])for(const mode of ['lost','empty'])cases.push([operation+': '+mode+' response survives a real reload and replays once',async h=>{
  await h.mode(mode);await h.submit();assert.equal((await h.state()).notices.includes(h.definition.success),false);
  await h.reload();await h.submit();const after=await h.state();
  assert.equal(after.rows.length,1);assert.equal(after.calls[0].p_request_id,after.calls[1].p_request_id);
  assert.ok(after.notices.includes(h.definition.success));
},operation]);
cases.push(['legacy v136 pending request migrates without changing its key',async h=>{
  await h.mode('lost');await h.submit();
  await h.page.evaluate(()=>{const next={...history.state};next.minutaPayrollLedgerIntent=Object.values(next.minutaPayrollFinancialIntents)[0];delete next.minutaPayrollFinancialIntents;history.replaceState(next,'');});
  await h.reload();await h.fill(500);await h.submit();assert.equal((await h.state()).rows.length,1);
},'payment']);
cases.push(['an unresolved advance restores its original date after a later reload',async h=>{
  await h.page.locator('#payrollAdvancePanel > summary').click();
  await h.page.locator('#payrollAdvancePaidAt').fill('2026-09-10T12:34');
  await h.mode('lost');await h.submit();await h.reload();
  assert.equal(await h.page.locator('#payrollAdvancePaidAt').inputValue(),'2026-09-10T12:34');
  await h.submit();assert.equal((await h.state()).rows.length,1);
},'advance']);
cases.push(['a later SQL refusal cannot discard a previously uncertain request',async h=>{
  await h.mode('lost');await h.submit();await h.mode('refuse');await h.submit();await h.submit();
  const after=await h.state();assert.equal(after.rows.length,1);assert.equal(new Set(after.calls.map(c=>c.p_request_id)).size,1);
},'payment']);
cases.push(['pending payment cannot be overwritten by a different financial action',async h=>{
  await h.mode('lost');await h.submit();
  await h.page.evaluate(()=>{document.querySelector('#payrollAdvanceAmount').value='500';document.querySelector('#payrollAdvanceForm').requestSubmit();});
  await h.page.waitForTimeout(30);
  assert.equal((await h.state()).calls.length,1);
  await h.reload();await h.fill(500);await h.submit();assert.equal((await h.state()).rows.length,1);
},'payment']);
cases.push(['denied history persistence prevents an unsafe new write',async h=>{
  await h.page.evaluate(()=>{history.replaceState=()=>{throw new DOMException('denied','SecurityError');};});
  await h.submit();assert.equal((await h.state()).calls.length,0);
},'payment']);
cases.push(['an initial rejected workspace RPC shows an error and supports reload',async h=>{
  const result=await h.page.evaluate(async()=>{
    testState.readFailure=true;
    let rejected=false;try{await ctl.load();}catch{rejected=true;}
    return {rejected,availability:ctl.availability,loading:!document.querySelector('#payrollLoading').hidden,error:!document.querySelector('#payrollUnavailable').hidden};
  });
  assert.deepEqual(result,{rejected:false,availability:'error',loading:false,error:true});
  await h.page.evaluate(()=>ctl.load());assert.equal((await h.state()).availability,'ready');
},'payment']);
cases.push(['a late rejected read cannot replace the destination organization',async h=>{
  const result=await h.page.evaluate(async()=>{
    let rejectOld;
    const gates={rpc:(_name,p)=>p.p_organization==='old'?new Promise((_resolve,reject)=>{rejectOld=reject;}):Promise.resolve({data:{organization_id:'new',current_role:'owner',can_manage:true,ledger_enabled:false},error:null})};
    const c=MinutaPayroll.createController({...controllerOptions,db:gates});
    const old=c.setOrganization({id:'old'});
    await c.setOrganization({id:'new'});rejectOld(Error('late old read'));
    let rejected=false,r;try{r=await old;}catch{rejected=true;}
    return {rejected,stale:r?.stale,availability:c.availability,organization:c.payload?.organization_id,errorVisible:!document.querySelector('#payrollUnavailable').hidden};
  });
  assert.deepEqual(result,{rejected:false,stale:true,availability:'ready',organization:'new',errorVisible:false});
},'payment']);
cases.push(['independent organizations retain their unresolved replay keys',async h=>{
  await h.mode('lost');await h.submit();
  await h.page.evaluate(async()=>{testState.org=otherOrg;await ctl.setOrganization({id:otherOrg});testState.mode='lost';});
  await h.fill(500);await h.submit();assert.equal((await h.state()).rows.length,2);
  await h.reload();await h.page.evaluate(async()=>{testState.org=originalOrg;await ctl.setOrganization({id:originalOrg});});
  await h.fill(500);await h.submit();assert.equal((await h.state()).rows.length,2,'returning after reload must not duplicate A');
},'payment']);
cases.push(['independent actors retain their unresolved replay keys',async h=>{
  await h.mode('lost');await h.submit();
  await h.page.evaluate(async()=>{testState.actor='00000000-0000-4000-8000-000000000202';ctl.reset();await ctl.setOrganization({id:originalOrg});testState.mode='lost';});
  await h.fill(500);await h.submit();assert.equal((await h.state()).rows.length,2);
  await h.reload();await h.page.evaluate(async()=>{testState.actor='00000000-0000-4000-8000-000000000002';ctl.reset();await ctl.setOrganization({id:originalOrg});});
  await h.fill(500);await h.submit();assert.equal((await h.state()).rows.length,2);
},'payment']);
for(const operation of ['payment','advance','offset'])cases.push([operation+': a late response after reset cannot unlock a newer pending write',async h=>{
  await h.mode('defer');await h.page.evaluate(()=>nativeSubmit());
  await h.page.evaluate(async()=>{testState.actor='00000000-0000-4000-8000-000000000202';ctl.reset();await ctl.setOrganization({id:originalOrg});testState.mode='defer';});
  await h.fill(500);await h.page.evaluate(()=>nativeSubmit());
  await h.page.evaluate(()=>{replyGates[0]();});await h.page.waitForTimeout(30);
  const pending=await h.page.evaluate(()=>{const button=document.querySelector('#'+definition.form+' button[type="submit"]');return {disabled:button.disabled,text:button.textContent,notices:testState.notices};});
  assert.deepEqual(pending,{disabled:true,text:'Сохраняем…',notices:[]});
  await h.page.evaluate(()=>{replyGates[1]();});await h.page.waitForFunction(()=>ctl.availability==='ready');
  assert.equal((await h.state()).rows.length,2);
},operation]);

let browser,failed=0;
async function fixture(operation){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],traffic=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
    if(route.request().url()==='https://payroll-ledger.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
    if(route.request().url()==='https://payroll-ledger.test/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    traffic.push(route.request().url());return route.abort();
  });
  await page.goto('https://payroll-ledger.test/');
  async function initialize(restored=null){
  await page.evaluate(html=>{const doc=new DOMParser().parseFromString(html,'text/html');document.body.append(document.importNode(doc.querySelector('#payrollPanel'),true));},html);
  await page.addScriptTag({content:sdk});await page.addScriptTag({content:source});
  await page.evaluate(async({ids,definition,definitions,restored})=>{
    window.originalOrg=ids.org;window.otherOrg='00000000-0000-4000-8000-000000000101';
    window.testState={org:ids.org,calls:[],rows:[],notices:[],replies:[],...restored,mode:'ok',readFailure:false};
    window.replyGates=[];
    const accepted=new Map(testState.rows.map(row=>[row.params.p_organization+':'+row.params.p_request_id,row]));
    function workspace(org){return {
      organization_id:org,current_role:'owner',can_manage:true,ledger_enabled:true,
      members:[{id:ids.performer,display_name:'Synthetic worker',is_bookable:true}],
      locations:[],plans:[],periods:[{id:ids.period,name:'Synthetic September',starts_on:'2026-09-01',ends_on:'2026-09-30',status:'approved',total_payroll_rub:10000}],
      items:[{id:'synthetic-item',period_id:ids.period,performer_id:ids.performer,payroll_rub:10000}],
      accruals:definition.rpc==='accrue_minuta_payroll_period_v136'?[]:[{id:ids.accrual,transaction_id:'synthetic-accrual-tx',period_id:ids.period,amount_minor:1000000}],
      debts:[{accrual_source_id:ids.accrual,period_id:ids.period,performer_id:ids.performer,original_minor:1000000,debt_minor:1000000}],
      advances:[{id:ids.advance,transaction_id:'00000000-0000-4000-8000-000000000040',performer_id:ids.performer,amount_minor:1000000,remaining_minor:1000000}],
      payment_accounts:[{id:ids.account,name:'Synthetic cash',account_type:'cash',active:true}]
    };}
    const client=supabase.createClient('https://synthetic-ledger-backend.test','synthetic-key',{
      accessToken:async()=>'synthetic-token',auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},db:{retry:false},
      global:{fetch:async(input,init)=>{
        const name=new URL(typeof input==='string'?input:input.url).pathname.split('/').at(-1),p=JSON.parse(init.body||'{}');
        if(name==='get_minuta_payroll_ledger_workspace_v136')return new Response(JSON.stringify(workspace(p.p_organization)),{status:200,headers:{'Content-Type':'application/json'}});
        if(!Object.values(definitions).some(d=>d.rpc===name))throw Error('Unexpected mutating RPC '+name);
        testState.calls.push(structuredClone(p));
        if(testState.mode==='refuse'){testState.mode='ok';return new Response(JSON.stringify({code:'22023',message:'invalid_payroll_'+(name==='offset_minuta_payroll_advance_v136'?'advance_offset':name==='create_minuta_payroll_advance_v136'?'advance':'payment'),details:'',hint:''}),{status:400,headers:{'Content-Type':'application/json'}});}
        const key=p.p_organization+':'+p.p_request_id;let row=accepted.get(key),replayed=Boolean(row);
        if(!row){row={id:crypto.randomUUID(),source_id:crypto.randomUUID(),params:structuredClone(p)};accepted.set(key,row);testState.rows.push(row);}
        const data={id:row.id,source_id:row.source_id,organization_id:p.p_organization,request_id:p.p_request_id,performer_id:p.p_performer||ids.performer,amount_minor:p.p_amount_minor,replayed};
        if(name==='pay_minuta_payroll_debt_v136')Object.assign(data,{accrual_source_id:p.p_accrual_source,debt_after_minor:950000});
        if(name==='create_minuta_payroll_advance_v136')data.remaining_minor=p.p_amount_minor;
        if(name==='offset_minuta_payroll_advance_v136')Object.assign(data,{advance_source_id:p.p_advance_source,accrual_source_id:p.p_accrual_source,debt_after_minor:950000,advance_remaining_minor:950000});
        if(name==='accrue_minuta_payroll_period_v136')Object.assign(data,{period_id:p.p_period,transaction_id:row.source_id,amount_minor:1000000});
        if(name==='reverse_minuta_payroll_transaction_v136')data.reversal_of=p.p_transaction;
        const mode=testState.mode;testState.mode='ok';
        if(mode==='lost')throw new TypeError('Failed to fetch');
        if(mode==='wrong-amount')data.amount_minor++;
        if(mode==='defer')await new Promise(resolve=>replyGates.push(resolve));
        return new Response(JSON.stringify(mode==='empty'?null:data),{status:200,headers:{'Content-Type':'application/json'}});
      }}
    });
    window.controllerOptions={db:{rpc:async(name,p)=>{
      if(name==='get_minuta_payroll_ledger_workspace_v136'&&testState.readFailure){testState.readFailure=false;throw Error('rejected workspace RPC');}
      const result=await client.rpc(name,p);if(name!=='get_minuta_payroll_ledger_workspace_v136')testState.replies.push(result);return result;
    }},$:s=>document.querySelector(s),escapeHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]),notify:m=>testState.notices.push(m),requireWrites:()=>true,getCurrentUser:()=>({id:testState.actor||ids.actor}),getSessionGeneration:()=>1,sessionIsCurrent:user=>user===(testState.actor||ids.actor),applyWriteAvailability:()=>{},confirmAction:()=>true};
    window.ctl=MinutaPayroll.createController(controllerOptions);ctl.bind();
    document.querySelector('#payrollStartDate').value='2026-09-01';document.querySelector('#payrollEndDate').value='2026-09-30';
    await ctl.setOrganization({id:testState.org});
    window.definition=definition;
    window.nativeSubmit=async()=>{
      if(definition.rpc==='accrue_minuta_payroll_period_v136')document.querySelector('[data-payroll-accrue]').click();
      else if(definition.rpc==='reverse_minuta_payroll_transaction_v136'){
        const form=document.querySelector('[data-payroll-reversal-form]');form.querySelector('[name="reason"]').value='Synthetic reversal reason';form.requestSubmit(form.querySelector('button[type="submit"]'));
      }else {const form=document.getElementById(definition.form);form.requestSubmit(form.querySelector('button[type="submit"]'));}
      await new Promise(r=>setTimeout(r,30));
    };
  },{ids,definition:definitions[operation],definitions,restored});
  }
  await initialize();
  async function fill(amount=500){if(definitions[operation].amount)await page.evaluate(({amount,id})=>{document.getElementById(id).value=String(amount);},{amount,id:definitions[operation].amount});}
  await fill();
  return {page,context,errors,traffic,definition:definitions[operation],fill,
    mode:mode=>page.evaluate(mode=>{testState.mode=mode;},mode),
    submit:async()=>{await page.evaluate(()=>nativeSubmit());await page.waitForFunction(()=>ctl.availability!=='loading',{timeout:3000});},
    state:()=>page.evaluate(()=>({...testState,availability:ctl.availability,history:history.state})),
    reload:async()=>{const restored=await page.evaluate(()=>testState);await page.reload();await initialize(restored);}};
}
try{
  browser=await chromium.launch({headless:true});
  for(const [name,run,operation] of cases){
    const h=await fixture(operation);
    try{await run(h);assert.deepEqual(h.errors,[]);assert.deepEqual(h.traffic,[]);console.log('PASS '+name);}
    catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}
    finally{await h.context.close();}
  }
}finally{await browser?.close();}
console.log((cases.length-failed)+'/'+cases.length+' payroll ledger recovery cases; actual SDK/controller, synthetic ledger, no SQL or external traffic');
process.exitCode=failed?1:0;
