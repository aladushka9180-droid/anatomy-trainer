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
const executableSql = sql => sql.replace(/^\\set[^\r\n]*(?:\r?\n|$)/gm,'');
const migration = executableSql(read('supabase-migration-v130.sql'));
const rollback = executableSql(read('supabase-migration-v130-operational-rollback.sql'));
const rollbackInTransaction = rollback
  .replace(/^begin;\s*/m,'')
  .replace(/\s*notify pgrst,'reload schema';\s*commit;\s*$/m,'');
const schemaRollback = executableSql(read('supabase-migration-v130-schema-rollback.sql'));
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
const item = randomUUID(), mixedItem = randomUUID(), fifoItem = randomUUID(), legacyItem = randomUUID();
const receipt = 'select public.apply_minuta_stock_movement_v130($1,$2,$3,$4,$5,$6,$7,$8,$9) result';
const transfer = 'select public.transfer_minuta_inventory_stock_v130($1,$2,$3,$4,$5,$6,$7) result';
const transferArgs = (requestId, quantity=3, from=sourceWarehouse, to=destinationWarehouse, target=item, reason='Перемещение для смены') =>
  [organization,from,to,target,quantity,reason,requestId];
const asActor = async client => {
  await client.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await client.query('set role authenticated');
};
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const canonicalSql = value => String(value || '').toLowerCase().replace(/\s+/g,'');
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
  const orphanState = (await admin.query(`select
    to_regclass('public.organization_inventory_transfer_settings') is not null settings,
    to_regclass('public.inventory_cost_layers') is not null cost_layers,
    to_regclass('public.inventory_transfer_documents') is not null documents,
    to_regclass('public.inventory_movement_cost_snapshots') is not null snapshots,
    to_regclass('public.inventory_cost_allocations') is not null allocations`)).rows[0];
  const orphanRelations = [
    ['documents','inventory_transfer_documents'],
    ['cost_layers','inventory_cost_layers'],
    ['snapshots','inventory_movement_cost_snapshots'],
    ['allocations','inventory_cost_allocations']
  ].filter(([key]) => orphanState[key]);
  if (!orphanState.settings && orphanRelations.length) {
    for (const [,relation] of orphanRelations) {
      const rows = Number((await admin.query(`select count(*)::bigint count from public.${relation}`)).rows[0].count);
      if (rows !== 0) throw Error(`v130_orphan_schema_not_empty:${relation}`);
    }
    const movementColumns = (await admin.query(`select attname from pg_attribute
      where attrelid='public.inventory_movements'::regclass
        and attname in('purchase_total_cost_kopecks','transfer_document_id') and not attisdropped`)).rows.map(row => row.attname);
    const movementEvidence = ["movement_type in ('transfer_out','transfer_in')"];
    if (movementColumns.includes('purchase_total_cost_kopecks')) movementEvidence.push('purchase_total_cost_kopecks is not null');
    if (movementColumns.includes('transfer_document_id')) movementEvidence.push('transfer_document_id is not null');
    const movementRows = Number((await admin.query(`select count(*)::bigint count from public.inventory_movements where ${movementEvidence.join(' or ')}`)).rows[0].count);
    if (movementRows !== 0) throw Error('v130_orphan_schema_has_movement_evidence');

    // Repair only an empty, incomplete schema in the explicitly guarded test
    // database. No CASCADE is used. A canonical apply+rollback below then
    // reconstructs and verifies the exact v82/v108 baseline before testing.
    await admin.query('begin');
    try {
      await admin.query('select pg_advisory_xact_lock(13000)');
      if (orphanState.documents) {
        await admin.query('drop trigger if exists inventory_transfer_document_pair_v130 on public.inventory_transfer_documents');
        await admin.query('drop trigger if exists inventory_transfer_documents_immutable_v130 on public.inventory_transfer_documents');
      }
      if (orphanState.snapshots) await admin.query('drop trigger if exists inventory_movement_cost_snapshots_immutable_v130 on public.inventory_movement_cost_snapshots');
      if (orphanState.allocations) await admin.query('drop trigger if exists inventory_cost_allocations_immutable_v130 on public.inventory_cost_allocations');
      await admin.query('drop trigger if exists inventory_transfer_movement_pair_v130 on public.inventory_movements');
      await admin.query('drop trigger if exists inventory_movement_cost_v130 on public.inventory_movements');
      await admin.query(`drop function if exists public.get_minuta_inventory_workspace_v130(uuid);
        drop function if exists public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid);
        drop function if exists public.apply_minuta_stock_movement_v130(uuid,uuid,uuid,text,numeric,numeric,text,uuid,bigint);
        drop function if exists public.set_minuta_inventory_transfers_enabled_v130(uuid,boolean);
        drop function if exists public.enable_minuta_inventory_transfers_v130(uuid);
        drop function if exists public.verify_minuta_inventory_transfer_pair_v130();
        drop function if exists public.record_minuta_inventory_cost_v130();
        drop function if exists public.protect_minuta_inventory_transfer_ledger_v130()`);
      await admin.query(`alter table public.inventory_movements
        drop constraint if exists inventory_movements_transfer_document_fk_v130,
        drop constraint if exists inventory_movements_movement_type_check_v130,
        drop constraint if exists inventory_purchase_cost_receipt_only_v130,
        drop constraint if exists inventory_transfer_movement_shape_v130`);
      await admin.query('drop index if exists public.inventory_transfer_movement_side_v130');
      await admin.query('drop table if exists public.inventory_cost_allocations');
      await admin.query('drop table if exists public.inventory_movement_cost_snapshots');
      await admin.query('drop table if exists public.inventory_cost_layers');
      await admin.query('drop table if exists public.inventory_transfer_documents');
      await admin.query('drop index if exists public.inventory_movements_id_organization_v130');
      await admin.query(`alter table public.inventory_movements
        drop column if exists purchase_total_cost_kopecks,
        drop column if exists transfer_document_id`);
      await admin.query('commit');
    } catch (error) {
      await admin.query('rollback');
      throw error;
    }
    await admin.query(migration);
    await admin.query(schemaRollback);
  }
  if ((await admin.query("select to_regclass('public.organization_inventory_transfer_settings') is not null present")).rows[0].present) {
    await admin.query(schemaRollback);
  }
  const v108Baseline = (await admin.query(`select
    pg_get_functiondef('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'::regprocedure) apply_definition,
    pg_get_functiondef('public.consume_minuta_inventory_for_booking(uuid)'::regprocedure) consume_definition,
    (select coalesce(proacl::text,'') from pg_proc where oid='public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'::regprocedure) apply_acl,
    (select coalesce(proacl::text,'') from pg_proc where oid='public.consume_minuta_inventory_for_booking(uuid)'::regprocedure) consume_acl,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.inventory_movements'::regclass
      and conname='inventory_movements_movement_type_check') movement_constraint`)).rows[0];
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
    values($1,$5,'D09 known FIFO','D09-KNOWN','piece',true,$6),
      ($2,$5,'D09 mixed FIFO','D09-MIXED','piece',true,$6),
      ($3,$5,'D09 chronology FIFO','D09-CHRONOLOGY','piece',true,$6),
      ($4,$5,'D09 legacy rollback','D09-LEGACY','piece',true,$6)`,
    [item,mixedItem,fifoItem,legacyItem,organization,actor]);
  await admin.query(`insert into public.inventory_warehouses(id,organization_id,location_id,name,active,created_by)
    values($1,$3,$4,'D09 source',true,$6),($2,$3,$5,'D09 destination',true,$6)`,
    [sourceWarehouse,destinationWarehouse,organization,sourceLocation,destinationLocation,actor]);
  await admin.query('commit'); fixtureCreated=true;

  await admin.query(schemaRollback);
  assert.equal((await admin.query("select to_regclass('public.inventory_transfer_documents') is null ok")).rows[0].ok,true);
  assert.equal((await admin.query("select to_regprocedure('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)') is null ok")).rows[0].ok,true);
  assert.equal((await admin.query(`select count(*)::integer n from pg_attribute
    where attrelid='public.inventory_movements'::regclass
      and attname in('purchase_total_cost_kopecks','transfer_document_id') and not attisdropped`)).rows[0].n,0);
  const v108MovementCheck = (await admin.query(`select pg_get_constraintdef(oid) definition from pg_constraint
    where conrelid='public.inventory_movements'::regclass
      and conname='inventory_movements_movement_type_check'`)).rows[0].definition;
  assert.match(v108MovementCheck,/receipt.*write_off.*inventory.*service_use/i);
  assert.doesNotMatch(v108MovementCheck,/transfer_out|transfer_in/i);
  const legacyApply = (await admin.query(`select lower(pg_get_functiondef(
    'public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'::regprocedure)) definition`)).rows[0].definition;
  assert.doesNotMatch(legacyApply,/13000|13001|inventory_transfer/i);
  const v108Restored = (await admin.query(`select
    pg_get_functiondef('public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'::regprocedure) apply_definition,
    pg_get_functiondef('public.consume_minuta_inventory_for_booking(uuid)'::regprocedure) consume_definition,
    (select coalesce(proacl::text,'') from pg_proc where oid='public.apply_minuta_stock_movement(uuid,uuid,uuid,text,numeric,numeric,text,uuid)'::regprocedure) apply_acl,
    (select coalesce(proacl::text,'') from pg_proc where oid='public.consume_minuta_inventory_for_booking(uuid)'::regprocedure) consume_acl,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.inventory_movements'::regclass
      and conname='inventory_movements_movement_type_check') movement_constraint`)).rows[0];
  assert.equal(canonicalSql(v108Restored.apply_definition),canonicalSql(v108Baseline.apply_definition));
  assert.equal(canonicalSql(v108Restored.consume_definition),canonicalSql(v108Baseline.consume_definition));
  assert.equal(v108Restored.apply_acl,v108Baseline.apply_acl);
  assert.equal(v108Restored.consume_acl,v108Baseline.consume_acl);
  assert.equal(canonicalSql(v108Restored.movement_constraint),canonicalSql(v108Baseline.movement_constraint));
  assert.equal((await admin.query('select count(*)::integer n from public.inventory_items where organization_id=$1',[organization])).rows[0].n,4);
  assert.equal((await admin.query('select count(*)::integer n from public.inventory_warehouses where organization_id=$1',[organization])).rows[0].n,2);
  assert.equal((await admin.query('select count(*)::integer n from public.organization_memberships where organization_id=$1',[organization])).rows[0].n,1);

  const legacyClient = await connect(); await asActor(legacyClient);
  const legacyReceipt = (await legacyClient.query(
    'select public.apply_minuta_stock_movement($1,$2,$3,$4,$5,$6,$7,$8) result',
    [organization,sourceWarehouse,legacyItem,'receipt',1,null,'V108 rollback receipt',randomUUID()]
  )).rows[0].result;
  assert.equal(legacyReceipt.quantity_after,1);
  await assert.rejects(
    legacyClient.query('select public.consume_minuta_inventory_for_booking($1)',[randomUUID()]),
    error => error?.code === '42501' && /permission denied/i.test(error.message)
  );

  await admin.query(migration);
  await admin.query(migration);
  assert.equal((await admin.query("select to_regprocedure('public.transfer_minuta_inventory_stock_v130(uuid,uuid,uuid,uuid,numeric,text,uuid)') is not null ok")).rows[0].ok,true);

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
  const transferAfterLegacy = await transferSecond;
  assert.ok(transferAfterLegacy.value,
    `transfer must continue after the legacy writer releases the organization lock: ${transferAfterLegacy.error?.code || 'unknown'} ${transferAfterLegacy.error?.message || 'unknown error'}`);
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

  const refusedSchemaRollback = await outcome(admin.query(schemaRollback));
  assert.equal(refusedSchemaRollback.error?.code,'55000');
  assert.equal(refusedSchemaRollback.error?.message,'v130_schema_rollback_refused_ledger_not_empty');
  await admin.query('rollback');
  assert.equal((await admin.query("select to_regclass('public.inventory_transfer_documents') is not null ok")).rows[0].ok,true);

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
    const hasD09Schema = (await admin.query("select to_regclass('public.inventory_cost_allocations') is not null ok")).rows[0].ok;
    await admin.query('begin');
    await admin.query("set local session_replication_role='replica'");
    await admin.query('delete from public.inventory_audit_log where organization_id=$1',[organization]);
    if (hasD09Schema) {
      await admin.query('delete from public.inventory_cost_allocations where organization_id=$1',[organization]);
      await admin.query('delete from public.inventory_movement_cost_snapshots where organization_id=$1',[organization]);
      await admin.query('delete from public.inventory_cost_layers where organization_id=$1',[organization]);
    }
    await admin.query('delete from public.inventory_movements where organization_id=$1',[organization]);
    if (hasD09Schema) await admin.query('delete from public.inventory_transfer_documents where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_stock_balances where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_warehouses where organization_id=$1',[organization]);
    await admin.query('delete from public.inventory_items where organization_id=$1',[organization]);
    if (hasD09Schema) await admin.query('delete from public.organization_inventory_transfer_settings where organization_id=$1',[organization]);
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
