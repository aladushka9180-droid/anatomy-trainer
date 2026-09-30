import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const require = createRequire(import.meta.url);
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const native = process.argv.includes('--postgres');
let db, Client, connectionString;
if (native) {
  connectionString = process.env.SERVICES_42501_LOCAL_POSTGRES_URL;
  assert.ok(connectionString, 'A disposable loopback PostgreSQL database is required');
  const target = new URL(connectionString);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(target.hostname), 'Remote databases refused');
  assert.equal(target.pathname, '/services_42501_test', 'Only the named disposable database is allowed');
  ({ Client } = require('pg'));
  db = new Client({ connectionString });
  await db.connect();
  db.exec = sql => db.query(sql);
} else {
  const { PGlite } = process.env.MINUTA_PGLITE_PACKAGE
    ? require(path.join(process.env.MINUTA_PGLITE_PACKAGE, 'dist/index.cjs'))
    : require('@electric-sql/pglite');
  db = new PGlite();
}
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const migration = read('../supabase-services-42501-grant.sql');
const rollback = read('../supabase-services-42501-grant-rollback.sql');
const fn = 'public.minuta_normalize_service_name_v160(text)';
const checks = [];
const check = name => checks.push(name);
const role = async (name, uid = owner, client = db) => {
  assert.ok(['anon','authenticated'].includes(name));
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claim.sub',$1,false)", [uid]);
  await client.query('set role ' + name);
};
const insert = (name, options = {}, client = db) => client.query(
  'insert into public.services(performer_id,name,duration_minutes,price_rub,active) values($1,$2,$3,$4,$5)' + (options.returning === false ? '' : ' returning id'),
  [options.owner || owner, name, options.duration ?? 60, options.price ?? 2000, options.active ?? true]
);
const deniedFunction = error => error.code === '42501' && /permission denied for function minuta_normalize_service_name_v160/.test(error.message);
const duplicate = error => error.code === '23505' && error.message === 'duplicate_service_name';
const preset = async (name, request = randomUUID(), extra = {}) => {
  const payload = [{ item_id:'massage', preset_id:'massage_full_body', name, duration_minutes:60, price_rub:3000, ...extra }];
  const result = await db.query('select public.create_provider_services_from_presets_v160($1,1,$2,$3::jsonb) as result', [request,['massage_therapist'],JSON.stringify(payload)]);
  return result.rows[0].result;
};
const snapshot = async () => {
  await db.query('reset role');
  const policies = (await db.query("select policyname, roles::text, cmd, qual, with_check from pg_policies where schemaname='public' order by tablename,policyname")).rows;
  const tables = (await db.query("select c.relname,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by c.relname")).rows;
  const functions = (await db.query("select p.proname,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.proowner::regrole::text,case when p.oid=$1::regprocedure then null else p.proacl::text end as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname",[fn])).rows;
  return {policies,tables,functions};
};
try {
  const occupied = await db.query("select count(*)::int as count from pg_class where relnamespace='public'::regnamespace and relkind in ('r','p')");
  assert.equal(occupied.rows[0].count,0,'Refusing a populated database');
  await db.exec(read('./services-42501-fixture.sql'));
  await db.exec(read('../supabase-migration-v160.sql'));
  const before = await snapshot();
  await role('authenticated');
  await assert.rejects(insert('Manual before'),deniedFunction);
  await assert.rejects(insert('Manual no returning',{returning:false}),deniedFunction);
  check('manual INSERT fails with exact 42501 with and without RETURNING');
  assert.equal((await preset('Template before')).created_count,1);
  check('actual v160 template RPC succeeds before repair');
  await db.query('reset role');
  await db.exec(migration);
  await db.exec(migration);
  const grants = (await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') as authenticated, has_function_privilege('anon',$1,'EXECUTE') as anon, has_function_privilege('service_role',$1,'EXECUTE') as service_role",[fn])).rows[0];
  assert.deepEqual(grants,{authenticated:true,anon:false,service_role:false});
  assert.deepEqual(await snapshot(),before);
  check('apply twice only grants helper EXECUTE to authenticated; policies, tables and function definitions unchanged');
  await role('authenticated');
  const created = await insert('Manual after');
  const createdId = created.rows[0].id;
  assert.ok(createdId);
  await insert('Per minute',{duration:1,price:32});
  await insert('Maximum duration',{duration:480,price:0});
  check('manual INSERT RETURNING id: 60 min, per-minute and maximum duration');
  await assert.rejects(insert('  MANUAL\u00a0 AFTER  '),duplicate);
  await insert('Hidden service',{active:false});
  await assert.rejects(insert(' hidden service '),duplicate);
  check('normalized and hidden duplicates remain rejected');
  await assert.rejects(insert('Wrong owner',{owner:other}),error=>error.code==='42501' && /row-level security/.test(error.message));
  const result = await db.query('update public.services set name=$1 where id=$2 returning id',['Manual renamed',createdId]);
  assert.equal(result.rows.length,1);
  await assert.rejects(db.query('update public.services set performer_id=$1 where id=$2',[other,createdId]),error=>error.code==='42501');
  check('own rename allowed; foreign-owner INSERT and ownership transfer denied');
  await role('authenticated',other);
  assert.equal((await db.query('select id from public.services where name=$1',['Hidden service'])).rows.length,0);
  assert.equal((await db.query('update public.services set price_rub=1 where id=$1 returning id',[createdId])).rows.length,0);
  assert.equal((await db.query('delete from public.services where id=$1 returning id',[createdId])).rows.length,0);
  await insert('Manual renamed',{owner:other});
  check('other account cannot read hidden, edit or delete owner rows; same name under its own owner allowed');
  await role('authenticated');
  const request = randomUUID();
  assert.equal((await preset('Template after',request)).created_count,1);
  assert.equal((await preset('Template after',request)).replayed,true);
  await assert.rejects(preset('Forged template owner',randomUUID(),{performer_id:other}),error=>error.code==='22023');
  check('actual template RPC, replay and forged-owner payload guard preserved');
  await role('anon');
  await assert.rejects(db.query('select public.minuta_normalize_service_name_v160($1)',['text']),deniedFunction);
  await assert.rejects(insert('Anonymous'),error=>error.code==='42501');
  check('anonymous helper execution and service creation denied');
  await db.query('reset role');
  const rowsBeforeRollback = (await db.query('select * from public.services order by id')).rows;
  await db.exec(rollback);
  assert.deepEqual((await db.query('select * from public.services order by id')).rows,rowsBeforeRollback);
  assert.deepEqual(await snapshot(),before);
  await role('authenticated');
  await assert.rejects(insert('Manual rollback'),deniedFunction);
  assert.equal((await preset('Template after rollback')).created_count,1);
  check('rollback preserves data and policies, restores direct-insert failure; template remains functional');
  await db.query('reset role');
  await db.exec(migration);
  await role('authenticated');
  await insert('Manual reapply');
  check('reapply restores direct creation');
  if (native) {
    const clients = [new Client({connectionString}),new Client({connectionString})];
    try {
      await Promise.all(clients.map(client=>client.connect()));
      await Promise.all(clients.map(client=>role('authenticated',owner,client)));
      const outcomes = await Promise.allSettled(clients.map(client=>insert('Concurrent duplicate',{},client)));
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(outcomes.filter(x=>x.status==='rejected' && duplicate(x.reason)).length,1);
      check('two native connections: one duplicate-name insert accepted, one rejected');
    } finally { await Promise.all(clients.map(client=>client.end())); }
  }
  console.log(JSON.stringify({status:'PASS',engine:native?'PostgreSQL':'PGlite',version:(await db.query('select version() as version')).rows[0].version,checks,productionWritten:false},null,2));
} finally {
  if (native) await db.end(); else await db.close();
}
