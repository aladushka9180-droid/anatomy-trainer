import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {body,generate,pins,readPinned} from './remaining-eight-restore-sql.mjs';
import {releaseSql,functionChecks} from './remaining-eight-production-sql.mjs';
const read=f=>readFileSync(new URL(f,import.meta.url),'utf8');
test('production release is atomic, additive, pinned and excludes functional writes',()=>{
 const sources=readPinned(new URL('../',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'));
 const apply=releaseSql(sources,'apply'),check=releaseSql(sources,'check'),observe=releaseSql(sources,'observe');
 assert.match(apply,/begin isolation level repeatable read;/);
 assert.equal((apply.match(/^commit;$/gm)||[]).length,1);
 assert.doesNotMatch(apply,/^rollback;|functional_checks|ТЕСТ:|set_minuta_loyalty_program_v166\(/m);
 for(const f of ['supabase-candidate-loyalty-adjustment-preview.sql','statistics-branch-candidate.sql','supabase-candidate-waitlist-offers.sql'])assert.ok(apply.includes(body(sources[f])));
 assert.match(apply,/remaining_eight_changed_original_state/);assert.match(apply,/remaining_eight_installed_source_mismatch/);
 for(const sql of [check,observe]){assert.match(sql,/^begin read only;/);assert.doesNotMatch(sql,/create table|create function|^commit;/m);}
 const guard=read('../../.github/scripts/remaining-eight-release-guard.mjs'),workflow=read('../../.github/workflows/minuta-remaining-eight-release.yml');
 for(const required of ['APPLY_REMAINING_EIGHT_AFTER_USER_APPROVAL','candidateProductionApplyEnvelopeVerified','candidatePositiveLoyaltyAndBranchAndOfferChecks','candidateOriginalPublicRowsAndDefinitionsPreserved','7200000'])assert.ok(guard.includes(required));
 assert.match(workflow,/environment: minuta-production/);assert.match(workflow,/group: minuta-production-database/);
 assert.match(workflow,/default_transaction_read_only=on/);assert.doesNotMatch(workflow,/--echo|cat "\$private_log/);
});
test('installed-body verifier rejects drift',{skip:!process.env.MINUTA_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href);
 const db=new PGlite();try{
  const source="create function public.release_fixture() returns int language sql security definer set search_path='' as $$select 1$$;";
  await db.exec(source);const check='do $$begin '+functionChecks({source}).sql+'end$$;';await db.exec(check);
  await db.exec(source.replace('create function','create or replace function').replace('select 1','select 2'));
  await assert.rejects(()=>db.exec(check),/remaining_eight_installed_source_mismatch/);
 }finally{await db.close();}
});
test('only six exact reviewed SQL sources are admitted',()=>{
 assert.equal(Object.keys(pins).length,6);
 for(const hash of Object.values(pins))assert.match(hash,/^[a-f0-9]{64}$/);
 const directory=mkdtempSync(join(tmpdir(),'remaining-eight-pins-'));
 writeFileSync(join(directory,Object.keys(pins)[0]),'begin; select 1; commit;');
 assert.throws(()=>readPinned(directory),/Unreviewed SQL/);
});
test('outer transaction is removed without altering inner PLpgSQL blocks',()=>{
 const source='-- reviewed\nbegin;\nDO $$\nbegin\n null;\nend $$;\ncommit;\n';
 assert.equal(body(source),'-- reviewed\n\nDO $$\nbegin\n null;\nend $$;\n');
 assert.throws(()=>body('begin; select 1;'),/Assertion/);
});
test('restore remains main-only, private and network-isolated',()=>{
 const shell=read('remaining-eight-restore.sh'),workflow=read('../../.github/workflows/minuta-supabase-restore-drill.yml');
 assert.match(shell,/NetworkMode[\s\S]*= none/);assert.match(shell,/VERBOSITY=default[\s\S]*private_log/);
 assert.doesNotMatch(shell,/SUPABASE_DB_URL|curl|wget|pg_restore|psql "\$/);
 assert.match(workflow,/ephemeral-restore-drill:[\s\S]*github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/test "\$age" -le 7200/);assert.match(workflow,/remaining-eight-restore-sql\.mjs candidate-sql\/minuta-online-booking --verify/);
 const functional=read('remaining-eight-functional.sql');
 assert.match(read('remaining-eight-restore-sql.mjs'),/readFileSync\(new URL\('\.\/remaining-eight-functional\.sql'/);
 for(const contract of ['restored_offer_accept_duplicate','restored_offer_busy_slot_not_protected','restored_offer_expired_write','restored_loyalty_duplicate_adjustment','restored_loyalty_stale_preview_accepted','restored_loyalty_out_of_bounds_accepted','restored_branch_scope_contract_failed'])assert.ok(functional.includes(contract));
 assert.doesNotMatch(functional,/https?:\/\/|dblink|net\.http|\bcommit;/i);
});
const fixture={
 'supabase-candidate-loyalty-adjustment-preview.sql':`begin;
 create function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer) returns jsonb language plpgsql as $$begin raise insufficient_privilege;end$$;
 create function public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid) returns jsonb language plpgsql as $$begin raise insufficient_privilege;end$$;
 revoke all on function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer),public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid) from public;
 grant execute on function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer),public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid) to authenticated;
 commit;`,
 'supabase-candidate-loyalty-adjustment-preview-rollback.sql':'begin;\ndrop function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer),public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid);\ncommit;',
 'statistics-branch-candidate.sql':`begin;
 create function public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb) returns jsonb language plpgsql as $$begin raise insufficient_privilege;end$$;
 revoke all on function public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb) from public;
 grant execute on function public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb) to authenticated;
 commit;`,
 'statistics-branch-rollback.sql':'begin;\ndrop function public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb);\ncommit;',
 'supabase-candidate-waitlist-offers.sql':`begin;
 create table if not exists public.organization_waitlist_offers(id uuid);
 create or replace function public.get_minuta_waitlist_offer_v196(uuid,uuid) returns jsonb language plpgsql as $$begin raise exception 'waitlist_offer_unavailable';end$$;
 create or replace function public.accept_minuta_waitlist_offer_v196(uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
 create or replace function public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz) returns jsonb language sql as $$select '{}'::jsonb$$;
 grant execute on function public.accept_minuta_waitlist_offer_v196(uuid,uuid),public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz) to anon,authenticated;
 commit;`,
 'supabase-candidate-waitlist-offers-rollback.sql':'begin;\nrevoke all on function public.accept_minuta_waitlist_offer_v196(uuid,uuid),public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz) from public,anon,authenticated;\ncommit;'
};
test('SQL rehearsal preserves original state and catches a destructive candidate',{skip:!process.env.MINUTA_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href);
 async function run(sources,functional=''){const db=new PGlite();try{
  await db.exec("create role anon;create role authenticated;create table public.rehearsal_original(id int primary key,value text);insert into public.rehearsal_original values(1,'unchanged');create sequence public.rehearsal_sequence;create function public.rehearsal_legacy() returns int language sql as $$select 42$$;");
  await db.exec(generate(sources,functional).replace('\\set ON_ERROR_STOP on\n',''));
  assert.equal((await db.query('select value from public.rehearsal_original')).rows[0].value,'unchanged');
  assert.equal((await db.query("select to_regclass('public.organization_waitlist_offers') as candidate")).rows[0].candidate,null);
 }finally{await db.close()}}
 await run(fixture);
 await run(fixture,"update public.rehearsal_original set value='temporary fixture';select nextval('public.rehearsal_sequence');");
 assert.throws(()=>generate(fixture,'commit;'),/savepoint/);
 const changed={...fixture};changed['statistics-branch-candidate.sql']=changed['statistics-branch-candidate.sql'].replace('commit;',"update public.rehearsal_original set value='changed';commit;");
 await assert.rejects(()=>run(changed),/remaining_eight_changed_original_state/);
 const changedFunction={...fixture};changedFunction['statistics-branch-candidate.sql']=changedFunction['statistics-branch-candidate.sql'].replace('commit;',()=> 'create or replace function public.rehearsal_legacy() returns int language sql as $$select 99$$;commit;');
 await assert.rejects(()=>run(changedFunction),/remaining_eight_changed_original_state/);
});

 test('functional diagnostics redact arbitrary database messages',{skip:!process.env.MINUTA_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href);
 const sql=read('remaining-eight-functional.sql');
 for(const [index,input] of [sql,sql.replace(/begin\r?\n/,()=>"begin\n raise exception 'PRIVATE_SENTINEL';\n")].entries()){
  const db=new PGlite();try{
   await assert.rejects(()=>db.exec(input),error=>{
    assert.match(error.message,/^remaining-eight-phase=fixture state=(42P01|P0001) check=redacted$/);
    assert.ok(!error.message.includes('PRIVATE_SENTINEL'));assert.ok(error.message.includes(index===1?'state=P0001':'state=42P01'));return true;
   });
  }finally{await db.close()}
 }
 });
