import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PGLITE_MODULE;
let PGlite;
try {
  ({ PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : '@electric-sql/pglite'));
} catch (error) {
  throw new Error(`PGlite не найден. Установите @electric-sql/pglite@0.5.8 или укажите MINUTA_PGLITE_MODULE до dist/index.js. ${error.message}`);
}

const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/');
const migration = readFileSync(root + 'supabase-migration-v113.sql', 'utf8');
const destructiveRollback = readFileSync(root + 'supabase-migration-v113-rollback.sql', 'utf8');
const operationalRollback = readFileSync(root + 'supabase-migration-v113-operational-rollback.sql', 'utf8');
const schemaCheck = readFileSync(root + 'tests/profitability-v113-schema-check.sql', 'utf8');
const db = new PGlite();
const id = {
  owner:'00000000-0000-4000-8000-000000000001',performer:'00000000-0000-4000-8000-000000000002',
  orgA:'00000000-0000-4000-8000-000000000010',orgB:'00000000-0000-4000-8000-000000000020',
  locationA:'00000000-0000-4000-8000-000000000101',locationB:'00000000-0000-4000-8000-000000000102',
  warehouseA:'00000000-0000-4000-8000-000000000201',warehouseB:'00000000-0000-4000-8000-000000000202',
  itemA:'00000000-0000-4000-8000-000000000301',itemB:'00000000-0000-4000-8000-000000000302',
  service:'00000000-0000-4000-8000-000000000401'
};

await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant usage on schema auth,public to anon,authenticated,service_role;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key,status text not null default 'active');
create table public.performer_profiles(id uuid primary key,display_name text not null);
create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean,is_bookable boolean default true,primary key(organization_id,user_id));
create table public.locations(id uuid primary key,organization_id uuid,name text,active boolean default true,is_primary boolean default false,unique(id,organization_id));
create table public.services(id uuid primary key,name text,performer_id uuid,active boolean default true);
create table public.bookings(id uuid primary key,organization_id uuid,location_id uuid,performer_id uuid,service_id uuid,booking_date date,unique(id,organization_id));
create table public.booking_outcomes(booking_id uuid primary key,visit_status text,amount_rub bigint);
create table public.organization_inventory_settings(organization_id uuid primary key,enabled boolean not null default false);
create table public.inventory_items(id uuid primary key,organization_id uuid,name text,sku text,unit text,low_stock_threshold numeric(14,3) default 0,active boolean default true,unique(id,organization_id));
create table public.inventory_warehouses(id uuid primary key,organization_id uuid,location_id uuid,name text,active boolean default true,is_primary boolean default false,unique(id,organization_id));
create table public.inventory_stock_balances(organization_id uuid,warehouse_id uuid,inventory_item_id uuid,quantity numeric(14,3),updated_at timestamptz default now(),primary key(organization_id,warehouse_id,inventory_item_id));
create table public.inventory_movements(
  id bigint generated always as identity primary key,organization_id uuid,warehouse_id uuid,inventory_item_id uuid,
  booking_id uuid,movement_type text,quantity_delta numeric(14,3),quantity_after numeric(14,3),request_id uuid,
  reason text default '',actor_id uuid,created_at timestamptz default now(),unique(organization_id,request_id)
);
create table public.inventory_service_usage(id bigint generated always as identity primary key,organization_id uuid,service_id uuid,inventory_item_id uuid,quantity numeric(14,3));
create table public.inventory_audit_log(id bigint generated always as identity primary key,organization_id uuid,event_type text,subject_id uuid,payload jsonb,actor_id uuid,created_at timestamptz default now());
create table public.payroll_periods(id uuid primary key,organization_id uuid,status text,paid_at timestamptz);
create table public.payroll_items(id bigint generated always as identity primary key,period_id uuid,organization_id uuid,booking_id uuid,payroll_rub bigint default 0);
-- Early review-only shape: corrected v113 must repair this cross-tenant key.
create table public.inventory_service_cost_settings(
  id bigint generated always as identity primary key,organization_id uuid not null references public.organizations(id),
  service_id uuid not null references public.services(id),effective_from date not null default timezone('Europe/Samara',now())::date,
  material_mode text not null check(material_mode in ('tracked','none')),updated_by uuid references auth.users(id),
  updated_at timestamptz default now(),unique(service_id,effective_from)
);
create function public.get_minuta_inventory_role(p_organization uuid) returns text language sql stable security definer set search_path to '' as $$
  select role from public.organization_memberships where organization_id=p_organization and user_id=auth.uid() and active
