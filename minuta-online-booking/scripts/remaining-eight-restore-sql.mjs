import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

export const pins=Object.freeze({
 'supabase-candidate-loyalty-adjustment-preview.sql':'ccf73b354d02a5479c41cfcc5093a81d99938a3dd39e7747056b94a30a0bb722',
 'supabase-candidate-loyalty-adjustment-preview-rollback.sql':'f8979d7e2e4ca7524113d332e28697645fe5997ca1133b904ccb730dfc394cac',
 'statistics-branch-candidate.sql':'3fdb5fae6406b7cb0a3d2f2b6f9374f97e2c58cff55c6ad0c83ae3b7e1fe9a39',
 'statistics-branch-rollback.sql':'7ccfcf7a3f8da3a11c4b314d494792ee15a1e5bd50f3cbe6dcfe8af0fc5fe1c6',
 'supabase-candidate-waitlist-offers.sql':'d9782e98e6e933cff2a0edae8d92cf300bcfd3f5bd218c82ce20800650228b84',
 'supabase-candidate-waitlist-offers-rollback.sql':'6be25d450906f0cc99b2b4e1a3506d89a1849e02ae2ff8c05f494935aeb0c127',
});
export function readPinned(directory){
 return Object.fromEntries(Object.entries(pins).map(([file,pin])=>{
  const text=readFileSync(resolve(directory,file),'utf8').replace(/\r\n/g,'\n');
  assert.equal(createHash('sha256').update(text).digest('hex'),pin,`Unreviewed SQL: ${file}`);
  return [file,text];
 }));
}
export function body(sql){
 assert.match(sql,/^begin;\s*$/mi);assert.match(sql,/\bcommit;\s*$/i);
 return sql.replace(/^begin;\s*$/mi,'').replace(/\bcommit;\s*$/i,'');
}
export function generate(sources,functionalSql=''){
 assert.doesNotMatch(functionalSql,/^\s*(?:begin|commit|rollback|savepoint|release);/mi,'Fixture must stay inside our savepoint');
 const functional=functionalSql ? String.raw`
savepoint functional_checks;
`+functionalSql+String.raw`
rollback to savepoint functional_checks;
do $functional_preservation$ declare expected jsonb; actual jsonb; sequence_keys text[]; begin
 select coalesce(array_agg(relname::text),array[]::text[]) into sequence_keys from original_eight_relations where relkind='S';
 select jsonb_set(value,'{rows}',(value->'rows')-sequence_keys) into expected from before_eight;
 actual:=pg_temp.original_eight_snapshot();actual:=jsonb_set(actual,'{rows}',(actual->'rows')-sequence_keys);
 if expected is distinct from actual then raise exception 'remaining_eight_functional_rollback_changed_original_state';end if;
 if exists(select 1 from public.organization_waitlist_offers) then raise exception 'remaining_eight_functional_offers_not_rolled_back';end if;
end $functional_preservation$;
-- nextval is not transactional; synthetic sequence advances exist only in the destroyed copy.
` : '';
 const apply=['supabase-candidate-loyalty-adjustment-preview.sql','statistics-branch-candidate.sql','supabase-candidate-waitlist-offers.sql'].map(f=>body(sources[f])).join('\n');
 const rollback=['supabase-candidate-waitlist-offers-rollback.sql','statistics-branch-rollback.sql','supabase-candidate-loyalty-adjustment-preview-rollback.sql'].map(f=>body(sources[f])).join('\n');
 const unchanged=String.raw`do $check$ begin
 if (select value from before_eight) is distinct from pg_temp.original_eight_snapshot() then
  raise exception using errcode='55000',message='remaining_eight_changed_original_state';
 end if;
end $check$;`;
 const checks=String.raw`
do $checks$ begin
 if has_function_privilege('anon','public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)','EXECUTE')
 or has_function_privilege('anon','public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)','EXECUTE')
 or has_function_privilege('anon','public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb)','EXECUTE')
 then raise exception 'remaining_eight_anonymous_management_access'; end if;
 if not has_function_privilege('authenticated','public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)','EXECUTE')
 or not has_function_privilege('authenticated','public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)','EXECUTE')
 or not has_function_privilege('authenticated','public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb)','EXECUTE')
 then raise exception 'remaining_eight_authenticated_contract_missing'; end if;
end $checks$;
savepoint negative_checks;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000000',true);
do $negative$ declare d uuid:='00000000-0000-4000-8000-000000000000'; begin
 begin perform public.preview_minuta_loyalty_adjustment_v166(d,d,1);raise exception 'preview_accepted_missing_membership';exception when insufficient_privilege then null;end;
 begin perform public.confirm_minuta_loyalty_adjustment_v166(d,d,1,'Synthetic check',d,0,1,d);raise exception 'confirm_accepted_missing_membership';exception when insufficient_privilege then null;end;
 begin perform public.get_minuta_statistics_branch_candidate(d,current_date,current_date,null,null,'bookings',1,null);raise exception 'branch_accepted_missing_membership';exception when insufficient_privilege then null;end;
 begin perform public.get_minuta_waitlist_offer_v196(d,d);raise exception 'offer_accepted_missing_capability';exception when sqlstate 'P0001' then
  if sqlerrm<>'waitlist_offer_unavailable' then raise;end if;
 end;
end $negative$;
rollback to savepoint negative_checks;
`;
 return String.raw`\set ON_ERROR_STOP on
begin;
set local statement_timeout='8min';
set local lock_timeout='5s';
do $target$ begin
 if current_setting('server_version_num')::integer not between 170000 and 179999 then raise exception 'PG17 required';end if;
 if to_regclass('public.organization_waitlist_offers') is not null then raise exception 'candidate_table_already_exists';end if;
end $target$;
create temp table original_eight_relations as select c.oid,c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','S');
create temp table original_eight_functions as select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind in ('f','p');
create temp table original_eight_constraints as select oid from pg_constraint where conrelid in(select oid from original_eight_relations);
create temp table original_eight_triggers as select oid from pg_trigger where tgrelid in(select oid from original_eight_relations);
create function pg_temp.original_eight_snapshot() returns jsonb language plpgsql as $snapshot$
declare r record; h text; result jsonb:='{}';begin
 for r in select * from original_eight_relations loop
  if r.relkind='S' then
   execute format('select md5(last_value::text||''|''||is_called::text) from public.%I',r.relname) into h;
  else
   execute format('select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',r.relname) into h;
  end if;
  result:=result||jsonb_build_object(r.relname,h);
 end loop;
 return jsonb_build_object('rows',result,
 'functions',(select md5(coalesce(string_agg(to_jsonb(p)::text||pg_get_functiondef(p.oid),'' order by p.oid),'')) from pg_proc p join original_eight_functions o on o.oid=p.oid),
 'relations',(select md5(coalesce(string_agg(jsonb_build_object('oid',c.oid,'name',c.relname,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'kind',c.relkind)::text,'' order by c.oid),'')) from pg_class c join original_eight_relations o on o.oid=c.oid),
 'attributes',(select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.attrelid,a.attnum),'')) from pg_attribute a where a.attrelid in(select oid from original_eight_relations) and a.attnum>0),
 'defaults',(select md5(coalesce(string_agg(to_jsonb(a)::text,'' order by a.oid),'')) from pg_attrdef a where a.adrelid in(select oid from original_eight_relations)),
 'constraints',(select md5(coalesce(string_agg(to_jsonb(c)::text,'' order by c.oid),'')) from pg_constraint c where c.oid in(select oid from original_eight_constraints)),
 'triggers',(select md5(coalesce(string_agg(to_jsonb(t)::text,'' order by t.oid),'')) from pg_trigger t where t.oid in(select oid from original_eight_triggers)),
 'policies',(select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by p.oid),'')) from pg_policy p where p.polrelid in(select oid from original_eight_relations)));
end $snapshot$;
create temp table before_eight as select pg_temp.original_eight_snapshot() as value;
`+apply+'\n'+unchanged+'\n'+checks+'\n'+unchanged+'\n'+rollback+String.raw`
do $rollback$ begin
 if to_regprocedure('public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)') is not null
 or to_regprocedure('public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb)') is not null
 then raise exception 'remaining_eight_rollback_contract';end if;
 if has_function_privilege('anon','public.accept_minuta_waitlist_offer_v196(uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz)','EXECUTE')
 then raise exception 'remaining_eight_offer_rollback_access';end if;
end $rollback$;
`+unchanged+'\n'+apply+'\n'+checks+'\n'+unchanged+'\n'+functional+String.raw`
rollback;
select 'remaining-eight exact restored-public apply/read/rollback/reapply PASS';
`;
}
if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){
 const sources=readPinned(process.argv[2]);
 if(process.argv[3]!=='--verify'){
  assert.ok(process.argv[3],'output path required');
  const functional=readFileSync(new URL('./remaining-eight-functional.sql',import.meta.url),'utf8');
  writeFileSync(resolve(process.argv[3]),generate(sources,functional),{mode:0o600});
 }
 console.log('Six reviewed SQL files verified');
}
