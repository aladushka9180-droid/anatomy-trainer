// Run only against an empty local PostgreSQL 17 clone of the test schema.
// The entire fixture, apply, rollback and reapply cycle is rolled back.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const endpoint = new URL(process.env.MINUTA_TEST_DATABASE_URL);
assert.equal(process.env.MINUTA_A04_EPHEMERAL_CONFIRM, 'SCHEMA_ONLY_EMPTY_DATABASE');
assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname));
assert.equal(endpoint.pathname, '/a04-shifts-fixture');
assert.equal(process.env.MINUTA_TEST_PROJECT_REF, 'a04-shifts-fixture');
execFileSync(process.execPath, [fileURLToPath(new URL('scripts/migration-config-guard.mjs', root))], { stdio:'inherit' });
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
const db = new Client({ connectionString:process.env.MINUTA_TEST_DATABASE_URL,
  application_name:'a04-shifts-full-schema-isolated' });
await db.connect();
const q = async (sql, parameters=[]) => (await db.query(sql, parameters)).rows;
const one = async (sql, parameters=[]) => Object.values((await q(sql, parameters))[0])[0];
const sqlFile = name => readFileSync(new URL(name, root), 'utf8').replace(/\r\n/g, '\n');
function transactionalBody(name) {
  const source = sqlFile(name);
  assert.equal((source.match(/^begin;$/gm) || []).length, 1);
  assert.equal((source.match(/^commit;$/gm) || []).length, 1);
  return source.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
}
const apply = () => db.query(transactionalBody('supabase-migration-v190.sql'));
const rollback = () => db.query(transactionalBody('recovery/rollback-shift-substitution-v190.sql'));
const substitute = (booking, service) => one('select public.substitute_minuta_booking($1,$2,$3)', [fixture.org, booking, service]);
async function rejected(action, code, message) {
  await db.query('savepoint expected_a04_error');
  try { await assert.rejects(action(), error => error.code === code && error.message === message); }
  finally { await db.query('rollback to expected_a04_error; release expected_a04_error'); }
}
let originalRead, originalWrite, fixture;
try {
  await db.query("begin; set local statement_timeout='90s'; set local lock_timeout='5s'");
  assert.equal(await one(`select count(*)::int from minuta_migration_guard.target
    where project_ref=$1 and allow_migrations is true`, [process.env.MINUTA_TEST_PROJECT_REF]), 1);
  assert.equal(await one('select current_setting(\'server_version_num\')::int / 10000'), 17);
  assert.equal(await one('select count(*)::int from public.bookings'), 0, 'clone must contain schema only');
  assert.equal(await one('select count(*)::int from public.organizations'), 0, 'clone must contain no organizations');
  assert.equal(await one('select count(*)::int from auth.users'), 0, 'clone must contain no users');
  originalRead = await one("select pg_get_functiondef('public.get_minuta_shift_workspace(uuid,date,date)'::regprocedure)");
  originalWrite = await one("select pg_get_functiondef('public.substitute_minuta_booking(uuid,uuid,uuid)'::regprocedure)");
  assert.ok(!originalRead.includes('is_schedule_block'), 'baseline must still expose the A04 read defect');
  assert.ok(!originalWrite.includes('schedule_block_substitution_denied'), 'baseline must still lack the A04 write guard');
  await db.query(sqlFile('tests/booking-concurrency-v123-fixture.sql'));
  fixture = (await q(`select current_setting('v123.actor') actor,current_setting('v123.org') org,
    current_setting('v123.loc') loc,current_setting('v123.service') service,
    current_setting('v123.date') date`))[0];
  const nextActor = randomUUID(), nextService = randomUUID();
  await db.query('set local session_replication_role=replica');
  await db.query(`insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,
    raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
    $2,now(),'{}','{}',now(),now())`, [nextActor, `${nextActor}@example.invalid`]);
  await db.query('set local session_replication_role=origin');
  await db.query('insert into public.performer_profiles(id,display_name) values($1,$2)', [nextActor, 'A04 synthetic replacement']);
  await db.query(`insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
    values($1,$2,'specialist',true,true)`, [fixture.org, nextActor]);
  await db.query(`insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
    values($1,$2,'A04 synthetic alternative',60,1000,true)`, [nextService, nextActor]);
  const technicalServices = [randomUUID(), randomUUID()];
  await db.query(`insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
    values($1,$3,'__MINUTA_SCHEDULE_BLOCK__',60,0,false),
          ($2,$3,'__PRIMETIME_EXTERNAL_CALENDAR__',60,0,false)`,
  [technicalServices[0], technicalServices[1], fixture.actor]);
  await db.query(`insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,slot_interval_minutes)
    select $1,day,true,'09:00','18:00',15 from generate_series(1,7) day`, [nextActor]);
  await db.query("select set_config('minuta.booking_organization',$1,true),set_config('minuta.booking_location',$2,true)", [fixture.org, fixture.loc]);
  const blocks = [randomUUID(), randomUUID(), randomUUID()];
  const [client, clientAfterReapply] = [randomUUID(), randomUUID()];
  for (const [id, time, service, isBlock] of [
    [blocks[0], '11:00', fixture.service, true],
    [blocks[1], '12:00', technicalServices[0], true],
    [blocks[2], '13:00', technicalServices[1], true],
    [client, '15:00', fixture.service, false],
    [clientAfterReapply, '17:00', fixture.service, false]
  ]) {
    await db.query(`insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,
      client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
      status,deposit_amount_rub,payment_status,payment_url,booking_policy_snapshot)
      values($1,$2,$3,$4,$5,$6,'79990000001',$7,$8,60,1000,1000,'confirmed',0,'not_required','',$9::jsonb)`,
    [id, id.replaceAll('-', '').slice(0, 10).toUpperCase(), randomUUID(), fixture.actor, service,
      isBlock ? 'A04 synthetic time block' : 'A04 synthetic visit', fixture.date, time,
      JSON.stringify(isBlock ? { schedule_block:true } : {})]);
  }
  const beforeWorkspace = await one('select public.get_minuta_shift_workspace($1,$2,$2)', [fixture.org, fixture.date]);
  assert.deepEqual(beforeWorkspace.bookings.map(item => item.id).sort(), [...blocks, client, clientAfterReapply].sort());
  assert.ok(beforeWorkspace.bookings.every(item => !Object.hasOwn(item, 'is_schedule_block')));
  assert.equal(await one("select count(*)::int from public.bookings where id=any($1::uuid[]) and booking_policy_snapshot @> '{\"schedule_block\":true}'::jsonb", [blocks]), 3);
  const blockState = async () => JSON.stringify(await q(`select to_jsonb(b) booking,
    (select count(*) from public.booking_session_items where booking_id=b.id) items,
    (select count(*) from public.booking_session_revisions where booking_id=b.id) revisions,
    (select count(*) from public.notification_marks where booking_id=b.id) marks,
    (select count(*) from public.notification_outbox where booking_id=b.id) outbox,
    (select count(*) from public.staff_schedule_audit_log where subject_id=b.id) audit
    from public.bookings b where b.id=any($1::uuid[]) order by b.id`, [blocks]));
  const beforeBlock = await blockState();
  await apply(); await apply();
  assert.equal(await one("select has_function_privilege('authenticated','public.substitute_minuta_booking(uuid,uuid,uuid)','EXECUTE')"), true);
  assert.equal(await one("select has_function_privilege('anon','public.substitute_minuta_booking(uuid,uuid,uuid)','EXECUTE')"), false);
  await db.query('set local role authenticated');
  const workspace = await one('select public.get_minuta_shift_workspace($1,$2,$2)', [fixture.org, fixture.date]);
  assert.deepEqual(workspace.bookings.map(item => item.id).sort(), [client, clientAfterReapply].sort());
  assert.ok(workspace.bookings.every(item => item.is_schedule_block === false));
  for (const block of blocks)
    await rejected(() => substitute(block, nextService), '55000', 'schedule_block_substitution_denied');
  assert.equal(await substitute(client, nextService), true);
  await db.query('reset role');
  assert.equal(await blockState(), beforeBlock);
  assert.equal(await one('select performer_id=$2 from public.bookings where id=$1', [client, nextActor]), true);
  await rollback();
  await db.query('set local role authenticated');
  assert.deepEqual((await one('select public.get_minuta_shift_workspace($1,$2,$2)', [fixture.org, fixture.date])).bookings.map(item => item.id).sort(), [client, clientAfterReapply].sort());
  for (const block of blocks)
    await rejected(() => substitute(block, nextService), '55000', 'booking_substitution_temporarily_unavailable');
  await rejected(() => substitute(clientAfterReapply, nextService), '55000', 'booking_substitution_temporarily_unavailable');
  await db.query('reset role');
  assert.equal(await blockState(), beforeBlock);
  assert.equal(await one('select performer_id=$2 from public.bookings where id=$1', [clientAfterReapply, fixture.actor]), true);
  await apply();
  await db.query('set local role authenticated');
  assert.deepEqual((await one('select public.get_minuta_shift_workspace($1,$2,$2)', [fixture.org, fixture.date])).bookings.map(item => item.id).sort(), [client, clientAfterReapply].sort());
  for (const block of blocks)
    await rejected(() => substitute(block, nextService), '55000', 'schedule_block_substitution_denied');
  assert.equal(await substitute(clientAfterReapply, nextService), true);
  await db.query('reset role');
  assert.equal(await blockState(), beforeBlock);
  console.log('PASS: isolated full schema v190 apply twice, block refusal/preservation, client substitution, rollback denial, reapply');
} catch (error) {
  console.error(JSON.stringify({ error:error.message, code:error.code }));
  process.exitCode = 1;
} finally {
  try {
    await db.query('rollback');
    if (originalRead) assert.equal(await one("select pg_get_functiondef('public.get_minuta_shift_workspace(uuid,date,date)'::regprocedure)"), originalRead);
    if (originalWrite) assert.equal(await one("select pg_get_functiondef('public.substitute_minuta_booking(uuid,uuid,uuid)'::regprocedure)"), originalWrite);
    console.log('Rolled back all A04 synthetic rows and schema changes.');
  } finally { await db.end(); }
}
