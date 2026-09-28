import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const diagnostic = read('../scripts/booking-delete-diagnostic.sql');
const deleteRpc = read('../supabase-migration-v64.sql');
const messaging = read('../supabase-migration-v162.sql');
const notices = [];
const db = new PGlite();
const actor = '00000000-0000-4000-8000-000000000001';
const foreignActor = '00000000-0000-4000-8000-000000000002';
const booking = '00000000-0000-4000-8000-000000000003';
const other = '00000000-0000-4000-8000-000000000004';
const org = '00000000-0000-4000-8000-000000000005';
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const callDelete = () => q('select public.provider_delete_booking($1) as result', [booking]);
const tableDDL = table => {
  const match = messaging.match(new RegExp(`create table if not exists public\\.${table}\\([\\s\\S]*?\\n\\);`));
  assert.ok(match, `Canonical ${table} schema exists`);
  return match[0];
};
const snapshot = async () => JSON.stringify(await q(`select
  (select jsonb_agg(to_jsonb(b) order by id) from bookings b) bookings,
  (select jsonb_agg(to_jsonb(p) order by id) from payments p) payments,
  (select jsonb_agg(to_jsonb(e) order by id) from payment_events e) events,
  (select jsonb_agg(to_jsonb(c) order by id) from message_conversations_v162 c) conversations`));
async function inspect(target = booking) {
  notices.length = 0;
  await db.exec('begin read only');
  try {
    await q("select set_config('eldion.diagnostic_booking',$1,true)", [target]);
    await db.exec(diagnostic, { onNotice: notice => notices.push(notice.message) });
    return notices.filter(s => s.startsWith('booking_delete_diagnostic '))
      .map(s => JSON.parse(s.slice('booking_delete_diagnostic '.length)));
  } finally { await db.exec('rollback'); }
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create table organizations(id uuid primary key);
    create table client_accounts(id uuid primary key);
    create table bookings(id uuid primary key, performer_id uuid, organization_id uuid,
      unique(id,organization_id));
    create table booking_reviews(id uuid primary key,booking_id uuid references bookings);
    create table payments(id uuid primary key,booking_id uuid references bookings on delete restrict);
    create table payment_events(id uuid primary key,payment_id uuid references payments on delete restrict);
    create table composite_link(booking_id uuid,organization_id uuid,
      foreign key(booking_id,organization_id) references bookings(id,organization_id) on delete restrict);
    insert into auth.users values('${actor}'),('${foreignActor}');
    insert into organizations values('${org}');
    insert into bookings values('${booking}','${actor}','${org}'),('${other}','${actor}','${org}');
    insert into payments values('${booking}','${booking}');
    insert into payment_events values('${booking}','${booking}');
    select set_config('test.actor','${actor}',false);
  `);
  await db.exec(tableDDL('message_conversations_v162'));
  await db.exec(deleteRpc);
  await assert.rejects(db.exec(diagnostic), /requires_read_only/);
  console.log('PASS: diagnostic refuses a writable transaction');

  await db.exec('begin');
  assert.equal((await callDelete())[0].result, 'deleted');
  assert.equal((await q('select count(*)::int as n from payments'))[0].n, 0);
  assert.equal((await q('select count(*)::int as n from payment_events'))[0].n, 0);
  await db.exec('rollback');
  console.log('PASS: canonical v64 deletes an ordinary synthetic booking and payment children');

  await q("select set_config('test.actor',$1,false)", [foreignActor]);
  await assert.rejects(callDelete(), e => e.code === '42501' && e.message === 'booking_access_denied');
  await q("select set_config('test.actor',$1,false)", [actor]);
  await db.exec('begin');
  await q('insert into booking_reviews values($1,$1)', [booking]);
  assert.equal((await callDelete())[0].result, 'review_protected');
  await db.exec('rollback');
  console.log('PASS: ownership and existing-review protections remain enforced');

  await q(`insert into message_conversations_v162(conversation_kind,organization_id,primary_booking_id)
    values('client',$1,$2),('client',$1,$3)`, [org,booking,other]);
  const before = await snapshot();
  await assert.rejects(callDelete(), e => e.code === '23503' && e.constraint === 'message_conversations_v162_primary_booking_id_fkey');
  assert.equal(await snapshot(), before, 'Failed RPC must also roll back its payment deletes');
  console.log('PASS: canonical v162 conversation FK reproduces v64 deletion refusal; data remains intact');

  await q('insert into composite_link values($1,$2)', [booking,org]);
  const report = await inspect();
  assert.equal(report.find(r => r.kind === 'target').matchingRows, 1);
  assert.equal(report.find(r => r.table === 'public.message_conversations_v162').matchingRows, 1);
  assert.equal(report.find(r => r.table === 'public.composite_link').matchingRows, 1);
  assert.equal(report.find(r => r.table === 'public.payment_events').matchingRows, 1);
  assert.equal(await snapshot(), before, 'Read-only diagnostic must not change any target data');
  assert.ok(!JSON.stringify(report).includes(booking), 'Report omits the target UUID and row contents');
  console.log('PASS: read-only report finds exact-row direct, payment and composite relationships without data exposure');
  const missing = await inspect('00000000-0000-4000-8000-000000000099');
  assert.deepEqual(missing, [{ kind:'target',matchingRows:0 }]);
  console.log('PASS: missing target is reported without scanning unrelated relationships');
  console.log('Synthetic causes are reproduced; the user booking cause requires the production read-only report.');
} finally { await db.close(); }
