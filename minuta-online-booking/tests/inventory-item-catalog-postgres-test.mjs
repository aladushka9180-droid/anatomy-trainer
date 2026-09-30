// Native PostgreSQL 17 only. Guard rejects production and non-isolated targets.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = new URL('../', import.meta.url);
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',app))],{ stdio:'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
const client = new Client({ connectionString:process.env.MINUTA_TEST_DATABASE_URL, application_name:'minuta-inventory-catalog-isolated' });
const read = name => readFileSync(new URL(name,app),'utf8');
const migration = read('inventory-item-catalog-candidate.sql');
const rollback = read('inventory-item-catalog-rollback.sql');
const actor=randomUUID(), organization=randomUUID(), location=randomUUID(), oldItem=randomUUID();
let fixture=false;
const asActor=async () => { await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]); await client.query('set role authenticated'); };
const asAdmin=async () => { await client.query('reset role'); };
const failure=async (query,args,code) => {
  let error;
  try { await client.query(query,args); } catch (reason) { error=reason; }
  assert.equal(error?.code,code);
};

try {
  await client.connect();
  await client.query("set statement_timeout='25s'; set lock_timeout='15s'");
  const version=Number((await client.query('show server_version_num')).rows[0].server_version_num);
  assert.ok(version>=170000 && version<180000,`native PostgreSQL 17 required, got ${version}`);
  if (process.env.MINUTA_CATALOG_BOOTSTRAP === 'synthetic')
    await client.query(read('tests/inventory-item-catalog-fixture.sql'));
  await client.query(migration);
  await client.query(migration); // idempotent reapply
  await client.query('begin');
  await client.query("set local session_replication_role='replica'");
  await client.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,[actor,`${actor}@example.invalid`]);
  await client.query("set local session_replication_role='origin'");
  await client.query("insert into public.performer_profiles(id,display_name) values($1,'O24 fixture')",[actor]);
  await client.query("insert into public.organizations(id,name,created_by,status) values($1,'O24 fixture',$2,'active')",[organization,actor]);
  await client.query("insert into public.locations(id,organization_id,name,timezone,is_primary,active) values($1,$2,'O24 location','Europe/Samara',true,true)",[location,organization]);
  await client.query("insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active) values($1,$2,'owner',true,true)",[organization,actor]);
  await client.query("insert into public.organization_inventory_settings(organization_id,enabled,auto_deduct_completed_visits) values($1,true,false)",[organization]);
  await client.query("insert into public.inventory_items(id,organization_id,name,sku,unit,active,created_by) values($1,$2,'Old material','','ml',true,$3)",[oldItem,organization,actor]);
  await client.query('commit'); fixture=true;

  await asActor();
  assert.equal((await client.query('select count(*)::integer amount from public.inventory_items')).rows[0].amount,1);
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[randomUUID()]);
  assert.equal((await client.query('select count(*)::integer amount from public.inventory_items')).rows[0].amount,0);
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  const catalog='select public.get_minuta_inventory_workspace_catalog($1) result';
  const legacy='select public.get_minuta_inventory_workspace_v130($1) result';
  const upsert='select public.upsert_minuta_inventory_item_catalog($1,$2,$3,$4,$5,$6,$7,$8,$9) result';
  const oldUpsert='select public.upsert_minuta_inventory_item($1,$2,$3,$4,$5,$6,$7) result';
  const before=(await client.query(catalog,[organization])).rows[0].result;
  assert.equal(before.items.find(row=>row.id===oldItem).category,null);
  assert.equal(before.items.find(row=>row.id===oldItem).icon,null);
  const inserted=(await client.query(upsert,[organization,null,'New material','O24-NEW','piece',2,true,'Расходники','box'])).rows[0].result;
  const itemId=inserted.id;
  assert.equal((await client.query(catalog,[organization])).rows[0].result.items.find(row=>row.id===itemId).icon,'box');
  assert.equal((await client.query(legacy,[organization])).rows[0].result.items.find(row=>row.id===itemId).category,undefined);
  await client.query(oldUpsert,[organization,itemId,'Renamed by old client','O24-NEW','piece',2,true]);
  const afterOld=(await client.query(catalog,[organization])).rows[0].result.items.find(row=>row.id===itemId);
  assert.equal(afterOld.name,'Renamed by old client');
  assert.equal(afterOld.category,'Расходники');
  assert.equal(afterOld.icon,'box');
  await failure(upsert,[organization,itemId,'Invalid icon','O24-NEW','piece',2,true,'Расходники','html'], '22023');
  await failure(catalog,[randomUUID()],'42501');
  await asAdmin();
  await client.query('set role anon');
  await failure(catalog,[organization],'42501');
  await asAdmin();
  assert.equal((await client.query("select category,icon from public.inventory_items where id=$1",[itemId])).rows[0].category,'Расходники');
  await client.query(rollback);
  assert.equal((await client.query("select to_regprocedure('public.get_minuta_inventory_workspace_catalog(uuid)') is null absent")).rows[0].absent,true);
  assert.equal((await client.query("select category,icon from public.inventory_items where id=$1",[itemId])).rows[0].icon,'box');
  await client.query(migration);
  await asActor();
  assert.equal((await client.query(catalog,[organization])).rows[0].result.items.find(row=>row.id===itemId).category,'Расходники');
  await asAdmin();
  console.log('O24 native PostgreSQL 17 apply/reapply/rollback/reapply, old client, empty metadata, org/anon/RLS guards PASS');
} finally {
  try { await client.query('rollback'); } catch {}
  try { await asAdmin(); } catch {}
  if (fixture) {
    await client.query('begin');
    await client.query("set local session_replication_role='replica'");
    await client.query('delete from public.inventory_audit_log where organization_id=$1',[organization]);
    await client.query('delete from public.inventory_items where organization_id=$1',[organization]);
    await client.query('delete from public.organization_inventory_settings where organization_id=$1',[organization]);
    await client.query('delete from public.organization_memberships where organization_id=$1',[organization]);
    await client.query('delete from public.locations where organization_id=$1',[organization]);
    await client.query('delete from public.organizations where id=$1',[organization]);
    await client.query('delete from public.performer_profiles where id=$1',[actor]);
    await client.query('delete from auth.users where id=$1',[actor]);
    await client.query('commit');
  }
  try { await client.query(rollback); } catch {}
  try { await client.end(); } catch {}
}
