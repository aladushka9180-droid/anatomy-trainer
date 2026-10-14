import assert from 'node:assert/strict';
import {fixture,readSql,id,org,owner,other,addClient} from './retention-audit-sql-fixture.mjs';
const db=await fixture(),results=[];
const forward=readSql('retention-audit-fixes-candidate.sql'),rollback=readSql('retention-audit-fixes-rollback-candidate.sql');
const signatures=['render_minuta_retention_message(text,text,text,text)','get_minuta_retention_workspace(uuid)','save_minuta_retention_settings(uuid,boolean,integer,integer,text)','prepare_minuta_retention_delivery(uuid,uuid,text)'].map(x=>'public.'+x);
const q=(sql,args=[])=>db.query(sql,args);
async function check(name,work){try{await work();results.push({name,pass:true});console.log('PASS '+name);}catch(error){results.push({name,pass:false,error:error.message});console.error('FAIL '+name+': '+error.message);}}
async function expectError(sql,args,pattern){let error;try{await q(sql,args);}catch(e){error=e;}assert.match(error?.message||'',pattern);}
const workspace=async()=>(await q('select public.get_minuta_retention_workspace($1) data',[org])).rows[0].data;
const metadata=async()=>(await q(`select oid::regprocedure::text signature,proowner,proacl::text,proconfig::text,provolatile,prosecdef,prorettype from pg_proc where oid=any($1::regprocedure[]) order by oid`,[signatures])).rows;
const definitions=async()=>(await q(`select oid::regprocedure::text signature,prosrc from pg_proc where oid=any($1::regprocedure[]) order by oid`,[signatures])).rows;
async function rows(){const all={};for(const table of ['organization_retention_settings','client_marketing_consents','retention_deliveries','retention_audit_log'])all[table]=(await q(`select to_jsonb(row) data from public.${table} row order by to_jsonb(row)::text`)).rows;return all;}
const originalMetadata=await metadata(),originalDefinitions=await definitions();
try{
 const a=await addClient(db,1),b=await addClient(db,2);
 const old=(await q('select public.prepare_minuta_retention_delivery($1,$2) data',[org,a])).rows[0].data;
 await q(`update public.retention_deliveries set prepared_at=now()-interval '2 years' where id=$1`,[old.id]);
 await q(`insert into public.retention_deliveries(organization_id,client_account_id,status,message_snapshot,prepared_at,sent_at) select $1,$2,'sent','synthetic history',now()-n*interval '1 minute',now()-n*interval '1 minute' from generate_series(1,101)n`,[org,b]);
 await check('baseline reproduces missing active draft and truncated URL',async()=>{
  assert.equal((await workspace()).deliveries.some(d=>d.id===old.id),false);
  const text=(await q('select public.render_minuta_retention_message($1,$2,$3,$4) text',['А'.repeat(990)+' {ссылка}','Клиент','Организация','retention-test'])).rows[0].text;
  assert.equal(text.endsWith('https://a'),true);
 });
 const beforeRows=await rows();
 await check('candidate preserves existing rows, ownership, grants, search_path and volatility',async()=>{
  await db.exec(forward);assert.deepEqual(await rows(),beforeRows);assert.deepEqual(await metadata(),originalMetadata);
 });
 await check('all active drafts and last 100 history entries remain accessible without duplication',async()=>{
  const w=await workspace();assert.equal(w.deliveries.filter(d=>d.id===old.id).length,1);assert.equal(w.deliveries.length,101);
  assert.equal(w.deliveries.filter(d=>d.status!=='prepared').length,100);
 });
 await check('visible old draft can be cancelled and client prepared again',async()=>{
  await q(`select public.finish_minuta_retention_delivery($1,$2,'cancelled')`,[org,old.id]);
  const next=(await q('select public.prepare_minuta_retention_delivery($1,$2) data',[org,a])).rows[0].data;assert.equal(next.status,'prepared');
 });
 await check('normal substitution retains complete booking link and all text',async()=>{
  const text=(await q('select public.render_minuta_retention_message($1,$2,$3,$4) text',['Здравствуйте, {имя}! {организация}: {ссылка}','Тест','Организация','retention-test'])).rows[0].text;
  assert.equal(text,'Здравствуйте, Тест! Организация: https://aladushka9180-droid.github.io/anatomy-trainer/minuta-online-booking/index.html?org=retention-test');
 });
 await check('oversized rendered template is rejected before settings or audit change',async()=>{
  const before=await rows();await expectError('select public.save_minuta_retention_settings($1,true,45,90,$2)',[org,'А'.repeat(990)+' {ссылка}'],/retention_message_too_long/);assert.deepEqual(await rows(),before);
 });
 await check('actual long client name cannot create a truncated or partial draft',async()=>{
  const client=await addClient(db,3);
  await q(`update public.bookings set client_name=repeat('И',150) where client_account_id=$1`,[client]);
  await q('select public.save_minuta_retention_settings($1,true,45,90,$2)',[org,'А'.repeat(870)+' {имя} {ссылка}']);
  const before=await rows();await expectError('select public.prepare_minuta_retention_delivery($1,$2)',[org,client],/retention_message_too_long/);assert.deepEqual(await rows(),before);
  await q(`select public.save_minuta_retention_settings($1,true,45,90,'Здравствуйте! Записаться: {ссылка}')`,[org]);
 });
 await check('reapplying candidate is idempotent and preserves rows',async()=>{const before=await rows(),defs=await definitions();await db.exec(forward);assert.deepEqual(await definitions(),defs);assert.deepEqual(await rows(),before);});
 await check('45 and 44 day thresholds are invariant across UTC, Samara and extreme session zones',async()=>{
  await db.exec('begin');
  try{
   const boundary=await addClient(db,4,45),recent=await addClient(db,5,44);
   for(const zone of ['UTC','Europe/Samara','Pacific/Honolulu','Pacific/Kiritimati']){
    await q(`select set_config('TimeZone',$1,true)`,[zone]);const w=await workspace();
    assert.equal(w.clients.find(c=>c.client_account_id===boundary).eligible,true,zone+' 45 days');
    assert.equal(w.clients.find(c=>c.client_account_id===recent).eligible,false,zone+' 44 days');
   }
  }finally{await db.exec('rollback');}
 });
 await check('unauthorized caller is still rejected by unchanged reviewed guard',async()=>{
  await q(`select set_config('request.jwt.claim.sub',$1,false)`,[other]);
  try{await expectError('select public.get_minuta_retention_workspace($1)',[org],/retention_manager_required/);}finally{await q(`select set_config('request.jwt.claim.sub',$1,false)`,[owner]);}
 });
 await check('rollback restores exact previous bodies while preserving all rows and ACL',async()=>{
  const before=await rows();await db.exec(rollback);assert.deepEqual(await definitions(),originalDefinitions);assert.deepEqual(await metadata(),originalMetadata);assert.deepEqual(await rows(),before);
 });
 await check('reapply after rollback restores the fix with all rows intact',async()=>{const before=await rows();await db.exec(forward);assert.deepEqual(await rows(),before);await expectError('select public.render_minuta_retention_message($1,$2,$3,$4)',['А'.repeat(990)+' {ссылка}','Клиент','Организация','retention-test'],/retention_message_too_long/);});
 await check('unreviewed function drift blocks both apply and rollback atomically',async()=>{
  await db.exec(`create or replace function public.render_minuta_retention_message(p_template text,p_client_name text,p_organization_name text,p_slug text) returns text language plpgsql immutable set search_path to '' as $$begin return 'unreviewed fixture only';end$$;`);
  const changed=await definitions(),before=await rows();
  for(const script of [forward,rollback]){let error;try{await db.exec(script);}catch(e){error=e;await db.exec('rollback');}assert.match(error?.message||'',/retention_patch_source_drift/);assert.deepEqual(await definitions(),changed);assert.deepEqual(await rows(),before);}
 });
}finally{await db.close();}
console.log(JSON.stringify({environment:'in-memory subset-schema SQL; no production or native concurrency claim',passed:results.filter(x=>x.pass).length,total:results.length,failures:results.filter(x=>!x.pass)},null,2));
if(results.some(x=>!x.pass))process.exitCode=1;
