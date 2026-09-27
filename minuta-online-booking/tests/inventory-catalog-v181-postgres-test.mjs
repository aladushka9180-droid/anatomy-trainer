// Two-connection test against an ephemeral local PostgreSQL only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const url = new URL(process.env.MINUTA_V181_ISOLATED_DATABASE_URL || '');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname === '/isolated_v181',
  'v181 test accepts only a local ephemeral isolated_v181 database');
const { Client } = await import('pg');
const clients=[];
const connect=async()=>{const client=new Client({connectionString:url.href});await client.connect();clients.push(client);return client;};
const admin=await connect(), first=await connect(), second=await connect();
const query=(client,sql,params=[])=>client.query(sql,params).then(result=>result.rows);
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const item='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const save=`select public.save_minuta_inventory_item_draft_v181($1,$2,$3,$4,$5,$6,$7,$8,$9) data`;
const requestOne='11111111-1111-4111-8111-111111111111';
const requestTwo='22222222-2222-4222-8222-222222222222';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const attempt=promise=>promise.then(value=>({value}),error=>({error}));

try {
  await admin.query(`
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
    insert into public.organizations values('${org}');
    insert into public.inventory_items(id,organization_id,name,sku,unit,low_stock_threshold,active)
      values('${item}','${org}','База','S1','piece',1,true);
  `);
  await admin.query(readFileSync(new URL('../supabase-migration-v181.sql',import.meta.url),'utf8'));
  for(const client of [first,second]){
    await query(client,"select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    await client.query('set role authenticated');
  }
  const workspace=(await query(first,'select public.get_minuta_inventory_workspace_v181($1) data',[org]))[0].data;
  const version=workspace.items[0].updated_at;
  const argsOne=[org,requestOne,item,version,'Первая правка','S1','piece',2,true];
  const argsTwo=[org,requestTwo,item,version,'Вторая правка','S1','piece',3,true];
  await first.query('begin');
  const saved=(await query(first,save,argsOne))[0].data;
  const competing=attempt(query(second,save,argsTwo));
  await sleep(150);
  await first.query('commit');
  const conflict=await competing;
  assert.equal(conflict.error?.message,'inventory_catalog_version_conflict');
  assert.deepEqual((await query(second,save,argsOne))[0].data,saved,'lost response must replay');
  assert.equal((await query(admin,'select count(*)::int n from public.inventory_catalog_requests_v181'))[0].n,1);
  const createdArgs=[org,'33333333-3333-4333-8333-333333333333',null,null,'Новый материал','S2','piece',0,true];
  await first.query('begin');
  const created=(await query(first,save,createdArgs))[0].data;
  const duplicate=attempt(query(second,save,createdArgs));
  await sleep(150);
  await first.query('commit');
  assert.deepEqual((await duplicate).value?.[0]?.data,created,'parallel identical create must return one id');
  assert.equal((await query(admin,'select count(*)::int n from public.inventory_items'))[0].n,2);
  assert.equal((await query(admin,'select count(*)::int n from public.inventory_catalog_requests_v181'))[0].n,2);
  await query(second,"select set_config('request.jwt.claim.sub',$1,false)",[other]);
  const stolen=await attempt(query(second,save,argsOne));
  assert.equal(stolen.error?.message,'inventory_catalog_request_mismatch');
  await query(admin,'update public.inventory_items set name=$1 where id=$2',['Последующая правка',item]);
  assert.deepEqual((await query(first,save,argsOne))[0].data,
    {saved:false,reason:'inventory_item_changed_after_save',organization_id:org,id:item});
  await query(admin,'delete from public.inventory_items where id=$1',[created.id]);
  assert.deepEqual((await query(first,save,createdArgs))[0].data,
    {saved:false,reason:'inventory_item_deleted',organization_id:org,id:created.id});
  console.log('v181 isolated PostgreSQL: parallel conflict, lost response, parallel create, actor isolation, later change and deletion tombstone passed');
} finally {
  await Promise.allSettled(clients.map(client=>client.end()));
}
