// Actual SQL, Edge modules and native DOM; core/Auth/provider are synthetic.
// Requires an explicitly admitted EMPTY database. No provider network is allowed.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {edgeFixture,id,reply} from './payment-edge-fixture.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=resolve(root,'..');
assert.equal(process.env.PAYMENT_AUDIT_ISOLATED_FIXTURE,'true','Explicit synthetic fixture admission required');
const url=new URL(process.env.PAYMENT_AUDIT_DATABASE_URL);
assert.ok(['127.0.0.1','localhost'].includes(url.hostname),'Loopback only');
assert.match(url.pathname,/^\/payment_audit_fixes(?:_[a-z0-9]+)?$/,'Dedicated fixture database only');
const pg=await import(process.env.MINUTA_PG_MODULE?pathToFileURL(process.env.MINUTA_PG_MODULE).href:'pg');
const {chromium}=await import(process.env.MINUTA_PLAYWRIGHT_MODULE?pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href:'playwright');
const Client=pg.default.Client,Pool=pg.default.Pool;
const client=new Client({connectionString:url.href}),pool=new Pool({connectionString:url.href,max:4});
const evidence={scope:'Synthetic prerequisites/Auth/provider; actual repository SQL/Edge/controller, native PostgreSQL and Chromium; no external operations',checks:[]};
let browser;
const v87=readFileSync(resolve(root,'supabase-migration-v87.sql'),'utf8').replaceAll('\r\n','\n');
const v142=readFileSync(resolve(root,'supabase-migration-v142.sql'),'utf8').replaceAll('\r\n','\n');
const v144=readFileSync(resolve(root,'supabase-migration-v144-payment-connectors.sql'),'utf8').replaceAll('\r\n','\n');
function table(sql,name){const start=sql.indexOf('create table if not exists public.'+name);assert.ok(start>=0,name);return sql.slice(start,sql.indexOf('\n);',start)+4);}
function fn(sql,name){const start=sql.indexOf('create or replace function public.'+name+'(');assert.ok(start>=0,name);const match=/\bend\s*\$\$;/g;match.lastIndex=start;const end=match.exec(sql);assert.ok(end,name);return sql.slice(start,end.index+end[0].length);}
const migrationName=readdirSync(resolve(repo,'supabase/migrations')).find(n=>n.endsWith('_payment_audit_fixes.sql'));
const migration=readFileSync(resolve(repo,'supabase/migrations',migrationName),'utf8');
const rollback=readFileSync(resolve(repo,'supabase/rollback/payment_audit_fixes.sql'),'utf8');
const org=id(1),actor=id(2),admin=id(3),foreign=id(4),service=id(5),booking=id(6),token=id(7),request=id(8);
async function check(label,action){await action();evidence.checks.push(label);console.log('PASS '+label);}
async function value(sql,args=[]){return (await client.query(sql,args)).rows[0].value;}
async function denied(sql,args,code){let failure;try{await client.query(sql,args);}catch(e){failure=e;await client.query('rollback');}assert.equal(failure?.code,code);}
try {
  await client.connect();
  assert.equal((await client.query("select count(*)::int n from pg_tables where schemaname in ('public','auth')")).rows[0].n,0,'Refuse a populated database');
  await client.query(`create schema auth; create schema extensions; create extension pgcrypto with schema extensions;
    do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text);
    create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean);
    create table public.services(id uuid primary key,name text);
    create table public.bookings(id uuid primary key,organization_id uuid,service_id uuid,client_phone text,performer_id uuid,manage_token uuid,
      status text default 'confirmed',deposit_amount_rub integer default 100,payment_status text default 'pending',
      payment_url text,payment_due_at timestamptz,refund_status text default 'not_required',booking_code text default 'FIXTURE',unique(id,organization_id));
    create table public.payments(id uuid primary key default gen_random_uuid(),booking_id uuid,performer_id uuid,provider text,provider_operation_id text,
      amount_minor bigint,currency text,status text,provider_created_at timestamptz,last_event_at timestamptz,unique(provider,provider_operation_id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('audit.actor',true),'')::uuid $$;
    create function public.has_organization_role(p_org uuid,p_roles text[]) returns boolean language sql stable as $$
      select exists(select 1 from public.organization_memberships where organization_id=p_org and user_id=auth.uid() and active and role=any(p_roles)) $$;
  `);
  const functions=[...v87.matchAll(/create or replace function public\.(\w+)\(/g)].map(m=>m[1]);
  const tables=['organization_payment_provider_settings','payment_provider_attempts','payment_provider_refunds','payment_provider_events','payment_provider_reconciliations','payment_provider_audit_log'];
  const policies=v87.slice(v87.indexOf('alter table public.organization_payment_provider_settings enable row level security;'),v87.indexOf('create or replace function public.require_minuta_payment_role('));
  const grants=v87.slice(v87.lastIndexOf('do $$ declare v_signature regprocedure;'),v87.lastIndexOf('commit;'));
  await client.query(tables.map(n=>table(v87,n)).join('\n')+'\n'+functions.map(n=>fn(v87,n)).join('\n')+'\n'+policies+'\n'+grants
    +'\n'+[...v87.matchAll(/create (?:unique )?index if not exists [\s\S]*?;/g)].map(m=>m[0]).join('\n')
    +'\n'+table(v142,'integration_connections_v142')+'\n'+fn(v142,'require_minuta_integration_owner_v142')+'\n'+fn(v142,'configure_minuta_integration_connection_v142')
    +'\n'+table(v144,'integration_provider_events_v144')+'\n'+fn(v144,'get_minuta_provider_connector_read_model_v144'));
  await client.query('insert into auth.users values ($1),($2),($3)',[actor,admin,foreign]);
  await client.query("insert into public.organizations values ($1,'active')",[org]);
  await client.query("insert into public.organization_memberships values ($1,$2,'owner',true),($1,$3,'admin',true)",[org,actor,admin]);
  await client.query("insert into public.services values ($1,'Synthetic service')",[service]);
  await client.query("insert into public.bookings(id,organization_id,service_id,client_phone,performer_id,manage_token) values ($1,$2,$3,'70000000001',$4,$5)",[booking,org,service,actor,token]);
  await client.query("select set_config('audit.actor',$1,false)",[actor]);
  const legacyAttempt=id(9),legacyRefund=id(10);
  await client.query("insert into public.payment_provider_attempts(id,organization_id,booking_id,environment,idempotency_key,amount_minor,status,provider_payment_id,captured_amount_minor) values($1,$2,$3,'test',$1,10000,'succeeded','legacy-payment',10000)",[legacyAttempt,org,booking]);
  await client.query("insert into public.payment_provider_refunds(id,organization_id,attempt_id,request_id,amount_minor,reason,requested_by,created_at) values($1,$2,$3,$1,1000,'Legacy uncertain refund',$4,now()-interval '25 hours')",[legacyRefund,org,legacyAttempt,actor]);
  const beforeAcl=await client.query("select oid::regprocedure::text signature,proacl::text acl from pg_proc where proname in ('get_minuta_payment_workspace','prepare_yookassa_payment','prepare_yookassa_refund') order by 1");
  await client.query(migration);
  await check('Migration preserves existing RPC permissions and closes dispatch to public clients',async()=>{
    assert.deepEqual((await client.query("select oid::regprocedure::text signature,proacl::text acl from pg_proc where proname in ('get_minuta_payment_workspace','prepare_yookassa_payment','prepare_yookassa_refund') order by 1")).rows,beforeAcl.rows);
    for(const role of ['anon','authenticated'])assert.equal(await value("select has_function_privilege($1,'public.claim_yookassa_refund_dispatch(uuid,uuid,uuid)','EXECUTE') value",[role]),false);
    assert.equal(await value("select has_function_privilege('service_role','public.claim_yookassa_refund_dispatch(uuid,uuid,uuid)','EXECUTE') value"),true);
  });
  await check('Legacy unknown dispatch retains a conservative timestamp and cannot POST again',async()=>{
    const r=await value('select public.claim_yookassa_refund_dispatch($1,$1,$2) value',[legacyRefund,actor]);assert.equal(r.allowed,false);
    assert.equal((await client.query('select first_provider_request_at=created_at same from public.payment_provider_refunds where id=$1',[legacyRefund])).rows[0].same,true);
  });
  await denied('select public.claim_yookassa_refund_dispatch($1,$2,$3)',[legacyRefund,id(999),actor],'55000');
  await denied('select public.claim_yookassa_refund_dispatch($1,$1,$2)',[legacyRefund,foreign],'42501');
  await client.query("select public.set_minuta_yookassa_settings($1,true,'test',false,null,null,null)",[org]);
  // A fresh booking drives actual prepare/complete/webhook SQL via actual Edge code.
  const paidBooking=id(20),paidToken=id(21);await client.query("insert into public.bookings(id,organization_id,service_id,client_phone,performer_id,manage_token) values($1,$2,$3,'70000000001',$4,$5)",[paidBooking,org,service,actor,paidToken]);
  const objects=new Map(),keys=new Map(),providerCalls=[];let seq=0,loseRefundReply=false;
  const env={SUPABASE_URL:'https://native.fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-key',SUPABASE_ANON_KEY:'fixture-public',YOOKASSA_ORGANIZATION_ID:org,YOOKASSA_TEST_SHOP_ID:'fixture-shop',YOOKASSA_TEST_SECRET_KEY:'fixture-key',YOOKASSA_RETURN_URL:'https://return.fixture.invalid',PAYMENT_WEBHOOK_ADAPTER:'yookassa-v1'};
  const rpcAllowed=new Set(functions.concat('claim_yookassa_refund_dispatch'));
  const transport=async r=>{
    const u=new URL(r.url);
    if(u.hostname==='api.yookassa.ru'){
      providerCalls.push({method:r.method,path:u.pathname,key:r.headers.get('idempotence-key')});
      if(r.method==='GET')return reply(objects.get(u.pathname.split('/').at(-1)));
      assert.equal(r.method,'POST');const key=r.headers.get('idempotence-key');
      const kind=u.pathname.endsWith('/refunds')?'refund':'payment';
      const object=keys.get(key)||{id:`${kind}-${++seq}`,status:kind==='payment'?'pending':'succeeded',amount:r.body.amount,metadata:r.body.metadata,
        ...(kind==='payment'?{test:true,confirmation:{confirmation_url:'https://pay.fixture.invalid/'}}:{payment_id:r.body.payment_id})};
      keys.set(key,object);objects.set(object.id,object);
      if(kind==='refund'&&loseRefundReply)throw new TypeError('Lost synthetic response after provider success');
      return reply(object);
    }
    assert.equal(u.hostname,'native.fixture.invalid','No external database/Auth access');
    if(u.pathname==='/auth/v1/user')return reply({id:actor});
    const name=u.pathname.split('/').at(-1);assert.ok(rpcAllowed.has(name),name);
    const args=Object.keys(r.body);args.forEach(k=>assert.match(k,/^p_[a-z0-9_]+$/));
    try{return reply((await pool.query(`select public.${name}(${args.map((k,i)=>`${k} => $${i+1}`).join(',')}) value`,args.map(k=>r.body[k]))).rows[0].value);}
    catch(e){return reply({code:e.code,message:e.message},400);}
  };
  const create=edgeFixture('yookassa-create-payment/index.ts',{env,fetch:transport}),webhook=edgeFixture('payment-webhook/index.ts',{env,fetch:transport}),refund=edgeFixture('yookassa-refund/index.ts',{env,fetch:transport});
  async function ok(response){const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;}
  const creates=await Promise.all([create.call({manage_token:paidToken,request_id:request}),create.call({manage_token:paidToken,request_id:id(22)})]);
  const prepared=await Promise.all(creates.map(ok)),attempt=prepared[0].attempt_id;
  await check('Concurrent payment preparation reuses one operation',async()=>{assert.equal(prepared[1].attempt_id,attempt);assert.equal([...objects.values()].filter(o=>o.id.startsWith('payment')).length,1);});
  const payment=[...objects.values()].find(o=>o.id.startsWith('payment'));payment.status='succeeded';
  await ok(await webhook.call({type:'notification',event:'payment.succeeded',object:payment}));
  await check('F05: exact retry after paid webhook recovers succeeded without provider POST',async()=>{
    const before=providerCalls.length;const result=await ok(await create.call({manage_token:paidToken,request_id:request}));
    assert.equal(result.status,'succeeded');assert.equal(result.attempt_id,attempt);assert.equal(providerCalls.length,before);
    assert.equal((await client.query('select payment_status from public.bookings where id=$1',[paidBooking])).rows[0].payment_status,'paid');
  });
  await check('Paid booking still refuses a fresh key, foreign token, changed amount and environment',async()=>{
    const before=providerCalls.length;
    for(const body of [{manage_token:paidToken,request_id:id(999)},{manage_token:id(998),request_id:request}])assert.ok((await create.call(body)).status>=400);
    await client.query('update public.bookings set deposit_amount_rub=101 where id=$1',[paidBooking]);assert.ok((await create.call({manage_token:paidToken,request_id:request})).status>=400);
    await client.query('update public.bookings set deposit_amount_rub=100 where id=$1',[paidBooking]);
    await client.query("update public.organization_payment_provider_settings set environment='production' where organization_id=$1",[org]);assert.ok((await create.call({manage_token:paidToken,request_id:request})).status>=400);
    await client.query("update public.organization_payment_provider_settings set environment='test' where organization_id=$1",[org]);assert.equal(providerCalls.length,before);
  });
  const authorization={authorization:'Bearer synthetic'},refundBody={organization_id:org,attempt_id:attempt,request_id:id(30),amount_minor:1000,reason:'Lost refund response fixture'};
  loseRefundReply=true;assert.ok((await refund.call(refundBody,authorization)).status>=400);loseRefundReply=false;
  await check('F01: retry at one hour reuses the provider object and original first-dispatch time',async()=>{
    const row=(await client.query('select * from public.payment_provider_refunds where request_id=$1',[refundBody.request_id])).rows[0];assert.ok(row.first_provider_request_at);
    await client.query("update public.payment_provider_refunds set first_provider_request_at=now()-interval '1 hour' where id=$1",[row.id]);
    const before=[...objects.values()].filter(o=>o.id.startsWith('refund')).length;await ok(await refund.call(refundBody,authorization));
    assert.equal([...objects.values()].filter(o=>o.id.startsWith('refund')).length,before);
    assert.ok(Date.now()-(await client.query('select first_provider_request_at from public.payment_provider_refunds where id=$1',[row.id])).rows[0].first_provider_request_at.getTime()>3500000);
  });
  const lateBody={...refundBody,request_id:id(31)};loseRefundReply=true;assert.ok((await refund.call(lateBody,authorization)).status>=400);loseRefundReply=false;
  await check('F01: retry after 25h makes no POST and keeps the creating reservation',async()=>{
    await client.query("update public.payment_provider_refunds set first_provider_request_at=now()-interval '25 hours' where request_id=$1",[lateBody.request_id]);
    const before=providerCalls.length;const response=await refund.call(lateBody,authorization);assert.ok(response.status>=400);assert.equal((await response.json()).error,'refund_reconciliation_required');assert.equal(providerCalls.length,before);
    const row=(await client.query('select status,request_id,amount_minor from public.payment_provider_refunds where request_id=$1',[lateBody.request_id])).rows[0];assert.equal(row.status,'creating');assert.equal(row.request_id,lateBody.request_id);assert.equal(Number(row.amount_minor),1000);
  });
  await check('Dispatch boundary closes at 23h55m; concurrent claims retain the same timestamp',async()=>{
    const row=(await client.query('select id from public.payment_provider_refunds where request_id=$1',[lateBody.request_id])).rows[0];
    for(const [age,allowed] of [['23 hours 54 minutes',true],['23 hours 55 minutes',false],['24 hours',false]]){
      await client.query('update public.payment_provider_refunds set first_provider_request_at=now()-$1::interval where id=$2',[age,row.id]);
      assert.equal((await value('select public.claim_yookassa_refund_dispatch($1,$2,$3) value',[row.id,lateBody.request_id,actor])).allowed,allowed);
    }
    await client.query('update public.payment_provider_refunds set first_provider_request_at=null where id=$1',[row.id]);
    const claims=await Promise.all([1,2].map(()=>pool.query('select public.claim_yookassa_refund_dispatch($1,$2,$3) value',[row.id,lateBody.request_id,actor])));
    assert.equal(claims[0].rows[0].value.first_provider_request_at,claims[1].rows[0].value.first_provider_request_at);
  });
  // The old legacy reservation is deliberately older than the 50-row journal page.
  await client.query('update public.payment_provider_refunds set amount_minor=9000 where id=$1',[legacyRefund]);
  for(let i=0;i<51;i++)await client.query("insert into public.payment_provider_refunds(organization_id,attempt_id,request_id,amount_minor,status,reason,requested_by) values($1,$2,$3,100,'canceled','Newer irrelevant history',$4)",[org,attempt,id(100+i),actor]);
  await check('F02: 50/51 row history boundary cannot hide the complete reservation aggregate',async()=>{
    const data=await value('select public.get_minuta_payment_workspace($1) value',[org]);const a=data.recent_attempts.find(a=>a.id===legacyAttempt);
    assert.equal(data.recent_refunds.length,50);assert.equal(data.recent_refunds.some(r=>r.id===legacyRefund),false);
    assert.equal(a.reserved_refund_amount_minor,9000);assert.equal(a.refundable_amount_minor,1000);assert.equal(a.refund_in_progress,true);
    assert.equal(data.recent_attempts.find(a=>a.id===attempt).reserved_refund_amount_minor,1000);
  });
  for(const [i,outcome] of ['matched','updated','pending','failed'].entries())await client.query("select public.record_yookassa_reconciliation($1,'payment',$2,'payment-fixture','succeeded',10000,'RUB','manual',$3,null,null)",[id(200+i),attempt,outcome]);
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  for(const width of [390,760,1440]){
    const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>{assert.equal(r.request().url(),'https://payment-audit.fixture.invalid/');return r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><meta charset="utf-8"><body></body></html>'});});
    await page.goto('https://payment-audit.fixture.invalid/');
    await page.evaluate(html=>{const parsed=new DOMParser().parseFromString(html,'text/html');document.body.append(document.importNode(parsed.querySelector('#paymentProviderPanel'),true));},readFileSync(resolve(root,'provider.html'),'utf8'));
    await page.addStyleTag({content:'[hidden]{display:none!important}svg{width:18px;height:18px}#providerIntegrationsDisclosure{display:block!important}input,button{font:16px sans-serif}'});
    const writes=[];let loseConfigure=false,loseReadback=false,failBeforeCommit=false,holdConfigure=false,releaseConfigure;
    await page.exposeFunction('fixtureRpc',async(name,args)=>{
      assert.ok(['get_minuta_payment_workspace','get_minuta_provider_connector_read_model_v144','configure_minuta_integration_connection_v142'].includes(name));
      const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^p_[a-z0-9_]+$/));
      if(name==='configure_minuta_integration_connection_v142'){writes.push({...args});if(failBeforeCommit){failBeforeCommit=false;return{error:{message:'Synthetic failure before commit'}};}}
      if(name==='get_minuta_provider_connector_read_model_v144'&&loseReadback){loseReadback=false;return{error:{message:'Synthetic read failure'}};}
      try{const data=await value(`select public.${name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) value`,keys.map(k=>args[k]));
        if(name==='configure_minuta_integration_connection_v142'&&loseConfigure){loseConfigure=false;return{error:{message:'Synthetic lost commit acknowledgement'}};}
        if(name==='configure_minuta_integration_connection_v142'&&holdConfigure){holdConfigure=false;await new Promise(resolve=>releaseConfigure=resolve);}
        return{data,error:null};
      }catch(e){return{error:{message:e.message,code:e.code}};}
    });
    await page.addScriptTag({content:readFileSync(resolve(root,'payment-management.js'),'utf8')});
    await page.addScriptTag({content:readFileSync(resolve(root,'integration-management.js'),'utf8')});
    await page.evaluate(async org=>{
      const options={db:{rpc:(n,a)=>fixtureRpc(n,a)},$:s=>document.querySelector(s),escapeHtml:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),notify:s=>(window.notices??=[]).push(s),requireWrites:()=>true};
      window.paymentController=MinutaPayments.createController(options);window.integrationController=MinutaIntegrations.createController(options);integrationController.bind();
      await paymentController.setOrganization({id:org,current_role:'owner'});await integrationController.setOrganization({id:org,current_role:'owner'});document.querySelector('#providerIntegrationsDisclosure').open=true;
    },org);
    await check(`F02/F03: actual DOM shows reserve and all localized reconciliation states at ${width}`,async()=>{
      const text=await page.locator('#paymentAttemptsList').textContent();assert.match(text,/зарезервировано 90,00/);assert.doesNotMatch(text,/доступно к возврату 100,00/);
      for(const label of ['сверено','обновлено','ожидает сверки','ошибка сверки'])assert.ok(text.includes('Сверка · '+label));
      assert.equal(await page.locator(`#paymentRefundAttempt option[value="${legacyAttempt}"]`).count(),0);
    });
    if(width===390){
      const submit=async provider=>{await page.locator(`[data-provider-integration-form="${provider}"] button`).click();await page.waitForFunction(()=>!document.querySelector('[data-provider-integration-form="'+window.fixtureProvider+'"] button').disabled);};
      for(const provider of ['dikidi','yclients']){
        await page.evaluate(p=>window.fixtureProvider=p,provider);await page.locator(`[data-provider-integration-form="${provider}"] input`).fill('audit-'+provider);
        loseConfigure=true;await submit(provider);
        await check(`F04: ${provider} lost save reply is recovered by immediate SQL readback`,async()=>{
          assert.equal(await page.locator(`[data-provider-integration="${provider}"] [data-provider-integration-state]`).textContent(),'Черновик сохранён');
          const before=writes.at(-1).p_connection;await submit(provider);assert.equal(writes.at(-1).p_connection,before);
          assert.equal((await client.query('select count(*)::int n from public.integration_connections_v142 where organization_id=$1 and provider=$2',[org,provider])).rows[0].n,1);
        });
      }
      await page.evaluate(()=>window.fixtureProvider='dikidi');await page.locator('[data-provider-integration-form="dikidi"] input').fill('audit-double-loss');loseConfigure=true;loseReadback=true;
      await submit('dikidi');const lostId=writes.at(-1).p_connection;await page.evaluate(()=>integrationController.load());await submit('dikidi');
      await check('F04: lost save plus lost readback retains UUID and entered account for a safe retry',async()=>{
        assert.equal(writes.at(-1).p_connection,lostId);assert.equal(writes.at(-1).p_external_account_id,'audit-double-loss');
        assert.equal((await client.query("select count(*)::int n from public.integration_connections_v142 where external_account_id='audit-double-loss'")).rows[0].n,1);
      });
      await page.locator('[data-provider-integration-form="dikidi"] input').fill('audit-before-commit');failBeforeCommit=true;await submit('dikidi');const failedId=writes.at(-1).p_connection;await submit('dikidi');
      await check('F04: failure before commit retains input and request identity without auto enabling exchange',async()=>{assert.equal(writes.at(-1).p_connection,failedId);assert.equal(writes.at(-1).p_enabled,false);assert.equal(writes.at(-1).p_environment,'testing');});
      await check('F04: reset while a save reply is pending suppresses stale readback and notification',async()=>{
        await page.locator('[data-provider-integration-form="dikidi"] input').fill('audit-stale-context');holdConfigure=true;
        await page.locator('[data-provider-integration-form="dikidi"] button').click();
        await page.waitForFunction(()=>document.querySelector('[data-provider-integration-form="dikidi"] button').disabled);
        const deadline=Date.now()+5000;
        while(!releaseConfigure&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
        assert.equal(typeof releaseConfigure,'function');
        const before=await page.evaluate(()=>window.notices.length);await page.evaluate(()=>integrationController.reset());releaseConfigure();
        await page.waitForTimeout(30);
        assert.equal(await page.evaluate(()=>window.notices.length),before);
        assert.equal(await page.locator('#providerIntegrationsDisclosure').evaluate(node=>node.hidden),true);
        await page.evaluate(org=>integrationController.setOrganization({id:org,current_role:'owner'}),org);
      });
    }
    assert.deepEqual(errors,[]);await page.close();
  }
  await check('Foreign organization, anonymous actor and admin setting write remain denied',async()=>{
    await denied('select public.get_minuta_payment_workspace($1)',[id(999)],'42501');
    await client.query("select set_config('audit.actor','',false)");await denied('select public.get_minuta_payment_workspace($1)',[org],'42501');
    await client.query("select set_config('audit.actor',$1,false)",[admin]);await denied("select public.set_minuta_yookassa_settings($1,false,'test',false,null,null,null)",[org],'42501');
    await client.query("select set_config('audit.actor',$1,false)",[actor]);
  });
  await check('Rollback refuses enabled payments',async()=>{await denied(rollback,[],'55000');});
  await client.query("select public.set_minuta_yookassa_settings($1,false,'test',false,null,null,null)",[org]);
  const before=await client.query('select id,first_provider_request_at,status,request_id,amount_minor from public.payment_provider_refunds order by id');
  await client.query(rollback);
  await check('Rollback restores old function bodies and preserves financial rows and dispatch evidence',async()=>{
    assert.deepEqual((await client.query('select id,first_provider_request_at,status,request_id,amount_minor from public.payment_provider_refunds order by id')).rows,before.rows);
    for(const name of ['get_minuta_payment_workspace','prepare_yookassa_payment','prepare_yookassa_refund'])assert.equal((await client.query('select prosrc from pg_proc where proname=$1',[name])).rows[0].prosrc,fn(v87,name).split('as $$')[1].split('$$;')[0]);
    assert.equal(await value("select to_regprocedure('public.claim_yookassa_refund_dispatch(uuid,uuid,uuid)') value"),null);
  });
  await client.query(migration);
  await check('Reapply preserves dispatch evidence and corrected aggregate with payments still disabled',async()=>{
    assert.deepEqual((await client.query('select id,first_provider_request_at,status,request_id,amount_minor from public.payment_provider_refunds order by id')).rows,before.rows);
    const data=await value('select public.get_minuta_payment_workspace($1) value',[org]);assert.equal(data.settings.enabled,false);assert.equal(data.recent_attempts.find(a=>a.id===legacyAttempt).refundable_amount_minor,1000);
  });
  console.log(`${evidence.checks.length} native regression checks passed`);
} finally {
  if(browser)await browser.close();await pool.end();await client.end();
  if(process.env.PAYMENT_AUDIT_OUTPUT_DIR){mkdirSync(process.env.PAYMENT_AUDIT_OUTPUT_DIR,{recursive:true});writeFileSync(resolve(process.env.PAYMENT_AUDIT_OUTPUT_DIR,'native-fixes-results.json'),JSON.stringify(evidence,null,2));}
}
