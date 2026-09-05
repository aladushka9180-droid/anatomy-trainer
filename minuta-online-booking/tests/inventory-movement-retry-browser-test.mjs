import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Full actual controller, native provider panel/forms/events/render, isolated SDK.
// Synthetic sequential v82:304-341 receipt/write_off ledger, NOT SQL, RLS,
// concurrency, costing v113, installed PWA or authenticated production E2E.
// Small integral quantities, one item/warehouse isolate request identity.
const source=readFileSync(process.env.MINUTA_INVENTORY_SOURCE||new URL('../inventory-management.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../provider.html',import.meta.url),'utf8');
const icons=readFileSync(new URL('../ui-icons.svg',import.meta.url),'utf8');
const playwright=process.env.MINUTA_PLAYWRIGHT_MODULE;
const {chromium}=await import(playwright?pathToFileURL(playwright).href:'playwright');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),actor=id(2),warehouse=id(3),item=id(4),location=id(5);
const reason='Списание испорченного материала';
const button='#inventoryMovementForm button[type="submit"]';
let browser;

async function fixture(){
  const context=await browser.newContext(),page=await context.newPage(),errors=[],traffic=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{
    const url=route.request().url();
    if(url==='https://inventory-movement.test/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body></body></html>'});
    if(url==='https://inventory-movement.test/ui-icons.svg')return route.fulfill({contentType:'image/svg+xml',body:icons});
    traffic.push(url);return route.abort();
  });
  await page.goto('https://inventory-movement.test/');
  await page.evaluate(html=>{
    const panel=new DOMParser().parseFromString(html,'text/html').querySelector('#inventoryPanel');
    if(!panel)throw Error('Missing actual inventory panel');
    document.body.append(document.importNode(panel,true));
  },html);
  await page.addScriptTag({content:source});
  await page.evaluate(async({org,actor,warehouse,item,location})=>{
    const clone=value=>JSON.parse(JSON.stringify(value));
    window.calls=[];window.rows=[];window.notices=[];window.stock=10;
    window.replyMode='success';window.deferReply=false;window.gates=[];window.nextRefusal=null;window.readFailure=null;
    const workspace=()=>({organization_id:org,current_role:'owner',enabled:true,auto_deduct_completed_visits:false,
      locations:[{id:location,name:'Филиал',active:true}],services:[],usage:[],audit:[],
      items:[{id:item,name:'Материал',unit:'piece',low_stock_threshold:0,active:true}],
      warehouses:[{id:warehouse,location_id:location,name:'Склад',active:true}],
      balances:[{warehouse_id:warehouse,inventory_item_id:item,quantity:stock}],movements:clone(rows)});
    const db={rpc:async(name,args)=>{
      calls.push({name,args:clone(args)});
      if(name==='get_minuta_inventory_workspace'){
        if(readFailure){const mode=readFailure;readFailure=null;
          if(mode==='throw')throw Error('Synthetic workspace rejection');
          return {data:null,error:{code:'08006',message:'Synthetic workspace unavailable'}};
        }
        return {data:workspace(),error:null};
      }
      if(name!=='apply_minuta_stock_movement')throw Error('Unexpected write '+name);
      // v82 enabled/target guards precede replay lookup, so a later refusal
      // cannot disprove that an earlier unknown call already committed.
      if(nextRefusal){const error=nextRefusal;nextRefusal=null;return {data:null,error};}
      if(args.p_organization!==org||args.p_warehouse!==warehouse||args.p_item!==item)throw Error('Unexpected fixture scope');
      if(!/^[0-9a-f-]{36}$/.test(args.p_request_id)||!['receipt','write_off'].includes(args.p_kind)
        ||!Number.isInteger(args.p_quantity)||args.p_quantity<=0)throw Error('Unsupported/invalid fixture payload');
      const delta=args.p_kind==='receipt'?args.p_quantity:-args.p_quantity;
      const old=rows.find(row=>row.organization_id===org&&row.request_id===args.p_request_id);
      let ack;
      if(old){
        if(old.warehouse_id!==args.p_warehouse||old.inventory_item_id!==args.p_item
          ||old.movement_type!==args.p_kind||old.quantity_delta!==delta)return {data:null,error:{code:'23505',message:'inventory_request_conflict'}};
        // v82 replay does not compare/rewrite reason and returns original quantity_after.
        ack={data:{organization_id:org,id:old.id,quantity_after:old.quantity_after},error:null};
      }else{
        if(stock+delta<0)return {data:null,error:{code:'55000',message:'insufficient_inventory_stock'}};
        if(args.p_kind==='write_off'&&String(args.p_reason).trim().length<2)return {data:null,error:{code:'22023',message:'inventory_reason_required'}};
        stock+=delta;
        const row={id:rows.length+1,organization_id:org,warehouse_id:warehouse,inventory_item_id:item,
          movement_type:args.p_kind,quantity_delta:delta,quantity_after:stock,request_id:args.p_request_id,
          reason:String(args.p_reason).trim(),actor_id:actor,created_at:'2026-09-06T09:00:00Z'};
        rows.push(row);ack={data:{organization_id:org,id:row.id,quantity_after:stock},error:null};
      }
      if(deferReply)return new Promise((resolve,reject)=>gates.push({resolve,reject,ack}));
      const mode=replyMode;replyMode='success';
      if(mode==='lost')return {data:null,error:{code:'',message:'TypeError: Failed to fetch'}};
      if(mode==='throw')throw Error('Synthetic SDK rejection after commit');
      if(mode==='null')return {data:null,error:null};
      if(mode==='partial')return {data:{organization_id:org},error:null};
      if(mode==='badId')return {data:{...ack.data,id:'not-a-movement-id'},error:null};
      if(mode==='badQuantity')return {data:{...ack.data,quantity_after:'not-a-number'},error:null};
      return ack;
    }};
    const $=selector=>document.querySelector(selector);
    window.controller=MinutaInventory.createController({db,$,escapeHtml:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
      notify:message=>notices.push(message),requireWrites:()=>true,getCurrentUser:()=>({id:actor}),getSessionGeneration:()=>1,
      sessionIsCurrent:(user,generation)=>user===actor&&generation===1,applyWriteAvailability(){}});
    controller.bind();await controller.setOrganization({id:org,current_role:'owner'});
  },{org,actor,warehouse,item,location});
  return {context,page,errors,traffic};
}
async function fill(page){
  await page.locator('#inventoryMovementKind').selectOption('write_off');
  await page.locator('#inventoryMovementQuantity').fill('2');
  await page.locator('#inventoryMovementReason').fill(reason);
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));}
async function submit(page){
  assert.equal(await page.locator('#inventoryMovementForm').evaluate(form=>form.checkValidity()),true,'Native validation must not hide a duplicate');
  if(await page.locator(button).isDisabled())await page.locator('#inventoryMovementForm').evaluate(form=>form.requestSubmit(form.querySelector('button[type="submit"]')));
  else await page.locator(button).click();
  await settle(page);
}
async function state(page){return page.evaluate(()=>({rows:structuredClone(rows),stock,calls:structuredClone(calls),notices:[...notices],
  error:document.querySelector('#inventoryMovementError').hidden?'':document.querySelector('#inventoryMovementError').textContent,
  summary:document.querySelector('#inventoryMovementsList').textContent,quantity:document.querySelector('#inventoryMovementQuantity').value,
  disabled:document.querySelector('#inventoryMovementForm button[type="submit"]').disabled}));}
