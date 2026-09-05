#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const {PGlite} = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href
  : '@electric-sql/pglite');
const sanitizer = readFileSync(fileURLToPath(new URL('./crm-snapshot-anonymize.sql',import.meta.url)),'utf8');

const ids={
  user:'00000000-0000-4000-8000-000000000001',org:'00000000-0000-4000-8000-000000000010',
  location:'00000000-0000-4000-8000-000000000020',performer:'00000000-0000-4000-8000-000000000001',
  service:'00000000-0000-4000-8000-000000000030',client:'00000000-0000-4000-8000-000000000040',
  series:'00000000-0000-4000-8000-000000000050',booking:'00000000-0000-4000-8000-000000000060',
  plan:'00000000-0000-4000-8000-000000000070',period:'00000000-0000-4000-8000-000000000080'
};

const schema=String.raw`
create schema auth; create table auth.users(id uuid primary key);
create table organizations(id uuid primary key,name text,public_slug text unique,status text);
create table performer_profiles(id uuid primary key references auth.users(id),display_name text);
create table locations(id uuid primary key,organization_id uuid references organizations(id),name text,timezone text,address text,unique(id,organization_id));
create table organization_memberships(organization_id uuid references organizations(id),user_id uuid references auth.users(id),role text,primary key(organization_id,user_id));
create table services(id uuid primary key,performer_id uuid references performer_profiles(id),name text);
create table client_accounts(id uuid primary key,normalized_phone text unique,access_code_hash text,auth_user_id uuid references auth.users(id));
create table booking_series(id uuid primary key,performer_id uuid references performer_profiles(id),service_id uuid references services(id),client_name text,client_phone text);
create table bookings(id uuid primary key,organization_id uuid references organizations(id),location_id uuid references locations(id),performer_id uuid references performer_profiles(id),service_id uuid references services(id),client_account_id uuid references client_accounts(id),series_id uuid references booking_series(id),booking_code text unique,manage_token uuid unique,request_id uuid unique,request_fingerprint text,client_name text,client_phone text,status text,payment_status text,payment_url text,color_key text,provider_note text,booking_scope_source text,booking_policy_snapshot jsonb,cancellation_reason text,refund_status text,booking_source text,created_by_role text);
create table booking_outcomes(booking_id uuid primary key references bookings(id),visit_status text,payment_method text,completion_source text);
create table organization_inventory_settings(organization_id uuid primary key references organizations(id),enabled boolean);
create table inventory_warehouses(id uuid primary key,organization_id uuid references organizations(id),location_id uuid references locations(id),name text);
create table inventory_items(id uuid primary key,organization_id uuid references organizations(id),name text,sku text,unit text);
create table inventory_stock_balances(organization_id uuid references organizations(id),warehouse_id uuid references inventory_warehouses(id),inventory_item_id uuid references inventory_items(id),quantity numeric);
create table inventory_movements(id bigint generated always as identity primary key,organization_id uuid references organizations(id),warehouse_id uuid references inventory_warehouses(id),inventory_item_id uuid references inventory_items(id),booking_id uuid references bookings(id),movement_type text,request_id uuid,reason text);
create table inventory_service_usage(organization_id uuid references organizations(id),service_id uuid references services(id),inventory_item_id uuid references inventory_items(id),quantity numeric);
create table organization_payroll_settings(organization_id uuid primary key references organizations(id),enabled boolean);
create table payroll_plans(id uuid primary key,organization_id uuid references organizations(id),performer_id uuid references performer_profiles(id),name text);
create table payroll_plan_tiers(id uuid primary key,plan_id uuid references payroll_plans(id),threshold_rub integer,rate_bps integer);
create table payroll_periods(id uuid primary key,organization_id uuid references organizations(id),location_id uuid references locations(id),name text,status text,source_fingerprint text);
create table payroll_period_plan_snapshots(id uuid primary key,period_id uuid references payroll_periods(id),organization_id uuid references organizations(id),source_plan_id uuid references payroll_plans(id),performer_id uuid references performer_profiles(id),plan_name text,tiers jsonb);
create table payroll_items(id uuid primary key,period_id uuid references payroll_periods(id),organization_id uuid references organizations(id),performer_id uuid references performer_profiles(id),booking_id uuid references bookings(id),source_plan_id uuid references payroll_plans(id),service_name text,source_snapshot jsonb);
create table payroll_adjustments(id uuid primary key,period_id uuid references payroll_periods(id),organization_id uuid references organizations(id),performer_id uuid references performer_profiles(id),reason text);
create table client_device_sessions(id uuid primary key,token_hash text,device_name text);
create table notification_outbox(id uuid primary key,payload jsonb);
create table payment_provider_attempts(id uuid primary key,provider_url text,secret text);
create table inventory_audit_log(id bigint generated always as identity primary key,details jsonb);
create function get_telegram_reminder_secret_hash() returns text language sql as 'select ''vault.secret''::text';
create function synthetic_booking_audit() returns trigger language plpgsql as $$
begin
  insert into notification_outbox values(gen_random_uuid(),jsonb_build_object('client_name',new.client_name));
  return new;
end $$;
create trigger synthetic_booking_audit after update on bookings for each row execute function synthetic_booking_audit();
`;

