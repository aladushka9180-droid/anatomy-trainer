import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

if (!process.env.MINUTA_PGLITE_PACKAGE) {
  throw new Error('Set MINUTA_PGLITE_PACKAGE to an isolated @electric-sql/pglite package directory');
}
const { PGlite } = createRequire(import.meta.url)(path.join(process.env.MINUTA_PGLITE_PACKAGE, 'dist/index.cjs'));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(root, 'supabase-migration-v169.sql'), 'utf8')
  .replace(/^\\set .*\r?\n/m, '');
const rollback = fs.readFileSync(path.join(root, 'supabase-migration-v169-rollback.sql'), 'utf8')
  .replace(/^\\set .*\r?\n/m, '');
const db = new PGlite();
const org = '10000000-0000-4000-8000-000000000001';
const booking = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scalar = async sql => (await db.query(sql)).rows[0].value;

try {
  await db.exec(`
    create schema auth;
    create function auth.role() returns text language sql stable as $$
      select current_setting('request.jwt.claim.role',true)
    $$;
    create table public.bookings(
      id uuid primary key, organization_id uuid not null, status text not null,
      booking_date date not null, booking_time time without time zone not null,
      client_phone text not null
    );
    create table public.organization_notification_settings(
      organization_id uuid primary key, enabled boolean not null,
      booking_reminder_enabled boolean not null, reminder_minutes_before integer not null
    );
    create table public.organization_notification_channels(
      organization_id uuid not null, audience text not null, channel text not null,
      enabled boolean not null, primary key(organization_id,audience,channel)
    );
    create table public.notification_outbox(
      event_key text primary key, booking_id uuid not null, kind text not null
    );
    create function public.enqueue_minuta_booking_notification(p_booking uuid,p_kind text)
    returns integer language plpgsql as $$
    declare v_count integer:=0; v_added integer; v_booking record; v_channel record;
    begin
      select * into v_booking from public.bookings where id=p_booking;
      for v_channel in select audience,channel from public.organization_notification_channels
        where organization_id=v_booking.organization_id and enabled
      loop
        insert into public.notification_outbox(event_key,booking_id,kind) values(
          'booking:'||v_booking.id::text||':'||p_kind||':'||v_booking.booking_date::text
          ||':'||v_booking.booking_time::text||':'||v_channel.audience||':'||v_channel.channel,
          v_booking.id,p_kind
        ) on conflict(event_key) do nothing;
        get diagnostics v_added=row_count;
        v_count:=v_count+v_added;
      end loop;
      return v_count;
    end $$;
    create function public.enqueue_due_minuta_booking_reminders(p_limit integer default 500)
    returns integer language sql as $$ select 0 $$;
    insert into public.organization_notification_settings values('${org}',true,true,1440);
    insert into public.organization_notification_channels values('${org}','client','sms',true);
    select set_config('request.jwt.claim.role','service_role',false);
  `);
  await db.exec(migration);

  const addBooking = async (id, minutes, status = 'confirmed') => db.exec(`
    insert into public.bookings
    select '${booking(id)}','${org}','${status}',
      ((now() at time zone 'Europe/Samara')+interval '${minutes} minutes')::date,
      ((now() at time zone 'Europe/Samara')+interval '${minutes} minutes')::time,
      '79990000000'
  `);
  await addBooking(1, 30);
  await addBooking(2, 45);
  await addBooking(3, 1471);
  await addBooking(4, -1);
  await addBooking(5, 20, 'cancelled');
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 1,
    'first missed reminder is queued');
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 1,
    'already queued booking cannot consume the next batch');
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 0,
    'retry does not duplicate reminders or enqueue future/past/cancelled visits');
  assert.equal(await scalar('select count(*)::integer as value from public.notification_outbox'), 2);

  await db.exec(`insert into public.organization_notification_channels values('${org}','provider','email',true)`);
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 1,
    'newly enabled channel gets only its missing event');
  await db.exec(`update public.bookings set booking_time=(booking_time+interval '1 hour')::time
    where id='${booking(1)}'`);
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 1,
    'other booking fills only its newly enabled channel');
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 2,
    'rescheduled time gets distinct per-channel keys');
  await db.exec(`update public.bookings set status='cancelled' where id='${booking(2)}'`);
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 0,
    'cancelled visits do not receive a late reminder');
  assert.equal(await scalar('select count(*)::integer as value from public.notification_outbox'), 6);

  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)");
  await assert.rejects(db.query('select public.enqueue_due_minuta_booking_reminders(1)'),
    /service_role_required/, 'browser role cannot queue reminders');
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  await addBooking(6, 25);
  await db.exec(rollback);
  assert.equal(await scalar('select public.enqueue_due_minuta_booking_reminders(1) as value'), 0,
    'rollback restores the old bounded scheduling window');
  console.log('PrimeTime Pro reminder catch-up v169 isolated DB checks: PASS');
} finally {
  await db.close();
}
