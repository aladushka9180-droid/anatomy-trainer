import assert from 'node:assert/strict';
import test from 'node:test';
import { edgeFixture,id,reply } from './payment-edge-fixture.mjs';

const organization=id(1),booking=id(2),attempt=id(3),request=id(4),refund=id(5),actor=id(6);
const env={SUPABASE_URL:'https://db.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',SUPABASE_ANON_KEY:'fixture-anon',YOOKASSA_ORGANIZATION_ID:organization,YOOKASSA_TEST_SHOP_ID:'test-shop',YOOKASSA_TEST_SECRET_KEY:'test-key',YOOKASSA_SHOP_ID:'production-shop',YOOKASSA_SECRET_KEY:'production-key',YOOKASSA_RETURN_URL:'https://return.fixture.invalid',PAYMENT_WEBHOOK_ADAPTER:'yookassa-v1'};
const paymentPrepared={mode:'yookassa',enabled:true,attempt_id:attempt,organization_id:organization,booking_id:booking,idempotency_key:request,amount_minor:15000,currency:'RUB',environment:'test',status:'creating'};
const refundPrepared={refund_id:refund,organization_id:organization,attempt_id:attempt,request_id:request,amount_minor:1000,currency:'RUB',environment:'test',status:'creating',provider_payment_id:'payment-1'};
const payment={id:'payment-1',status:'pending',amount:{value:'150.00',currency:'RUB'},test:true,confirmation:{confirmation_url:'https://pay.fixture.invalid'},metadata:{minuta_organization_id:organization,minuta_booking_id:booking,minuta_attempt_id:attempt,minuta_environment:'test'}};
const refundResponse={id:'refund-1',status:'succeeded',payment_id:'payment-1',amount:{value:'10.00',currency:'RUB'},metadata:{minuta_refund_id:refund,minuta_attempt_id:attempt,minuta_organization_id:organization,minuta_environment:'test'}};
function fixture(entry,{prepared=paymentPrepared,provider=payment,providerStatus=200,rpcFailure='',network=false,environment=env}={}){
  return edgeFixture(entry,{env:environment,fetch:async r=>{
    const url=new URL(r.url);
    if(url.hostname==='api.yookassa.ru'){if(network)throw new TypeError('fixture network interruption');return reply(provider,providerStatus);}
    assert.equal(url.hostname,'db.fixture.invalid');
    if(url.pathname==='/auth/v1/user')return reply({id:actor});
    const name=url.pathname.split('/').at(-1);
    if(name===rpcFailure)return reply({message:'fixture rejected'},503);
    if(name.startsWith('prepare_yookassa_'))return reply(prepared);
    return reply({ok:true,accepted:true});
  }});
}
const rpcCalls=f=>f.requests.filter(r=>r.url.includes('/rpc/'));
const providerCalls=f=>f.requests.filter(r=>r.url.includes('api.yookassa.ru'));

