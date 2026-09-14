import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const start = source.indexOf('async function readPortfolioPublication(');
const end = source.indexOf('async function persistPortfolioOrder(', start);
assert.ok(start > 0 && end > start);
const functions = source.slice(start, end);

function fixture({ consent=true, published=false, rpcMode='success', readPublished=published }={}) {
  const item = { id:'item', procedure_name:'Работа', body_area:'Зона', session_count:2, description:'Описание', sort_order:10, published, consent_confirmed_at:consent ? '2026-09-01T00:00:00Z' : null, updated_at:'2026-09-15T00:00:00Z' };
  const calls = [];
  const notices = [];
  let resolveRpc;
  const db = {
    rpc:async(name,args) => {
      calls.push({name,args});
      if (rpcMode === 'pending') return new Promise(resolve => { resolveRpc=resolve; });
      if (rpcMode === 'unknown') return { data:null,error:{message:'lost'} };
      return { data:{ok:true,updated_at:'2026-09-15T00:01:00Z'},error:null };
    },
    from:() => {
      const query = { select(){return query;},eq(){return query;},async maybeSingle(){return {data:{id:'item',published:readPublished,updated_at:'2026-09-15T00:01:00Z'},error:null};} };
      return query;
    }
  };
  const context = { Set,db,currentUser:{id:'owner'},sessionGeneration:1,portfolioItems:[item],portfolioPublicationPending:new Set(),requireWrites:()=>true,sessionIsCurrent:()=>true,notify:message=>notices.push(message),openPortfolioEditor:id=>calls.push({open:id}),renderPortfolio:()=>calls.push({render:true}) };
  vm.createContext(context);
  vm.runInContext(functions,context);
  return {context,item,calls,notices,resolve:result=>resolveRpc?.(result)};
}

test('publication without consent opens the existing safe editor and does not write',async()=>{
  const f=fixture({consent:false});
  await f.context.setPortfolioPublished('item',true);
  assert.equal(f.calls.some(call=>call.name),false);
  assert.deepEqual(f.calls.at(-1),{open:'item'});
  assert.match(f.notices[0],/согласие клиента/);
});

test('publication uses optimistic transactional RPC without replacing photos',async()=>{
  const f=fixture();
  await f.context.setPortfolioPublished('item',true);
  assert.equal(f.calls[0].name,'save_provider_portfolio_item');
  assert.equal(f.calls[0].args.p_expected_updated_at,'2026-09-15T00:00:00Z');
  assert.equal(Array.isArray(f.calls[0].args.p_photos),true);
  assert.equal(f.calls[0].args.p_photos.length,0);
  assert.equal(f.calls[0].args.p_item.published,true);
  assert.equal(f.item.published,true);
  assert.ok(f.calls.some(call=>call.render));
});

test('lost RPC response is accepted only after exact state readback',async()=>{
  const f=fixture({rpcMode:'unknown',readPublished:true});
  await f.context.setPortfolioPublished('item',true);
  assert.equal(f.item.published,true);
  assert.match(f.notices.at(-1),/опубликована/);
});

test('unconfirmed publication keeps local state unchanged',async()=>{
  const f=fixture({rpcMode:'unknown',readPublished:false});
  await f.context.setPortfolioPublished('item',true);
  assert.equal(f.item.published,false);
  assert.equal(f.calls.some(call=>call.render),false);
  assert.match(f.notices.at(-1),/Не удалось подтвердить/);
});

test('publication is single-flight for repeated activation',async()=>{
  const f=fixture({rpcMode:'pending'});
  const first=f.context.setPortfolioPublished('item',true);
  const second=f.context.setPortfolioPublished('item',true);
  assert.equal(f.calls.filter(call=>call.name).length,1);
  f.resolve({data:{ok:true,updated_at:'2026-09-15T00:01:00Z'},error:null});
  await Promise.all([first,second]);
});
