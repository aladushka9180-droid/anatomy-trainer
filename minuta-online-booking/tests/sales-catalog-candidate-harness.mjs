import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const read = name => readFileSync(new URL(name,import.meta.url),'utf8').replace(/^\\set.*$/mg,'');
export const ids = {
  org:'20000000-0000-4000-8000-000000000001',otherOrg:'20000000-0000-4000-8000-000000000002',
  owner:'10000000-0000-4000-8000-000000000001',admin:'10000000-0000-4000-8000-000000000002',
  specialist:'10000000-0000-4000-8000-000000000003',outsider:'10000000-0000-4000-8000-000000000004',
  client:'30000000-0000-4000-8000-000000000001',otherClient:'30000000-0000-4000-8000-000000000002',
  warehouse:'40000000-0000-4000-8000-000000000001',otherWarehouse:'40000000-0000-4000-8000-000000000002',
  booking:'50000000-0000-4000-8000-000000000001',location:'60000000-0000-4000-8000-000000000001',
  item:'70000000-0000-4000-8000-000000000001',item2:'70000000-0000-4000-8000-000000000002',
  cash:'80000000-0000-4000-8000-000000000001',otherCash:'80000000-0000-4000-8000-000000000002',
};
export const request = n => `90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const functionDefinition = (source,name) => {
  const start=source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start>=0,name);
  const end=source.indexOf('$$;',source.indexOf('as $$',start));
  assert.ok(end>start,name);
  return source.slice(start,end+3);
};
export async function baseline(db) {
  await db.query(read('sales-catalog-candidate-fixture.sql'));
  for (const n of [129,82,108,130,147,148]) await db.query(read(`../supabase-migration-v${n}.sql`));
  const sale=functionDefinition(read('../supabase-migration-v151.sql'),'sell_minuta_commercial_product_v151');
  const workspace=functionDefinition(read('../supabase-migration-v151.sql'),'get_minuta_commerce_workspace_v151');
  await db.query(sale+workspace);
  await db.query(`revoke all on function public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) from public;
    grant execute on function public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) to authenticated;`);
}
export async function seed(db) {
  const v=ids;
  await db.query(`insert into auth.users values('${v.owner}'),('${v.admin}'),('${v.specialist}'),('${v.outsider}');
    insert into organizations(id,name) values('${v.org}','Synthetic sales'),('${v.otherOrg}','Foreign synthetic');
    insert into organization_memberships(organization_id,user_id,role,active) values
      ('${v.org}','${v.owner}','owner',true),('${v.org}','${v.admin}','admin',true),('${v.org}','${v.specialist}','specialist',true),
      ('${v.otherOrg}','${v.outsider}','owner',true);
    insert into locations(id,organization_id,name) values('${v.location}','${v.org}','Synthetic location'),('${v.otherWarehouse}','${v.otherOrg}','Foreign');
    insert into bookings(id,organization_id,location_id,client_account_id,client_name) values
      ('${v.booking}','${v.org}','${v.location}','${v.client}','Synthetic client'),
      ('${v.otherClient}','${v.otherOrg}','${v.otherWarehouse}','${v.otherClient}','Foreign client');
    insert into organization_finance_settings(organization_id,enabled,enabled_at,enabled_by) values('${v.org}',true,now(),'${v.owner}'),('${v.otherOrg}',true,now(),'${v.outsider}');
    insert into organization_inventory_settings(organization_id,enabled,auto_deduct_completed_visits) values('${v.org}',true,false);
    insert into inventory_items(id,organization_id,name,sku,unit,created_by) values
      ('${v.item}','${v.org}','500 ml cream','SYNTHETIC-500','ml','${v.owner}'),('${v.item2}','${v.org}','Physical variant','SYNTHETIC-B','piece','${v.owner}');
    insert into inventory_warehouses(id,organization_id,location_id,name) values('${v.warehouse}','${v.org}','${v.location}','Synthetic'),
      ('${v.otherWarehouse}','${v.otherOrg}','${v.otherWarehouse}','Foreign');
    insert into financial_accounts(id,organization_id,name,account_class,account_type,creation_request_id,request_fingerprint,created_by) values
      ('${v.cash}','${v.org}','Synthetic cash','asset','cash','${request(1)}',repeat('1',64),'${v.owner}'),
      ('${v.otherCash}','${v.otherOrg}','Foreign cash','asset','cash','${request(2)}',repeat('2',64),'${v.outsider}');
    insert into organization_inventory_transfer_settings(organization_id,initialized_at,initialized_by) values('${v.org}',now(),'${v.owner}');
    select set_config('request.jwt.claim.sub','${v.owner}',false);
    select apply_minuta_stock_movement('${v.org}','${v.warehouse}','${v.item}','receipt',5000,null,'Synthetic initial stock','${request(3)}');
    select apply_minuta_stock_movement('${v.org}','${v.warehouse}','${v.item2}','receipt',20,null,'Synthetic initial stock','${request(4)}');`);
}
export async function rpc(db,actor,name,values) {
  // Explicit transaction fires the real deferred balance constraints on commit.
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
    const result=await db.query(`select public.${name}(${values.map((_,i)=>`$${i+1}`).join(',')}) payload`,values);
    await db.query('commit');
    return result.rows[0].payload;
  } catch(e) {await db.query('rollback');throw e;}
}
export const scalar = async (db,sql,values=[]) => Object.values((await db.query(sql,values)).rows[0])[0];
export const importRows = (version=0) => [
  {inventory_item_id:ids.item,name:'500 ml cream',sku:'SYNTHETIC-500',unit:'ml',sale_unit:'pack',stock_per_sale_unit:500,
    sale_price_minor:89900,purpose:'both',category:'User category',variant_label:'500 ml',metadata_version:version},
  {inventory_item_id:ids.item2,name:'Physical variant',sku:'SYNTHETIC-B',unit:'piece',sale_unit:'piece',stock_per_sale_unit:1,
    sale_price_minor:1200,purpose:'retail',metadata_version:version},
];
export async function saveMetadata(db,rows=importRows(),n=10) {
  const preview=await rpc(db,ids.owner,'preview_minuta_sales_import_candidate',[ids.org,JSON.stringify(rows)]);
  assert.deepEqual(preview.errors,[]);
  const result=await rpc(db,ids.owner,'commit_minuta_sales_import_candidate',[ids.org,JSON.stringify(rows),preview.preview_hash,true,request(n)]);
  return {preview,result};
}
export const lines = (qty=1) => [
  {line_id:'cream',inventory_item_id:ids.item,warehouse_id:ids.warehouse,quantity:qty,metadata_version:1,unit_price_minor:89900,discount_minor:0},
  {line_id:'variant',inventory_item_id:ids.item2,warehouse_id:ids.warehouse,quantity:2,metadata_version:1,unit_price_minor:1200,discount_minor:0},
];
export const cartArgs = (rows=lines(),n=20) => [ids.org,null,ids.client,ids.specialist,JSON.stringify(rows),'cash',ids.cash,request(n)];
