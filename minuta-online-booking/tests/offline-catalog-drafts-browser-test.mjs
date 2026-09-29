import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root=new URL('../',import.meta.url);
const source={
  '/reliability.js':readFileSync(new URL('reliability.js',root),'utf8'),
  '/offline-catalog-drafts.js':readFileSync(new URL('offline-catalog-drafts.js',root),'utf8')
};
const server=createServer((request,response)=>{
  if(request.url==='/'){
    response.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    response.end('<!doctype html><script src="/reliability.js"></script><script src="/offline-catalog-drafts.js"></script>');
    return;
  }
  if(source[request.url]){
    response.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});
    response.end(source[request.url]);
    return;
  }
  response.writeHead(404);response.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const { chromium }=await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL || 'chrome'});
const context=await browser.newContext();
const page=await context.newPage();
const url=`http://127.0.0.1:${server.address().port}/`;
const user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const foreign='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const item='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

try {
  await page.goto(url);
  const queued=await page.evaluate(async ({user,org,item})=>{
    const api=window.MinutaOfflineCatalogDrafts;
    return api.queue({userId:user,organizationId:org,kind:'inventory',entityId:item,
      expectedVersion:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      values:{name:'Масло для массажа',sku:'M1',unit:'ml',lowStock:2,active:true}});
  },{user,org,item});
  assert.equal(queued.status,'local');
  assert.equal(queued.fields.name,'Масло для массажа');
  await page.reload();
  const persisted=await page.evaluate(async ({user,org,other,foreign})=>{
    const api=window.MinutaOfflineCatalogDrafts;
    return {
      own:await api.list(user,org),
      other:await api.list(other,org),
      foreign:await api.list(user,foreign)
    };
  },{user,org,other,foreign});
  assert.equal(persisted.own.drafts.length,1);
  assert.equal(persisted.own.invalidCount,0);
  assert.equal(persisted.other.drafts.length,0);
  assert.equal(persisted.foreign.drafts.length,0);
  const versions=await page.evaluate(async ({user,org,other,foreign,item})=>{
    const api=window.MinutaOfflineCatalogDrafts;
    const service='ffffffff-ffff-4fff-8fff-ffffffffffff';
    await api.rememberVersion({userId:user,organizationId:org,kind:'inventory',entityId:item,
      version:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});
    await api.rememberVersion({userId:user,organizationId:org,kind:'service',entityId:service,
      version:'0123456789abcdef0123456789abcdef'});
    let invalid=false;
    try { await api.rememberVersion({userId:user,organizationId:org,kind:'service',entityId:service,
      version:'unverified'}); } catch(error) { invalid=error.message==='catalog_version_invalid'; }
    return {invalid,own:await api.readVersion(user,org,'inventory',item),
      other:await api.readVersion(other,org,'inventory',item),
      foreign:await api.readVersion(user,foreign,'inventory',item),
      service:await api.readVersion(user,org,'service',service)};
  },{user,org,other,foreign,item});
  assert.deepEqual(versions,{invalid:true,own:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',other:null,foreign:null,
    service:'0123456789abcdef0123456789abcdef'});
  await page.reload();
  assert.equal(await page.evaluate(async ({user,org,item})=>
    window.MinutaOfflineCatalogDrafts.readVersion(user,org,'inventory',item),{user,org,item}),
    versions.own);
  const captured=await page.evaluate(async ({user,org,item})=>{
    const api=window.MinutaOfflineCatalogDrafts;
    const current=(u,o)=>u===user&&o===org;
    const inventory=await api.captureInventoryVersions({userId:user,organizationId:org,isCurrent:current,
      workspace:{organization_id:org,items:[{id:item,etag:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        name:'Масло',sku:'M1',unit:'ml',low_stock_threshold:2,active:true}]}});
    const wrongScope=await api.refreshServiceVersion({userId:user,organizationId:org,
      entityId:item,isCurrent:current,rpc:async()=>({data:{organization_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        id:item,etag:'0123456789abcdef0123456789abcdef'}})});
    const service=await api.refreshServiceVersion({userId:user,organizationId:org,
      entityId:item,isCurrent:current,rpc:async(name,params)=>({data:{organization_id:params.p_organization,
        id:params.p_service,etag:'fedcba9876543210fedcba9876543210',
        name:'Массаж',duration_minutes:60,price_rub:2500,active:true}})});
    return {inventory,wrongScope,service,storedInventory:await api.readVersion(user,org,'inventory',item),
      storedService:await api.readVersion(user,org,'service',item),
      serviceSnapshot:await api.readVersionSnapshot(user,org,'service',item),
      inventorySnapshot:await api.readVersionSnapshot(user,org,'inventory',item),
      savedInventory:await api.listVersionSnapshots(user,org,'inventory')};
  },{user,org,item});
  assert.deepEqual(captured,{inventory:1,wrongScope:null,service:'fedcba9876543210fedcba9876543210',
    storedInventory:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',storedService:'fedcba9876543210fedcba9876543210',
    serviceSnapshot:{version:'fedcba9876543210fedcba9876543210',
      fields:{name:'Массаж',durationMinutes:60,priceRub:2500,active:true}},
    inventorySnapshot:{version:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      fields:{name:'Масло',sku:'M1',unit:'ml',lowStock:2,active:true}},
    savedInventory:[{entityId:item,version:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      fields:{name:'Масло',sku:'M1',unit:'ml',lowStock:2,active:true}}]});
  const scopeGuard=await page.evaluate(async ({user,org,item,requestId})=>{
    const api=window.MinutaOfflineCatalogDrafts;
    let calls=0,duplicate=false;
    await api.flushOne({userId:user,organizationId:org,requestId,isCurrent:()=>false,
      rpc:async()=>{calls++;return {data:{saved:true}};}});
    try {
      await api.queue({userId:user,organizationId:org,kind:'inventory',entityId:item,
        expectedVersion:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        values:{name:'Повтор',sku:'M2',unit:'ml',lowStock:2,active:true}});
    } catch(error) { duplicate=error.message==='catalog_draft_exists'; }
    return {calls,duplicate};
  },{user,org,item,requestId:queued.requestId});
  assert.deepEqual(scopeGuard,{calls:0,duplicate:true});
  const replay=await page.evaluate(async ({user,org,requestId})=>{
    const api=window.MinutaOfflineCatalogDrafts;
    let calls=0,seen=[];
    const current=(u,o)=>u===user && o===org;
    const first=await api.flushOne({userId:user,organizationId:org,requestId,isCurrent:current,
      rpc:async(name,params)=>{calls++;seen.push([name,params.p_request_id]);throw new Error('lost_response');}});
    const second=await api.flushOne({userId:user,organizationId:org,requestId,isCurrent:current,
      rpc:async(name,params)=>{calls++;seen.push([name,params.p_request_id]);return {data:{saved:true,organization_id:org,
        id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',etag:'cccccccccccccccccccccccccccccccc'}};}});
    return {calls,seen,first:first.status,second:second.status};
  },{user,org,requestId:queued.requestId});
  assert.equal(replay.calls,2);
  assert.deepEqual(replay.seen.map(row=>row[1]),[queued.requestId,queued.requestId]);
  assert.equal(replay.first,'checking');
  assert.equal(replay.second,'applied');
  await page.reload();
  assert.equal((await page.evaluate(async ({user,org,id})=>
    (await window.MinutaOfflineCatalogDrafts.read(user,org,id)).status,
    {user,org,id:queued.requestId})),'applied');
  const conflict=await page.evaluate(async ({user,org})=>{
    const api=window.MinutaOfflineCatalogDrafts;
    const draft=await api.queue({userId:user,organizationId:org,kind:'service',entityId:null,
      expectedVersion:null,values:{name:'Новая услуга',durationMinutes:45,priceRub:700,active:true}});
    const unverified=await api.flushOne({userId:user,organizationId:org,requestId:draft.requestId,
      isCurrent:(u,o)=>u===user&&o===org,
      rpc:async()=>({data:{saved:true,organization_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',etag:'0123456789abcdef0123456789abcdef'}})});
    const result=await api.flushOne({userId:user,organizationId:org,requestId:draft.requestId,
      isCurrent:(u,o)=>u===user&&o===org,
      rpc:async()=>({data:{saved:false,reason:'service_changed_after_save'}})});
    return {unverified:unverified.status,status:result.status,reason:result.result?.reason};
  },{user,org});
  assert.deepEqual(conflict,{unverified:'checking',status:'conflict',reason:'service_changed_after_save'});
  const unavailable=await page.evaluate(async ({user,org})=>{
    const store=window.MinutaReliability,original=store.put;
    store.put=async()=>{throw new Error('idb_unavailable');};
    try {
      await window.MinutaOfflineCatalogDrafts.queue({userId:user,organizationId:org,kind:'service',entityId:null,
        expectedVersion:null,values:{name:'Не сохранено',durationMinutes:30,priceRub:1,active:true}});
      return false;
    } catch(error) { return error.message==='idb_unavailable'; }
    finally { store.put=original; }
  },{user,org});
  assert.equal(unavailable,true);
  await page.evaluate(async ({user})=>window.MinutaOfflineCatalogDrafts.clearUser(user),{user});
  assert.equal((await page.evaluate(async ({user,org})=>
    (await window.MinutaOfflineCatalogDrafts.list(user,org)).drafts.length,{user,org})),0);
  assert.equal(await page.evaluate(async ({user,org,item})=>
    window.MinutaOfflineCatalogDrafts.readVersion(user,org,'inventory',item),{user,org,item}),null);
  await page.evaluate(({user,org,item})=>{
    const store=window.MinutaReliability,put=store.put;
    window.versionPutEntered=false;
    store.put=async (...args)=>{
      if (args[0].startsWith('minuta-offline-catalog-version-v1:')) {
        window.versionPutEntered=true;
        await new Promise(resolve=>{ window.releaseVersionPut=resolve; });
      }
      return put(...args);
    };
    window.pendingVersion=window.MinutaOfflineCatalogDrafts.rememberVersion({
      userId:user,organizationId:org,kind:'inventory',entityId:item,
      version:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      values:{name:'Масло',sku:'M1',unit:'ml',lowStock:2,active:true}
    }).then(()=>null,error=>error.message).finally(()=>{store.put=put;});
  },{user,org,item});
  await page.waitForFunction(()=>window.versionPutEntered);
  const staleVersion=await page.evaluate(async user=>{
    await window.MinutaOfflineCatalogDrafts.clearUser(user);
    window.releaseVersionPut();
    return window.pendingVersion;
  },user);
  assert.equal(staleVersion,'catalog_session_changed');
  assert.equal(await page.evaluate(async ({user,org,item})=>
    window.MinutaOfflineCatalogDrafts.readVersion(user,org,'inventory',item),{user,org,item}),null);
  console.log('Offline catalog drafts browser passed: durable reload, scoped versions, same request replay, conflict, storage failure, sign-out races');
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