$$;
create function public.get_minuta_inventory_workspace(p_organization uuid) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_inventory_role(p_organization);
  if v_role is null then raise exception using errcode='42501',message='inventory_membership_required'; end if;
  return jsonb_build_object('organization_id',p_organization,'current_role',v_role,'locations','[]'::jsonb,'services','[]'::jsonb,'items','[]'::jsonb,'warehouses','[]'::jsonb,'balances','[]'::jsonb,'usage','[]'::jsonb,'movements','[]'::jsonb,'audit','[]'::jsonb);
end $$;
create function public.write_minuta_inventory_audit(p_organization uuid,p_event text,p_subject uuid,p_payload jsonb) returns void language sql security definer set search_path to '' as $$
  insert into public.inventory_audit_log(organization_id,event_type,subject_id,payload,actor_id) values(p_organization,p_event,p_subject,p_payload,auth.uid())
$$;
insert into auth.users values('${id.owner}'),('${id.performer}');
insert into public.organizations values('${id.orgA}','active'),('${id.orgB}','active');
insert into public.performer_profiles values('${id.performer}','Общий специалист');
insert into public.organization_memberships values
 ('${id.orgA}','${id.owner}','owner',true,true),('${id.orgB}','${id.owner}','owner',true,true),
 ('${id.orgA}','${id.performer}','specialist',true,true),('${id.orgB}','${id.performer}','specialist',true,true);
