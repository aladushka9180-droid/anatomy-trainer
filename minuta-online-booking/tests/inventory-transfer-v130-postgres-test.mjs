// Real multi-connection PostgreSQL only. Never run against production.
// Requires the standard MINUTA_TEST_* guard variables and the `pg` module.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const { execFileSync: run } = await import('node:child_process');
run(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio:'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function', 'PostgreSQL Client constructor unavailable');

const read = name => readFileSync(new URL(name, root), 'utf8');
const migration = read('supabase-migration-v130.sql');
const rollback = read('supabase-migration-v130-operational-rollback.sql');
const rollbackInTransaction = rollback
  .replace(/^\\set ON_ERROR_STOP on\s*/m,'')
  .replace(/^begin;\s*/m,'')
  .replace(/\s*notify pgrst,'reload schema';\s*commit;\s*$/m,'');
const clients = [];
const tls = process.env.MINUTA_TEST_PG_TLS_NO_VERIFY === 'MIGRATION_TEST_ONLY' ? { rejectUnauthorized:false } : undefined;
const connect = async () => {
  const client = new Client({
    connectionString:process.env.MINUTA_TEST_DATABASE_URL,
    application_name:'minuta-d09-v130-isolated-test',
    ...(tls ? { ssl:tls } : {})
  });
  await client.connect(); clients.push(client);
  await client.query("set statement_timeout='30s'; set lock_timeout='20s'");
  return client;
};
const admin = await connect();
const actor = randomUUID(), organization = randomUUID(), sourceLocation = randomUUID(), destinationLocation = randomUUID();
const sourceWarehouse = randomUUID(), destinationWarehouse = randomUUID();
const item = randomUUID(), mixedItem = randomUUID(), fifoItem = randomUUID();
const receipt = 'select public.apply_minuta_stock_movement_v130($1,$2,$3,$4,$5,$6,$7,$8,$9) result';
const transfer = 'select public.transfer_minuta_inventory_stock_v130($1,$2,$3,$4,$5,$6,$7) result';
const transferArgs = (requestId, quantity=3, from=sourceWarehouse, to=destinationWarehouse, target=item, reason='Перемещение для смены') =>
  [organization,from,to,target,quantity,reason,requestId];
const asActor = async client => {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await client.query('set role authenticated');
};
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const awaitBlocked = async (observer,pid) => {
  for (let attempt=0;attempt<100;attempt+=1) {
    const row = (await observer.query("select wait_event_type='Lock' blocked from pg_stat_activity where pid=$1",[pid])).rows[0];
    if (row?.blocked) return;
    await new Promise(resolve => setTimeout(resolve,25));
  }
  throw Error('d09_second_session_did_not_wait_for_lock');
};
let fixtureCreated = false;

