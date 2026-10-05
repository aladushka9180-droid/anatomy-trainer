// Real concurrent sessions, restricted to one empty loopback PostgreSQL 17 fixture.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isolatedNotificationSetup,organization,phone,bookingId,addBooking,enqueue,clearBookings} from './reminder-delivery-db-fixture.mjs';

assert.equal(process.env.MINUTA_REMINDER_EPHEMERAL_CONFIRM,'EMPTY_LOOPBACK_POSTGRES_17');
const dsn=new URL(process.env.MINUTA_REMINDER_EPHEMERAL_DATABASE_URL||'');
assert.equal(dsn.protocol,'postgresql:');assert.equal(dsn.hostname,'127.0.0.1');
assert.equal(dsn.port,'55437');assert.equal(dsn.pathname,'/minuta_reminder_fixture');assert.equal(dsn.username,'postgres');
const pg=await import(pathToFileURL(process.env.MINUTA_PG_MODULE).href);
const Client=pg.Client||pg.default?.Client;
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/^\\set[^\n]*\n/,'');
const sessions=[];
async function connect() {
  const client=new Client({connectionString:dsn.href,application_name:'minuta-reminder-empty-fixture'});
  await client.connect();sessions.push(client);
  await client.query("set statement_timeout='20s';set lock_timeout='15s';select set_config('request.jwt.claim.role','service_role',false)");
  return client;
}
async function waitForLock(admin,pid) {
  for(let i=0;i<120;i++) {
    await admin.query('select pg_stat_clear_snapshot()');
    if((await admin.query("select wait_event_type='Lock' waiting from pg_stat_activity where pid=$1",[pid])).rows[0]?.waiting)return;
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw Error('second_claim_did_not_wait_for_shared_reminder_lock');
}
const definitions=async(client)=>(await client.query(`select oid::regprocedure::text name,pg_get_functiondef(oid) definition,proacl::text acl
  from pg_proc where oid in('public.claim_minuta_notification_outbox(text[],integer)'::regprocedure,
    'public.claim_minuta_notification_test_outbox_v128(uuid,text,text)'::regprocedure) order by proname`)).rows;
try {
  const admin=await connect(),a=await connect(),b=await connect();
  const fixture={query:admin.query.bind(admin),exec:admin.query.bind(admin)};
  assert.equal((await admin.query('show server_version_num')).rows[0].server_version_num.startsWith('17'),true);
  assert.equal((await admin.query("select count(*)::int n from pg_tables where schemaname in('public','auth')")).rows[0].n,0,'Refuse a non-empty database');
  await admin.query(isolatedNotificationSetup());
  await admin.query('create function public.enqueue_due_minuta_booking_reminders(integer default 500) returns integer language sql as $$select 0$$');
  for(const version of [126,128,169])await admin.query(read(`supabase-migration-v${version}.sql`));
  const original=await definitions(admin);
  await admin.query(read('scripts/reminder-single-catchup-candidate.sql'));
  await admin.query(read('scripts/reminder-single-catchup-candidate.sql'));
  await admin.query("update public.organization_notification_channels set enabled=audience='client' and channel in('sms','telegram')");
  for(const channel of ['sms','telegram'])await admin.query(`insert into public.notification_recipient_endpoints(
    organization_id,audience,subject_key,channel,destination,consent_source,consent_at,active)
    values($1,'client',$2,$3,'{"chat_id":"synthetic-client","phone":"79990000001"}','synthetic-consent',now(),true)`,[organization,phone,channel]);
  let checks=0;
  for(const [id,firstChannel,secondChannel,controlled] of [[1,'sms','telegram',false],[2,'telegram','sms',false],[3,'sms','telegram',true]]) {
    await clearBookings(fixture);await addBooking(fixture,id,30);await enqueue(fixture);
    await a.query('begin');await b.query('begin');
    const first=(await a.query('select * from public.claim_minuta_notification_outbox($1::text[],1)',[[firstChannel]])).rows;
    assert.equal(first.length,1);checks++;
    const secondPid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
    const event=(await admin.query('select event_key from public.notification_outbox where channel=$1',[secondChannel])).rows[0].event_key;
    const pending=(controlled
      ?b.query('select * from public.claim_minuta_notification_test_outbox_v128($1,$2,$3)',[organization,event,secondChannel])
      :b.query('select * from public.claim_minuta_notification_outbox($1::text[],1)',[[secondChannel]]))
      .then(value=>({value}),error=>({error}));
    await waitForLock(admin,secondPid);checks++;
    await a.query('commit');
    const second=await pending;if(second.error)throw second.error;
    assert.equal(second.value.rows.length,0,'Concurrent second channel must not escape');checks++;
    await b.query('commit');
    assert.equal((await admin.query("select count(*)::int n from public.notification_outbox where status='sending'")).rows[0].n,1);checks++;
    assert.equal((await admin.query("select count(*)::int n from public.notification_outbox where status='cancelled'")).rows[0].n,1);checks++;
  }
  await clearBookings(fixture);await addBooking(fixture,4,30);await enqueue(fixture);
  await admin.query('begin');
  await admin.query(`select pg_advisory_xact_lock(hashtextextended(
    id::text||':client:'||booking_date::text||':'||booking_time::text||':0',0))
    from public.bookings where id=$1`,[bookingId(4)]);
  await a.query('begin');
  const waitingPid=(await a.query('select pg_backend_pid() pid')).rows[0].pid;
  const changedRecipient=a.query("select * from public.claim_minuta_notification_outbox(array['sms'],1)")
    .then(value=>({value}),error=>({error}));
  await waitForLock(admin,waitingPid);checks++;
  await admin.query('update public.bookings set client_phone=$1 where id=$2',['79990000002',bookingId(4)]);
  await admin.query('commit');
  const obsolete=await changedRecipient;if(obsolete.error)throw obsolete.error;
  assert.equal(obsolete.value.rows.length,0,'Recipient must be rechecked after the concurrent lock wait');checks++;
  await a.query('commit');
  const dataBefore=(await admin.query('select jsonb_agg(to_jsonb(q)) rows from public.notification_outbox q')).rows;
  await admin.query(read('scripts/reminder-single-catchup-rollback.sql'));
  assert.deepEqual(await definitions(admin),original);checks++;
  assert.deepEqual((await admin.query('select jsonb_agg(to_jsonb(q)) rows from public.notification_outbox q')).rows,dataBefore);checks++;
  await admin.query(read('scripts/reminder-single-catchup-candidate.sql'));checks++;
  console.log(`PASS: ${checks} native PostgreSQL 17 checks, two-session normal/controlled cross-channel races and exact rollback; no messages.`);
} finally {
  for(const client of sessions){try{await client.query('rollback');}catch{}await client.end();}
}
