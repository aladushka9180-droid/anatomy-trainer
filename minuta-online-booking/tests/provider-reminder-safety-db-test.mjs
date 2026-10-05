import assert from 'node:assert/strict';
import {reminderDatabase,organization,performer,bookingId,addBooking,scalar,enqueue,claim,clearBookings} from './reminder-delivery-db-fixture.mjs';

const db=await reminderDatabase({candidate:true});
let passed=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);passed++;};
try {
  await db.query(`update public.organization_notification_channels set enabled=true
    where organization_id=$1 and audience='provider' and channel='telegram'`,[organization]);
  await db.query(`insert into public.notification_recipient_endpoints(
    organization_id,audience,subject_key,channel,destination,consent_source,consent_at,active)
    values($1,'provider',$2,'telegram','{"chat_id":"synthetic-provider"}','synthetic',now(),true)`,[organization,performer]);
  for(const [id,minutes,status] of [[1,30,'confirmed'],[2,-1,'confirmed'],[3,20,'cancelled'],[4,20,'new'],[5,1471,'confirmed']])
    await addBooking(db,id,minutes,status);
  check(await enqueue(db),1,'Only confirmed future booking catches up');
  check(await enqueue(db),0,'Repeated scheduler adds no duplicate');
  const jobs=await claim(db);
  check(jobs.length,1,'Only one provider reminder is claimable');
  check(jobs[0].audience,'provider','Master recipient is separate from client');
  check(jobs[0].booking_id,bookingId(1),'Correct confirmed future booking');
  check(jobs[0].destination.chat_id,'synthetic-provider','Configured master destination');
  check((await claim(db)).length,0,'Active lease cannot be claimed twice');
  await db.exec(`update public.notification_outbox set locked_at=now()-interval '16 minutes';`);
  check((await claim(db)).length,0,'Expired Telegram lease is never resent');
  check(await scalar(db,'select last_error_code as value from public.notification_outbox'),'telegram_delivery_unknown','Ambiguous Telegram result is quarantined');
  check(await enqueue(db),0,'Scheduler does not recreate quarantined event');

  await clearBookings(db);
  await addBooking(db,6,30);await enqueue(db);
  await db.query('update public.bookings set status=\'cancelled\' where id=$1',[bookingId(6)]);
  check((await claim(db)).filter(job=>job.kind==='booking_reminder').length,0,'Cancellation before claim prevents reminder');
  check(await scalar(db,"select status as value from public.notification_outbox where kind='booking_reminder'"),'cancelled','Cancelled pending event is terminal');

  await clearBookings(db);
  await addBooking(db,7,30);await enqueue(db);
  await db.query(`update public.bookings set booking_date=((now() at time zone 'Europe/Samara')+interval '2 hours')::date,
    booking_time=((now() at time zone 'Europe/Samara')+interval '2 hours')::time where id=$1`,[bookingId(7)]);
  check((await claim(db)).filter(job=>job.kind==='booking_reminder').length,0,'Old time cannot be sent after reschedule');
  check(await enqueue(db),1,'New time gets its own reminder');
  const moved=(await claim(db)).filter(job=>job.kind==='booking_reminder');
  check(moved.length,1,'Only new schedule is claimable');
  check(moved[0].message_payload.booking_time,await scalar(db,'select booking_time::text as value from public.bookings'),'Payload matches current time');

  await clearBookings(db);
  await addBooking(db,8,30);await enqueue(db);
  await db.query(`update public.bookings set booking_date=((now() at time zone 'Europe/Samara')-interval '1 minute')::date,
    booking_time=((now() at time zone 'Europe/Samara')-interval '1 minute')::time where id=$1`,[bookingId(8)]);
  check((await claim(db)).filter(job=>job.kind==='booking_reminder').length,0,'Visit that became past is not delivered');

  await clearBookings(db);
  await addBooking(db,9,30);await enqueue(db);
  await db.exec('update public.organization_notification_settings set enabled=false;');
  check((await claim(db)).length,0,'Organization OFF blocks pending delivery');
  await db.exec('update public.organization_notification_settings set enabled=true;update public.organization_notification_channels set enabled=false;');
  check((await claim(db)).length,0,'Channel OFF blocks pending delivery');
  await db.exec("update public.organization_notification_channels set enabled=true where audience='provider' and channel='telegram';");
  await db.exec(`update public.organization_notification_settings set quiet_hours_enabled=true,
    quiet_hours_start=((now() at time zone 'Europe/Samara')-interval '5 minutes')::time,
    quiet_hours_end=((now() at time zone 'Europe/Samara')+interval '5 minutes')::time;`);
  check((await claim(db)).length,0,'Quiet hours defer delivery');
  await db.exec('update public.organization_notification_settings set quiet_hours_enabled=false;');
  check((await claim(db)).length,1,'Delivery resumes when quiet hours end');

  await db.exec("select set_config('request.jwt.claim.role','authenticated',false);");
  await assert.rejects(enqueue(db),/service_role_required/);passed++;
  await db.exec('set role authenticated;');
  await assert.rejects(claim(db),/permission denied/);passed++;
  console.log(`PASS: ${passed} provider reminder checks using actual v126/v128/v169 SQL; synthetic memory database, no messages.`);
} finally { await db.close(); }
