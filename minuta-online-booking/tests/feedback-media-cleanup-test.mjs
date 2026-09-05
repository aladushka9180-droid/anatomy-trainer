import assert from 'node:assert/strict';
import test from 'node:test';
import {cleanupFeedbackMedia} from '../scripts/feedback-media-cleanup.mjs';
const uuid='00000000-0000-4000-8000-000000000001',path=`${uuid}/${uuid}/${uuid}.webp`;
const config={baseUrl:'https://testprojectreference.supabase.co/',expectedProjectRef:'testprojectreference',serviceKey:'SYNTHETIC'};
function fixture({claim=[{path,token:uuid}],probe=404,finish=true,remove=200}={}){
  const calls=[];return {calls,fetchImpl:async(url,options)=>{const route=new URL(url).pathname;calls.push({route,options});
    if(route.endsWith('claim_minuta_feedback_cleanup_v116'))return Response.json(claim);
    if(route.endsWith('finish_minuta_feedback_cleanup_v116'))return Response.json(finish);
    if(options.method==='DELETE')return new Response('',{status:remove});
    if(route.includes('/storage/'))return new Response('',{status:probe});
    return Response.json([{state:'reserved'}]);}};
}
test('preview never claims or deletes',async()=>{const f=fixture();assert.equal((await cleanupFeedbackMedia({...config,...f})).deleted,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,undefined);});
test('delete only exact claimed path and finalize only after absence',async()=>{const f=fixture();assert.deepEqual(await cleanupFeedbackMedia({...config,...f,apply:true}),{mode:'apply',claimed:1,deleted:1,failed:0});assert.equal(JSON.parse(f.calls[1].options.body).prefixes[0],path);assert.ok(f.calls[2].route.includes('/object/authenticated/'));assert.ok(f.calls[3].route.endsWith('finish_minuta_feedback_cleanup_v116'));});
for(const probe of [200,403,500])test(`probe ${probe} cannot finalize deletion`,async()=>{const f=fixture({probe});assert.equal((await cleanupFeedbackMedia({...config,...f,apply:true})).failed,1);assert.ok(!f.calls.some(c=>c.route.endsWith('finish_minuta_feedback_cleanup_v116')));});
test('malformed or broad path stops before Storage writes',async()=>{const f=fixture({claim:[{path:'../',token:uuid}]});await assert.rejects(cleanupFeedbackMedia({...config,...f,apply:true}),/invalid_cleanup_claim/);assert.equal(f.calls.length,1);});
test('wrong project is rejected without any request',async()=>{const f=fixture();await assert.rejects(cleanupFeedbackMedia({...config,...f,expectedProjectRef:'differentproject',apply:true}),/invalid_cleanup_configuration/);assert.equal(f.calls.length,0);});
test('invalid final ACK is not reported as deletion success',async()=>{const f=fixture({finish:null});assert.equal((await cleanupFeedbackMedia({...config,...f,apply:true})).deleted,0);});
test('duplicate claims fail before any Storage request',async()=>{const f=fixture({claim:[{path,token:uuid},{path,token:uuid}]});await assert.rejects(cleanupFeedbackMedia({...config,...f,apply:true}),/invalid_cleanup_claim/);assert.equal(f.calls.length,1);});
test('already absent DELETE still requires an independent absence check',async()=>{const f=fixture({remove:404});assert.equal((await cleanupFeedbackMedia({...config,...f,apply:true})).deleted,1);assert.equal(f.calls.length,4);});
test('DELETE error never probes or finalizes',async()=>{const f=fixture({remove:500});assert.equal((await cleanupFeedbackMedia({...config,...f,apply:true})).failed,1);assert.equal(f.calls.length,2);});
test('absence-probe network rejection cannot finish a lease',async()=>{const f=fixture(),original=f.fetchImpl;f.fetchImpl=(url,options)=>new URL(url).pathname.includes('/object/authenticated/')?Promise.reject(Error('network')):original(url,options);assert.equal((await cleanupFeedbackMedia({...config,...f,apply:true})).failed,1);assert.ok(!f.calls.some(c=>c.route.endsWith('finish_minuta_feedback_cleanup_v116')));});
test('explicit Storage NotFound body permits finish, not a generic error',async()=>{const f=fixture(),original=f.fetchImpl;f.fetchImpl=(url,options)=>new URL(url).pathname.includes('/object/authenticated/')?Promise.resolve(Response.json({statusCode:'404',error:'NotFound'},{status:400})):original(url,options);assert.equal((await cleanupFeedbackMedia({...config,...f,apply:true})).deleted,1);});
test('stale lease false ACK is failed even when bytes are absent',async()=>{const f=fixture({finish:false});assert.deepEqual(await cleanupFeedbackMedia({...config,...f,apply:true}),{mode:'apply',claimed:1,deleted:0,failed:1});});
