// Synthetic in-memory PG only. This is NOT a full Supabase/actual restore harness.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {applyExpenseFixture,expenseFixtureIds} from './manual-expense-edit-v193-fixture.mjs';
const name=process.env.MINUTA_PGLITE_MODULE||'@electric-sql/pglite';
const {PGlite}=await import(/^[A-Za-z]:[\\/]/.test(name)?pathToFileURL(name).href:name);
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8').replaceAll('\r\n','\n');
const db=new PGlite();
const ids=expenseFixtureIds;
const q=(s,p=[])=>db.query(s,p),scalar=async(s,p=[])=>Object.values((await q(s,p)).rows[0]||{})[0];
const uid=async()=>scalar('select gen_random_uuid()');
const proofs=[];
let phase='synthetic bootstrap / apply';
const proof=async(name,fn)=>{phase=name;await fn();proofs.push(name);};
const fail=async(fn,message,code)=>assert.rejects(fn,e=>(!code||e.code===code)&&String(e.message).includes(message));
const actor=async(id=ids.owner)=>{await db.exec('reset role');await q("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role authenticated');};
const counts=async()=>{await db.exec('reset role');const value=await q(`select count(*) filter(where operation_type='reversal')::int reversals,count(*)::int transactions,
 (select count(*)::int from public.financial_manual_expenses_v163) expenses,
 (select count(*)::int from public.financial_manual_expense_edits_v193) edits from public.financial_transactions`);await db.exec('set role authenticated');return value;};
const edit=async(p)=>scalar('select public.edit_minuta_manual_expense_v193($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',p);
const screen=async(start,end=start,master=null)=>scalar('select public.get_minuta_finance_screen_v163($1,$2,$3,$4)',[ids.org,start,end,master]);
const oldDefs=()=>q(`select proname,pg_get_functiondef(oid) def,proacl::text acl,proowner::text owner
 from pg_proc where pronamespace='public'::regnamespace and proname ~ '^((record|reverse)_minuta_manual_expense_v163|pay_minuta_supplier_expense_v132|reverse_minuta_supplier_expense_v132|get_minuta_finance_screen_v163)$' order by proname`);
try{
 await applyExpenseFixture(db);
 const baselineDefs=await oldDefs();
 await actor();
 await scalar('select public.set_minuta_finance_enabled_v132($1,true)',[ids.org]);
 const cash=await scalar('select public.create_minuta_financial_account_v129($1,$2,$3,$4)',[ids.org,await uid(),'Synthetic cash','cash']);
 const bank=await scalar('select public.create_minuta_financial_account_v129($1,$2,$3,$4)',[ids.org,await uid(),'Synthetic bank','bank']);
 const category=await scalar("select id from public.organization_finance_categories_v163 where organization_id=$1 and system_key='materials'",[ids.org]);
 const rent=await scalar("select id from public.organization_finance_categories_v163 where organization_id=$1 and system_key='rent'",[ids.org]);
 const create=async(date='2020-01-11',amount=12345,performer=ids.owner)=>scalar('select public.record_minuta_manual_expense_v163($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ids.org,category,'Synthetic supplier','Original expense',amount,cash.id,date,performer,await uid()]);
 const original=await create();
 await proof('RED: two ordinary RPCs do not neutralize the original business period',async()=>{
  await db.exec('begin');
  try{
   await scalar('select public.reverse_minuta_manual_expense_v163($1,$2,$3,$4)',[ids.org,original.id,await uid(),'manual_expense_edit']);
   await scalar('select public.record_minuta_manual_expense_v163($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ids.org,rent,'Synthetic replacement','Replacement',20000,bank.id,'2020-02-11',ids.owner,await uid()]);
   assert.equal((await screen('2020-01-11')).summary.expense_minor,12345);
  }finally{await db.exec('rollback');}
 });
 await db.exec('reset role');
 await proof('apply / empty rollback / reapply leaves original v132/v163 definitions and ledger intact',async()=>{
  await db.exec(read('supabase-migration-v193.sql'));
  await db.exec(read('supabase-migration-v193-rollback.sql'));
  assert.equal(await scalar("select to_regprocedure('public.edit_minuta_manual_expense_v193(uuid,uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)') is null"),true);
  await db.exec(read('supabase-migration-v193.sql'));
  assert.deepEqual(await oldDefs(),baselineDefs);
 });
 await proof('empty rollback refuses modified definitions and ACL without removing newer state',async()=>{
  const signature='public.get_minuta_manual_expense_edit_status_v193(uuid)';
  const definition=await scalar('select pg_get_functiondef($1::regprocedure)',[signature]);
  const changed=definition.replace("'version',193","'version',194");
  assert.notEqual(changed,definition);
  for(const mutation of [changed,`grant execute on function ${signature} to anon`]){
   await db.exec('begin');
   try{
    await db.exec(mutation);
    await fail(()=>db.exec(read('supabase-migration-v193-rollback.sql')),'v193_rollback_preserve_changed_definition_or_acl','55000');
   }finally{await db.exec('rollback');}
   assert.equal(await scalar('select pg_get_functiondef($1::regprocedure)',[signature]),definition);
  }
 });
 await actor();
 await proof('capability and editable snapshot are closed, scoped and preserve exact original fields',async()=>{
  assert.deepEqual(await scalar('select public.get_minuta_manual_expense_edit_status_v193($1)',[ids.org]),{schema:'manual-expense-edit-v1',version:193});
  assert.deepEqual(await scalar('select public.get_minuta_manual_expense_for_edit_v193($1,$2)',[ids.org,original.id]),
   {id:original.id,category_id:category,source_label:'Synthetic supplier',title:'Original expense',amount_minor:12345,payment_account_id:cash.id,occurred_on:'2020-01-11',performer_id:ids.owner});
 });
 const originalMetadata=await scalar('select to_jsonb(e) from public.financial_manual_expenses_v163 e where id=$1',[original.id]);
 const originalLedger=await q('select to_jsonb(t) row from public.financial_transactions t where source_id=$1 order by id',[original.expense_source_id]);
 const p=[ids.org,original.id,rent,'Edited supplier','Exact edited title',20000,bank.id,'2020-02-11',ids.owner,await uid()];
 let result;
 await proof('performer correction is refused before reversals and preserves original assignment',async()=>{
  const before=await counts(),changed=[...p];changed[8]=ids.staff;
  await fail(()=>edit(changed),'manual_expense_edit_performer_mismatch','22023');
  assert.deepEqual(await counts(),before);
 });
 await proof('NULL assignment is preserved; inactive original performer remains a fail-closed replacement gate',async()=>{
  const unassigned=await create('2020-07-01',500,null);
  const args=[ids.org,unassigned.id,category,'Unassigned supplier','Unassigned correction',501,cash.id,'2020-07-02',null,await uid()];
  const wrong=[...args];wrong[8]=ids.owner;const before=await counts();
  await fail(()=>edit(wrong),'manual_expense_edit_performer_mismatch','22023');assert.deepEqual(await counts(),before);
  const corrected=await edit(args);assert.equal(await scalar('select performer_id from public.financial_manual_expenses_v163 where id=$1',[corrected.new_expense_id]),null);
  const inactive=await create('2020-07-03',500,ids.staff),intent=[...args];intent[1]=inactive.id;intent[8]=ids.staff;intent[9]=await uid();
  const inactiveBefore=await counts();await db.exec('reset role');await q('update public.organization_memberships set active=false where organization_id=$1 and user_id=$2',[ids.org,ids.staff]);await actor();
  try{
   await fail(()=>edit(intent),'manual_expense_performer_not_in_organization','42501');assert.deepEqual(await counts(),inactiveBefore);
  }finally{await db.exec('reset role');await q('update public.organization_memberships set active=true where organization_id=$1 and user_id=$2',[ids.org,ids.staff]);await actor();}
 });
 await proof('GREEN: atomic correction neutralizes old period, replaces new period and preserves immutable originals',async()=>{
  result=await edit(p);
  assert.equal(result.replayed,false);assert.notEqual(result.new_expense_id,original.id);
  assert.equal((await screen('2020-01-11')).summary.expense_minor,0);
  assert.equal((await screen('2020-02-11')).summary.expense_minor,20000);
  assert.equal((await screen('2020-01-11','2020-01-11',ids.owner)).summary.expense_minor,0);
  assert.equal((await screen('2020-02-11','2020-02-11',ids.owner)).summary.expense_minor,20000);
  assert.equal((await screen('2020-02-11','2020-02-11',ids.staff)).summary.expense_minor,0);
  assert.equal((await screen('2020-01-01','2020-02-28')).summary.expense_minor,20000);
  assert.deepEqual(await scalar('select to_jsonb(e) from public.financial_manual_expenses_v163 e where id=$1',[original.id]),originalMetadata);
  assert.deepEqual(await q('select to_jsonb(t) row from public.financial_transactions t where source_id=$1 order by id',[original.expense_source_id]),originalLedger);
  const dated=await q('select occurred_at,created_at from public.financial_transactions where id in($1,$2)',[result.payment_reversal_id,result.accrual_reversal_id]);
  for(const row of dated.rows){assert.equal(row.occurred_at.toISOString(),new Date(originalMetadata.occurred_at).toISOString());assert.ok(row.created_at>row.occurred_at);}
  const fresh=await scalar('select public.get_minuta_manual_expense_for_edit_v193($1,$2)',[ids.org,result.new_expense_id]);
  assert.equal(fresh.occurred_on,'2020-02-11');assert.equal(fresh.title,p[4]);assert.equal(fresh.source_label,p[3]);assert.equal(fresh.performer_id,ids.owner);
  await fail(()=>scalar('select public.get_minuta_manual_expense_for_edit_v193($1,$2)',[ids.org,original.id]),'manual_expense_already_corrected','55000');
  const imbalance=await scalar(`select count(*)::int from (select transaction_id from public.financial_postings group by transaction_id
   having sum(case side when 'debit' then amount_minor else -amount_minor end)<>0) x`);
  assert.equal(imbalance,0);
 });
 await proof('lost ACK same frozen intent replays once; changed intent and stale editor never create rows',async()=>{
  const before=await counts();const again=await edit(p);assert.equal(again.replayed,true);assert.equal(again.new_expense_id,result.new_expense_id);
  const changed=[...p];changed[5]++;await fail(()=>edit(changed),'manual_expense_edit_idempotency_conflict','23505');
  for(const [index,value] of [[1,result.new_expense_id],[2,category],[3,'Different supplier'],[4,'Different title'],[6,cash.id],[7,'2020-02-12'],[8,ids.staff]]){
   const changed=[...p];changed[index]=value;await fail(()=>edit(changed),'manual_expense_edit_idempotency_conflict','23505');
  }
  const stale=[...p];stale[9]=await uid();await fail(()=>edit(stale),'manual_expense_already_corrected','55000');
  assert.deepEqual(await counts(),before);
 });
 await proof('replacement validation after reversal fails atomically: zero partial reversals/links/new expenses',async()=>{
  const e=await create('2020-03-01');const before=await counts();
  const invalid=[ids.org,e.id,await uid(),'Invalid replacement','No category',1,cash.id,'2020-03-02',ids.owner,await uid()];
  await fail(()=>edit(invalid),'active_finance_category_not_found','P0002');assert.deepEqual(await counts(),before);
  invalid[2]=category;invalid[6]=await uid();await fail(()=>edit(invalid),'cash_or_bank_account_required','22023');assert.deepEqual(await counts(),before);
  invalid[6]=cash.id;invalid[8]=ids.foreign;await fail(()=>edit(invalid),'manual_expense_edit_performer_mismatch','22023');assert.deepEqual(await counts(),before);
  invalid[8]=ids.owner;invalid[7]='9999-01-01';await fail(()=>edit(invalid),'manual_expense_future_date','22023');assert.deepEqual(await counts(),before);
 });
 await proof('queued concurrent edit intents have one winner; same-request pair returns one replay',async()=>{
  const e=await create('2020-04-01');const base=[ids.org,e.id,category,'Concurrency supplier','Concurrency',111,cash.id,'2020-04-02',null,await uid()];
  base[8]=ids.owner;const other=[...base];other[9]=await uid();
  const results=await Promise.allSettled([edit(base),edit(other)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.match(results.find(x=>x.status==='rejected').reason.message,/manual_expense_already_corrected/);
  const e2=await create('2020-04-03');const same=[...base];same[1]=e2.id;same[9]=await uid();
  const pair=await Promise.all([edit(same),edit(same)]);assert.equal(pair[0].new_expense_id,pair[1].new_expense_id);assert.deepEqual(pair.map(x=>x.replayed),[false,true]);
  // PGlite queues one session; this does not certify two-connection PG lock races.
 });
 await proof('second edit of replacement forms immutable chain; retry of earlier edit keeps its committed receipt',async()=>{
  const next=[...p];next[1]=result.new_expense_id;next[5]=30000;next[7]='2020-05-11';next[9]=await uid();
  const r=await edit(next);assert.notEqual(r.new_expense_id,result.new_expense_id);
  assert.equal((await edit(p)).new_expense_id,result.new_expense_id);
  assert.equal((await screen('2020-02-11')).summary.expense_minor,0);assert.equal((await screen('2020-05-11')).summary.expense_minor,30000);
 });
 await proof('business timezone/DST uses local noon and preserves ordinary reversal dates',async()=>{
  await db.exec('reset role');await q("update public.locations set timezone='Europe/Berlin' where organization_id=$1",[ids.org]);await actor();
  const e=await create('2020-03-28');const dst=[ids.org,e.id,category,'DST supplier','DST correction',555,cash.id,'2020-03-29',null,await uid()];
  dst[8]=ids.owner;const r=await edit(dst);const t=await scalar('select occurred_at from public.financial_transactions where id=(select payment_transaction_id from public.financial_manual_expenses_v163 where id=$1)',[r.new_expense_id]);
  assert.equal(t.toISOString(),'2020-03-29T10:00:00.000Z');assert.equal((await screen('2020-03-28')).summary.expense_minor,0);assert.equal((await screen('2020-03-29')).summary.expense_minor,555);
  const ordinary=await create('2020-06-01');const reversed=await scalar('select public.reverse_minuta_manual_expense_v163($1,$2,$3,$4)',[ids.org,ordinary.id,await uid(),'ordinary_cancel']);
  const row=(await q('select occurred_at,created_at from public.financial_transactions where id=$1',[reversed.payment_reversal_id])).rows[0];
  assert.ok(Math.abs(row.occurred_at-row.created_at)<1000);assert.equal((await screen('2020-06-01')).summary.expense_minor,12345);
  const stale=[ids.org,ordinary.id,category,'No duplicate','Ordinary reversed',1,cash.id,'2020-06-02',null,await uid()];
  stale[8]=ids.owner;await fail(()=>edit(stale),'manual_expense_already_corrected','55000');
  await db.exec('reset role');await q("update public.locations set timezone='Europe/Samara' where organization_id=$1",[ids.org]);await actor();
 });
 await proof('read scope and replay recheck actor/org/finance ON; private helpers cannot be called directly',async()=>{
  await actor(ids.staff);await fail(()=>scalar('select public.get_minuta_manual_expense_edit_status_v193($1)',[ids.org]),'financial_manager_role_required','42501');await fail(()=>edit(p),'financial_manager_role_required','42501');
  await fail(()=>scalar('select count(*)::int from public.financial_manual_expense_edits_v193'),'permission denied','42501');
  await actor(ids.foreign);await fail(()=>scalar('select public.get_minuta_manual_expense_for_edit_v193($1,$2)',[ids.org,result.new_expense_id]),'financial_manager_role_required','42501');
  await actor();const missing=await uid();await fail(()=>scalar('select public.get_minuta_manual_expense_for_edit_v193($1,$2)',[ids.org,missing]),'manual_expense_not_found','P0002');
  for(const signature of ['pay_minuta_manual_expense_dated_v193(uuid,uuid,uuid,uuid)','record_minuta_manual_expense_dated_v193(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)','reverse_minuta_manual_expense_transaction_dated_v193(uuid,uuid,uuid,text,text,timestamp with time zone)']){
   for(const who of ['anon','authenticated','service_role'])assert.equal(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[who,'public.'+signature]),false);
  }
  await fail(()=>db.exec('delete from public.financial_manual_expense_edits_v193'),'permission denied','42501');
  await scalar('select public.set_minuta_finance_enabled_v132($1,false)',[ids.org]);await fail(()=>edit(p),'finance_disabled','55000');
  await scalar('select public.set_minuta_finance_enabled_v132($1,true)',[ids.org]);
  await db.exec('reset role');await q("update public.organization_memberships set active=false where organization_id=$1 and user_id=$2",[ids.org,ids.owner]);
  await actor();await fail(()=>edit(p),'financial_manager_role_required','42501');
  await db.exec('reset role');await q('update public.organization_memberships set active=true where organization_id=$1 and user_id=$2',[ids.org,ids.owner]);await actor();
 });
 await proof('manual business-date adapter contract and actual cash projector match v163 for edits',async()=>{
  const src=read('finance-center-provider.js');const start=src.indexOf('  function projectCashLedger('),end=src.indexOf('\n  function ',start+10);
  assert.ok(start>0&&end>start);const body=src.slice(start,end);
  const labelStart=src.indexOf('  function bucketLabel('),labelEnd=src.indexOf('\n  function ',labelStart+10);
  assert.ok(labelStart>0&&labelEnd>labelStart);
  const dateStart=src.indexOf('  function businessDate('),dateEnd=src.indexOf('\n  //',dateStart+10);
  assert.ok(dateStart>0&&dateEnd>dateStart);
  const project=runInNewContext(src.slice(dateStart,dateEnd)+src.slice(labelStart,labelEnd)+body+';projectCashLedger');
  const rows=(await q(`select t.id,t.operation_type,t.source_type,t.source_id,t.reversal_of,t.occurred_at,
   coalesce(jsonb_agg(jsonb_build_object('side',p.side,'amount_minor',p.amount_minor,'financial_accounts',jsonb_build_object('account_class',a.account_class,'account_type',a.account_type))) filter(where p.id is not null),'[]'::jsonb) financial_postings
   from public.financial_transactions t left join public.financial_postings p on p.transaction_id=t.id left join public.financial_accounts a on a.id=p.account_id
   group by t.id order by t.id`)).rows.map(row=>({...row,occurred_at:row.occurred_at.toISOString()}));
  const expenses=(await q('select expense_source_id,category_id,category_name_snapshot,performer_id,occurred_at from public.financial_manual_expenses_v163')).rows.map(row=>({...row,occurred_at:row.occurred_at.toISOString()}));
  // Feed unchanged persisted rows into the actual integrated cash projector.
  for(const date of ['2020-01-11','2020-02-11','2020-05-11']){
   const cashResult=project(rows,{bounds:{start:date,end:date},timezone:'Europe/Samara',expenses});
   assert.equal(cashResult.classified,true);assert.equal(cashResult.expenseMinor,(await screen(date)).summary.expense_minor);
  }
 });
 await db.exec('reset role');
 await proof('history and changed definitions/ACL are rollback-protected; original functions remain unchanged',async()=>{
  await fail(()=>db.exec('update public.financial_manual_expense_edits_v193 set request_fingerprint=request_fingerprint'),'finance_screen_history_is_append_only','55000');
  await fail(()=>db.exec(read('supabase-migration-v193-rollback.sql')),'v193_rollback_preserve_expense_edit_history','55000');await db.exec('rollback');
  assert.deepEqual(await oldDefs(),baselineDefs);
 });
 console.log(`PASS ${proofs.length} synthetic v193 proof groups\n${proofs.join('\n')}\nLimits: no actual Supabase/restore; two-connection native concurrency is a separate CI service test.`);
}catch(e){console.error(`FAIL ${phase}: ${e.code||e.name} position=${e.position||''}: ${String(e.message).slice(0,500)}`);process.exitCode=1;}
finally{await db.close();}