test('test-mode creation uses only test credentials and stable request id across retry',async()=>{
  const f=fixture('yookassa-create-payment/index.ts');
  for(let n=0;n<2;n++){const response=await f.call({manage_token:booking,request_id:request});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);}
  assert.equal(providerCalls(f).length,2);
  for(const r of providerCalls(f)){assert.equal(r.method,'POST');assert.equal(r.headers.get('idempotence-key'),request);assert.equal(r.headers.get('authorization'),`Basic ${btoa('test-shop:test-key')}`);assert.equal(r.body.metadata.minuta_environment,'test');}
});
for(const [name,provider] of [['live object in test',{...payment,test:false}],['wrong amount',{...payment,amount:{value:'151.00',currency:'RUB'}}],['foreign tenant',{...payment,metadata:{...payment.metadata,minuta_organization_id:id(90)}}]])test(`payment refuses ${name} without completing ledger`,async()=>{
  const f=fixture('yookassa-create-payment/index.ts',{provider});const response=await f.call({manage_token:booking,request_id:request});assert.ok(response.status>=400);assert.equal(rpcCalls(f).some(r=>r.url.endsWith('/complete_yookassa_payment_creation')),false);
});
test('tenant credential mismatch never calls payment provider',async()=>{
  const f=fixture('yookassa-create-payment/index.ts',{environment:{...env,YOOKASSA_ORGANIZATION_ID:id(99)}});
  assert.ok((await f.call({manage_token:booking,request_id:request})).status>=400);assert.equal(providerCalls(f).length,0);
});
test('already created pending payment returns existing link without another provider POST',async()=>{
  const f=fixture('yookassa-create-payment/index.ts',{prepared:{...paymentPrepared,status:'pending',provider_payment_id:'payment-1',confirmation_url:'https://pay.fixture.invalid'}});
  assert.equal((await f.call({manage_token:booking,request_id:request})).status,200);assert.equal(providerCalls(f).length,0);
});
for(const network of [true,false])test(`refund ${network?'network loss':'provider 500'} stays non-definitive and same-key retry`,async()=>{
  const f=fixture('yookassa-refund/index.ts',{prepared:refundPrepared,provider:{code:'internal_server_error'},providerStatus:500,network});
  for(let n=0;n<2;n++)assert.ok((await f.call({organization_id:organization,attempt_id:attempt,request_id:request,amount_minor:1000,reason:'Fixture refund reason'},{authorization:'Bearer fixture-token'})).status>=400);
  const fails=rpcCalls(f).filter(r=>r.url.endsWith('/fail_yookassa_refund'));assert.equal(fails.length,2);assert.ok(fails.every(r=>r.body.p_definitive===false));
  assert.deepEqual(providerCalls(f).map(r=>r.headers.get('idempotence-key')),[request,request]);
});
test('pending refund reconciles with canonical GET, never a second refund POST',async()=>{
  const f=fixture('yookassa-refund/index.ts',{prepared:{...refundPrepared,status:'pending',provider_refund_id:'refund-1'},provider:refundResponse});
  const response=await f.call({organization_id:organization,attempt_id:attempt,request_id:request,amount_minor:1000,reason:'Fixture refund reason'},{authorization:'Bearer fixture-token'});
  assert.equal(response.status,200);assert.deepEqual(providerCalls(f).map(r=>r.method),['GET']);assert.ok(rpcCalls(f).some(r=>r.url.endsWith('/complete_yookassa_refund')));
});
test('refund without authenticated actor never reaches preparation or provider',async()=>{
  const f=fixture('yookassa-refund/index.ts',{prepared:refundPrepared,provider:refundResponse});assert.ok((await f.call({})).status>=400);assert.equal(f.requests.length,0);
});
test('refund provider success with failed ledger acknowledgement is not reported succeeded',async()=>{
  const f=fixture('yookassa-refund/index.ts',{prepared:refundPrepared,provider:refundResponse,rpcFailure:'complete_yookassa_refund'});
  const response=await f.call({organization_id:organization,attempt_id:attempt,request_id:request,amount_minor:1000,reason:'Fixture refund reason'},{authorization:'Bearer fixture-token'});
  assert.ok(response.status>=400);assert.equal(rpcCalls(f).find(r=>r.url.endsWith('/fail_yookassa_refund')).body.p_definitive,false);
});
for(const variant of ['canonical','foreign','live','unavailable'])test(`webhook ${variant} requires authenticated canonical data before ledger write`,async()=>{
  const canonical={...payment,status:'succeeded',...(variant==='foreign'?{metadata:{...payment.metadata,minuta_attempt_id:id(91)}}:{}),...(variant==='live'?{test:false}:{})};
  const f=fixture('payment-webhook/index.ts',{provider:canonical,network:variant==='unavailable'});
  const response=await f.call({type:'notification',event:'payment.succeeded',object:{...payment,status:'succeeded'}});
  assert.equal(providerCalls(f)[0].method,'GET');assert.equal(providerCalls(f)[0].headers.get('authorization'),`Basic ${btoa('test-shop:test-key')}`);
  const writes=rpcCalls(f).filter(r=>r.url.endsWith('/process_yookassa_payment_event'));
  if(variant==='canonical'){assert.equal(response.status,200);assert.equal(writes.length,1);}else{assert.ok(response.status>=400);assert.equal(writes.length,0);}
});
test('replayed webhook preserves canonical object event key for SQL idempotency',async()=>{
  const f=fixture('payment-webhook/index.ts',{provider:{...payment,status:'succeeded'}});
  for(let i=0;i<2;i++)assert.equal((await f.call({type:'notification',event:'payment.succeeded',object:payment})).status,200);
  const events=rpcCalls(f).filter(r=>r.url.endsWith('/process_yookassa_payment_event'));
  assert.deepEqual(events.map(r=>r.body.p_event_key),['payment.succeeded:payment-1','payment.succeeded:payment-1']);
  assert.equal(events[0].body.p_payload_sha256,events[1].body.p_payload_sha256);
});
