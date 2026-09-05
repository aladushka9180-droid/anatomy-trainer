import { CLIENT_RECORD_BUCKET,createCleanupHandler,type CleanupDependencies } from "./handler.ts";

const secret="worker-secret";
const first={id:"11111111-1111-4111-8111-111111111111",object_path:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/11111111-1111-4111-8111-111111111111.pdf"};
const second={id:"22222222-2222-4222-8222-222222222222",object_path:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/22222222-2222-4222-8222-222222222222.webp"};

function assert(value:unknown,message:string): asserts value { if(!value) throw new Error(message); }
function equal(actual:unknown,expected:unknown,message:string) { if(actual!==expected) throw new Error(`${message}: ${actual} !== ${expected}`); }
async function body(response:Response) { return await response.json() as Record<string,unknown>; }
function request(payload:unknown={},authorization=secret) {
  return new Request("https://worker.invalid",{method:"POST",headers:{"x-worker-secret":authorization,"content-type":"application/json"},body:JSON.stringify(payload)});
}
function fixture(overrides:Partial<CleanupDependencies>={}) {
  const calls={claim:0,remove:0,finish:0,bucket:"",paths:[] as string[],ids:[] as string[]};
  const dependencies:CleanupDependencies={
    workerSecret:secret,timeoutMs:100,
    claim:async()=>{calls.claim+=1;return [first,second]},
    remove:async(bucket,paths)=>{calls.remove+=1;calls.bucket=bucket;calls.paths=paths},
    finish:async id=>{calls.finish+=1;calls.ids.push(id)},
    ...overrides,
  };
  return {calls,handler:createCleanupHandler(dependencies)};
}

Deno.test("unauthorized request never reaches cleanup API",async()=>{
  const {calls,handler}=fixture();const response=await handler(request({},"wrong"));
  equal(response.status,401,"status");equal(calls.claim,0,"claim calls");equal(calls.remove,0,"remove calls");equal(calls.finish,0,"finish calls");
});

Deno.test("dry-run is default and returns only a count",async()=>{
  let execute=true,limit=0;const {calls,handler}=fixture({claim:async(value,run)=>{calls.claim+=1;limit=value;execute=run;return [first]}});
  const response=await handler(request());const data=await body(response);
  equal(response.status,200,"status");equal(execute,false,"execute");equal(limit,100,"limit");equal(data.count,1,"count");
  equal(calls.remove,0,"remove calls");equal(calls.finish,0,"finish calls");assert(!("object_path" in data),"response leaked path");
});

Deno.test("request cannot supply a deletion target",async()=>{
  const {calls,handler}=fixture();const response=await handler(request({execute:true,object_path:first.object_path}));
  equal(response.status,400,"status");equal(calls.claim,0,"claim calls");equal(calls.remove,0,"remove calls");
});

Deno.test("malformed or mismatched opaque path blocks the whole batch",async()=>{
  const {calls,handler}=fixture({claim:async()=>[{...first,object_path:"../../foreign-file"}]});
  const response=await handler(request({execute:true}));equal(response.status,502,"status");equal(calls.remove,0,"remove calls");equal(calls.finish,0,"finish calls");
  const mismatch=fixture({claim:async()=>[{...first,object_path:second.object_path}]});
  equal((await mismatch.handler(request({execute:true}))).status,502,"mismatch status");equal(mismatch.calls.remove,0,"mismatch remove");
});

Deno.test("storage failure never finishes metadata",async()=>{
  const {calls,handler}=fixture({remove:async()=>{calls.remove+=1;throw new Error("storage")}});
  const response=await handler(request({execute:true,limit:500}));const data=await body(response);
  equal(response.status,502,"status");equal(calls.remove,1,"remove calls");equal(calls.finish,0,"finish calls");equal(data.failed,2,"failed");
});

Deno.test("execute mark phase with an empty grace result removes nothing",async()=>{
  let execute=false;const {calls,handler}=fixture({claim:async(_limit,value)=>{execute=value;return []}});
  const response=await handler(request({execute:true}));const data=await body(response);
  equal(response.status,200,"status");equal(execute,true,"execute");equal(data.claimed,0,"claimed");equal(calls.remove,0,"remove calls");equal(calls.finish,0,"finish calls");
});

Deno.test("success uses fixed bucket then finishes each expired row",async()=>{
  const {calls,handler}=fixture();const response=await handler(request({execute:true,limit:2}));const data=await body(response);
  equal(response.status,200,"status");equal(calls.bucket,CLIENT_RECORD_BUCKET,"bucket");equal(calls.paths.length,2,"paths");equal(calls.finish,2,"finish calls");equal(data.finished,2,"finished");
  assert(!JSON.stringify(data).includes(first.id),"response leaked id");assert(!JSON.stringify(data).includes(first.object_path),"response leaked path");
});

Deno.test("finish failure remains retryable on the next claim",async()=>{
  let finishAttempts=0;const {calls,handler}=fixture({finish:async()=>{calls.finish+=1;finishAttempts+=1;if(finishAttempts===1)throw new Error("db")},claim:async()=>[first]});
  const firstResponse=await handler(request({execute:true}));equal(firstResponse.status,207,"first status");
  const secondResponse=await handler(request({execute:true}));equal(secondResponse.status,200,"second status");
  equal(calls.remove,2,"storage retried");equal(calls.finish,2,"finish retried");
});

Deno.test("hung APIs are aborted by a bounded timeout",async()=>{
  let aborted=false;const {calls,handler}=fixture({timeoutMs:50,claim:(_limit,_execute,signal)=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>{aborted=true;reject(signal.reason)},{once:true}))});
  const started=Date.now();const response=await handler(request());const elapsed=Date.now()-started;
  equal(response.status,504,"status");assert(aborted,"signal was not aborted");assert(elapsed<500,"timeout was not bounded");equal(calls.remove,0,"remove calls");
});

Deno.test("hung Storage call is bounded and never finishes metadata",async()=>{
  let aborted=false;const {calls,handler}=fixture({timeoutMs:50,remove:(_bucket,_paths,signal)=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>{aborted=true;reject(signal.reason)},{once:true}))});
  const response=await handler(request({execute:true}));equal(response.status,504,"status");assert(aborted,"storage signal was not aborted");equal(calls.finish,0,"finish calls");
});
