// Disposable, source-free PostgreSQL 17 CI service only. Never a Supabase URL.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {applyExpenseFixture,expenseFixtureIds as ids,expenseSql} from './manual-expense-edit-v193-fixture.mjs';

const CONFIRM='EMPTY_SYNTHETIC_DATABASE_ONLY',DATABASE='minuta_expense_edit_test';
function fixtureTarget(value,confirm,ci){
 let target;try{target=new URL(value);}catch{throw new Error('unsafe_native_fixture');}
 if(ci!=='true'||confirm!==CONFIRM||target.protocol!=='postgresql:'
    ||!['127.0.0.1','localhost'].includes(target.hostname)||target.port!=='55432'
    ||target.pathname!==`/${DATABASE}`||target.username!=='postgres'
    ||target.password!=='ephemeral-fixture-only'||target.search||target.hash)
  throw new Error('unsafe_native_fixture');
 return target;
}
function selfTest(){
 const good='postgresql://postgres:ephemeral-fixture-only@127.0.0.1:55432/minuta_expense_edit_test';
 assert.equal(fixtureTarget(good,CONFIRM,'true').pathname,`/${DATABASE}`);
 assert.equal(fixtureTarget(good.replace('127.0.0.1','localhost'),CONFIRM,'true').hostname,'localhost');
 for(const [value,confirm,ci] of [
  [undefined,CONFIRM,'true'],['not-a-url',CONFIRM,'true'],[good,'','true'],[good,CONFIRM,'false'],
  [good.replace('127.0.0.1','database.example.invalid'),CONFIRM,'true'],
  [good.replace('55432','5432'),CONFIRM,'true'],[good.replace(DATABASE,'postgres'),CONFIRM,'true'],
  [good.replace('postgresql:','https:'),CONFIRM,'true'],[good.replace('postgres:ephemeral','admin:ephemeral'),CONFIRM,'true'],
  [good.replace('ephemeral-fixture-only','not-the-fixture-password'),CONFIRM,'true'],
  [good+'?sslmode=disable',CONFIRM,'true'],[good+'#ignored',CONFIRM,'true']
 ])assert.throws(()=>fixtureTarget(value,confirm,ci),/^Error: unsafe_native_fixture$/);
 console.log('PASS 14 pure native-fixture target guards; no connections/SQL performed');
}

