// Caller supplies one privileged pg Client inside an attested PG17 network-none
// full-public-restore transaction. This module never connects or commits.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const O24_SQL_SHA256 = Object.freeze({
  apply:'a7b81ee8e1a57c41fef75fb040c39200486cb29baa928e78d45540b5586eb6db',
  rollback:'923ec150178db07e95af36511f357755c7f2b2eab2c6bf46fff846174bcf7c27'
});
const normalize = text => text.replace(/\r\n/g, '\n');
export function exactO24TransactionBody(source, expectedHash) {
  const text = normalize(source);
  assert.equal(createHash('sha256').update(text).digest('hex'), expectedHash, 'O24 SQL hash mismatch');
  const wrapped = /^begin;\n([\s\S]*?)\ncommit;\n?$/i.exec(text);
  assert.ok(wrapped, 'O24 SQL transaction framing changed');
  return wrapped[1];
}
const applySql = exactO24TransactionBody(
  readFileSync(new URL('../inventory-item-catalog-candidate.sql', import.meta.url), 'utf8'), O24_SQL_SHA256.apply);
const rollbackSql = exactO24TransactionBody(
  readFileSync(new URL('../inventory-item-catalog-rollback.sql', import.meta.url), 'utf8'), O24_SQL_SHA256.rollback);

const signatures = [
  'public.get_minuta_inventory_role(uuid)',
  'public.get_minuta_inventory_workspace(uuid)',
  'public.get_minuta_inventory_workspace_v130(uuid)',
  'public.upsert_minuta_inventory_item(uuid,uuid,text,text,text,numeric,boolean)',
  'public.get_minuta_inventory_workspace_catalog(uuid)',
  'public.upsert_minuta_inventory_item_catalog(uuid,uuid,text,text,text,numeric,boolean,text,text)'
];
const one = async (db, sql, args=[]) => (await db.query(sql, args)).rows[0];
const result = async (db, sql, args=[]) => (await one(db, sql, args))?.result;

async function functionSnapshot(db) {
  const { rows } = await db.query(`select signature,
    p.oid::text oid,pg_get_functiondef(p.oid) body,p.proowner::text owner,
    p.proacl::text acl,p.proconfig::text config
    from unnest($1::text[]) with ordinality as requested(signature,position)
    left join pg_proc p on p.oid=to_regprocedure(signature)
    order by position`, [signatures]);
  assert.equal(rows.length, signatures.length, 'O24 function catalog incomplete');
  return rows.map(({ body, ...entry }) => ({ ...entry,
    body_hash:body === null ? null : createHash('sha256').update(body).digest('hex') }));
}
async function columnSnapshot(db) {
  const { rows } = await db.query(`select attname,atttypid::regtype::text data_type,attnotnull,atthasdef
    from pg_attribute where attrelid='public.inventory_items'::regclass
      and attname in ('category','icon') and attnum>0 and not attisdropped order by attname`);
  return rows;
}
async function catalogObjectSnapshot(db) {
  const functions = (await db.query(`select proname name,p.oid::regprocedure::text identity
    from pg_proc p where pronamespace='public'::regnamespace
      and proname in ('get_minuta_inventory_workspace_catalog','upsert_minuta_inventory_item_catalog')
    order by proname,identity`)).rows;
  const constraints = (await db.query(`select conname name from pg_constraint
    where conrelid='public.inventory_items'::regclass
      and conname in ('inventory_items_category_optional_check','inventory_items_icon_optional_check')
    order by conname`)).rows;
  return {functions,constraints};
}
async function asActor(db, role, actor, work) {
  await db.query('savepoint o24_actor');
  try {
    await db.query(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [actor || '']);
    const value = await work();
    await db.query('reset role');
    await db.query('release savepoint o24_actor');
    return value;
  } catch (error) {
    await db.query('rollback to savepoint o24_actor');
    await db.query('release savepoint o24_actor');
    throw error;
  }
}
async function denied(work, code, message) {
  let refusal;
  try { await work(); } catch (error) { refusal = error; }
  assert.equal(refusal?.code, code, 'O24 refusal SQLSTATE mismatch');
  if (message) assert.equal(refusal.message, message, 'O24 refusal reason mismatch');
}
async function seed(db, ids) {
  await db.query('set local session_replication_role=replica');
  for (const actor of [ids.owner,ids.admin,ids.specialist,ids.foreignOwner])
    await db.query('insert into auth.users(id) values($1)', [actor]);
  await db.query('set local session_replication_role=origin');
  for (const actor of [ids.owner,ids.admin,ids.specialist,ids.foreignOwner])
    await db.query('insert into public.performer_profiles(id,display_name) values($1,$2)',
      [actor,'O24 synthetic '+actor.slice(0,8)]);
  for (const [org,owner] of [[ids.org,ids.owner],[ids.foreignOrg,ids.foreignOwner]]) {
    await db.query("insert into public.organizations(id,name,created_by,status) values($1,$2,$3,'active')",
      [org,'O24 isolated '+org,owner]);
    await db.query('insert into public.organization_inventory_settings(organization_id,enabled,auto_deduct_completed_visits) values($1,true,false)', [org]);
  }
  for (const [actor,org,role] of [
    [ids.owner,ids.org,'owner'],[ids.admin,ids.org,'admin'],
    [ids.specialist,ids.org,'specialist'],[ids.foreignOwner,ids.foreignOrg,'owner']
  ]) await db.query('insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active) values($1,$2,$3,true,true)',
    [org,actor,role]);
  for (const [id,org,owner] of [[ids.oldItem,ids.org,ids.owner],[ids.foreignItem,ids.foreignOrg,ids.foreignOwner]])
    await db.query("insert into public.inventory_items(id,organization_id,name,sku,unit,active,created_by) values($1,$2,'O24 synthetic item','', 'piece',true,$3)",
      [id,org,owner]);
}

