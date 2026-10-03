import assert from 'node:assert/strict';
import test from 'node:test';
import {createCatalogRpcAdapter,attestReceipt,definiteRollback,resourceUrl} from '../commerce-catalog-adapter.js';
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const intent = {p_organization:id(1),p_booking:null,p_client_account:id(3),p_seller:id(2),p_payment_method:'cash',p_payment_account:id(5),p_request_id:id(8),p_lines:[{line_id:'first',inventory_item_id:id(4),warehouse_id:id(6),quantity:1,unit_price_minor:89900,metadata_version:1,discount_minor:0}]};
const receipt = {found:true,id:id(9),organization_id:id(1),booking_id:null,client_account_id:id(3),seller_id:id(2),payment_method:'cash',payment_account_id:id(5),request_id:id(8),intent_lines:structuredClone(intent.p_lines),total_minor:89900,refunded_minor:0,lines:[{line_id:'first',sale_id:id(10),inventory_item_id:id(4),warehouse_id:id(6),sale_quantity:1,unit_price_minor:89900,metadata_version:1,discount_minor:0,total_minor:89900,bundle_id:null,bundle_version:null}]};
const copy = x => structuredClone(x);
function fixture() {
  let actor = id(2), generation = 1, writable = true;
  const ctx = {organization:{id:id(1),current_role:'owner'},state:{organization_id:id(1)}};
  const calls = []; let respond = () => ({data:copy(receipt),error:null});
  const options = {db:{rpc:async(name,args)=>{calls.push({name,args:copy(args)});return respond(name,args);}},getCurrentUser:()=>({id:actor}),getSessionGeneration:()=>generation,sessionIsCurrent:(user,gen)=>user===actor&&gen===generation,requireWrites:()=>writable};
  const api = createCatalogRpcAdapter(options,()=>ctx);
  return {api,ctx,calls,options,scope:()=>api.scope(),setActor:v=>{actor=v;},setGeneration:v=>{generation=v;},setWritable:v=>{writable=v;},respond:fn=>{respond=fn;}};
}
test('receipt attests organization/client/request/seller/payment and immutable item lines',()=>{
  assert.equal(attestReceipt(intent,receipt,id(2)),true);
  for(const [field,value] of [['organization_id',id(77)],['client_account_id',id(77)],['request_id',id(77)],['booking_id',id(77)],['seller_id',id(77)],['payment_account_id',id(77)],['payment_method','manual'],['total_minor',89901]]){
    assert.equal(attestReceipt(intent,{...receipt,[field]:value},id(2)),false,field);
  }
  for(const [field,value] of [['inventory_item_id',id(77)],['warehouse_id',id(77)],['line_id','other'],['sale_quantity',2],['unit_price_minor',90000],['metadata_version',2]]){
    const r=copy(receipt);r.lines[0][field]=value;assert.equal(attestReceipt(intent,r,id(2)),false,field);
  }
});
function bundleCase() {
  const wanted={...copy(intent),p_lines:[{line_id:'kit',bundle_id:id(20),bundle_version:1,warehouse_id:id(6),quantity:1,
    components:[{inventory_item_id:id(4),metadata_version:1,unit_price_minor:1000},{inventory_item_id:id(7),metadata_version:1,unit_price_minor:500}]}]};
  const saved={...copy(receipt),intent_lines:copy(wanted.p_lines),total_minor:2000,lines:[
    {line_id:'kit:1',sale_id:id(30),inventory_item_id:id(4),warehouse_id:id(6),sale_quantity:1,unit_price_minor:1000,metadata_version:1,discount_minor:0,total_minor:1000,bundle_id:id(20),bundle_version:1},
    {line_id:'kit:2',sale_id:id(31),inventory_item_id:id(7),warehouse_id:id(6),sale_quantity:2,unit_price_minor:500,metadata_version:1,discount_minor:0,total_minor:1000,bundle_id:id(20),bundle_version:1}
  ]};
  return {wanted,saved};
}
test('bundle receipt binds the original count and component request snapshot',()=>{
  const {wanted,saved}=bundleCase();assert.equal(attestReceipt(wanted,saved,id(2)),true);
  const changed=copy(wanted);changed.p_lines[0].quantity=2;assert.equal(attestReceipt(changed,saved,id(2)),false,'Same request ID cannot confirm another bundle count');
  const double=copy(saved);double.intent_lines=copy(changed.p_lines);double.lines[0].sale_quantity=2;double.lines[0].total_minor=2000;double.lines[1].sale_quantity=4;double.lines[1].total_minor=2000;double.total_minor=4000;
  assert.equal(attestReceipt(changed,double,id(2)),true,'A matching two-bundle receipt still confirms');
  const extra=copy(wanted);extra.p_lines[0].components[0].quantity=2;assert.equal(attestReceipt(extra,saved,id(2)),false,'Even an ignored extra component field changes the original request');
});
test('server JSON key order does not change receipt attestation; incomplete snapshots stay unknown',()=>{
  const {wanted,saved}=bundleCase();
  const reordered=value=>Array.isArray(value)?value.map(reordered):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).reverse().map(([key,v])=>[key,reordered(v)])):value;
  assert.equal(attestReceipt(wanted,{...saved,intent_lines:reordered(saved.intent_lines)},id(2)),true);
  for(const snapshot of [undefined,null,{},[]])assert.equal(attestReceipt(wanted,{...saved,intent_lines:snapshot},id(2)),false);
});
test('mismatched bundled recovery stays pending and status sends no sale',async()=>{
  const f=fixture(),{wanted,saved}=bundleCase(),changed=copy(wanted);changed.p_lines[0].quantity=2;f.respond(()=>({data:saved}));
  const args={scope:f.scope(),kind:'sale',intent:changed,requestId:changed.p_request_id,mode:'status'};
  const status=await f.api.onResolvePending(args);assert.equal(status.confirmed,false);assert.equal(status.receipt,undefined);assert.equal(status.error.message,'invalid_catalog_receipt');
  assert.deepEqual(f.calls.map(x=>x.name),['get_minuta_sales_cart_candidate']);assert.equal((await f.api.onSubmit({scope:f.scope(),intent:changed})).confirmed,false);
  assert.equal((await f.api.onResolvePending({...args,intent:wanted})).confirmed,true);
});
test('one cart RPC carries exact original intent; no legacy sale loop',async()=>{
  const f=fixture(),out=await f.api.onSubmit({scope:f.scope(),intent:copy(intent)});
  assert.equal(out.confirmed,true);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'sell_minuta_inventory_cart_candidate');assert.deepEqual(f.calls[0].args,intent);
});
test('network rejection and invalid successful receipt never confirm',async()=>{
  const f=fixture();f.respond(()=>{throw Error('network');});await assert.rejects(f.api.onSubmit({scope:f.scope(),intent}),/network/);
  f.respond(()=>({data:{...receipt,client_account_id:id(90)},error:null}));assert.equal((await f.api.onSubmit({scope:f.scope(),intent})).confirmed,false);
});
test('first known SQL rollback carries exact request and row error; conflict remains unknown',async()=>{
  const f=fixture();f.respond(()=>({error:{code:'55000',message:'insufficient_inventory_stock',details:'{"index":1}'}}));
  const out=await f.api.onSubmit({scope:f.scope(),intent});assert.equal(out.rolledBack,true);assert.equal(out.requestId,intent.p_request_id);assert.equal(out.organizationId,id(1));
  f.respond(()=>({error:{code:'23505',message:'catalog_request_conflict'}}));assert.equal((await f.api.onSubmit({scope:f.scope(),intent})).confirmed,false);
  assert.equal(definiteRollback({code:'23505',message:'catalog_sku_conflict'}),true);
});
test('status found=false never unlocks or writes; retry uses same full UUID/intent',async()=>{
  const f=fixture();f.respond(()=>({data:{found:false,organization_id:id(1),client_account_id:id(3)}}));
  const args={scope:f.scope(),kind:'sale',intent,requestId:id(8),mode:'status'};
  assert.equal((await f.api.onResolvePending(args)).confirmed,false);assert.deepEqual(f.calls[0].args,{p_organization:id(1),p_request_id:id(8),p_client_account:id(3)});
  f.respond(()=>({data:receipt}));assert.equal((await f.api.onResolvePending({...args,mode:'retry'})).confirmed,true);assert.deepEqual(f.calls[1].args,intent);
});
test('failed retry after unknown outcome cannot clear recovery, including changed write flags',async()=>{
  const f=fixture();f.respond(()=>({error:{code:'55000',message:'sales_catalog_writes_disabled'}}));
  const result=await f.api.onResolvePending({scope:f.scope(),kind:'sale',intent,requestId:id(8),mode:'retry'});
  assert.equal(result.rolledBack,undefined);assert.equal(result.confirmed,false);
});
test('scope checked before POST and after await, including changed actor and generation',async()=>{
  const f=fixture(),s=f.scope();f.setActor(id(77));await assert.rejects(f.api.onSubmit({scope:s,intent}),/scope_changed/);assert.equal(f.calls.length,0);
  f.setActor(id(2));let finish;f.respond(()=>new Promise(r=>finish=r));const p=f.api.onSubmit({scope:s,intent});f.setGeneration(2);finish({data:receipt});await assert.rejects(p,/scope_changed/);
});
test('organization and role changes deny old callbacks; disabled writes perform no POST',async()=>{
  const f=fixture(),s=f.scope();f.ctx.organization.id=id(90);await assert.rejects(f.api.onSubmit({scope:s,intent}),/scope_changed/);
  f.ctx.organization.id=id(1);f.ctx.organization.current_role='specialist';await assert.rejects(f.api.onSubmit({scope:s,intent}),/scope_changed/);
  f.ctx.organization.current_role='owner';f.setWritable(false);assert.equal((await f.api.onSubmit({scope:s,intent})).rolledBack,true);assert.equal(f.calls.length,0);
});
test('manager can save one item, while batch import is owner-only',async()=>{
  const f=fixture(),s=f.scope();f.ctx.organization.current_role='admin';f.respond(()=>({data:{items:[{inventory_item_id:id(4),metadata_version:2}]}}));
  assert.equal((await f.api.onSaveCatalog({scope:s,item:{name:'Cream'},requestId:id(8)})).confirmed,true);
  await assert.rejects(f.api.onCommitImport({scope:s,rows:[],previewHash:'a'.repeat(64),confirmed:true,requestId:id(7)}),/scope_changed/);assert.equal(f.calls.length,1);
});
test('metadata retry keeps original request/payload; status mode never creates an item',async()=>{
  const f=fixture(),s=f.scope(),payload={item:{name:'Cream',sale_price_minor:null},requestId:id(8)};f.respond(()=>({data:{items:[{inventory_item_id:id(4),metadata_version:1}]}}));
  const args={scope:s,kind:'item',intent:payload,requestId:id(8),mode:'status'};assert.equal((await f.api.onResolvePending(args)).confirmed,false);assert.equal(f.calls.length,0);
  assert.equal((await f.api.onResolvePending({...args,mode:'retry'})).confirmed,true);assert.deepEqual(f.calls[0].args,{p_organization:id(1),p_item:payload.item,p_request_id:id(8)});
});
test('repeat response attests exact selected client; no other-client read',async()=>{
  const f=fixture();f.respond(()=>({data:{found:true,organization_id:id(1),client_account_id:id(90)}}));await assert.rejects(f.api.onRepeat({scope:f.scope(),clientId:id(3)}),/scope_changed/);assert.equal(f.calls[0].args.p_client_account,id(3));
});
test('history uses authoritative grouped totals and explicit org-wide scope/cursor',async()=>{
  const f=fixture(),cursor={before:'2026-10-01T10:00:00Z',before_id:id(20)};f.respond(()=>({data:{organization_id:id(1),grouped:true,filter_client:false,grouped_count:12,gross_minor:100,refunded_minor:10,net_minor:90,purchases:[],next_cursor:null}}));
  const result=await f.api.history(f.scope(),cursor);assert.equal(result.grouped_count,12);assert.equal(f.calls[0].args.p_filter_client,false);assert.equal(f.calls[0].args.p_before_id,id(20));assert.equal(f.calls[0].args.p_client_account,null);
});
test('module/style URLs inherit the calling release version',()=>{
  assert.equal(resourceUrl('./commerce-catalog.css','https://example.com/pro/commerce-catalog-adapter.js?v=1071'),'https://example.com/pro/commerce-catalog.css?v=1071');
});