async function run(){
 const clients=[];let phase='target guard';const passed=[];
 try{
  const target=fixtureTarget(process.env.MINUTA_NATIVE_TEST_DATABASE_URL,process.env.MINUTA_NATIVE_TEST_CONFIRM,process.env.CI);
  const {Client}=createRequire(import.meta.url)(process.env.MINUTA_PG_MODULE||'pg');
  const connect=async(label)=>{
   const client=new Client({connectionString:target.href,ssl:false,connectionTimeoutMillis:5000,
    application_name:`manual-expense-v193-fixture-${label}`});clients.push(client);await client.connect();
   await client.query("set statement_timeout='15s';set lock_timeout='12s';set idle_in_transaction_session_timeout='20s'");return client;
  };
  const a=await connect('a'),b=await connect('b');
  const scalar=async(client,sql,args=[])=>Object.values((await client.query(sql,args)).rows[0]||{})[0];
  const aPid=await scalar(a,'select pg_backend_pid()'),bPid=await scalar(b,'select pg_backend_pid()');
  assert.notEqual(aPid,bPid);
  phase='empty PostgreSQL17 service guard';
  const guard=(await a.query(`select current_database() database,current_user actor,session_user login,
   current_setting('server_version_num')::int version,pg_is_in_recovery() recovery,
   (select count(*)::int from pg_namespace where nspname not in('public','pg_catalog','information_schema')
      and nspname !~ '^pg_(toast|temp)') extra_schemas,
   (select count(*)::int from pg_class where relnamespace='public'::regnamespace) public_relations,
   (select count(*)::int from pg_proc where pronamespace='public'::regnamespace) public_functions,
   (select count(*)::int from pg_roles where rolname in('anon','authenticated','service_role')) fixture_roles`)).rows[0];
  assert.equal(guard.database,DATABASE);assert.equal(guard.actor,'postgres');assert.equal(guard.login,'postgres');
  assert.ok(guard.version>=170000&&guard.version<180000);assert.equal(guard.recovery,false);
  assert.equal(guard.extra_schemas,0);assert.equal(guard.public_relations,0);assert.equal(guard.public_functions,0);assert.equal(guard.fixture_roles,0);
  passed.push('two distinct backend PIDs; exact empty PostgreSQL17 CI fixture');
  phase='synthetic prerequisites and actual v129/v132/v163/v193';
  await applyExpenseFixture({exec:sql=>a.query(sql)});await a.query(expenseSql('supabase-migration-v193.sql'));
  const beginActor=async(client,actor=ids.owner)=>{
   await client.query('begin;set local role authenticated');
   await client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
   assert.equal(await scalar(client,'select current_user'),'authenticated');
  };
  const asActor=async(client,fn,actor=ids.owner)=>{
   await beginActor(client,actor);
   try{const result=await fn();await client.query('commit');return result;}
   catch(error){await client.query('rollback');throw error;}
  };
  const call=(client,name,args)=>scalar(client,`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
  await asActor(a,()=>call(a,'set_minuta_finance_enabled_v132',[ids.org,true]));
  const account=await asActor(a,()=>call(a,'create_minuta_financial_account_v129',[ids.org,randomUUID(),'Native synthetic cash','cash']));
  const category=await scalar(a,"select id from public.organization_finance_categories_v163 where organization_id=$1 and system_key='materials'",[ids.org]);
  const counts=async()=> (await a.query(`select count(*)::int transactions,count(*) filter(where operation_type='reversal')::int reversals,
   (select count(*)::int from public.financial_manual_expenses_v163 where organization_id=$1) expenses,
   (select count(*)::int from public.financial_manual_expense_edits_v193 where organization_id=$1) edits
   from public.financial_transactions where organization_id=$1`,[ids.org])).rows[0];
  const snapshot=async(expense)=>({
   metadata:await scalar(a,'select to_jsonb(e) from public.financial_manual_expenses_v163 e where id=$1',[expense.id]),
   ledger:(await a.query('select to_jsonb(t) row from public.financial_transactions t where source_id=$1 order by id',[expense.expense_source_id])).rows
  });
  const create=async(date,performer=ids.owner)=>{
   const expense=await asActor(a,()=>call(a,'record_minuta_manual_expense_v163',[ids.org,category,'Native synthetic supplier','Original native expense',12345,account.id,date,performer,randomUUID()]));
   return {expense,before:await counts(),original:await snapshot(expense)};
  };
  const editArgs=(expense,date,request=randomUUID(),performer=ids.owner)=>[ids.org,expense.id,category,'Edited synthetic supplier','Edited native expense',23456,account.id,date,performer,request];
  const edit=(client,args)=>call(client,'edit_minuta_manual_expense_v193',args);
  const reverse=(client,expense,request=randomUUID())=>call(client,'reverse_minuta_manual_expense_v163',[ids.org,expense.id,request,'ordinary_cancel']);
  const screen=(date)=>asActor(a,()=>call(a,'get_minuta_finance_screen_v163',[ids.org,date,date]));

  // Leader executes but does not commit; the follower must demonstrably wait on
  // that distinct connection's real lock before we release the leader transaction.
  const race=async(leader,follower)=>{
   let pending,settled=false;
   try{
    await beginActor(a);const first=await leader(a);
    await beginActor(b);
    pending=follower(b).then(value=>({ok:true,value}),error=>({ok:false,error})).finally(()=>{settled=true;});
    await a.query('reset role');
    const deadline=Date.now()+5000;let blocked=false;
    while(Date.now()<deadline){
     blocked=await scalar(a,'select $1::int=any(pg_blocking_pids($2::int))',[aPid,bPid]);
     if(blocked)break;
     assert.equal(settled,false,'follower completed before encountering the leader lock');await pause(10);
    }
    assert.equal(blocked,true,'two-connection race never reached a real blocking lock');
    await a.query('commit');const second=await pending;
    await b.query(second.ok?'commit':'rollback');return {first,second};
   }finally{
    await a.query('rollback');if(pending)await pending;await b.query('rollback');
   }
  };
  const completeState=async(fixture,edited)=>{
   assert.deepEqual(await snapshot(fixture.expense),fixture.original);
   const after=await counts();
   assert.deepEqual(after,{transactions:fixture.before.transactions+(edited?4:2),reversals:fixture.before.reversals+2,
    expenses:fixture.before.expenses+(edited?1:0),edits:fixture.before.edits+(edited?1:0)});
   const bases=[fixture.expense.payment_transaction_id,
    await scalar(a,"select id from public.financial_transactions where source_id=$1 and operation_type='supplier_expense_accrual'",[fixture.expense.expense_source_id])];
   for(const id of bases)assert.equal(await scalar(a,'select count(*)::int from public.financial_transactions where organization_id=$1 and reversal_of=$2',[ids.org,id]),1);
   assert.equal(await scalar(a,`select count(*)::int from (select transaction_id from public.financial_postings where organization_id=$1
    group by transaction_id having sum(case side when 'debit' then amount_minor else -amount_minor end)<>0) x`,[ids.org]),0);
  };
  const proof=async(name,fn)=>{phase=name;await fn();passed.push(name);};
  await proof('different requests: one committed edit, one stale refusal, no partial ledger',async()=>{
   const fixture=await create('2020-08-01'),one=editArgs(fixture.expense,'2020-08-02'),two=editArgs(fixture.expense,'2020-08-03');two[5]++;
   const result=await race(c=>edit(c,one),c=>edit(c,two));
   assert.equal(result.first.replayed,false);assert.equal(result.second.ok,false);
   assert.equal(result.second.error.code,'55000');assert.equal(result.second.error.message,'manual_expense_already_corrected');
   await completeState(fixture,true);
   assert.equal((await screen('2020-08-01')).summary.expense_minor,0);assert.equal((await screen('2020-08-02')).summary.expense_minor,one[5]);
   assert.equal((await screen('2020-08-03')).summary.expense_minor,0);
  });
  await proof('same frozen request: one receipt plus replay across separate transactions',async()=>{
   const fixture=await create('2020-09-01'),args=editArgs(fixture.expense,'2020-09-02');
   const result=await race(c=>edit(c,args),c=>edit(c,args));assert.equal(result.second.ok,true);
   assert.equal(result.first.replayed,false);assert.equal(result.second.value.replayed,true);
   for(const key of ['id','old_expense_id','new_expense_id','payment_reversal_id','accrual_reversal_id'])assert.equal(result.first[key],result.second.value[key]);
   assert.equal(await scalar(a,'select count(*)::int from public.financial_manual_expense_edits_v193 where organization_id=$1 and request_id=$2',[ids.org,args[9]]),1);
   await completeState(fixture,true);
  });
  await proof('edit wins ordinary v163 reversal: no double reversal or partial losing correction',async()=>{
   const fixture=await create('2020-10-01'),args=editArgs(fixture.expense,'2020-10-02');
   const result=await race(c=>edit(c,args),c=>reverse(c,fixture.expense));assert.equal(result.second.ok,false);
   assert.equal(result.second.error.code,'23505');assert.equal(result.second.error.message,'supplier_expense_transaction_already_reversed');
   await completeState(fixture,true);
  });
  await proof('ordinary v163 reversal wins edit: no replacement/link or partial losing correction',async()=>{
   const fixture=await create('2020-11-01'),args=editArgs(fixture.expense,'2020-11-02');
   const result=await race(c=>reverse(c,fixture.expense),c=>edit(c,args));assert.equal(result.second.ok,false);
   assert.equal(result.second.error.code,'55000');assert.equal(result.second.error.message,'manual_expense_already_corrected');
   await completeState(fixture,false);assert.equal((await screen('2020-11-02')).summary.expense_minor,0);
  });
  await proof('original performer including NULL is preserved; mismatch is refused before any ledger write',async()=>{
   for(const performer of [ids.owner,null]){
    const fixture=await create('2020-12-01',performer),args=editArgs(fixture.expense,'2020-12-02',randomUUID(),performer);
    const wrong=[...args];wrong[8]=performer===null?ids.owner:null;
    await assert.rejects(()=>asActor(a,()=>edit(a,wrong)),e=>e.code==='22023'&&e.message==='manual_expense_edit_performer_mismatch');
    assert.deepEqual(await counts(),fixture.before);assert.deepEqual(await snapshot(fixture.expense),fixture.original);
    const result=await asActor(a,()=>edit(a,args));
    assert.equal(await scalar(a,'select performer_id from public.financial_manual_expenses_v163 where id=$1',[result.new_expense_id]),performer);
   }
  });
  console.log(`PASS ${passed.length} native PostgreSQL17 proof groups: ${passed.join('; ')}\nSynthetic CI service only; not actual Supabase/Auth/restore qualification.`);
 }catch(error){
  const code=/^[A-Z0-9_]{2,40}$/.test(String(error.code||''))?error.code:'NATIVE_FIXTURE_REFUSED';
  const location=String(error.stack||'').match(/manual-expense-edit-v193-native-test\.mjs:\d+(?::\d+)?/)?.[0]||'';
  console.error(`FAIL ${phase}: ${code} ${location}`);process.exitCode=1;
 }finally{
  // Only our two clients are closed. The dedicated CI service owns all synthetic
  // schemas/roles/data and is disposed by CI; no drop/cleanup touches another DB.
  await Promise.allSettled(clients.map(client=>client.end()));
 }
}
if(process.argv.includes('--self-test'))selfTest();else await run();
