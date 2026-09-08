import assert from 'node:assert/strict';
import test from 'node:test';
import { edgeFixture,id,reply } from './payment-edge-fixture.mjs';

const secret='fixture-dispatcher-secret-not-a-real-secret';
const env={SUPABASE_URL:'https://db.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-key',NOTIFICATION_DISPATCHER_SECRET:secret,TELEGRAM_BOT_TOKEN:'fixture-token'};
const job={outbox_id:id(1),lock_token:id(2),event_key:'fixture-event',organization_id:id(3),performer_id:id(4),booking_id:id(5),kind:'booking_confirmed',channel:'telegram',audience:'client',attempt_no:1,destination:{chat_id:'fixture-recipient'},message_payload:{service_name:'Fixture',booking_date:'2099-09-09',booking_time:'14:00:00'}};
function fixture({environment=env,mode='accepted',jobs=[job]}={}){
  return edgeFixture('notification-dispatcher/index.ts',{env:environment,fetch:async r=>{
    const url=new URL(r.url);
    if(url.hostname==='api.telegram.org'){if(mode==='unknown')throw new TypeError('fixture ambiguous timeout');if(mode==='blocked')return reply({ok:false,error_code:403},403);return reply({ok:true,result:{message_id:42}});}
    assert.equal(url.hostname,'db.fixture.invalid');
    const name=url.pathname.split('/').at(-1);
    if(name==='enqueue_due_minuta_booking_reminders'||name==='enqueue_due_minuta_booking_confirmation_requests_v126')return reply(0);
    if(name==='claim_minuta_notification_outbox')return reply(jobs);
    if(name==='claim_minuta_notification_test_outbox_v128')return reply(jobs);
    if(name==='ack_minuta_notification_outbox_v114'&&mode==='ack-failed')return reply({message:'fixture failed'},503);
    if(name==='fail_minuta_notification_test_outbox_v128')return reply('failed');
    if(name==='fail_notification_outbox')return reply('failed');
    return reply('sent');
  }});
}
test('public dispatcher GET exposes capability only and never claims or delivers',async()=>{
  const f=fixture();const response=await f.call({}, {},'GET');assert.equal(response.status,200);assert.equal(f.requests.length,0);const body=await response.json();assert.deepEqual(body.configured_channels,['telegram']);assert.equal(JSON.stringify(body).includes(secret),false);
});
test('unauthorized dispatcher never enqueues, claims, or delivers',async()=>{
  const f=fixture();assert.equal((await f.call()).status,401);assert.equal(f.requests.length,0);
});
test('configured dry-run without activation performs no RPC or delivery',async()=>{
  const f=fixture();const response=await f.call({dry_run:true},{'x-worker-secret':secret});assert.equal(response.status,200);assert.equal((await response.json()).claimed,0);assert.equal(f.requests.length,0);
});
test('no channels means no claim',async()=>{
  const f=fixture({environment:{...env,TELEGRAM_BOT_TOKEN:''}});assert.equal((await f.call({},{'x-worker-secret':secret})).status,503);assert.equal(f.requests.length,0);
});
test('accepted Telegram message is sent, not delivered',async()=>{
  const f=fixture();const response=await f.call({},{'x-worker-secret':secret});const result=await response.json();assert.equal(result.sent,1);
  const ack=f.requests.find(r=>r.url.endsWith('/ack_minuta_notification_outbox_v114'));assert.equal(ack.body.p_delivery_state,'sent');assert.equal(ack.body.p_delivered_at,null);assert.equal(ack.body.p_receipt_source,null);
});
test('ambiguous Telegram response requests no automatic retry',async()=>{
  const f=fixture({mode:'unknown'});const response=await f.call({},{'x-worker-secret':secret});assert.equal((await response.json()).sent,0);
  const failure=f.requests.find(r=>r.url.endsWith('/fail_notification_outbox'));assert.equal(failure.body.p_error_code,'telegram_delivery_unknown');assert.equal(failure.body.p_retryable,false);assert.equal(f.requests.some(r=>r.url.endsWith('/ack_minuta_notification_outbox_v114')),false);
});
test('accepted Telegram but failed database acknowledgement retains uncertain lease',async()=>{
  const f=fixture({mode:'ack-failed'});const response=await f.call({},{'x-worker-secret':secret});const result=await response.json();assert.equal(result.sent,0);assert.equal(result.failed,1);assert.equal(f.requests.some(r=>r.url.endsWith('/fail_notification_outbox')),false);
});
test('missing client endpoint never sends to a fallback recipient',async()=>{
  const f=fixture({jobs:[{...job,destination:null}]});const response=await f.call({},{'x-worker-secret':secret});assert.equal((await response.json()).sent,0);assert.equal(f.requests.some(r=>r.url.includes('api.telegram.org')),false);
});
test('scoped test claims exactly one event and skips both schedulers',async()=>{
  const f=fixture();
  const response=await f.call({channels:['telegram'],limit:1,skip_schedulers:true,test_scope:{organization_id:job.organization_id,event_key:job.event_key}},{'x-worker-secret':secret});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.test_mode,true);assert.equal(result.schedulers_skipped,true);assert.equal(result.claimed,1);assert.equal(result.sent,1);
  assert.equal(f.requests.some(r=>r.url.includes('/enqueue_due_minuta_')),false);assert.equal(f.requests.some(r=>r.url.endsWith('/claim_minuta_notification_outbox')),false);
  const claim=f.requests.find(r=>r.url.endsWith('/claim_minuta_notification_test_outbox_v128'));assert.deepEqual(claim.body,{p_organization:job.organization_id,p_event_key:job.event_key,p_channel:'telegram'});
});
test('scoped test rejects incomplete or broad scopes before any RPC',async()=>{
  for(const body of [
    {channels:['telegram'],test_scope:{organization_id:job.organization_id,event_key:job.event_key}},
    {channels:['telegram','sms'],limit:1,skip_schedulers:true,test_scope:{organization_id:job.organization_id,event_key:job.event_key}},
    {channels:['telegram'],limit:2,skip_schedulers:true,test_scope:{organization_id:job.organization_id,event_key:job.event_key}},
    {channels:['telegram'],limit:1,skip_schedulers:true,test_scope:{organization_id:job.organization_id,event_key:''}},
  ]){const f=fixture();const response=await f.call(body,{'x-worker-secret':secret});assert.equal(response.status,400);assert.equal(f.requests.length,0);}
});
test('scoped test fails closed when the exact claim is absent or mismatched',async()=>{
  for(const jobs of [[],[{...job,event_key:'other-event'}]]){
    const f=fixture({jobs});const response=await f.call({channels:['telegram'],limit:1,skip_schedulers:true,test_scope:{organization_id:job.organization_id,event_key:job.event_key}},{'x-worker-secret':secret});
    assert.equal(response.status,502);assert.equal((await response.json()).error,'claim_failed');assert.equal(f.requests.some(r=>r.url.includes('api.telegram.org')),false);
  }
});
test('scoped test failure is terminal and cannot create a normal fallback',async()=>{
  const f=fixture({mode:'blocked'});const response=await f.call({channels:['telegram'],limit:1,skip_schedulers:true,test_scope:{organization_id:job.organization_id,event_key:job.event_key}},{'x-worker-secret':secret});
  assert.equal(response.status,207);assert.equal((await response.json()).failed,1);assert.equal(f.requests.some(r=>r.url.endsWith('/fail_notification_outbox')),false);
  const failure=f.requests.find(r=>r.url.endsWith('/fail_minuta_notification_test_outbox_v128'));assert.equal(failure.body.p_outbox,job.outbox_id);assert.equal(failure.body.p_event_key,job.event_key);assert.equal(failure.body.p_organization,job.organization_id);assert.equal(failure.body.p_channel,job.channel);
  assert.equal(f.requests.some(r=>r.url.endsWith('/deactivate_minuta_notification_endpoint_v114')),false);
});
for(const receipt of [false,true])test(`gateway delivered requires receipt evidence=${receipt}`,async()=>{
  const f=edgeFixture('notification-dispatcher/adapters.ts',{fetch:async()=>reply({id:'fixture-mail',delivery_status:'delivered',...(receipt?{delivered_at:'2026-09-08T10:00:00Z',receipt_source:'gateway_webhook'}:{})})});
  const result=await f.exported.deliverNotification({...job,channel:'email',destination:{email:'fixture@example.invalid'}},{email:{url:'https://gateway.fixture.invalid/send',token:'fixture-token'}});
  assert.equal(result.ok,true);assert.equal(result.deliveryState,receipt?'delivered':'sent');assert.equal(f.requests[0].headers.get('idempotency-key'),job.event_key);
  assert.equal(f.requests[0].body.outbox_id,job.outbox_id);assert.equal(f.requests[0].body.event_key,job.event_key);
  assert.deepEqual(f.requests[0].body.metadata,{outbox_id:job.outbox_id,event_key:job.event_key,organization_id:job.organization_id,booking_id:job.booking_id});
});
