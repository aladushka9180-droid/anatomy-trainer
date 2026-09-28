import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../primetime-handoff.js', import.meta.url), 'utf8');
const target = 'https://primetime-booking.primetime-booking-ru.workers.dev/for-masters';
const state = 'a'.repeat(64), ticket = 'b'.repeat(64);
async function simulate(search = '', options = {}) {
  const result = { destinations:[], calls:[], notices:[], cleaned:[], events:{} };
  const label = { textContent:'' };
  const button = { disabled:false, setAttribute(){}, querySelector:()=>label, addEventListener:(name,fn)=>{result.events[name]=fn;} };
  runInNewContext(source, {
    URL, URLSearchParams, console:{error(){}}, notify:message=>result.notices.push(message),
    document:{getElementById:()=>button},
    window:{location:{search,href:`https://pro.test/provider.html${search}`,assign:url=>result.destinations.push(url)},history:{replaceState:(_a,_b,url)=>result.cleaned.push(url)}},
    db:{auth:{getSession:async()=>({data:{session:options.signedOut?null:{user:{id:'synthetic'}}},error:options.sessionError}),onAuthStateChange:()=>{}},rpc:async(name,args)=>{result.calls.push({name,args});return {data:{ticket:options.ticket??ticket},error:options.rpcError};}}
  });
  await new Promise(setImmediate);
  return result;
}
test('profile action starts on the active Worker', async()=>{
  const result=await simulate();
  result.events.click();
  assert.deepEqual(result.destinations,[`${target}/start`]);
  assert.equal(result.calls.length,0);
});
test('valid handoff returns only to the Worker and removes state from Pro URL',async()=>{
  const result=await simulate(`?primetime_return=${state}&return_to=https://untrusted.test/steal`);
  assert.deepEqual(result.destinations,[`${target}#handoff=${ticket}`]);
  assert.equal(result.calls.length,1);
  assert.equal(result.calls[0].name,'create_primetime_handoff');
  assert.equal(result.calls[0].args.p_state,state);
  assert.ok(result.cleaned.every(url=>!url.includes('primetime_return')));
});
test('missing or malformed state cannot create a handoff',async()=>{
  for(const value of ['', 'a'.repeat(63), 'g'.repeat(64), 'https://untrusted.test/']){
    const result=await simulate(`?primetime_return=${encodeURIComponent(value)}`);
    assert.equal(result.calls.length,0);
    assert.equal(result.destinations.length,0);
  }
});
test('signed-out sessions cannot create a ticket',async()=>{
  const result=await simulate(`?primetime_return=${state}`,{signedOut:true});
  assert.equal(result.calls.length,0);
  assert.equal(result.destinations.length,0);
});
test('invalid tickets and backend failures never redirect',async()=>{
  for(const options of [{ticket:'invalid'},{rpcError:new Error('synthetic failure')},{sessionError:new Error('synthetic failure')}]){
    const result=await simulate(`?primetime_return=${state}`,options);
    assert.equal(result.destinations.length,0);
    assert.equal(result.notices.length,1);
  }
});