const writes=s=>s.calls.filter(call=>call.name==='apply_minuta_stock_movement');
async function uncertain(page,mode='lost'){
  await fill(page);await page.evaluate(mode=>{replyMode=mode;window.originalForm=document.querySelector('#inventoryMovementForm');},mode);
  await submit(page);const s=await state(page);
  assert.equal(s.rows.length,1);assert.equal(s.stock,8);
  assert.match(s.summary,/остаток\s*8/,'Actual reload/render must see the committed movement');
  assert.equal(await page.evaluate(()=>originalForm===document.querySelector('#inventoryMovementForm')),true);
  return s;
}
const cases=[
  ['CONTROL native invalid empty quantity writes nothing',async page=>{
    await fill(page);await page.locator('#inventoryMovementQuantity').fill('');await page.locator(button).click();await settle(page);
    assert.equal(writes(await state(page)).length,0);
  }],
  ['CONTROL acknowledged explicit new identical movement is allowed',async page=>{
    await fill(page);await submit(page);assert.equal((await state(page)).quantity,'');
    assert.ok((await state(page)).notices.includes('Списание сохранён'),'Exact current success notice must actually be exercised');
    await fill(page);await submit(page);const s=await state(page);
    assert.equal(s.rows.length,2);assert.equal(s.stock,6);assert.notEqual(s.rows[0].request_id,s.rows[1].request_id);
  }],
  ['CONTROL unchanged retry keeps original movement key',async page=>{
    const first=await uncertain(page);await submit(page);const s=await state(page);
    assert.equal(s.rows.length,1);assert.equal(s.stock,8);
    for(const call of writes(s))assert.deepEqual(call.args,writes(first)[0].args);
  }],
  ['SAFETY unknown stock result is not described as unchanged stock',async page=>{
    const s=await uncertain(page);assert.doesNotMatch(s.error,/не сохранено|остатки не изменены/);
    assert.match(s.error,/не подтвержд|проверь|результат/i);
  }],
  ['SAFETY organization-only acknowledgement is not success',async page=>{
    const s=await uncertain(page,'partial');assert.equal(s.quantity,'2');
    assert.equal(s.notices.includes('Списание сохранён'),false);
  }],
  ['SAFETY null acknowledgement followed by native input does not create a new movement',async page=>{
    await uncertain(page,'null');await page.locator('#inventoryMovementQuantity').fill('2.0');await submit(page);
    const s=await state(page);assert.equal(s.rows.length,1);assert.equal(s.stock,8);
  }],
  ['SAFETY pending native submit and input are single-flight',async page=>{
    await fill(page);await page.evaluate(()=>{deferReply=true;});await submit(page);
    await page.locator('#inventoryMovementQuantity').fill('2.0');await submit(page);
    assert.equal(writes(await state(page)).length,1);
    await page.evaluate(()=>{deferReply=false;gates[0].resolve(gates[0].ack);});await settle(page);
    assert.equal((await state(page)).rows.length,1);
  }],
  ['SAFETY rejected SDK outcome remains recoverable with the same original intent',async page=>{
    const first=await uncertain(page,'throw');await page.locator('#inventoryMovementQuantity').fill('2.0');await submit(page);
    const s=await state(page);assert.equal(s.rows.length,1);assert.equal(s.stock,8);
    for(const call of writes(s))assert.deepEqual(call.args,writes(first)[0].args);
  }],
  ['POLICY real edit after unknown cannot silently discard the unresolved operation',async page=>{
    const first=await uncertain(page);await page.locator('#inventoryMovementQuantity').fill('3');await submit(page);
    const s=await state(page);assert.equal(s.rows.length,1);assert.equal(writes(s).length,1);
    assert.match(s.error,/не подтвержд|исходн|результат|восстанов/i);
    await page.locator('[data-inventory-restore-movement]').click();
    assert.equal((await state(page)).quantity,'2');await submit(page);
    const recovered=await state(page);assert.equal(recovered.rows.length,1);assert.equal(recovered.stock,8);
    assert.deepEqual(writes(recovered)[1].args,writes(first)[0].args,'Restore must replay the exact original tuple and key');
  }],
  ['SAFETY refusal of a replay cannot clear an earlier unknown intent',async page=>{
    await uncertain(page);await page.evaluate(()=>{nextRefusal={code:'55000',message:'inventory_disabled'};});await submit(page);
    assert.equal(writes(await state(page)).length,2);
    await page.locator('#inventoryMovementQuantity').fill('3');await submit(page);
    const s=await state(page);assert.equal(s.rows.length,1);assert.equal(writes(s).length,2);assert.equal(s.stock,8);
  }],
  ['CONTROL exact refusal before any commit permits a corrected new movement',async page=>{
    await fill(page);await page.evaluate(()=>{nextRefusal={code:'55000',message:'insufficient_inventory_stock'};});await submit(page);
    assert.equal((await state(page)).rows.length,0);
    await page.locator('#inventoryMovementQuantity').fill('1');await submit(page);
    const s=await state(page);assert.equal(s.rows.length,1);assert.equal(s.stock,9);
  }],
];
for(const mode of ['error','throw'])cases.push([`SAFETY unknown then workspace ${mode} retains the key through native read retry`,async page=>{
  await fill(page);await page.evaluate(mode=>{replyMode='lost';readFailure=mode;},mode);await submit(page);
  assert.equal((await state(page)).rows.length,1);
  assert.equal(await page.locator('#inventoryUnavailable').isVisible(),true,'Failed read must expose an actionable read retry');
  await page.locator('#reloadInventory').click();await settle(page);
  assert.match((await state(page)).summary,/остаток\s*8/);
  await page.locator('#inventoryMovementQuantity').fill('2.0');await submit(page);
  const s=await state(page);assert.equal(s.rows.length,1);assert.equal(s.stock,8);
  assert.equal(writes(s).length,2);assert.deepEqual(writes(s)[1].args,writes(s)[0].args);
}]);
for(const mode of ['badId','badQuantity'])cases.push([`SAFETY ${mode} acknowledgement does not confirm a movement`,async page=>{
  const s=await uncertain(page,mode);assert.equal(s.quantity,'2');
  assert.equal(s.notices.includes('Списание сохранён'),false);
  await page.locator('#inventoryMovementQuantity').fill('2.0');await submit(page);
  assert.equal((await state(page)).rows.length,1);
}]);
for(const [label,selector,event,value] of [
  ['no-op input','#inventoryMovementQuantity','input','2'],
  ['no-op change','#inventoryMovementKind','change','write_off'],
  ['numeric equivalent','#inventoryMovementQuantity','input','2.0'],
  ['trim equivalent','#inventoryMovementReason','change',reason+' '],
])cases.push([`SAFETY lost reply then ${label} preserves the original intent`,async page=>{
  const first=await uncertain(page);
  await page.locator(selector).evaluate((node,{event,value})=>{node.value=value;node.dispatchEvent(new Event(event,{bubbles:true}));},{event,value});
  await submit(page);const s=await state(page);
  assert.equal(s.rows.length,1);assert.equal(s.stock,8);
  for(const call of writes(s))assert.deepEqual(call.args,writes(first)[0].args);
}]);
let failures=0;
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const [name,run] of cases){
    const f=await fixture();
    try{await run(f.page);assert.deepEqual(f.errors,[]);assert.deepEqual(f.traffic,[]);console.log('PASS '+name);}
    catch(error){failures++;console.error('FAIL '+name+' — '+error.message);}
    finally{await f.context.close();}
  }
}finally{await browser?.close();}
console.log(`Native inventory movement: ${cases.length-failures}/${cases.length} PASS; ${failures} failures. SQL/auth/concurrency not exercised.`);
if(failures)process.exitCode=1;
