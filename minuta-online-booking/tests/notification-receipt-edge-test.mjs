import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
import { edgeFixture,reply } from './payment-edge-fixture.mjs';

const receiptSecret='fixture-receipt-secret-with-at-least-32-bytes';
const environment={
  SUPABASE_URL:'https://db.fixture.invalid',
  SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',
  NOTIFICATION_RECEIPT_SECRET:receiptSecret,
};
const body={
  status:'delivered',channel:'sms',provider_message_id:'provider-message-42',
  delivered_at:new Date().toISOString(),receipt_source:'fixture_gateway',
};

async function signature(payload,timestamp,secret=receiptSecret){
  const encoder=new TextEncoder();
  const key=await webcrypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await webcrypto.subtle.sign('HMAC',key,encoder.encode(`${timestamp}.${JSON.stringify(payload)}`));
  return `sha256=${Buffer.from(digest).toString('hex')}`;
}

function fixture({env=environment,state='delivered',status=200}={}){
  return edgeFixture('notification-receipt/index.ts',{env,fetch:async request=>{
    assert.equal(request.url,'https://db.fixture.invalid/rest/v1/rpc/confirm_minuta_notification_delivery_v114');
    assert.equal(request.body.p_channel,'sms');
    assert.equal(request.body.p_provider_message_id,'provider-message-42');
    assert.equal(request.body.p_receipt_source,'fixture_gateway');
    assert.equal(request.headers.get('apikey'),'fixture-service-key');
    return reply(state,status);
  }});
}

async function signedHeaders(payload=body,timestamp=String(Math.floor(Date.now()/1000)),secret=receiptSecret){
  return {'x-receipt-timestamp':timestamp,'x-receipt-signature':await signature(payload,timestamp,secret)};
}

test('receipt endpoint fails closed when its signing secret is absent',async()=>{
  const f=fixture({env:{...environment,NOTIFICATION_RECEIPT_SECRET:''}});
  assert.equal((await f.call(body,await signedHeaders())).status,503);
  assert.equal(f.requests.length,0);
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
    {...body,channel:'whatsapp'},
    {...body,receipt_source:'unsafe source'},
    {...body,delivered_at:new Date(Date.now()+10*60*1000).toISOString()},
  ]){
    const f=fixture();
    assert.equal((await f.call(invalid,await signedHeaders(invalid))).status,400);
    assert.equal(f.requests.length,0);
  }
});

test('valid receipt stores only normalized delivery evidence',async()=>{
  const f=fixture();
  const response=await f.call(body,await signedHeaders());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,state:'delivered'});
  assert.equal(f.requests.length,1);
  assert.equal(JSON.stringify(f.requests).includes(receiptSecret),false);
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