const fixtures=String.raw`
insert into auth.users values('${ids.user}');
insert into organizations values('${ids.org}','Салон Анны','salon-anna','active');
insert into performer_profiles values('${ids.performer}','Анна Иванова');
insert into locations values('${ids.location}','${ids.org}','Центр','Europe/Samara','ул. Личная, 7');
insert into organization_memberships values('${ids.org}','${ids.user}','owner');
insert into services values('${ids.service}','${ids.performer}','Личный массаж');
insert into client_accounts values('${ids.client}','79991234567',repeat('a',64),'${ids.user}');
insert into booking_series values('${ids.series}','${ids.performer}','${ids.service}','Иван Петров','+7 999 123-45-67');
insert into bookings values('${ids.booking}','${ids.org}','${ids.location}','${ids.performer}','${ids.service}','${ids.client}','${ids.series}','BOOK-PRIVATE','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',repeat('b',64),'Иван Петров','+7 999 123-45-67','confirmed','pending','https://pay.invalid/private','mint','Аллергия клиента','team','{"comment":"private"}','client','pending','provider_manual','owner');
insert into booking_outcomes values('${ids.booking}','completed','card','manual');
insert into organization_inventory_settings values('${ids.org}',true);
insert into inventory_warehouses values('20000000-0000-4000-8000-000000000001','${ids.org}','${ids.location}','Главный склад');
insert into inventory_items values('20000000-0000-4000-8000-000000000002','${ids.org}','Личный препарат','PRIVATE-SKU','ml');
insert into inventory_stock_balances values('${ids.org}','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',10);
insert into inventory_movements(organization_id,warehouse_id,inventory_item_id,booking_id,movement_type,request_id,reason) values('${ids.org}','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','${ids.booking}','service_use','20000000-0000-4000-8000-000000000003','Для Ивана');
insert into inventory_service_usage values('${ids.org}','${ids.service}','20000000-0000-4000-8000-000000000002',1);
insert into organization_payroll_settings values('${ids.org}',true);
insert into payroll_plans values('${ids.plan}','${ids.org}','${ids.performer}','План Анны');
insert into payroll_plan_tiers values('30000000-0000-4000-8000-000000000001','${ids.plan}',1000,500);
insert into payroll_periods values('${ids.period}','${ids.org}','${ids.location}','Зарплата Анны','draft',repeat('c',64));
insert into payroll_period_plan_snapshots values('30000000-0000-4000-8000-000000000002','${ids.period}','${ids.org}','${ids.plan}','${ids.performer}','План Анны','[{"private":"value"}]');
insert into payroll_items values('30000000-0000-4000-8000-000000000003','${ids.period}','${ids.org}','${ids.performer}','${ids.booking}','${ids.plan}','Личный массаж','{"client":"Иван"}');
insert into payroll_adjustments values('30000000-0000-4000-8000-000000000004','${ids.period}','${ids.org}','${ids.performer}','Личная премия');
insert into client_device_sessions values(gen_random_uuid(),repeat('d',64),'Телефон Ивана');
insert into notification_outbox values(gen_random_uuid(),'{"phone":"79991234567"}');
insert into payment_provider_attempts values(gen_random_uuid(),'https://pay.invalid','secret');
insert into inventory_audit_log(details) values('{"note":"Иван"}');
`;

async function database(extra='') {
  const db=new PGlite();
  await db.exec(schema+extra+fixtures);
  return db;
}
async function scalar(db,sql,key='value') { return (await db.query(sql)).rows[0]?.[key]; }
async function assertGuardRejects(db,code,object) {
  try {
    await db.exec(sanitizer);
    assert.fail(`guard unexpectedly accepted ${code}`);
  } catch(error) {
    assert.equal(error.message,'crm_snapshot_guard_failed');
    const detail=JSON.parse(error.detail);
    assert.equal(detail.code,code);
    if(object) assert.ok(detail.objects.includes(object),`${object} missing from guard metadata`);
    await db.exec('rollback');
  }
}

