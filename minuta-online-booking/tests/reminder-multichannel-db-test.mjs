import assert from 'node:assert/strict';
import {reminderDatabase,organization,performer,phone,bookingId,addBooking,enqueue,claim,clearBookings,scalar,applySql} from './reminder-delivery-db-fixture.mjs';

const db=await reminderDatabase();
const forward='scripts/reminder-single-catchup-candidate.sql',rollback='scripts/reminder-single-catchup-rollback.sql';
const definitions=async()=> (await db.query(`select oid::regprocedure::text name,pg_get_functiondef(oid) definition,proacl::text acl
  from pg_proc where oid in('public.claim_minuta_notification_outbox(text[],integer)'::regprocedure,
    'public.claim_minuta_notification_test_outbox_v128(uuid,text,text)'::regprocedure) order by proname`)).rows;
const state=async()=> (await db.query(`select (select jsonb_agg(to_jsonb(b)) from public.bookings b) bookings,
  (select jsonb_agg(to_jsonb(q)) from public.notification_outbox q) outbox,
  (select jsonb_agg(to_jsonb(s)) from public.organization_notification_settings s) settings,
  (select jsonb_agg(to_jsonb(c)) from public.organization_notification_channels c) channels`)).rows;
let passed=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);passed++;};
async function connect(audience,channel,active=true) {
  await db.query(`insert into public.organization_notification_channels(organization_id,audience,channel,enabled)
    values($1,$2,$3,true) on conflict(organization_id,audience,channel) do update set enabled=true`,[organization,audience,channel]);
  await db.query(`insert into public.notification_recipient_endpoints(
    organization_id,audience,subject_key,channel,destination,consent_source,consent_at,active)
    values($1,$2,$3,$4,$5::jsonb,'synthetic-consent',now(),$6)`,
    [organization,audience,audience==='client'?phone:performer,channel,
      JSON.stringify(channel==='telegram'?{chat_id:'synthetic-recipient'}:channel==='email'?{email:'synthetic@example.invalid'}:{phone}),active]);
}
async function fresh() {
  await clearBookings(db);
  await db.exec(`delete from public.notification_recipient_endpoints;delete from public.organization_notification_fallbacks;
    update public.organization_notification_channels set enabled=false;
    update public.organization_notification_settings set enabled=true,quiet_hours_enabled=false,reminder_minutes_before=1440;`);
}
try {
  const originals=await definitions(),before=await state();
  if(!process.argv.includes('--baseline')) {await applySql(db,forward);await applySql(db,forward);}
  check(await state(),before,'Installation and reapply preserve data/settings');
  await connect('client','sms');await connect('client','telegram');
  await addBooking(db,1,30);await enqueue(db);await enqueue(db);
  const jobs=await claim(db,['sms','telegram']);
  check(jobs.length,1,'At most one catch-up message across SMS and Telegram');
  check((await claim(db,['sms','telegram'])).length,0,'Next claim cannot send the other channel');
  check(await scalar(db,"select count(*)::int as value from public.notification_outbox where status='cancelled'"),1,'Duplicate is cancelled before external sending');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await connect('provider','email');await connect('provider','telegram');
  await addBooking(db,2,30);await addBooking(db,3,40);await enqueue(db);
  const separated=await claim(db,['sms','telegram','email']);
  check(separated.length,4,'One per booking and audience; master and client remain independent');
  check(new Set(separated.map(job=>`${job.booking_id}:${job.audience}`)).size,4,'No shared client/master or cross-booking suppression');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,4,30);await enqueue(db);
  const first=(await db.query("select * from public.claim_minuta_notification_outbox(array['sms','telegram'],1)")).rows;
  check(first.length,1,'Small batch chooses one');
  check((await claim(db,['sms','telegram'])).length,0,'Changing batch size cannot deliver another channel');
  await db.query("update public.notification_outbox set status='failed',last_error_code='telegram_delivery_unknown',locked_at=null,lock_token=null where id=$1",[first[0].outbox_id]);
  await connect('client','email');await enqueue(db);
  check((await claim(db,['sms','telegram','email'])).length,0,'New channel cannot bypass ambiguous prior attempt');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,5,30);await enqueue(db);
  const primary=(await claim(db,['sms']))[0];
  await db.query("update public.notification_outbox set status='sent',sent_at=now(),locked_at=null,lock_token=null where id=$1",[primary.outbox_id]);
  const alternate=await scalar(db,"select event_key as value from public.notification_outbox where channel='telegram'");
  check((await db.query('select * from public.claim_minuta_notification_test_outbox_v128($1,$2,$3)',[organization,alternate,'telegram'])).rows.length,0,'Controlled test cannot bypass the cross-channel limit');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,6,30);await enqueue(db);
  await db.query(`insert into public.organization_notification_fallbacks(
    organization_id,audience,primary_channel,fallback_channel,enabled,delay_seconds)
    values($1,'client','sms','telegram',true,0)`,[organization]);
  const failed=(await claim(db,['sms']))[0];
  await db.query("select public.fail_notification_outbox($1,$2,'synthetic_failure','Synthetic failure',false,0)",[failed.outbox_id,failed.lock_token]);
  check((await claim(db,['sms','telegram'])).length,0,'Fallback does not create a second catch-up attempt');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,11,30);await enqueue(db);
  const retry=(await claim(db,['sms']))[0];
  await db.query("select public.fail_notification_outbox($1,$2,'synthetic_timeout','Synthetic timeout',true,0)",[retry.outbox_id,retry.lock_token]);
  check((await claim(db,['telegram'])).length,0,'Retryable pending attempt blocks a second channel');
  await db.query("update public.notification_outbox set next_attempt_at=now()-interval '1 minute' where id=$1",[retry.outbox_id]);
  check((await claim(db,['sms'])).length,0,'Catch-up never repeats the first channel after a timeout');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,12,30);await enqueue(db);
  const expired=(await claim(db,['sms']))[0];
  await db.query("update public.notification_outbox set locked_at=now()-interval '16 minutes' where id=$1",[expired.outbox_id]);
  check((await claim(db,['sms','telegram'])).length,0,'Expired SMS lease cannot repeat or switch channels');
  await connect('client','email');await enqueue(db);
  check((await claim(db,['email'])).length,0,'Suppressed expired attempt keeps its prior delivery history');

  await fresh();await connect('client','email');await connect('client','sms');
  await addBooking(db,13,30);await enqueue(db);
  const retryPeer=(await claim(db,['sms']))[0];
  await db.query("update public.notification_outbox set locked_at=now()-interval '16 minutes' where id=$1",[retryPeer.outbox_id]);
  check((await claim(db,['email','sms'])).length,0,'A retry later in the same batch blocks an earlier fresh channel');

  await fresh();await connect('client','sms',false);await connect('client','telegram',false);
  await addBooking(db,7,30);await enqueue(db);
  check((await claim(db,['sms','telegram'])).length,0,'No active consented endpoint means no client sending');
  check(await scalar(db,'select sum(attempts)::int as value from public.notification_outbox'),0,'Missing endpoint does not consume attempts');
  await db.exec('update public.notification_recipient_endpoints set active=true;');
  check((await claim(db,['sms','telegram'])).length,1,'One catch-up after valid endpoint becomes active');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await db.exec('update public.organization_notification_settings set reminder_minutes_before=60;');
  await addBooking(db,8,75);await enqueue(db);
  check((await claim(db,['sms','telegram'])).length,2,'Ordinary early multi-channel reminders retain existing behavior');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,9,30);await enqueue(db);
  await db.query('update public.bookings set client_phone=$1 where id=$2',['79990000002',bookingId(9)]);
  check((await claim(db,['sms','telegram'])).length,0,'Changed client phone cannot receive an old reminder');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,14,30);await enqueue(db);
  await db.query('update public.bookings set organization_id=$1 where id=$2',['00000000-0000-4000-8000-000000000004',bookingId(14)]);
  check((await claim(db,['sms','telegram'])).length,0,'Moved booking cannot deliver from the previous organization');

  await fresh();await connect('client','sms');await connect('client','telegram');
  await addBooking(db,10,30);await enqueue(db);
  await db.exec('alter table public.bookings add column notification_schedule_revision bigint not null default 0;');
  const old=(await claim(db,['sms']))[0];
  await db.query("update public.notification_outbox set status='sent',locked_at=null,lock_token=null where id=$1",[old.outbox_id]);
  await db.query('update public.bookings set notification_schedule_revision=2 where id=$1',[bookingId(10)]);
  await db.query(`insert into public.notification_outbox(performer_id,booking_id,organization_id,event_key,kind,channel,audience,recipient_key,payload,dispatcher)
    select performer_id,booking_id,organization_id,event_key||':revision:2',kind,channel,audience,recipient_key,payload,dispatcher
    from public.notification_outbox where booking_id=$1`,[bookingId(10)]);
  const revised=await claim(db,['sms','telegram']);
  check(revised.length,1,'Optional schedule revision gets its own single current reminder');
  check(revised[0].event_key.endsWith(':revision:2'),true,'Old revision is not revived');

  const preserved=await state();
  await applySql(db,rollback);
  check(await definitions(),originals,'Rollback restores exact function definitions and ACL');
  check(await state(),preserved,'Rollback preserves bookings, outbox and settings');
  await applySql(db,forward);await applySql(db,forward);
  check(await state(),preserved,'Reapply preserves existing event history');
  await db.exec('set role authenticated;');
  await assert.rejects(claim(db,['sms']),/permission denied/);passed++;
  await assert.rejects(db.query("select * from public.claim_minuta_notification_outbox_before_catchup_once(array['sms'],20)"),/permission denied/);passed++;
  await db.exec('reset role;');await applySql(db,rollback);
  await db.exec('create role synthetic_legacy_dispatcher;grant execute on function public.claim_minuta_notification_outbox(text[],integer) to synthetic_legacy_dispatcher;');
  const customAcl=await definitions();
  await assert.rejects(applySql(db,forward),/single_catchup_unexpected_execute_acl/);passed++;
  await db.exec('rollback;');
  check(await definitions(),customAcl,'Unknown ACL blocks installation without removing the grant');
  console.log(`PASS: ${passed} single catch-up checks, consent/ambiguity/fallback/revision guards and exact rollback; no messages.`);
} finally { await db.close(); }
