import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const migration=fs.readFileSync(new URL('../supabase-migration-v193.sql',import.meta.url),'utf8');
const mode=process.argv[2], output=process.argv[3];
assert.ok(output);
if(mode==='before') {
  const end=migration.indexOf('alter table public.inventory_items add column');
  assert.ok(end>0 && migration.slice(0,end).includes('v193_inventory_reader_drift'));
  fs.writeFileSync(output,migration.slice(0,end)+'rollback;\n');
} else {
  assert.equal(mode,'after');
  const signatures=[
    ['upsert_minuta_inventory_item_v193','uuid,uuid,text,text,text,numeric,boolean,text,text'],
    ['get_minuta_inventory_workspace','uuid']
  ];
  const checks=signatures.map(([name,args])=>{
    const body=migration.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;'))?.[1];
    assert.ok(body, name);
    const digest=createHash('md5').update(body.replace(/\s+/g,'')).digest('hex');
    return `if md5(regexp_replace((select prosrc from pg_proc where oid='public.${name}(${args})'::regprocedure),'\\s+','','g')) is distinct from '${digest}' then raise exception 'v193_installed_source_mismatch'; end if;`;
  }).join('\n');
  fs.writeFileSync(output,`begin read only;
do $verify$ begin
${checks}
if (select count(*) from information_schema.columns where table_schema='public' and table_name='inventory_items' and column_name in ('category','icon_key') and data_type='text' and is_nullable='NO')<>2 then raise exception 'v193_columns_missing'; end if;
if (select count(*) from pg_constraint where conrelid='public.inventory_items'::regclass and conname in ('inventory_item_category_v193','inventory_item_icon_v193') and convalidated)<>2 then raise exception 'v193_constraints_missing'; end if;
if has_function_privilege('anon','public.upsert_minuta_inventory_item_v193(uuid,uuid,text,text,text,numeric,boolean,text,text)','EXECUTE') or not has_function_privilege('authenticated','public.upsert_minuta_inventory_item_v193(uuid,uuid,text,text,text,numeric,boolean,text,text)','EXECUTE') then raise exception 'v193_acl_mismatch'; end if;
end $verify$;
rollback;
`);
}
