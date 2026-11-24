import fs from 'node:fs';import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const body=s=>{assert.equal((s.match(/^begin;$/gm)||[]).length,1);assert.equal((s.match(/^commit;$/gm)||[]).length,1);return s.replace(/^begin;$/m,'').replace(/^commit;$/m,'');};
const checks=`
do $check$ declare r record;v text;begin
 for r in select * from day_restore_baseline loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',r.name) into v;
  if v is distinct from r.digest then raise exception 'v192_existing_rows_changed';end if;
 end loop;
end $check$;
`;
const baseline=`
create temporary table day_restore_baseline(name text primary key,digest text) on commit drop;
do $baseline$declare n text;v text;begin
 foreach n in array array['bookings','services','provider_schedule','provider_days_off','booking_outcomes'] loop
  execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',n) into v;
  insert into day_restore_baseline values(n,v);
 end loop;
end $baseline$;
`;
const migration=read('supabase-migration-v192.sql'),rollback=read('supabase-migration-v192-rollback.sql');
const sql='begin;\n'+baseline+body(migration)+checks+body(rollback)+checks+`
 do $restore$begin
  if exists(select 1 from public.provider_day_sources_v192 where md5(pg_get_functiondef(identity::regprocedure)) is distinct from original_md5) then raise exception 'v192_original_definition_not_restored';end if;
 end $restore$;
 rollback;
`+migration+`
 do $fresh$begin
  if obj_description('public.get_minuta_provider_day_v192(uuid,uuid,date)'::regprocedure,'pg_proc')<>'primetime_provider_day_v192' then raise exception 'v192_final_apply_not_confirmed';end if;
  if has_table_privilege('authenticated','public.provider_day_schedule_v192','SELECT') or not has_function_privilege('authenticated','public.save_minuta_provider_day_v192(uuid,uuid,date,uuid,time,time,boolean,text)','EXECUTE') then raise exception 'v192_acl_invalid';end if;
 end $fresh$;
`;
assert.ok(process.argv[2]);fs.writeFileSync(process.argv[2],sql);
