// Isolated single-connection rehearsal. Multi-connection atomicity still needs PostgreSQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PGLITE_MODULE;
assert.ok(modulePath, 'Set MINUTA_PGLITE_MODULE to an isolated PGlite installation');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const db = new PGlite();

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema extensions;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role',true),'')
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create function extensions.digest(data bytea,kind text) returns bytea language sql immutable as $$
      select decode(md5(encode(data,'hex'))||md5(encode(data,'hex')||kind),'hex')
    $$;
    create table public.bookings(organization_id uuid,client_phone text,client_name text);
    create table public.organization_waitlist_requests(organization_id uuid,client_phone text,client_name text);
    create table public.conversation_messages_v162(conversation_id uuid,sender_participant_id uuid);
    create table public.message_participants_v162(id uuid,conversation_id uuid,active boolean);
    create table public.message_conversations_v162(id uuid);
    create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean);
    create function public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time,text,text,integer,integer)
      returns uuid language sql as $$ select null::uuid $$;
    create function public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text)
      returns uuid language sql as $$ select null::uuid $$;
    create function public.minuta_send_message_core_v162(uuid,uuid,text,text,uuid,text)
      returns uuid language sql as $$ select null::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    grant insert on public.bookings,public.organization_waitlist_requests,
      public.conversation_messages_v162 to anon,authenticated,service_role;
  `);

  const migration = read('supabase-migration-v173.sql');
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(read('tests/abuse-guards-v173-integration.sql'));

  const org = '00000000-0000-4000-8000-000000000173';
  const conversation = '00000000-0000-4000-8000-000000000174';
  const participant = '00000000-0000-4000-8000-000000000175';
  await db.exec(`insert into public.message_participants_v162 values('${participant}','${conversation}',true)`);
  await db.exec("select set_config('request.jwt.claim.role','anon',false); set role anon");
  const booking = `insert into public.bookings values('${org}','79990000173','Ирина')`;
  for (let i = 0; i < 5; i += 1) await db.exec(booking);
  await assert.rejects(() => db.exec(booking), /request_rate_limited/);
  await assert.rejects(() => db.exec(`insert into public.bookings values('${org}',repeat('1',41),'Ирина')`),
    /invalid_booking_data/);
  await assert.rejects(() => db.exec(`insert into public.organization_waitlist_requests values('${org}',repeat('1',41),'Ирина')`),
    /invalid_client_data/);
  const message = `insert into public.conversation_messages_v162 values('${conversation}','${participant}')`;
  for (let i = 0; i < 12; i += 1) await db.exec(message);
  await assert.rejects(() => db.exec(message), /request_rate_limited/);
  await db.exec('reset role');

  const counts = (await db.query(`select scope_kind,request_count from public.minuta_abuse_rate_buckets_v173
    where scope_kind in('booking_phone_hour','message_participant_minute') order by scope_kind`)).rows;
  assert.deepEqual(counts, [
    { scope_kind: 'booking_phone_hour', request_count: 5 },
    { scope_kind: 'message_participant_minute', request_count: 12 },
  ]);

  await db.exec(read('supabase-migration-v173-rollback.sql'));
  assert.equal((await db.query("select to_regclass('public.minuta_abuse_rate_buckets_v173') is null missing")).rows[0].missing, true);

  await db.exec(`create function public.guard_minuta_waitlist_v173()
    returns trigger language plpgsql as $$ begin return new; end $$`);
  await assert.rejects(() => db.exec(migration), /v173_abuse_guard_function_name_collision/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.minuta_abuse_rate_buckets_v173') is null missing")).rows[0].missing, true);
  await db.exec('drop function public.guard_minuta_waitlist_v173()');

  await db.exec(`create function public.foreign_booking_guard_v173()
    returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger bookings_abuse_guard_v173 before insert on public.bookings
    for each row execute function public.foreign_booking_guard_v173()`);
  await assert.rejects(() => db.exec(migration), /v173_abuse_guard_trigger_name_collision/);
  await db.exec('rollback');
  await db.exec('drop trigger bookings_abuse_guard_v173 on public.bookings; drop function public.foreign_booking_guard_v173()');

  await db.exec(migration);
  assert.equal((await db.query("select to_regclass('public.minuta_abuse_rate_buckets_v173') is not null restored")).rows[0].restored, true);
  await db.exec("comment on function public.guard_minuta_waitlist_v173() is 'foreign function'");
  await assert.rejects(() => db.exec(read('supabase-migration-v173-rollback.sql')),
    /v173_abuse_guard_rollback_state_mismatch/);
  await db.exec('rollback');
  assert.equal((await db.query("select to_regclass('public.minuta_abuse_rate_buckets_v173') is not null preserved")).rows[0].preserved, true);
  await db.exec("comment on function public.guard_minuta_waitlist_v173() is 'minuta_abuse_guard_v173'");
  console.log('PASS: v173 PGlite apply/reapply, trigger limits, rollback/reapply');
} catch (error) {
  console.error(`v173 PGlite rehearsal failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
