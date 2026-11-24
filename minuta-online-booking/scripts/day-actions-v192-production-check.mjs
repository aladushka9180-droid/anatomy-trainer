import fs from 'node:fs';import assert from 'node:assert/strict';
const migration=fs.readFileSync(new URL('../supabase-migration-v192.sql',import.meta.url),'utf8');
const mode=process.argv[2],output=process.argv[3];assert.ok(output);
if(mode==='before'){const prefix=migration.slice(0,migration.indexOf('create table public.provider_day_schedule_v192'));assert.ok(prefix.includes('v192_canonical_source_changed'));fs.writeFileSync(output,prefix+'rollback;\n');}
else{assert.equal(mode,'after');fs.writeFileSync(output,`begin read only;
do $verify$begin
 if obj_description('public.get_minuta_provider_day_v192(uuid,uuid,date)'::regprocedure,'pg_proc') is distinct from 'primetime_provider_day_v192' then raise exception 'v192_marker_missing';end if;
 if (select count(*) from public.provider_day_sources_v192)<>4 or exists(select 1 from public.provider_day_sources_v192 where installed_md5 is distinct from md5(pg_get_functiondef(identity::regprocedure))) then raise exception 'v192_installed_source_mismatch';end if;
 if has_function_privilege('anon','public.save_minuta_provider_day_v192(uuid,uuid,date,uuid,time,time,boolean,text)','EXECUTE') or has_table_privilege('authenticated','public.provider_day_schedule_v192','SELECT') or not has_function_privilege('authenticated','public.save_minuta_provider_day_v192(uuid,uuid,date,uuid,time,time,boolean,text)','EXECUTE') then raise exception 'v192_acl_mismatch';end if;
end $verify$;
rollback;
`);}