{
  const db=await database();
  const before=await db.query(`select bookings.id booking_id,bookings.manage_token,bookings.request_id,client_accounts.id client_id,client_accounts.access_code_hash,organizations.id organization_id,auth.users.id user_id from bookings cross join client_accounts cross join organizations cross join auth.users`);
  await db.exec(sanitizer);
  const payload=JSON.stringify((await db.query(`select * from organizations cross join locations cross join performer_profiles cross join services cross join client_accounts cross join bookings cross join booking_series cross join inventory_items cross join inventory_movements cross join payroll_adjustments`)).rows);
  for(const secret of ['Салон Анны','Анна Иванова','Иван Петров','ул. Личная','Аллергия','79991234567','https://pay.invalid','PRIVATE-SKU','Личная премия',...Object.values(ids)]) {
    assert.equal(payload.includes(secret),false,`PII remained: ${secret}`);
  }
  assert.equal(await scalar(db,`select count(*)::int value from client_device_sessions`),0);
  assert.equal(await scalar(db,`select count(*)::int value from notification_outbox`),0);
  assert.equal(await scalar(db,`select count(*)::int value from payment_provider_attempts`),0);
  assert.equal(await scalar(db,`select count(*)::int value from inventory_audit_log`),0);
  assert.equal(await scalar(db,`select count(*)::int value from bookings`),1);
  assert.equal(await scalar(db,`select bookings.client_phone=client_accounts.normalized_phone normalized from bookings join client_accounts on client_accounts.id=bookings.client_account_id`,'normalized'),true);
  assert.equal(await scalar(db,`select bookings.client_name=booking_series.client_name value from bookings join booking_series on booking_series.id=bookings.series_id`),true);
  assert.notEqual(await scalar(db,`select normalized_phone value from client_accounts`),'79991234567');
  assert.notEqual(await scalar(db,`select manage_token::text value from bookings`),String(before.rows[0].manage_token));
  assert.notEqual(await scalar(db,`select request_id::text value from bookings`),String(before.rows[0].request_id));
  assert.notEqual(await scalar(db,`select access_code_hash value from client_accounts`),before.rows[0].access_code_hash);
  assert.notEqual(await scalar(db,`select id::text value from bookings`),String(before.rows[0].booking_id));
  assert.notEqual(await scalar(db,`select id::text value from organizations`),String(before.rows[0].organization_id));
  assert.notEqual(await scalar(db,`select id::text value from auth.users`),String(before.rows[0].user_id));
  assert.equal(await scalar(db,`select bookings.organization_id=organizations.id value from bookings cross join organizations`),true);
  assert.equal(await scalar(db,`select organization_memberships.user_id=auth.users.id value from organization_memberships cross join auth.users`),true);
  assert.equal(await scalar(db,`select auth_user_id is null value from client_accounts`),true);
  assert.equal(await scalar(db,`select to_regprocedure('public.get_telegram_reminder_secret_hash()') is null value`),true);
  assert.equal(await scalar(db,`select not exists(select 1 from pg_namespace n cross join lateral aclexplode(n.nspacl) acl where n.nspname='public' and acl.grantee=0) value`),true);
  await db.close();
}

{
  const db=await database('alter table bookings add column private_comment text;');
  await assertGuardRejects(db,'unknown_sensitive_columns','bookings.private_comment');
  assert.equal(await scalar(db,`select client_name value from bookings`),'Иван Петров','failed preflight must not mutate');
  await db.close();
}

{
  const db=await database('create table hidden_parent(id uuid primary key); alter table bookings add column hidden_id uuid references hidden_parent(id);');
  await assertGuardRejects(db,'unknown_fk_dependency','public.bookings->public.hidden_parent');
  await db.close();
}

{
  const db=await database(`
    create function unexpected_webhook() returns text language sql as 'select ''http_post''::text';
  `);
  await assertGuardRejects(db,'unexpected_outbound_or_secret_function','public.unexpected_webhook()');
  assert.equal(await scalar(db,`select to_regprocedure('public.get_telegram_reminder_secret_hash()') is not null value`),true,'failed preflight must roll back the pinned drop');
  await db.close();
}

console.log('CRM snapshot anonymizer tests: PASS');
