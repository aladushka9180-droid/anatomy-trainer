// Two-connection service catalog test against ephemeral local PostgreSQL only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const url=new URL(process.env.MINUTA_V186_ISOLATED_DATABASE_URL || '');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname==='/isolated_v186',
  'v186 test accepts only a local ephemeral isolated_v186 database');
const { Client }=await import('pg');
const clients=[];
const connect=async()=>{const client=new Client({connectionString:url.href});await client.connect();clients.push(client);return client;};
const admin=await connect(),first=await connect(),second=await connect();
const query=(client,sql,params=[])=>client.query(sql,params).then(result=>result.rows);
const attempt=promise=>promise.then(value=>({value}),error=>({error}));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const org='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const foreignOrg='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const service='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const save='select public.save_minuta_service_catalog_draft_v186($1,$2,$3,$4,$5,$6,$7,$8) data';

try {
  await admin.query(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    create table auth.users(id uuid primary key);
    create table public.organizations(id uuid primary key,status text not null);
    create table public.organization_memberships(organization_id uuid,user_id uuid,
      role text not null check(role in ('owner','admin','specialist')),active boolean not null);
    create table public.services(id uuid primary key default gen_random_uuid(),performer_id uuid not null,
      name text not null,duration_minutes integer not null,price_rub integer not null,active boolean not null);
    create table public.service_public_details_v159(service_id uuid primary key references public.services(id) on delete cascade,
      short_description text not null default '',highlights text[] not null default '{}'::text[],
      important_note text not null default '',photo_storage_path text not null default '',
      photo_alt text not null default '',photo_width integer,photo_height integer);
    insert into auth.users values('${actor}'),('${other}');
    insert into public.organizations values('${org}','active'),('${foreignOrg}','active');
    insert into public.organization_memberships values('${org}','${actor}','owner',true);
    insert into public.services values('${service}','${actor}','Исходная услуга',60,1000,true);
    insert into public.service_public_details_v159(service_id,short_description,photo_storage_path)
      values('${service}','Описание сохранено','${actor}/services/${service}/photo.webp');
  `);
  await admin.query(readFileSync(new URL('../supabase-migration-v186.sql',import.meta.url),'utf8'));
  for(const client of [first,second]){
    await query(client,"select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    await client.query('set role authenticated');
  }
  const initial=(await query(first,'select public.get_minuta_service_catalog_draft_v186($1,$2) data',[org,service]))[0].data;
  const argsOne=[org,'11111111-1111-4111-8111-111111111111',service,initial.etag,'Первая правка',75,1200,true];
  const argsTwo=[org,'22222222-2222-4222-8222-222222222222',service,initial.etag,'Вторая правка',80,1300,true];
  await first.query('begin');
  const saved=(await query(first,save,argsOne))[0].data;
  const competing=attempt(query(second,save,argsTwo));
  await sleep(150);
  await first.query('commit');
  assert.equal((await competing).error?.message,'service_catalog_version_conflict');
  assert.notEqual(saved.etag,initial.etag);
  assert.equal(saved.etag,(await query(first,
    'select public.get_minuta_service_catalog_draft_v186($1,$2) data',[org,service]))[0].data.etag);
  assert.deepEqual((await query(second,save,argsOne))[0].data,saved);
  assert.equal((await query(admin,'select photo_storage_path from public.service_public_details_v159 where service_id=$1',[service]))[0].photo_storage_path,
    `${actor}/services/${service}/photo.webp`);
  const createArgs=[org,'33333333-3333-4333-8333-333333333333',null,null,'Новая услуга',45,500,true];
  await first.query('begin');
  const created=(await query(first,save,createArgs))[0].data;
  const duplicate=attempt(query(second,save,createArgs));
  await sleep(150);
  await first.query('commit');
  assert.deepEqual((await duplicate).value?.[0]?.data,created);
  assert.equal((await query(admin,'select count(*)::int n from public.services'))[0].n,2);
  assert.equal((await query(admin,'select count(*)::int n from public.service_catalog_requests_v186'))[0].n,2);
  const denied=await attempt(query(second,save,[foreignOrg,'44444444-4444-4444-8444-444444444444',null,null,'Чужая услуга',45,500,true]));
  assert.equal(denied.error?.message,'service_catalog_organization_denied');
  await query(admin,'update public.organization_memberships set active=false where organization_id=$1 and user_id=$2',[org,actor]);
  const inactive=await attempt(query(second,save,[org,'66666666-6666-4666-8666-666666666666',null,null,'Без членства',45,500,true]));
  assert.equal(inactive.error?.message,'service_catalog_organization_denied');
  await query(admin,'update public.organization_memberships set active=true where organization_id=$1 and user_id=$2',[org,actor]);
  await query(admin,'update public.organizations set status=$1 where id=$2',['suspended',org]);
  const suspended=await attempt(query(second,save,[org,'77777777-7777-4777-8777-777777777777',null,null,'Закрытая организация',45,500,true]));
  assert.equal(suspended.error?.message,'service_catalog_organization_denied');
  await query(admin,'update public.organizations set status=$1 where id=$2',['active',org]);
  const foreignService='ffffffff-ffff-4fff-8fff-ffffffffffff';
  await query(admin,'insert into public.services values($1,$2,$3,$4,$5,$6)',[foreignService,other,'Чужой сервис',60,500,true]);
  const foreignEdit=await attempt(query(second,save,[org,'88888888-8888-4888-8888-888888888888',
    foreignService,initial.etag,'Чужая правка',60,500,true]));
  assert.equal(foreignEdit.error?.message,'service_catalog_service_not_found');
  assert.equal((await query(admin,'select count(*)::int n from public.service_catalog_requests_v186'))[0].n,2);
  const beforeDetails=(await query(first,
    'select public.get_minuta_service_catalog_draft_v186($1,$2) data',[org,service]))[0].data;
  await admin.query('begin');
  await query(admin,'update public.service_public_details_v159 set short_description=$1 where service_id=$2',['Внешняя правка',service]);
  const pendingDetails=attempt(query(second,save,[org,'55555555-5555-4555-8555-555555555555',
    service,beforeDetails.etag,'После карточки',90,1400,true]));
  await sleep(150);
  await admin.query('commit');
  assert.equal((await pendingDetails).error?.message,'service_catalog_version_conflict');
  assert.deepEqual((await query(first,save,argsOne))[0].data,{saved:false,reason:'service_changed_after_save',id:service});
  await query(admin,'delete from public.services where id=$1',[created.id]);
  assert.deepEqual((await query(first,save,createArgs))[0].data,{saved:false,reason:'service_deleted',id:created.id});
  console.log('v186 isolated PostgreSQL: parallel conflict, replay, parallel create, details, scope and tombstones passed');
} finally { await Promise.allSettled(clients.map(client=>client.end())); }
