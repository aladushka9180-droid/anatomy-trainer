// Isolated in-memory SQL contract. No connection to a server or user data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PGLITE_MODULE;
assert.ok(modulePath, 'Set MINUTA_PGLITE_MODULE to an isolated PGlite installation');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const secondOrg = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const item = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const request = '11111111-1111-4111-8111-111111111111';
const query = async (sql, params=[]) => (await db.query(sql,params)).rows;
const rejects = async (operation, pattern) => assert.rejects(operation,pattern);

try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key);
    create table public.inventory_items(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,
      name text not null,sku text not null,unit text not null,
      low_stock_threshold numeric not null,active boolean not null,
      updated_at timestamptz not null default clock_timestamp()
    );
    create function public.touch_inventory() returns trigger language plpgsql as $$
      begin new.updated_at:=clock_timestamp();return new;end $$;
    create trigger inventory_touch before update on public.inventory_items
      for each row execute function public.touch_inventory();
    grant select on public.inventory_items to authenticated;
    create function public.get_minuta_inventory_role(p_organization uuid)
    returns text language plpgsql as $$ begin
      if auth.uid() is null or p_organization<>'${org}'::uuid then
        raise exception using errcode='42501',message='inventory_management_denied';
      end if; return 'owner'; end $$;
    create function public.get_minuta_inventory_workspace_v130(p_organization uuid)
    returns jsonb language sql as $$ select jsonb_build_object('organization_id',p_organization,'items','[]'::jsonb) $$;
    create function public.upsert_minuta_inventory_item(
      p_organization uuid,p_item uuid,p_name text,p_sku text,p_unit text,p_low_stock numeric,p_active boolean
    ) returns jsonb language plpgsql as $$ declare v_id uuid; begin
      if p_item is null then
        insert into public.inventory_items(organization_id,name,sku,unit,low_stock_threshold,active)
        values(p_organization,p_name,p_sku,p_unit,p_low_stock,p_active) returning id into v_id;
      else
        update public.inventory_items set name=p_name,sku=p_sku,unit=p_unit,
          low_stock_threshold=p_low_stock,active=p_active
        where id=p_item and organization_id=p_organization returning id into v_id;
      end if;
      return jsonb_build_object('organization_id',p_organization,'id',v_id);
    end $$;
    insert into auth.users values('${owner}'),('${other}');
    insert into public.organizations values('${org}'),('${secondOrg}');
    insert into public.inventory_items(id,organization_id,name,sku,unit,low_stock_threshold,active)
      values('${item}','${org}','Старое имя','S1','piece',1,true);
  `);
  const migration = readFileSync(new URL('../supabase-migration-v181.sql',import.meta.url),'utf8');
  await db.exec(migration);
  await query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.exec('set role authenticated;');
  const workspace = (await query('select public.get_minuta_inventory_workspace_v181($1) data',[org]))[0].data;
  const version = workspace.items.find(row => row.id===item)?.updated_at;
  assert.ok(version);
  const saveSql = `select public.save_minuta_inventory_item_draft_v181(
    $1,$2,$3,$4,$5,$6,$7,$8,$9) data`;
  const args = [org,request,item,version,'Новое имя','S1','piece',2,true];
  const first = (await query(saveSql,args))[0].data;
  assert.equal(first.id,item);
  assert.equal(first.saved,true);
  assert.deepEqual((await query(saveSql,args))[0].data,first,'lost-response replay must return same result');
  assert.equal((await query('select count(*)::int n from public.inventory_items'))[0].n,1);
  await rejects(()=>query('select count(*) from public.inventory_catalog_requests_v181'),/permission denied/);
  await rejects(()=>query(saveSql,[org,request,item,version,'Подмена','S1','piece',2,true]),/inventory_catalog_request_mismatch/);
  await rejects(()=>query(saveSql,[org,'22222222-2222-4222-8222-222222222222',item,version,'Устаревшее','S1','piece',2,true]),/inventory_catalog_version_conflict/);
  await rejects(()=>query(saveSql,[secondOrg,'33333333-3333-4333-8333-333333333333',item,version,'Чужая','S1','piece',2,true]),/inventory_management_denied/);
  await query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  await rejects(()=>query(saveSql,args),/inventory_catalog_request_mismatch/);
  const createArgs=[org,'44444444-4444-4444-8444-444444444444',null,null,'Новая позиция','S2','piece',0,true];
  const created=(await query(saveSql,createArgs))[0].data;
  assert.equal((await query(saveSql,createArgs))[0].data.id,created.id);
  await db.exec('reset role;');
  assert.equal((await query('select count(*)::int n from public.inventory_items'))[0].n,2);
  assert.equal((await query('select count(*)::int n from public.inventory_catalog_requests_v181'))[0].n,2);
  await query('delete from public.inventory_items where id=$1',[created.id]);
  await db.exec('set role authenticated;');
  assert.deepEqual((await query(saveSql,createArgs))[0].data,
    {saved:false,reason:'inventory_item_deleted',organization_id:org,id:created.id});
  await db.exec('reset role;');
  const rollback=readFileSync(new URL('../supabase-migration-v181-rollback.sql',import.meta.url),'utf8');
  await rejects(()=>db.exec(rollback),/v181_catalog_requests_must_be_preserved/);
  await db.exec('rollback;');
  assert.equal((await query('select count(*)::int n from public.inventory_catalog_requests_v181'))[0].n,2);
  await db.exec('delete from public.inventory_catalog_requests_v181;');
  await db.exec(rollback);
  assert.equal((await query("select to_regclass('public.inventory_catalog_requests_v181') relation"))[0].relation,null);
  await db.exec(migration);
  console.log('v181 isolated catalog contract passed: version, replay, mismatch, tenant, actor, create, deletion tombstone, guarded rollback, reapply');
} finally {
  await db.close();
}
