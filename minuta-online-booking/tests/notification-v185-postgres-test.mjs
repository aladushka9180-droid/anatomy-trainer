// Real two-connection PostgreSQL 17 test against one empty loopback fixture.
// Never accepts a remote host, production project, or an existing database.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

assert.equal(process.env.MINUTA_V185_EPHEMERAL_CONFIRM, 'EMPTY_LOOPBACK_POSTGRES_17');
const dsn = new URL(process.env.MINUTA_V185_EPHEMERAL_DATABASE_URL || '');
assert.equal(dsn.protocol, 'postgresql:');
assert.equal(dsn.hostname, '127.0.0.1');
assert.equal(dsn.port, '55433');
assert.equal(dsn.pathname, '/minuta_v185_fixture');
assert.equal(dsn.username, 'postgres');
const pg = await import(pathToFileURL(process.env.MINUTA_PG_MODULE).href);
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function');
const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8')
  .replace(/^\\set ON_ERROR_STOP on\s*/i, '');
const clients = [];
async function connect() {
  const client = new Client({ connectionString: dsn.href, application_name: 'minuta-v185-empty-fixture' });
  await client.connect();
  clients.push(client);
  await client.query("set statement_timeout='20s'; set lock_timeout='15s'");
  return client;
}
async function waitForLock(admin, pid) {
  for (let i = 0; i < 120; i++) {
    const state = await admin.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1", [pid]);
    if (state.rows[0]?.waiting) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw Error('second_session_did_not_wait_for_real_lock');
}
const org = '00000000-0000-4000-8000-000000000001';
const performer = '00000000-0000-4000-8000-000000000002';
const service = '00000000-0000-4000-8000-000000000003';
const pendingBooking = '40000000-0000-4000-8000-000000000001';
const sentBooking = '40000000-0000-4000-8000-000000000002';
let admin;
try {
  admin = await connect();
  assert.equal((await admin.query('show server_version_num')).rows[0].server_version_num.startsWith('17'), true);
  await admin.query(read('tests/notification-v185-synthetic-schema.sql'));
  await admin.query(read('supabase-migration-v126.sql'));
  await admin.query(read('supabase-migration-v185.sql'));
  await admin.query(read('supabase-migration-v185.sql'));
  await admin.query('insert into public.organizations(id) values($1)', [org]);
  await admin.query("insert into public.performer_profiles(id,display_name) values($1,'Fixture')", [performer]);
  await admin.query("insert into public.services(id,name) values($1,'Fixture')", [service]);
  await admin.query(
    'insert into public.organization_notification_settings(organization_id,enabled) values($1,true)', [org]);
  await admin.query(
    "insert into public.organization_notification_channels(organization_id,audience,channel,enabled)" +
    " values($1,'client','telegram',true),($1,'client','sms',true),($1,'provider','telegram',true)",
    [org]
  );
  await admin.query(
    "insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone," +
    "booking_date,booking_time,status,organization_id) values" +
    "($1,'P',gen_random_uuid(),$3,$4,'Fixture','79990000001','2099-09-09','14:00','confirmed',$5)," +
    "($2,'S',gen_random_uuid(),$3,$4,'Fixture','79990000001','2099-09-09','14:00','confirmed',$5)",
    [pendingBooking, sentBooking, performer, service, org]
  );
  await admin.query("select public.enqueue_minuta_booking_notification($1,'booking_rescheduled')", [pendingBooking]);
  await admin.query("select public.enqueue_minuta_booking_notification($1,'booking_reminder')", [pendingBooking]);
  await admin.query("select public.enqueue_minuta_booking_notification($1,'booking_rescheduled')", [sentBooking]);
  const original = await admin.query(
    "select event_key from public.notification_outbox where booking_id=$1 and kind='booking_rescheduled'" +
    " and audience='client' and channel='telegram'",
    [pendingBooking]
  );
  assert.equal(original.rows[0].event_key,
    'booking:' + pendingBooking + ':booking_rescheduled:2099-09-09:14:00:00:client:telegram');
  await admin.query(
    "update public.notification_outbox set status='sent',attempts=1,sent_at=now()," +
    "provider_message_id='fixture-sent' where booking_id=$1 and kind='booking_rescheduled'" +
    " and audience='client' and channel='telegram'",
    [sentBooking]
  );

  const a = await connect();
  const b = await connect();
  const bPid = (await b.query('select pg_backend_pid() pid')).rows[0].pid;
  await a.query('begin');
  await a.query("update public.bookings set booking_time='15:00' where id=$1", [pendingBooking]);
  const waitingMove = b.query("update public.bookings set booking_time='14:00' where id=$1", [pendingBooking]);
  await waitForLock(admin, bPid);
  await a.query('commit');
  assert.equal((await waitingMove).rowCount, 1);
  assert.equal((await admin.query(
    'select notification_schedule_revision::integer revision from public.bookings where id=$1',
    [pendingBooking]
  )).rows[0].revision, 2);
  await admin.query("update public.bookings set booking_time='15:00' where id=$1", [sentBooking]);
  await admin.query("update public.bookings set booking_time='14:00' where id=$1", [sentBooking]);
  await admin.query("update public.bookings set booking_date='2099-09-09',booking_time='14:00' where id=$1",
    [pendingBooking]);
  assert.equal((await admin.query(
    'select notification_schedule_revision::integer revision from public.bookings where id=$1',
    [pendingBooking]
  )).rows[0].revision, 2);
  const cycle = await admin.query(
    "select booking_id::text,kind,count(*) filter(where status='cancelled')::integer cancelled," +
    "count(*) filter(where status='sent')::integer sent,count(*) filter(where status='pending')::integer pending" +
    " from public.notification_outbox where booking_id in($1,$2) and audience='client' and channel='telegram'" +
    " and payload->>'booking_time'='14:00:00' and kind='booking_rescheduled'" +
    ' group by booking_id,kind order by booking_id',
    [pendingBooking, sentBooking]
  );
  assert.deepEqual(cycle.rows, [
    { booking_id: pendingBooking, kind: 'booking_rescheduled', cancelled: 1, sent: 0, pending: 1 },
    { booking_id: sentBooking, kind: 'booking_rescheduled', cancelled: 0, sent: 1, pending: 1 }
  ]);

  await a.query('begin');
  const firstReminder = await a.query(
    "select public.enqueue_minuta_booking_notification($1,'booking_reminder') inserted", [pendingBooking]);
  assert.equal(firstReminder.rows[0].inserted, 3);
  const waitingDuplicate = b.query(
    "select public.enqueue_minuta_booking_notification($1,'booking_reminder') inserted", [pendingBooking]);
  await waitForLock(admin, bPid);
  await a.query('commit');
  assert.equal((await waitingDuplicate).rows[0].inserted, 0);
  assert.equal((await admin.query(
    "select count(*)::integer n from public.notification_outbox where booking_id=$1" +
    " and kind='booking_reminder' and audience='client' and channel='telegram'" +
    " and status='pending'",
    [pendingBooking]
  )).rows[0].n, 1);
  const acl = await admin.query(
    "select has_function_privilege('anon','public.enqueue_minuta_booking_notification(uuid,text)','execute') anon," +
    "has_function_privilege('authenticated','public.enqueue_minuta_booking_notification(uuid,text)','execute') authenticated," +
    "has_function_privilege('service_role','public.touch_minuta_notification_schedule_revision_v185()','execute') trigger_execute"
  );
  assert.deepEqual(acl.rows, [{ anon: false, authenticated: false, trigger_execute: false }]);

  await admin.query(read('supabase-migration-v185-rollback.sql'));
  const retained = await admin.query(
    "select exists(select 1 from information_schema.columns where table_schema='public'" +
    " and table_name='bookings' and column_name='notification_schedule_revision') retained," +
    " position('notification_schedule_revision' in p.prosrc)>0 revised_source" +
    " from pg_proc p where p.oid='public.enqueue_minuta_booking_notification(uuid,text)'::regprocedure"
  );
  assert.deepEqual(retained.rows, [{ retained: true, revised_source: false }]);
  await admin.query(read('supabase-migration-v185.sql'));
  await admin.query(read('supabase-migration-v185.sql'));
  assert.equal((await admin.query(
    "select public.enqueue_minuta_booking_notification($1,'booking_reminder') inserted", [pendingBooking]
  )).rows[0].inserted, 0);
  assert.equal((await admin.query(
    'select notification_schedule_revision::integer revision from public.bookings where id=$1',
    [pendingBooking]
  )).rows[0].revision, 2);
  await admin.query('delete from public.notification_delivery_attempts');
  await admin.query('delete from public.notification_outbox');
  await admin.query('delete from public.bookings');
  await admin.query(read('supabase-migration-v185-rollback.sql'));
  assert.equal((await admin.query(
    "select exists(select 1 from information_schema.columns where table_schema='public'" +
    " and table_name='bookings' and column_name='notification_schedule_revision') present"
  )).rows[0].present, false);
  console.log('PASS v185 PostgreSQL 17: real lock race, exact dedup, sent history, rev0, no-op, ACL, rollback and reapply');
} finally {
  for (const client of clients) {
    try { await client.query('rollback'); } catch {}
    await client.end().catch(() => {});
  }
}
