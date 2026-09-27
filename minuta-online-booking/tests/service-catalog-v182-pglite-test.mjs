// In-memory service catalog contract; no server, credentials, or user data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

assert.ok(process.env.MINUTA_PGLITE_MODULE,'Set MINUTA_PGLITE_MODULE');
const { PGlite } = await import(pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href);
const db=new PGlite();
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const foreignOrg='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const service='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const query=async(sql,params=[])=>(await db.query(sql,params)).rows;
const save='select public.save_minuta_service_catalog_draft_v182($1,$2,$3,$4,$5,$6,$7,$8) data';

try {
  await db.exec(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text not null);
    create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean not null);
    create table public.services(id uuid primary key default gen_random_uuid(),performer_id uuid not null,
      name text not null,duration_minutes integer not null,price_rub integer not null,active boolean not null);
    create table public.service_public_details_v159(service_id uuid primary key references public.services(id) on delete cascade,
      short_description text not null default '',highlights text[] not null default '{}'::text[],
      important_note text not null default '',photo_storage_path text not null default '',
      photo_alt text not null default '',photo_width integer,photo_height integer);
    insert into auth.users values('${actor}'),('${other}');
    insert into public.organizations values('${org}','active'),('${foreignOrg}','active');
    insert into public.organization_memberships values('${org}','${actor}',true);
    insert into public.services values('${service}','${actor}','Исходная услуга',60,1000,true);
    insert into public.service_public_details_v159(service_id,short_description,photo_storage_path)
      values('${service}','Описание сохранено','${actor}/services/${service}/photo.webp');
  `);
  const migration=read('../supabase-migration-v182.sql');
  await db.exec(migration);
  await query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await db.exec('set role authenticated;');
  const initial=(await query('select public.get_minuta_service_catalog_draft_v182($1,$2) data',[org,service]))[0].data;
  assert.match(initial.etag,/^[0-9a-f]{32}$/);
  const request='11111111-1111-4111-8111-111111111111';
  const args=[org,request,service,initial.etag,'Новая услуга',75,1200,true];
  const saved=(await query(save,args))[0].data;
  assert.equal(saved.saved,true);
  assert.notEqual(saved.etag,initial.etag);
  assert.deepEqual((await query(save,args))[0].data,saved);
  await assert.rejects(()=>query(save,[org,request,service,initial.etag,'Подмена',75,1200,true]),/service_catalog_request_mismatch/);
  await assert.rejects(()=>query(save,[org,'22222222-2222-4222-8222-222222222222',service,initial.etag,'Устаревшее',75,1200,true]),/service_catalog_version_conflict/);
  await assert.rejects(()=>query(save,[foreignOrg,'33333333-3333-4333-8333-333333333333',service,initial.etag,'Чужая',75,1200,true]),/service_catalog_organization_denied/);
  const createdArgs=[org,'44444444-4444-4444-8444-444444444444',null,null,'Новая позиция услуг',45,500,true];
  const created=(await query(save,createdArgs))[0].data;
  assert.equal((await query(save,createdArgs))[0].data.id,created.id);
  await db.exec('reset role;');
  assert.equal((await query('select count(*)::int n from public.services'))[0].n,2);
  assert.equal((await query('select count(*)::int n from public.service_catalog_requests_v182'))[0].n,2);
  assert.equal((await query('select short_description from public.service_public_details_v159 where service_id=$1',[service]))[0].short_description,'Описание сохранено');
  await query('update public.service_public_details_v159 set short_description=$1 where service_id=$2',['Внешняя правка',service]);
  await db.exec('set role authenticated;');
  await assert.rejects(()=>query(save,[org,'55555555-5555-4555-8555-555555555555',service,saved.etag,'Конфликт',75,1200,true]),/service_catalog_version_conflict/);
  assert.deepEqual((await query(save,args))[0].data,{saved:false,reason:'service_changed_after_save',id:service});
  await db.exec('reset role;');
  await query('delete from public.services where id=$1',[created.id]);
  await db.exec('set role authenticated;');
  assert.deepEqual((await query(save,createdArgs))[0].data,{saved:false,reason:'service_deleted',id:created.id});
  await db.exec('reset role;');
  const rollback=read('../supabase-migration-v182-rollback.sql');
  await assert.rejects(()=>db.exec(rollback),/v182_service_requests_must_be_preserved/);
  await db.exec('rollback;');
  await db.exec('delete from public.service_catalog_requests_v182;');
  await db.exec(rollback);
  assert.equal((await query("select to_regclass('public.service_catalog_requests_v182') value"))[0].value,null);
  await db.exec(migration);
  console.log('v182 isolated service catalog: version, replay, scope, details preservation, later change, deletion, rollback, reapply passed');
} finally { await db.close(); }
