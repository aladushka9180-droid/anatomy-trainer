// Executes repository Edge modules, stripping TypeScript syntax only. All I/O
// is supplied by the test: no Deno env access, real JWT, provider or database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

// tests/ is inside minuta-online-booking: Edge functions live at repository root.
const functionsRoot=path.resolve(fileURLToPath(new URL('../../supabase/functions/',import.meta.url)));
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
export function edgeFixture(entry,{env={},fetch:transport}={}){
  let handler;
  const requests=[];
  const box=vm.createContext({URL,Request,Response,Headers,TextEncoder,TextDecoder,AbortSignal,Uint8Array,crypto:webcrypto,btoa,atob,console,
    Deno:{env:{get:key=>env[key]},serve:callback=>{handler=callback;}},
    fetch:async(url,init={})=>{const request={url:String(url),method:init.method||'GET',headers:new Headers(init.headers),body:init.body?JSON.parse(init.body):null};requests.push(request);assert.ok(transport,'No real network is allowed');return transport(request);}
  });
  const modules=new Map();
  function load(filename){
    if(modules.has(filename))return modules.get(filename);
    assert.ok(filename.startsWith(functionsRoot+path.sep),'Only repository Edge modules');
    let code=stripTypeScriptTypes(readFileSync(filename,'utf8'),{mode:'strip'});
    const dependencies=[];
    code=code.replace(/import\s+\{([\s\S]*?)\}\s+from\s+["']([^"']+)["'];?/g,(_all,names,relative)=>{
      assert.ok(relative.startsWith('.'),'No external dependency imports');
      const index=dependencies.push(load(path.resolve(path.dirname(filename),relative)))-1;
      return `const {${names.replace(/\bas\b/g,':')}}=__dependencies[${index}];`;
    }).replace(/import\s+["']jsr:@supabase\/functions-js\/edge-runtime\.d\.ts["'];?/g,'');
    const exports=[...code.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/g)].map(match=>match[1]);
    code=code.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let))/g,'');
    const factory=vm.runInContext(`(function(__dependencies){${code}\nreturn {${exports.join(',')}};})`,box,{filename});
    const result=factory(dependencies);modules.set(filename,result);return result;
  }
  const exported=load(path.resolve(functionsRoot,entry));
  return{requests,exported,call:async(body={},headers={},method='POST')=>{
    assert.equal(typeof handler,'function');
    return handler(new Request('https://edge.fixture.invalid/function',{method,headers:{'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})}));
  }};
}
