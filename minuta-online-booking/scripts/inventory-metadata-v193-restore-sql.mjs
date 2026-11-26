import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),read=n=>readFileSync(new URL(n,root),'utf8');
assert.ok(process.argv[2],'output path required');
const migration=read('supabase-migration-v193.sql'),rollback=read('supabase-migration-v193-rollback.sql');
const sql=String.raw`\set ON_ERROR_STOP on
create function pg_temp.inventory_snapshot_v193() returns jsonb language plpgsql as $snapshot$
declare t text; h text; result jsonb:='{}';
begin
 foreach t in array array['bookings','booking_outcomes','inventory_items','inventory_movements','inventory_stock_balances','inventory_service_usage','inventory_audit_log','organization_inventory_settings'] loop
   execute format('select md5(coalesce(string_agg((to_jsonb(r)-''category''-''icon_key'')::text,E''\\n'' order by (to_jsonb(r)-''category''-''icon_key'')::text),'''')) from public.%I r',t) into h;
   result:=result||jsonb_build_object(t,h);
 end loop;
 return result;
end $snapshot$;
create temp table before_v193 as select pg_temp.inventory_snapshot_v193() as snapshot,pg_get_functiondef('public.get_minuta_inventory_workspace(uuid)'::regprocedure) as reader;
`+migration+'\n'+migration+String.raw`
do $check$ begin
 if (select snapshot from before_v193)<>pg_temp.inventory_snapshot_v193() then raise exception 'v193_apply_changed_original_rows'; end if;
 if has_function_privilege('anon','public.upsert_minuta_inventory_item_v193(uuid,uuid,text,text,text,numeric,boolean,text,text)','EXECUTE') then raise exception 'v193_anon_access'; end if;
end $check$;
begin;
do $functional$
declare i public.inventory_items%rowtype; u uuid; w jsonb;
begin
 select item.* into i from public.inventory_items item
 join public.organizations o on o.id=item.organization_id and o.status='active'
 join public.organization_inventory_settings s on s.organization_id=o.id and s.enabled
 join public.organization_memberships m on m.organization_id=o.id and m.active and m.role in ('owner','admin')
 order by item.id,m.user_id limit 1;
 if i.id is null then raise exception 'v193_no_qualified_clone_item'; end if;
 select user_id into u from public.organization_memberships where organization_id=i.organization_id and active and role in ('owner','admin') order by user_id limit 1;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform public.upsert_minuta_inventory_item_v193(i.organization_id,i.id,i.name,i.sku,i.unit,i.low_stock_threshold,i.active,'Учебная категория','glove');
 w:=public.get_minuta_inventory_workspace_v130(i.organization_id);
 if not exists(select 1 from jsonb_array_elements(w->'items') x where x->>'id'=i.id::text and x->>'category'='Учебная категория' and x->>'icon_key'='glove') then raise exception 'v193_metadata_roundtrip'; end if;
 perform public.upsert_minuta_inventory_item(i.organization_id,i.id,i.name,i.sku,i.unit,i.low_stock_threshold,i.active);
 if not exists(select 1 from public.inventory_items where id=i.id and icon_key='glove') then raise exception 'v193_old_writer_erased_metadata'; end if;
 begin
   perform public.upsert_minuta_inventory_item_v193(i.organization_id,i.id,i.name,i.sku,i.unit,i.low_stock_threshold,i.active,repeat('я',61),'glove');
   raise exception 'v193_invalid_category_accepted';
 exception when invalid_parameter_value then null; end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   perform public.upsert_minuta_inventory_item_v193(i.organization_id,i.id,i.name,i.sku,i.unit,i.low_stock_threshold,i.active,'','');
   raise exception 'v193_unauthenticated_write';
 exception when insufficient_privilege then null; end;
end $functional$;
rollback;
`+rollback+String.raw`
do $check$ begin
 if (select snapshot from before_v193)<>pg_temp.inventory_snapshot_v193() then raise exception 'v193_rollback_changed_original_rows'; end if;
 if (select reader from before_v193)<>pg_get_functiondef('public.get_minuta_inventory_workspace(uuid)'::regprocedure) then raise exception 'v193_reader_not_restored'; end if;
end $check$;
`+migration+String.raw`
do $check$ begin
 if (select snapshot from before_v193)<>pg_temp.inventory_snapshot_v193() then raise exception 'v193_reapply_changed_original_rows'; end if;
end $check$;
`;
writeFileSync(resolve(process.argv[2]),sql,{mode:0o600});
