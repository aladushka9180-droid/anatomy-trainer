import {writeFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readPinned,body,generate} from './remaining-eight-restore-sql.mjs';
const files=['supabase-candidate-loyalty-adjustment-preview.sql','statistics-branch-candidate.sql','supabase-candidate-waitlist-offers.sql'];
export function functionChecks(sources){
 const functions=[];
 for(const sql of Object.values(sources))for(const m of sql.matchAll(/create(?: or replace)? function public\.([a-z0-9_]+)\([\s\S]*?\bas\s+(\$[a-z_]*\$)([\s\S]*?)\2;/gi)){
  const hash=createHash('md5').update(m[3].replace(/\s+/g,'')).digest('hex');
  functions.push({name:m[1],hash});
 }
 return {functions,sql:functions.map(({name,hash})=>String.raw`if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${name}' and p.prosecdef and p.proconfig @> array['search_path=""'] and md5(regexp_replace(p.prosrc,'\s+','','g'))='${hash}')<>1 then raise exception 'remaining_eight_installed_source_mismatch';end if;`).join('\n')};
}
export function releaseSql(sources,phase){
 assert.ok(['check','apply','observe'].includes(phase));
 const checks=functionChecks(Object.fromEntries(files.map(f=>[f,sources[f]])));assert.equal(checks.functions.length,8);
 const absent=String.raw`do $absent$ begin
 if to_regclass('public.organization_waitlist_offers') is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[${checks.functions.map(f=>"'"+f.name+"'").join(',')}])) then raise exception 'remaining_eight_already_present_inspect_before_retry';end if;
end $absent$;`;
 const installed=String.raw`do $installed$ begin
${checks.sql}
if not (select relrowsecurity from pg_class where oid='public.organization_waitlist_offers'::regclass) or not exists(select 1 from pg_policy where polrelid='public.organization_waitlist_offers'::regclass and polname='organization_waitlist_offers_read') then raise exception 'remaining_eight_offer_rls_missing';end if;
if has_table_privilege('anon','public.organization_waitlist_offers','SELECT') or has_table_privilege('authenticated','public.organization_waitlist_offers','INSERT,UPDATE,DELETE') or not has_table_privilege('authenticated','public.organization_waitlist_offers','SELECT') then raise exception 'remaining_eight_offer_table_access';end if;
`+[
 ['preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)',false,true],
 ['confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)',false,true],
 ['minuta_statistics_branch_scope_candidate(uuid,date,date,uuid,uuid)',false,false],
 ['get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb)',false,true],
 ['get_minuta_waitlist_offer_v196(uuid,uuid)',true,true],
 ['accept_minuta_waitlist_offer_v196(uuid,uuid)',true,true],
 ['get_minuta_waitlist_employee_v196(uuid)',false,true],
 ['create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz)',false,true]
 ].map(([signature,anon,auth])=>`if has_function_privilege('anon','public.${signature}','EXECUTE') is distinct from ${anon} or has_function_privilege('authenticated','public.${signature}','EXECUTE') is distinct from ${auth} then raise exception 'remaining_eight_rpc_acl_mismatch';end if;`).join('\n')+String.raw`
end $installed$;`;
 if(phase==='observe')return 'begin read only;\n'+installed+'\nrollback;\n';
 if(phase==='check')return 'begin read only;\n'+absent+'\nrollback;\n';
 const rehearsal=generate(sources),first=body(sources[files[0]]);
 let prefix=rehearsal.slice(0,rehearsal.indexOf(first));assert.ok(prefix.includes('create temp table before_eight'));
 prefix=prefix.replace('begin;','begin isolation level repeatable read;').replace(/do \$target\$[\s\S]*?end \$target\$;/,'');
 return prefix+'\n'+absent+'\n'+files.map(f=>body(sources[f])).join('\n')+String.raw`
do $preservation$ begin
 if (select value from before_eight) is distinct from pg_temp.original_eight_snapshot() then raise exception 'remaining_eight_changed_original_state';end if;
end $preservation$;
`+installed+'\ncommit;\n';
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const sources=readPinned(process.argv[4]||fileURLToPath(new URL('../',import.meta.url)));
 const rehearsal=process.argv[2]==='rehearse';
 const sql=releaseSql(sources,rehearsal?'apply':process.argv[2]);
 writeFileSync(process.argv[3],rehearsal?sql.replace(/\ncommit;\n$/,'\nrollback;\n'):sql);
}
