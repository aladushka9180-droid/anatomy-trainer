import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',root))],{stdio:'inherit'});
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const body=p=>{const s=read(p);assert.equal((s.match(/^begin;$/gm)||[]).length,1);assert.equal((s.match(/^commit;$/gm)||[]).length,1);return s.replace(/^begin;$/m,'').replace(/^commit;$/m,'');};
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'day-v192-'));
try{
 const canonical=fs.readdirSync(new URL('tests/day-actions-v192-canonical/',root)).filter(p=>p.endsWith('.sql')).sort().map(p=>read('tests/day-actions-v192-canonical/'+p)+';').join('\n');
 const sql=String.raw`\set ON_ERROR_STOP on
begin;
select set_config('daytest.expected_ref', :'expected_ref', true);
set local lock_timeout='5s';set local statement_timeout='120s';
do $$begin
 if (select count(*) from minuta_migration_guard.target where project_ref=current_setting('daytest.expected_ref') and allow_migrations)<>1 then raise exception 'isolated_target_marker_required';end if;
end $$;
-- Network transport is suppressed only within this rollback-only test transaction.
-- No trigger arguments or headers are selected or logged.
do $$declare r record;begin
 for r in select n.nspname,c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal and n.nspname='public' and pn.nspname='supabase_functions' and p.proname='http_request'
 loop execute format('alter table %I.%I disable trigger %I',r.nspname,r.relname,r.tgname);end loop;
end $$;
`+canonical+'\n'+body('supabase-migration-v192.sql')+'\n'+read('tests/booking-concurrency-v123-fixture.sql')+'\n'+read('tests/day-actions-v192-integration.sql')+'\n'+body('supabase-migration-v192-rollback.sql')+String.raw`
select pg_temp.day_assert(not has_function_privilege('authenticated','public.save_minuta_provider_day_v192(uuid,uuid,date,uuid,time,time,boolean,text)','EXECUTE'),'rollback_revoked_writes');
select pg_temp.day_assert((select count(*)=1 from public.provider_day_schedule_v192),'rollback_kept_dates');
select pg_temp.day_assert((select bool_and(md5(pg_get_functiondef(identity::regprocedure))=original_md5) from public.provider_day_sources_v192),'rollback_exact_source');
rollback;
select case when to_regclass('public.provider_day_schedule_v192') is null then 'PASS: day-hours, native exception block, replay, tombstone, conflicts, scope, ACL, exact code rollback, zero committed rows' else 'FAIL: test transaction persisted schema' end;
`;
 const file=path.join(directory,'test.sql');fs.writeFileSync(file,sql);
 const ref=process.env.MINUTA_TEST_PROJECT_REF;assert.match(ref,/^[a-z0-9-]{6,64}$/);
 const result=spawnSync('psql',[process.env.MINUTA_TEST_DATABASE_URL.replace(':6543',':5432'),'-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=terse','-v','expected_ref='+ref,'-f',file],{encoding:'utf8',env:{...process.env,PGOPTIONS:(process.env.PGOPTIONS||'')+' -c daytest.expected_ref='+ref},maxBuffer:2e6});
 if(result.status!==0){console.error('Isolated v192 SQL failed:',String(result.stderr||'').slice(-2200));process.exitCode=1;}
 else {const verdict=result.stdout.split(/\r?\n/).filter(s=>/^(PASS|FAIL):/.test(s));assert.equal(verdict.length,1);assert.ok(verdict[0].startsWith('PASS:'));console.log(verdict[0]);}
}finally{fs.rmSync(directory,{recursive:true,force:true});}
