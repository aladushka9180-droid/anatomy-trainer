import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { edgeFixture,reply } from './payment-edge-fixture.mjs';

const smsSecret='fixture-sms-receipt-secret-with-at-least-32-bytes';
const emailSecret='fixture-email-receipt-secret-with-at-least-32-bytes';
const smsKeyId='sms-2026-09';
const environment={
  SUPABASE_URL:'https://db.fixture.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',
  NOTIFICATION_RECEIPT_SMS_KEYS:JSON.stringify({[smsKeyId]:smsSecret}),
  NOTIFICATION_RECEIPT_EMAIL_KEYS:JSON.stringify({'email-2026-09':emailSecret}),
};
const body={
  status:'delivered',channel:'sms',
  outbox_id:'11111111-1111-4111-8111-111111111111',
  event_key:'booking:receipt-fixture:sms',
  organization_id:'22222222-2222-4222-8222-222222222222',
  provider_message_id:'provider-message-42',
  delivered_at:new Date().toISOString(),receipt_source:'fixture_gateway',
};

async function signature(payload,timestamp,keyId=smsKeyId,secret=smsSecret){
  const encoder=new TextEncoder();
  const key=await webcrypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await webcrypto.subtle.sign('HMAC',key,encoder.encode(`${timestamp}.${keyId}.${JSON.stringify(payload)}`));
  return `sha256=${Buffer.from(digest).toString('hex')}`;
}

function fixture({env=environment,state='delivered',status=200}={}){
  return edgeFixture('notification-receipt/index.ts',{env,fetch:async request=>{
    assert.equal(request.url,'https://db.fixture.invalid/rest/v1/rpc/confirm_minuta_notification_delivery_v126');
    assert.equal(request.body.p_outbox,body.outbox_id);
    assert.equal(request.body.p_event_key,body.event_key);
    assert.equal(request.body.p_organization,body.organization_id);
    assert.equal(request.body.p_channel,'sms');
    assert.equal(request.body.p_provider_message_id,'provider-message-42');
    assert.equal(request.body.p_receipt_source,'fixture_gateway');
    assert.equal(request.headers.get('apikey'),'fixture-service-key');
    return reply(state,status);
  }});
}

async function signedHeaders(payload=body,timestamp=String(Math.floor(Date.now()/1000)),secret=smsSecret,keyId=smsKeyId){
  return {'x-receipt-key-id':keyId,'x-receipt-timestamp':timestamp,
    'x-receipt-signature':await signature(payload,timestamp,keyId,secret)};
}

test('receipt endpoint fails closed when channel key configuration is absent',async()=>{
  const f=fixture({env:{...environment,NOTIFICATION_RECEIPT_SMS_KEYS:''}});
  assert.equal((await f.call(body,await signedHeaders())).status,503);
  assert.equal(f.requests.length,0);
});

test('receipt endpoint fails closed for unknown key ids and cross-channel keys',async()=>{
  for(const headers of [
    await signedHeaders(body,undefined,smsSecret,'unknown-key'),
    await signedHeaders(body,undefined,emailSecret,smsKeyId),
  ]){
    const f=fixture();
    assert.equal((await f.call(body,headers)).status,401);
    assert.equal(f.requests.length,0);
  }
});

test('receipt endpoint rejects an unsafe database endpoint',async()=>{
  const f=fixture({env:{...environment,SUPABASE_URL:'http://db.fixture.invalid'}});
  assert.equal((await f.call(body,await signedHeaders())).status,503);
  assert.equal(f.requests.length,0);
});

test('receipt endpoint rejects missing, invalid and stale signatures without database access',async()=>{
  for(const headers of [{},await signedHeaders(body,String(Math.floor(Date.now()/1000)-301)),
    await signedHeaders(body,String(Math.floor(Date.now()/1000)),'different-fixture-secret-with-32-bytes')]){
    const f=fixture();
    assert.equal((await f.call(body,headers)).status,401);
    assert.equal(f.requests.length,0);
  }
});

test('receipt endpoint validates the signed semantic payload',async()=>{
  for(const invalid of [
    {...body,status:'sent'},
    {...body,outbox_id:'not-a-uuid'},
    {...body,organization_id:'not-a-uuid'},
    {...body,event_key:''},
    {...body,receipt_source:'unsafe source'},
    {...body,delivered_at:new Date(Date.now()+10*60*1000).toISOString()},
  ]){
    const f=fixture();
    assert.equal((await f.call(invalid,await signedHeaders(invalid))).status,400);
    assert.equal(f.requests.length,0);
  }
});

test('signature binds every receipt routing identity',async()=>{
  const headers=await signedHeaders(body);
  for(const changed of [
    {...body,outbox_id:'33333333-3333-4333-8333-333333333333'},
    {...body,event_key:`${body.event_key}:changed`},
    {...body,organization_id:'44444444-4444-4444-8444-444444444444'},
    {...body,channel:'email'},
    {...body,provider_message_id:'provider-message-43'},
  ]){
    const f=fixture();
    assert.equal((await f.call(changed,headers)).status,401);
    assert.equal(f.requests.length,0);
  }
});

test('valid receipt stores only normalized delivery evidence',async()=>{
  const f=fixture();
  const response=await f.call(body,await signedHeaders());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,state:'delivered'});
  assert.equal(f.requests.length,1);
  assert.equal(JSON.stringify(f.requests).includes(smsSecret),false);
});

test('receipt endpoint accepts conventional uppercase hexadecimal signatures',async()=>{
  const f=fixture();
  const headers=await signedHeaders();
  headers['x-receipt-signature']=headers['x-receipt-signature'].toUpperCase();
  assert.equal((await f.call(body,headers)).status,200);
});

test('unknown provider message and database rejection remain explicit',async()=>{
  const missing=fixture({state:'not_found'});
  assert.equal((await missing.call(body,await signedHeaders())).status,404);
  const rejected=fixture({state:{message:'private detail'},status:503});
  const response=await rejected.call(body,await signedHeaders());
  assert.equal(response.status,502);
  assert.equal(JSON.stringify(await response.json()).includes('private detail'),false);
});

test('receipt endpoint has no public capability or browser method',async()=>{
  const f=fixture();
  assert.equal((await f.call({}, {},'GET')).status,405);
  assert.equal(f.requests.length,0);
});