insert into public.locations values('${id.locationA}','${id.orgA}','A',true,true),('${id.locationB}','${id.orgB}','B',true,true);
insert into public.services values('${id.service}','Общая услуга','${id.performer}',true);
insert into public.organization_inventory_settings values('${id.orgA}',true),('${id.orgB}',true);
insert into public.inventory_items values('${id.itemA}','${id.orgA}','A',null,'piece',0,true),('${id.itemB}','${id.orgB}','B',null,'piece',0,true);
insert into public.inventory_warehouses values('${id.warehouseA}','${id.orgA}','${id.locationA}','A',true,true),('${id.warehouseB}','${id.orgB}','${id.locationB}','B',true,true);
insert into public.inventory_stock_balances values('${id.orgA}','${id.warehouseA}','${id.itemA}',10,now());
`);

async function scalar(sql) { const result=await db.query(sql); return Object.values(result.rows[0])[0]; }
async function assertScalar(sql,expected,label) {
  const actual=await scalar(sql),matches=typeof expected==='number'?Number(actual)===expected:String(actual)===String(expected);
  if(!matches) throw new Error(`${label}: ожидалось ${expected}, получено ${actual}`);
  console.log(`PASS: ${label}`);
}
async function asOwner(sql) {
  await db.exec(`begin;select set_config('request.jwt.claim.sub','${id.owner}',true);set local role authenticated;${sql};reset role;commit;`);
}

await db.exec(migration);
await assertScalar('select count(*) from public.organization_inventory_cost_settings',0,'миграция выключена по умолчанию');
await assertScalar('select count(*) from public.inventory_cost_layers',0,'apply не создаёт baseline');
await db.exec(`begin;
 update public.inventory_stock_balances set quantity=9 where organization_id='${id.orgA}';
 insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,request_id,reason)
 values('${id.orgA}','${id.warehouseA}','${id.itemA}','write_off',-1,9,'10000000-0000-4000-8000-000000000001','legacy disabled');
 insert into public.inventory_stock_balances values('${id.orgB}','${id.warehouseB}','${id.itemB}',5,now());
 insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,request_id,reason)
 values('${id.orgB}','${id.warehouseB}','${id.itemB}','receipt',5,5,'10000000-0000-4000-8000-000000000002','legacy disabled');commit;`);
await assertScalar('select count(*) from public.inventory_movement_cost_snapshots',0,'legacy движения не затронуты до opt-in');
await db.exec(migration);
await assertScalar('select count(*) from public.inventory_cost_layers',0,'reapply после движений не создаёт baseline');
await asOwner(`select public.enable_minuta_inventory_costing_v113('${id.orgA}')`);
await asOwner(`select public.enable_minuta_inventory_costing_v113('${id.orgA}')`);
await assertScalar(`select count(*) from public.inventory_cost_layers where organization_id='${id.orgA}' and source_movement_id is null`,1,'baseline создаётся один раз');
await asOwner(`select public.apply_minuta_stock_movement_v113('${id.orgA}','${id.warehouseA}','${id.itemA}','receipt',3,null,'priced','10000000-0000-4000-8000-000000000003',900)`);
await db.exec(migration);
await assertScalar(`select count(*) from public.inventory_cost_layers where organization_id='${id.orgA}'`,2,'reapply после priced receipt не дублирует слой');
await asOwner(`select public.apply_minuta_stock_movement_v113('${id.orgA}','${id.warehouseA}','${id.itemA}','write_off',2,null,'fifo','10000000-0000-4000-8000-000000000005',null)`);
await asOwner(`select public.enable_minuta_inventory_costing_v113('${id.orgB}')`);
await asOwner(`select public.set_minuta_service_material_mode_v113('${id.orgA}','${id.service}','none')`);
await asOwner(`select public.set_minuta_service_material_mode_v113('${id.orgB}','${id.service}','tracked')`);
await assertScalar(`select count(*) from public.inventory_service_cost_settings where service_id='${id.service}'`,2,'service/date изолирован по организациям');
await db.exec(schemaCheck);

const historyBefore={
  layers:await scalar('select count(*) from public.inventory_cost_layers'),
  snapshots:await scalar('select count(*) from public.inventory_movement_cost_snapshots'),
  allocations:await scalar('select count(*) from public.inventory_cost_allocations'),
  settings:await scalar('select count(*) from public.inventory_service_cost_settings')
};
await db.exec(operationalRollback);
const suspensionAudits=await scalar(`select count(*) from public.inventory_audit_log where event_type='inventory_costing_operationally_suspended'`);
await db.exec(operationalRollback);
await assertScalar(`select count(*) from public.organization_inventory_cost_settings where enabled`,0,'operational rollback выключает все организации');
await assertScalar(`select count(*) from public.organization_inventory_cost_settings where initialized_at is not null and suspended_at is not null`,2,'инициализированные ledger помечены suspended');
await assertScalar(`select count(*) from public.inventory_cost_layers`,historyBefore.layers,'FIFO-история сохранена');
await assertScalar(`select count(*) from public.inventory_movement_cost_snapshots`,historyBefore.snapshots,'snapshots сохранены');
await assertScalar(`select count(*) from public.inventory_cost_allocations`,historyBefore.allocations,'FIFO allocations сохранены');
await assertScalar(`select count(*) from public.inventory_service_cost_settings`,historyBefore.settings,'tenant settings сохранены');
await assertScalar(`select count(*) from public.inventory_audit_log where event_type='inventory_costing_operationally_suspended'`,suspensionAudits,'повторный operational rollback не дублирует аудит');
await assertScalar(`select to_regprocedure('public.get_minuta_inventory_workspace_v113(uuid)') is null`,true,'v113 API удалён');

await db.exec(`begin;
 update public.inventory_stock_balances set quantity=11 where organization_id='${id.orgA}';
 insert into public.inventory_movements(organization_id,warehouse_id,inventory_item_id,movement_type,quantity_delta,quantity_after,request_id,reason)
 values('${id.orgA}','${id.warehouseA}','${id.itemA}','receipt',1,11,'10000000-0000-4000-8000-000000000004','legacy after rollback');commit;`);
await assertScalar(`select count(*) from public.inventory_movement_cost_snapshots`,historyBefore.snapshots,'legacy склад работает без изменения замороженного ledger');

await db.exec(migration);
await asOwner(`do $$ begin
  begin
    perform public.enable_minuta_inventory_costing_v113('${id.orgA}');
    raise exception 'reactivation was not blocked';
  exception when sqlstate '55000' then
    if sqlerrm<>'inventory_costing_reactivation_requires_reconciliation' then raise; end if;
  end;
end $$`);
await assertScalar(`select enabled from public.organization_inventory_cost_settings where organization_id='${id.orgA}'`,false,'reapply не возобновляет ledger с пропуском');
await assertScalar(`select count(*) from public.inventory_cost_layers`,historyBefore.layers,'reapply сохраняет финансовую историю без нового baseline');
let destructiveBlocked=false;
try {
  await db.exec(destructiveRollback);
} catch (error) {
  destructiveBlocked=String(error.message).includes('v113_rollback_blocked_financial_history_exists');
  await db.exec('rollback');
}
if(!destructiveBlocked) throw new Error('destructive rollback обязан блокироваться после activation');
console.log('PASS: destructive rollback после activation требует сохранения ledger');
await assertScalar(`select count(*) from public.inventory_cost_layers`,historyBefore.layers,'блокировка destructive rollback атомарна');

await db.close();
console.log('profitability v113 PGlite runtime test: OK');