try {
  await admin.query(migration);
  await admin.query(migration);
  assert.equal((await admin.query("select to_regprocedure('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)') is not null ok")).rows[0].ok,true);

  await admin.query('begin');
  await admin.query("set local session_replication_role='replica'");
  await admin.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,now(),'{}','{}',now(),now())`,[actor,`${actor}@example.invalid`]);
  await admin.query("set local session_replication_role='origin'");
  await admin.query("insert into public.performer_profiles(id,display_name) values($1,'D09 isolated fixture')",[actor]);
  await admin.query("insert into public.organizations(id,name,created_by,status) values($1,'D09 isolated fixture',$2,'active')",[organization,actor]);
  await admin.query(`insert into public.locations(id,organization_id,name,timezone,is_primary,active)
    values($1,$3,'D09 source','Europe/Samara',true,true),($2,$3,'D09 destination','Europe/Samara',false,true)`,
    [sourceLocation,destinationLocation,organization]);
  await admin.query(`insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values($1,$2,'owner',true,true)`,[organization,actor]);
  await admin.query(`insert into public.organization_inventory_settings(organization_id,enabled,auto_deduct_completed_visits,enabled_at,enabled_by)
    values($1,true,false,now(),$2)`,[organization,actor]);
  await admin.query(`insert into public.inventory_items(id,organization_id,name,sku,unit,active,created_by)
    values($1,$4,'D09 known FIFO','D09-KNOWN','piece',true,$5),
      ($2,$4,'D09 mixed FIFO','D09-MIXED','piece',true,$5),
      ($3,$4,'D09 chronology FIFO','D09-CHRONOLOGY','piece',true,$5)`,
    [item,mixedItem,fifoItem,organization,actor]);
  await admin.query(`insert into public.inventory_warehouses(id,organization_id,location_id,name,active,created_by)
    values($1,$3,$4,'D09 source',true,$6),($2,$3,$5,'D09 destination',true,$6)`,
    [sourceWarehouse,destinationWarehouse,organization,sourceLocation,destinationLocation,actor]);
  await admin.query('commit'); fixtureCreated=true;

  const a = await connect(), b = await connect(), observer = await connect(); await asActor(a); await asActor(b);
  await a.query('select public.enable_minuta_inventory_transfers_v130($1)',[organization]);
  assert.equal((await admin.query('select enabled from public.organization_inventory_transfer_settings where organization_id=$1',[organization])).rows[0].enabled,true);

  await a.query(receipt,[organization,sourceWarehouse,item,'receipt',2,null,'Партия A',randomUUID(),100]);
  await a.query(receipt,[organization,sourceWarehouse,item,'receipt',5,null,'Партия B',randomUUID(),500]);
  const request = randomUUID();
  const first = (await a.query(transfer,transferArgs(request))).rows[0].result;
  assert.equal(first.source_quantity_after,4); assert.equal(first.destination_quantity_after,3);
  assert.equal(first.cost_complete,true);
  const replay = (await b.query(transfer,transferArgs(request))).rows[0].result;
  assert.deepEqual(replay,first);
  assert.equal((await admin.query('select count(*)::integer n from public.inventory_transfer_documents where organization_id=$1 and request_id=$2',[organization,request])).rows[0].n,1);
  assert.equal((await admin.query('select count(*)::integer n from public.inventory_movements where transfer_document_id=$1',[first.document_id])).rows[0].n,2);
  const destinationLayers = (await admin.query(`select original_quantity::text quantity,unit_cost_kopecks::text cost
    from public.inventory_cost_layers where source_movement_id=$1 order by created_at,id`,[first.destination_movement_id])).rows;
  assert.deepEqual(destinationLayers,[{quantity:'2.000',cost:'50.000000'},{quantity:'1.000',cost:'100.000000'}]);
  assert.equal((await admin.query('select total_cost_kopecks from public.inventory_movement_cost_snapshots where movement_id=$1',[first.source_movement_id])).rows[0].total_cost_kopecks,'200');
  const conflict = await outcome(b.query(transfer,transferArgs(request,2)));
  assert.equal(conflict.error?.code,'23505'); assert.equal(conflict.error?.message,'inventory_transfer_request_conflict');

  const beforeFailure = (await admin.query(`select
    (select quantity::text from public.inventory_stock_balances where organization_id=$1 and warehouse_id=$2 and inventory_item_id=$4) source,
    (select quantity::text from public.inventory_stock_balances where organization_id=$1 and warehouse_id=$3 and inventory_item_id=$4) destination,
    (select count(*)::integer from public.inventory_transfer_documents where organization_id=$1) documents,
    (select count(*)::integer from public.inventory_movements where organization_id=$1) movements`,
    [organization,sourceWarehouse,destinationWarehouse,item])).rows[0];
  await admin.query(`create function public.fail_d09_transfer_in_test() returns trigger language plpgsql as $$
    begin if new.movement_type='transfer_in' then raise exception 'forced_d09_incoming_failure';end if;return new;end $$`);
  await admin.query(`create trigger fail_d09_transfer_in_test before insert on public.inventory_movements
    for each row execute function public.fail_d09_transfer_in_test()`);
  const forced = await outcome(a.query(transfer,transferArgs(randomUUID(),1)));
  assert.match(forced.error?.message || '',/forced_d09_incoming_failure/);
  await admin.query('drop trigger fail_d09_transfer_in_test on public.inventory_movements');
  await admin.query('drop function public.fail_d09_transfer_in_test()');
  const afterFailure = (await admin.query(`select
    (select quantity::text from public.inventory_stock_balances where organization_id=$1 and warehouse_id=$2 and inventory_item_id=$4) source,
    (select quantity::text from public.inventory_stock_balances where organization_id=$1 and warehouse_id=$3 and inventory_item_id=$4) destination,
    (select count(*)::integer from public.inventory_transfer_documents where organization_id=$1) documents,
    (select count(*)::integer from public.inventory_movements where organization_id=$1) movements`,
    [organization,sourceWarehouse,destinationWarehouse,item])).rows[0];
  assert.deepEqual(afterFailure,beforeFailure);

  await a.query(receipt,[organization,sourceWarehouse,mixedItem,'receipt',2,null,'Известная партия',randomUUID(),200]);
  await a.query('select public.apply_minuta_stock_movement($1,$2,$3,$4,$5,$6,$7,$8)',
    [organization,sourceWarehouse,mixedItem,'receipt',2,null,'Неизвестная партия',randomUUID()]);
  const mixed = (await a.query(transfer,transferArgs(randomUUID(),3,sourceWarehouse,destinationWarehouse,mixedItem))).rows[0].result;
  assert.equal(mixed.cost_complete,false);
  assert.equal((await admin.query('select total_cost_kopecks from public.inventory_movement_cost_snapshots where movement_id=$1',[mixed.source_movement_id])).rows[0].total_cost_kopecks,null);
  assert.equal((await admin.query('select count(*)::integer n from public.inventory_cost_layers where source_movement_id=$1 and unit_cost_kopecks is null',[mixed.destination_movement_id])).rows[0].n,1);

  // A transferred old layer must remain older than stock already present at the
  // destination; the newer transferred layer must stay behind that stock.
  await a.query(receipt,[organization,sourceWarehouse,fifoItem,'receipt',2,null,'Старая исходная партия',randomUUID(),100]);
  await admin.query('select pg_sleep(0.01)');
  await a.query(receipt,[organization,destinationWarehouse,fifoItem,'receipt',2,null,'Средняя партия назначения',randomUUID(),400]);
  await admin.query('select pg_sleep(0.01)');
  await a.query(receipt,[organization,sourceWarehouse,fifoItem,'receipt',2,null,'Новая исходная партия',randomUUID(),600]);
  await a.query(transfer,transferArgs(randomUUID(),3,sourceWarehouse,destinationWarehouse,fifoItem));
  const chronologyWriteOff = (await a.query(receipt,
    [organization,destinationWarehouse,fifoItem,'write_off',3,null,'Проверка хронологии FIFO',randomUUID(),null])).rows[0].result;
  const chronologyCosts = (await admin.query(`select allocation.quantity::text quantity,
      allocation.unit_cost_kopecks::text cost
    from public.inventory_cost_allocations allocation
    join public.inventory_cost_layers layer on layer.id=allocation.cost_layer_id
    where allocation.movement_id=$1 order by layer.created_at,layer.id`,[chronologyWriteOff.id])).rows;
  assert.deepEqual(chronologyCosts,[{quantity:'2.000',cost:'50.000000'},{quantity:'1.000',cost:'200.000000'}]);

  await a.query(receipt,[organization,destinationWarehouse,item,'receipt',6,null,'Партия назначения',randomUUID(),600]);
  const raceId = randomUUID();
  const [raceA,raceB] = await Promise.all([a.query(transfer,transferArgs(raceId,1)),b.query(transfer,transferArgs(raceId,1))]);
  assert.equal(raceA.rows[0].result.document_id,raceB.rows[0].result.document_id);
  assert.equal((await admin.query('select count(*)::integer n from public.inventory_transfer_documents where organization_id=$1 and request_id=$2',[organization,raceId])).rows[0].n,1);

  const opposite = await Promise.all([
    a.query(transfer,transferArgs(randomUUID(),1,sourceWarehouse,destinationWarehouse)),
    b.query(transfer,transferArgs(randomUUID(),1,destinationWarehouse,sourceWarehouse))
  ]);
  assert.equal(opposite.length,2);
  const total = (await admin.query(`select sum(quantity)::text total from public.inventory_stock_balances
    where organization_id=$1 and inventory_item_id=$2 and warehouse_id in($3,$4)`,
    [organization,item,sourceWarehouse,destinationWarehouse])).rows[0].total;
  assert.equal(total,'13.000');

  const aPid = (await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const bPid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
  await a.query('begin');
  await a.query(transfer,transferArgs(randomUUID(),1));
  const manual = outcome(b.query('select public.apply_minuta_stock_movement($1,$2,$3,$4,$5,$6,$7,$8)',
    [organization,sourceWarehouse,item,'write_off',1,null,'Параллельное списание',randomUUID()]));
  await awaitBlocked(observer,bPid);
  await a.query('commit');
  assert.ok((await manual).value,'manual write-off must complete after the transfer lock');
  const afterManualTotal = (await admin.query(`select sum(quantity)::text total from public.inventory_stock_balances
    where organization_id=$1 and inventory_item_id=$2 and warehouse_id in($3,$4)`,
    [organization,item,sourceWarehouse,destinationWarehouse])).rows[0].total;
  assert.equal(afterManualTotal,'12.000');

  await admin.query(`create function public.wait_d09_legacy_insert_test() returns trigger language plpgsql as $$
    begin
      if new.reason='D09 lock barrier' then perform pg_advisory_xact_lock(13009); end if;
      return new;
    end $$`);
  await admin.query(`create trigger wait_d09_legacy_insert_test before insert on public.inventory_movements
    for each row execute function public.wait_d09_legacy_insert_test()`);
  await admin.query('begin');
  await admin.query('select pg_advisory_xact_lock(13009)');
  const legacyFirst = outcome(a.query('select public.apply_minuta_stock_movement($1,$2,$3,$4,$5,$6,$7,$8)',
    [organization,sourceWarehouse,item,'write_off',1,null,'D09 lock barrier',randomUUID()]));
  await awaitBlocked(observer,aPid);
  const transferSecond = outcome(b.query(transfer,transferArgs(randomUUID(),1)));
  await awaitBlocked(observer,bPid);
  await admin.query('commit');
  assert.ok((await legacyFirst).value,'legacy writer must complete without a lock-order deadlock');
  assert.ok((await transferSecond).value,'transfer must continue after the legacy writer releases the organization lock');
  await admin.query('drop trigger wait_d09_legacy_insert_test on public.inventory_movements');
  await admin.query('drop function public.wait_d09_legacy_insert_test()');

  const revokedRequest = randomUUID();
  await admin.query('begin');
  await admin.query("select pg_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,8200))",[organization,revokedRequest]);
  await admin.query('update public.organization_memberships set active=false where organization_id=$1 and user_id=$2',[organization,actor]);
  const revokedAttempt = outcome(b.query(transfer,transferArgs(revokedRequest,1)));
  await awaitBlocked(observer,bPid);
  await admin.query('commit');
  const revoked = await revokedAttempt;
  assert.equal(revoked.error?.code,'42501'); assert.equal(revoked.error?.message,'inventory_management_denied');
  await admin.query('update public.organization_memberships set active=true where organization_id=$1 and user_id=$2',[organization,actor]);

  // Exercise the global operational rollback inside an outer transaction.
  // A process crash closes the connection and PostgreSQL rolls it back, so a
  // persistent shared test database cannot leave unrelated organizations
  // suspended or authenticated grants revoked.
  await admin.query('begin');
  await admin.query(rollbackInTransaction);
  assert.equal((await admin.query('select enabled from public.organization_inventory_transfer_settings where organization_id=$1',[organization])).rows[0].enabled,false);
  assert.equal((await admin.query("select has_function_privilege('authenticated','public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)','EXECUTE') allowed")).rows[0].allowed,false);
  assert.equal((await admin.query("select exists(select 1 from pg_trigger where tgname='inventory_movement_cost_v130' and not tgisinternal and tgenabled<>'D') ok")).rows[0].ok,true);
  await admin.query('rollback');
  assert.equal((await admin.query('select enabled from public.organization_inventory_transfer_settings where organization_id=$1',[organization])).rows[0].enabled,true);
  assert.equal((await admin.query("select has_function_privilege('authenticated','public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)','EXECUTE') allowed")).rows[0].allowed,true);
  const replayAfterRollback = (await a.query(transfer,transferArgs(request))).rows[0].result;
  assert.equal(replayAfterRollback.document_id,first.document_id);

  console.log('inventory transfer v130 PostgreSQL: FIFO, mixed cost, atomic failure, replay, races and transactional rollback PASS');
} finally {
  for (const client of clients) { try { await client.query('rollback'); await client.query('reset role'); } catch {} }
  try { await admin.query('drop trigger if exists fail_d09_transfer_in_test on public.inventory_movements'); } catch {}
  try { await admin.query('drop function if exists public.fail_d09_transfer_in_test()'); } catch {}
  try { await admin.query('drop trigger if exists wait_d09_legacy_insert_test on public.inventory_movements'); } catch {}
  try { await admin.query('drop function if exists public.wait_d09_legacy_insert_test()'); } catch {}
  if (fixtureCreated) {
    await admin.query('begin');
    await admin.query("set local session_replication_role='replica'");
    await admin.query('delete from public.inventory_audit_log where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_cost_allocations where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_movement_cost_snapshots where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_cost_layers where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_movements where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_transfer_documents where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_stock_balances where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_warehouses where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_items where organization_id=$1',[organization]);
    await admin.query('delete from public.organization_inventory_transfer_settings where organization_id=$1',[organization]);
    await admin.query('delete from public.organization_inventory_settings where organization_id=$1',[organization]);
    await admin.query('delete from public.organization_memberships where organization_id=$1',[organization]);
    await admin.query('delete from public.locations where organization_id=$1',[organization]);
    await admin.query('delete from public.organizations where id=$1',[organization]);
    await admin.query('delete from public.performer_profiles where id=$1',[actor]);
    await admin.query('delete from auth.users where id=$1',[actor]);
    await admin.query('commit');
  }
  for (const client of clients) await client.end();
}