export async function probe(db, { attested=false, expectedDatabase='', expectedPort=0 }={}) {
  assert.equal(attested, true, 'O24 requires external full-restore attestation');
  assert.equal(typeof db?.query, 'function', 'O24 requires one pg Client');
  assert.match(expectedDatabase, /^o24-[a-z0-9-]*full-restore$/, 'O24 disposable database name required');
  assert.ok(Number.isInteger(expectedPort) && expectedPort>=20000 && expectedPort<=65535,
    'O24 requires an ephemeral listener port');
  const identity = await one(db, `select current_database() database,
    pg_catalog.host(inet_server_addr()) server_address,pg_catalog.host(inet_client_addr()) client_address,inet_server_port() server_port,
    current_setting('server_version_num')::integer version,pg_is_in_recovery() recovery,
    exists(select 1 from pg_roles where rolname=current_user and rolsuper) privileged`);
  assert.equal(identity?.database, expectedDatabase, 'O24 database mismatch');
  assert.equal(identity.server_address, '127.0.0.1', 'O24 server must be loopback');
  assert.equal(identity.client_address, '127.0.0.1', 'O24 client must be loopback');
  assert.equal(identity.server_port, expectedPort, 'O24 server port mismatch');
  assert.ok(identity.version>=170000 && identity.version<180000, 'O24 requires PostgreSQL 17');
  assert.equal(identity.recovery, false, 'O24 restore must be writable');
  assert.equal(identity.privileged, true, 'O24 requires privileged caller');

  const savepoint = `o24_full_restore_${randomUUID().replaceAll('-','')}`;
  // RELEASE must succeed before any writes: PostgreSQL otherwise only warns
  // on SAVEPOINT outside an explicit outer transaction.
  await db.query(`savepoint ${savepoint}`);
  await db.query(`release savepoint ${savepoint}`);
  await db.query(`savepoint ${savepoint}`);
  let baseline, ids, answer;
  try {
    await db.query("set local statement_timeout='90s'; set local lock_timeout='5s'");
    baseline = await functionSnapshot(db);
    assert.ok(baseline.slice(0,4).every(entry=>entry.oid), 'O24 legacy functions missing');
    assert.ok(baseline.slice(4).every(entry=>entry.oid===null), 'O24 candidate already present');
    assert.deepEqual(await columnSnapshot(db), [], 'O24 columns already present');
    assert.deepEqual(await catalogObjectSnapshot(db), {functions:[],constraints:[]},
      'O24 function overload or constraint collision');
    ids = Object.fromEntries(['owner','admin','specialist','foreignOwner','org','foreignOrg','oldItem','foreignItem']
      .map(key=>[key,randomUUID()]));
    await seed(db,ids);
    await db.query(applySql);
    await db.query(applySql); // idempotent apply on the restored schema
    const foreignBefore = await one(db,'select to_jsonb(item) row from public.inventory_items item where id=$1',[ids.foreignItem]);
    const applied = await functionSnapshot(db);
    assert.deepEqual(applied.slice(0,4),baseline.slice(0,4), 'O24 changed legacy function OID/body/ACL');
    assert.ok(applied.slice(4).every(entry=>entry.oid), 'O24 catalog functions missing');
    assert.deepEqual(await columnSnapshot(db), [
      {attname:'category',data_type:'text',attnotnull:false,atthasdef:false},
      {attname:'icon',data_type:'text',attnotnull:false,atthasdef:false}
    ]);
    const objects = await catalogObjectSnapshot(db);
    assert.deepEqual(objects.functions.map(row=>row.name),
      ['get_minuta_inventory_workspace_catalog','upsert_minuta_inventory_item_catalog']);
    assert.deepEqual(objects.constraints.map(row=>row.name),
      ['inventory_items_category_optional_check','inventory_items_icon_optional_check']);
    for (const signature of signatures.slice(4)) {
      assert.equal((await one(db,"select has_function_privilege('authenticated',$1,'execute') allowed",[signature])).allowed,true);
      assert.equal((await one(db,"select has_function_privilege('anon',$1,'execute') allowed",[signature])).allowed,false);
      assert.equal((await one(db,"select has_function_privilege('service_role',$1,'execute') allowed",[signature])).allowed,false);
    }
    const read = org => result(db,'select public.get_minuta_inventory_workspace_catalog($1) result',[org]);
    const legacyRead = org => result(db,'select public.get_minuta_inventory_workspace_v130($1) result',[org]);
    const write = (org,item,name,category,icon) => result(db,
      'select public.upsert_minuta_inventory_item_catalog($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
      [org,item,name,'','piece',0,true,category,icon]);
    const oldWrite = (org,item,name) => result(db,
      'select public.upsert_minuta_inventory_item($1,$2,$3,$4,$5,$6,$7) result',
      [org,item,name,'','piece',0,true]);

    await asActor(db,'authenticated',ids.owner,async()=>{
      const initial = await read(ids.org);
      assert.equal(initial.items.find(item=>item.id===ids.oldItem)?.category,null);
      assert.equal(initial.items.find(item=>item.id===ids.oldItem)?.icon,null);
      const created = await write(ids.org,null,'O24 new material','Расходники','box');
      ids.newItem = created.id;
      assert.ok(ids.newItem, 'O24 new item missing');
      assert.equal((await read(ids.org)).items.find(item=>item.id===ids.newItem)?.icon,'box');
      assert.equal((await legacyRead(ids.org)).items.find(item=>item.id===ids.newItem)?.category,undefined);
      await oldWrite(ids.org,ids.newItem,'O24 legacy renamed');
      assert.equal((await read(ids.org)).items.find(item=>item.id===ids.newItem)?.category,'Расходники');
      await write(ids.org,ids.newItem,'O24 updated material','  Уход  ','care');
      assert.equal((await read(ids.org)).items.find(item=>item.id===ids.newItem)?.category,'Уход');
      await write(ids.org,ids.newItem,'O24 cleared material','   ','');
      const cleared=(await read(ids.org)).items.find(item=>item.id===ids.newItem);
      assert.equal(cleared.category,null);assert.equal(cleared.icon,null);
      await write(ids.org,ids.newItem,'O24 restored material','Расходники','box');
    });
    await denied(()=>asActor(db,'authenticated',ids.owner,()=>write(ids.org,ids.newItem,'O24 bad icon',null,'html')),'22023','invalid_inventory_catalog_metadata');
    await denied(()=>asActor(db,'authenticated',ids.owner,()=>write(ids.org,ids.newItem,'O24 bad category','x'.repeat(61),'box')),'22023','invalid_inventory_catalog_metadata');
    await asActor(db,'authenticated',ids.admin,async()=>{
      assert.equal((await read(ids.org)).current_role,'admin');
      await write(ids.org,ids.oldItem,'O24 admin material','Админ','tools');
      assert.equal((await read(ids.org)).items.find(item=>item.id===ids.oldItem)?.icon,'tools');
    });
    for (const actor of [ids.specialist,ids.foreignOwner]) {
      await denied(()=>asActor(db,'authenticated',actor,()=>read(ids.org)),'42501','inventory_management_denied');
      await denied(()=>asActor(db,'authenticated',actor,()=>write(ids.org,ids.oldItem,'O24 denied',null,null)),'42501','inventory_management_denied');
    }
    await denied(()=>asActor(db,'anon','',()=>read(ids.org)),'42501');
    await denied(()=>asActor(db,'anon','',()=>write(ids.org,ids.oldItem,'O24 anon denied',null,null)),'42501');
    await denied(()=>asActor(db,'authenticated',ids.owner,()=>read(ids.foreignOrg)),'42501','inventory_management_denied');
    await denied(()=>asActor(db,'authenticated',ids.owner,()=>write(ids.foreignOrg,ids.foreignItem,'O24 wrong org',null,null)),'42501','inventory_management_denied');
    await asActor(db,'authenticated',ids.owner,async()=>{
      assert.equal((await one(db,'select count(*)::integer amount from public.inventory_items where id=$1',[ids.foreignItem])).amount,0);
      assert.equal((await one(db,'select count(*)::integer amount from public.inventory_items where id=$1',[ids.newItem])).amount,1);
    });
    assert.deepEqual(await one(db,'select to_jsonb(item) row from public.inventory_items item where id=$1',[ids.foreignItem]),foreignBefore,
      'O24 changed synthetic foreign item');

    await db.query(rollbackSql);
    const rolled = await functionSnapshot(db);
    assert.deepEqual(rolled.slice(0,4),baseline.slice(0,4), 'O24 operational rollback changed legacy function');
    assert.ok(rolled.slice(4).every(entry=>entry.oid===null), 'O24 operational rollback left catalog RPC');
    assert.deepEqual((await catalogObjectSnapshot(db)).functions,[], 'O24 operational rollback left catalog overload');
    assert.equal((await one(db,'select category,icon from public.inventory_items where id=$1',[ids.newItem])).category,'Расходники');
    await db.query(applySql);
    await asActor(db,'authenticated',ids.owner,async()=>{
      assert.equal((await read(ids.org)).items.find(item=>item.id===ids.newItem)?.category,'Расходники');
    });
    assert.deepEqual(await one(db,'select to_jsonb(item) row from public.inventory_items item where id=$1',[ids.foreignItem]),foreignBefore,
      'O24 reapply changed synthetic foreign item');
    answer={status:'success',nullableMetadata:true,clearUpdate:true,roleScope:true,legacyCompatible:true,
      operationalRollbackRetainsValues:true,reapply:true};
  } finally {
    await db.query(`rollback to savepoint ${savepoint}`);
    await db.query(`release savepoint ${savepoint}`);
    if (baseline) {
      assert.deepEqual(await functionSnapshot(db),baseline,'O24 outer savepoint changed original function OID/body/ACL');
      assert.deepEqual(await columnSnapshot(db),[],'O24 outer savepoint left columns');
      assert.deepEqual(await catalogObjectSnapshot(db),{functions:[],constraints:[]},
        'O24 outer savepoint left catalog function or constraint');
    }
    if (ids) {
      for (const id of [ids.org,ids.foreignOrg])
        assert.equal((await one(db,'select exists(select 1 from public.organizations where id=$1) present',[id])).present,false,
          'O24 outer savepoint left synthetic organization');
      for (const id of [ids.oldItem,ids.foreignItem,ids.newItem].filter(Boolean))
        assert.equal((await one(db,'select exists(select 1 from public.inventory_items where id=$1) present',[id])).present,false,
          'O24 outer savepoint left synthetic item');
    }
  }
  return { ...answer,savepointRestored:true };
}

export default probe;
