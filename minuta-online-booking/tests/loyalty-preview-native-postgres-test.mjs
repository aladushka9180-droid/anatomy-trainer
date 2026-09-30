// Run only against an empty, disposable PostgreSQL 17 database on localhost.
// The fixture contains synthetic identities; no Supabase or production URL is accepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const connectionString = process.env.LOYALTY_PREVIEW_LOCAL_POSTGRES_URL;
assert.ok(connectionString, 'LOYALTY_PREVIEW_LOCAL_POSTGRES_URL is required');
const target = new URL(connectionString);
assert.ok(['localhost','127.0.0.1','::1'].includes(target.hostname), 'Only a local PostgreSQL fixture is allowed');
assert.equal(target.pathname, '/loyalty_preview_fixture', 'Use the named disposable fixture database');
assert.equal(target.protocol, 'postgresql:');
assert.ok(!target.searchParams.has('sslmode') || target.searchParams.get('sslmode') === 'disable');

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const fixture = read('./loyalty-preview-native-fixture.sql');
const base = read('../supabase-migration-v166.sql');
const apply = read('../supabase-candidate-loyalty-adjustment-preview.sql');
const rollback = read('../supabase-candidate-loyalty-adjustment-preview-rollback.sql');
const org = '00000000-0000-4000-8000-000000000010';
const actor = '00000000-0000-4000-8000-000000000001';
const client = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request = n => client(n);
const connections = [];
const connect = async (api=false) => {
  const c = new pg.Client({ connectionString, application_name:'loyalty-preview-native-fixture', ssl:false });
  await c.connect();
  connections.push(c);
  await c.query("set statement_timeout='15s'; set lock_timeout='10s'");
  await c.query('select set_config($1,$2,false)', ['test.uid',actor]);
  if (api) await c.query('set role authenticated');
  return c;
};
const one = async (c, sql, values=[]) => (await c.query(sql,values)).rows[0];
async function waitForLock(observer, pid) {
  for (let attempt=0; attempt<100; attempt+=1) {
    const activity = await one(observer,'select wait_event_type from pg_stat_activity where pid=$1',[pid]);
    if (activity?.wait_event_type === 'Lock') return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('The second native transaction did not wait on the first transaction lock');
}
const preview = async (c, account, delta) => (await one(c,
  'select public.preview_minuta_loyalty_adjustment_v166($1,$2,$3) value',
  [org,account,delta])).value;
const confirm = async (c, account, delta, reason, requestId, snapshot) => (await one(c,
  `select public.confirm_minuta_loyalty_adjustment_v166($1,$2,$3,$4,$5,$6,$7,$8) value`,
  [org,account,delta,reason,requestId,snapshot.before,snapshot.cycle_number,snapshot.rule_id])).value;
let bookingNumber = 200;
async function booking(c, account, completed=true) {
  const id = client(++bookingNumber);
  await c.query(`insert into public.bookings(id,organization_id,client_account_id,booking_date,booking_time,client_name)
    values($1,$2,$3,current_date-1,'10:00','Synthetic client')`,[id,org,account]);
  await c.query(`insert into public.booking_outcomes(booking_id,visit_status) values($1,$2)`,
    [id,completed?'completed':'scheduled']);
  return id;
}
async function state(c, account) {
  return one(c,`select
    (select count(*)::integer from public.loyalty_program_rewards_v166 where client_account_id=$1) rewards,
    (select count(*)::integer from public.loyalty_program_history_v166
      where client_account_id=$1 and event_type='manual_adjustment') adjustments,
    (select cycle_number from public.loyalty_program_accounts_v166 where client_account_id=$1) cycle,
    (select manual_progress+(select count(*)::integer from public.loyalty_program_visits_v166 v
      where v.account_id=a.id and v.cycle_number=a.cycle_number and v.reversed_at is null)
      from public.loyalty_program_accounts_v166 a where a.client_account_id=$1) progress`,[account]);
}

try {
  const main = await connect();
  const identity = await one(main,`select current_database() database,
    current_setting('server_version_num')::integer version,
    pg_is_in_recovery() recovery,
    to_regclass('public.loyalty_program_settings_v166') is not null existing,
    (select count(*)::integer from pg_tables where schemaname not in('pg_catalog','information_schema')) user_tables`);
  assert.equal(identity.database,'loyalty_preview_fixture');
  assert.ok(identity.version >= 170000 && identity.version < 180000,'PostgreSQL 17 is required');
  assert.equal(identity.recovery,false);
  assert.equal(identity.existing,false,'Fixture database must be empty before this run');
  assert.equal(identity.user_tables,0,'Refuse to add fixture objects to a populated local database');
  await main.query(fixture);
  await main.query(base);
  await main.query(apply);
  assert.equal((await one(main,`select to_regprocedure(
    'public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)') is not null present`)).present,true);
  await main.query(rollback);
  assert.equal((await one(main,`select to_regprocedure(
    'public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)') is null removed`)).removed,true);

  // Old clients retain the v166 writer during the compatibility window.
  const api = await connect(true);
  await api.query('select public.set_minuta_loyalty_program_v166($1,true,2,$2,1000,$3,$4,null,$5)',
    [org,'percent','Скидка 10%','На одну услугу',request(100)]);
  await booking(main,client(22));
  const legacy = (await one(api,
    'select public.adjust_minuta_loyalty_progress_v166($1,$2,1,$3,$4) value',
    [org,client(22),'Старый интерфейс',request(101)])).value;
  assert.ok(legacy.reward_id,'Legacy writer still issues the reward after preview rollback');
  assert.deepEqual(await state(main,client(22)),{ rewards:1,adjustments:1,cycle:2,progress:0 });
  await main.query(apply);

  // Two different requests based on the same preview: one commit and one stale refusal.
  await booking(main,client(20));
  const snapshot = await preview(api,client(20),1);
  assert.deepEqual([snapshot.before,snapshot.after,snapshot.goal_visits],[1,2,2]);
  const a = await connect(true), b = await connect(true);
  const distinct = await Promise.allSettled([
    confirm(a,client(20),1,'Исправление A',request(102),snapshot),
    confirm(b,client(20),1,'Исправление B',request(103),snapshot)
  ]);
  assert.equal(distinct.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(distinct.filter(x=>x.status==='rejected').length,1);
  assert.equal(distinct.find(x=>x.status==='rejected').reason.code,'55000');
  assert.deepEqual(await state(main,client(20)),{ rewards:1,adjustments:1,cycle:2,progress:0 });
  const winningRequest = distinct[0].status==='fulfilled' ? request(102) : request(103);
  const winningReason = distinct[0].status==='fulfilled' ? 'Исправление A' : 'Исправление B';
  assert.equal((await confirm(api,client(20),1,winningReason,winningRequest,snapshot)).recovered,true);

  // Two simultaneous retries of one request are both safe, including a reward/new cycle.
  const nextCycle = await preview(api,client(20),2);
  const same = await Promise.all([
    confirm(a,client(20),2,'Повтор одного запроса',request(104),nextCycle),
    confirm(b,client(20),2,'Повтор одного запроса',request(104),nextCycle)
  ]);
  assert.deepEqual(same.map(row=>row.recovered).sort(),[false,true]);
  assert.deepEqual(await state(main,client(20)),{ rewards:2,adjustments:2,cycle:3,progress:0 });

  // Booking commits first. Confirmation must reject the outdated cycle/balance.
  await booking(main,client(21));
  const beforeBooking = await preview(api,client(21),1);
  const secondBooking = await booking(main,client(21),false);
  const bookingConnection = await connect(), adjustmentConnection = await connect(true);
  const bookingPid = (await one(bookingConnection,'select pg_backend_pid() pid')).pid;
  const adjustmentPid = (await one(adjustmentConnection,'select pg_backend_pid() pid')).pid;
  await bookingConnection.query('begin');
  await bookingConnection.query(`update public.booking_outcomes set visit_status='completed' where booking_id=$1`,[secondBooking]);
  const afterBookingPromise = confirm(adjustmentConnection,client(21),1,'Опоздавшая коррекция',request(105),beforeBooking)
    .then(value=>({value}),error=>({error}));
  await waitForLock(main,adjustmentPid);
  await bookingConnection.query('commit');
  assert.equal((await afterBookingPromise).error?.code,'55000');
  assert.deepEqual(await state(main,client(21)),{ rewards:1,adjustments:0,cycle:2,progress:0 });

  // Confirmation commits first. The subsequent booking counts in that same cycle.
  const beforeConfirm = await preview(api,client(21),1);
  const thirdBooking = await booking(main,client(21),false);
  await adjustmentConnection.query('begin');
  await confirm(adjustmentConnection,client(21),1,'Первая коррекция',request(106),beforeConfirm);
  await bookingConnection.query('begin');
  const bookingAfterConfirm = bookingConnection.query(
    `update public.booking_outcomes set visit_status='completed' where booking_id=$1`,[thirdBooking])
    .then(value=>({value}),error=>({error}));
  await waitForLock(main,bookingPid);
  await adjustmentConnection.query('commit');
  const bookingAfterResult = await bookingAfterConfirm;
  if (bookingAfterResult.error) throw bookingAfterResult.error;
  await bookingConnection.query('commit');
  assert.deepEqual(await state(main,client(21)),{ rewards:2,adjustments:1,cycle:3,progress:0 });

  // Absent account: uncommitted booking creates it while confirm still sees zero.
  const absentBooking = await booking(main,client(23),false);
  const absentPreview = await preview(api,client(23),1);
  assert.equal(absentPreview.before,0);
  await bookingConnection.query('begin');
  await bookingConnection.query(`update public.booking_outcomes set visit_status='completed' where booking_id=$1`,[absentBooking]);
  const absentConfirmation = confirm(adjustmentConnection,client(23),1,
    'Параллельное создание',request(107),absentPreview)
    .then(value=>({value}),error=>({error}));
  await waitForLock(main,adjustmentPid);
  await bookingConnection.query('commit');
  assert.equal((await absentConfirmation).error?.code,'55000');
  assert.deepEqual(await state(main,client(23)),{ rewards:0,adjustments:0,cycle:1,progress:1 });

  const rights = await one(main,`select
    has_function_privilege('anon','public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)','execute') anon_preview,
    has_function_privilege('authenticated','public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)','execute') authenticated_preview`);
  assert.deepEqual(rights,{ anon_preview:false,authenticated_preview:true });
  console.log('loyalty preview native PostgreSQL 17: PASS (apply/rollback/reapply, concurrent confirm, booking, absent account)');
} finally {
  await Promise.all(connections.map(c=>c.end().catch(()=>{})));
}
