import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join} from 'node:path';

const root=new URL('../',import.meta.url);
const read=name=>readFileSync(new URL(name,root),'utf8');
export const applySql=(db,name)=>db.exec(read(name).replace(/^\\set[^\n]*\n/,''));
export const organization='00000000-0000-4000-8000-000000000001';
export const performer='00000000-0000-4000-8000-000000000002';
export const service='00000000-0000-4000-8000-000000000003';
export const bookingId=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const phone='79990000001';
export function isolatedNotificationSetup() {
  const setup=read('notification-v126-integration-test.ts').match(/await database\.exec\(`([\s\S]*?)`\);/)?.[1];
  assert.ok(setup,'Existing v126 isolated schema');
  const ids={organization,performer,service};
  return setup.replace(/\$\{(\w+)\}/g,(_,name)=>{assert.ok(ids[name],name);return ids[name];});
}

// Reuse the existing isolated schema fixture, then apply the actual SQL functions.
// No URL, credentials, persistent database, dispatcher or network connection is used.
export async function reminderDatabase({candidate=false}={}) {
  assert.ok(process.env.MINUTA_PGLITE_PACKAGE,'Set MINUTA_PGLITE_PACKAGE to a local PGlite package');
  const {PGlite}=createRequire(import.meta.url)(join(process.env.MINUTA_PGLITE_PACKAGE,'dist/index.cjs'));
  const db=new PGlite();
  try {
    await db.exec(isolatedNotificationSetup());
    await db.exec(`create function public.enqueue_due_minuta_booking_reminders(integer default 500)
      returns integer language sql as $$select 0$$;`);
    for(const version of [126,128,169]) await db.exec(read(`supabase-migration-v${version}.sql`).replace(/^\\set[^\n]*\n/,''));
    if(candidate) await applySql(db,'scripts/reminder-single-catchup-candidate.sql');
    await db.exec('update public.organization_notification_channels set enabled=false;');
    return db;
  } catch(error) { await db.close(); throw error; }
}

export async function addBooking(db,id,minutes,status='confirmed') {
  await db.query(`insert into public.bookings(
    id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,status,organization_id)
    select $1,'SYNTHETIC',gen_random_uuid(),$2,$3,'Synthetic client',$4,
      ((now() at time zone 'Europe/Samara')+make_interval(mins=>$5))::date,
      ((now() at time zone 'Europe/Samara')+make_interval(mins=>$5))::time,$6,$7`,
    [bookingId(id),performer,service,phone,minutes,status,organization]);
}
export const scalar=async(db,sql,params=[])=> (await db.query(sql,params)).rows[0].value;
export const enqueue=db=>scalar(db,'select public.enqueue_due_minuta_booking_reminders(20) as value');
export const claim=async(db,channels=['telegram'])=>(await db.query(
  'select * from public.claim_minuta_notification_outbox($1::text[],20)',[channels])).rows;
export async function clearBookings(db) {
  await db.exec(`delete from public.notification_delivery_attempts;
    delete from public.notification_outbox;delete from public.bookings;`);
}
