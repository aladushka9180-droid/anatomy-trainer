import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// PostgreSQL WASM in memory: no connection string, external Auth or network.
if (!process.env.MINUTA_PGLITE_MODULE) throw new Error('Set MINUTA_PGLITE_MODULE to the installed PGlite module');
const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE);
const db = new PGlite();
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const ownerService = '33333333-3333-4333-8333-333333333333';
const otherService = '44444444-4444-4444-8444-444444444444';
const apply = await readFile(new URL('../supabase-public-performer-reviews.sql', import.meta.url), 'utf8');
const rollback = await readFile(new URL('../supabase-public-performer-reviews-rollback.sql', import.meta.url), 'utf8');
try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.services(id uuid primary key, performer_id uuid, name text);
    create table public.bookings(id uuid primary key, performer_id uuid, status text, private_phone text);
    create table public.booking_outcomes(booking_id uuid primary key, visit_status text);
    create table public.booking_reviews(id uuid primary key, booking_id uuid, performer_id uuid, service_id uuid,
      rating smallint, review_text text, created_at timestamptz, published boolean, private_client_name text);
    alter table public.booking_reviews enable row level security;
    revoke all on public.booking_reviews from public, anon, authenticated;
    create function public.get_public_booking_reviews() returns text language sql as $$select 'legacy unchanged'::text$$;
    insert into public.services values ('${ownerService}', '${owner}', 'Fixture service'), ('${otherService}', '${other}', 'Foreign service');
    insert into public.bookings
      select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
        case when i in (17,21) then '${other}'::uuid else '${owner}'::uuid end,
        case when i=20 then 'cancelled' else 'confirmed' end, 'PRIVATE PHONE'
      from generate_series(1,22) i;
    insert into public.booking_outcomes select id, case when right(id::text,2)='19' then 'no_show' else 'completed' end from public.bookings;
    insert into public.booking_reviews
      select id, id, case when right(id::text,2)='17' then '${other}'::uuid else '${owner}'::uuid end,
        case when right(id::text,2) in ('17','22') then '${otherService}'::uuid else '${ownerService}'::uuid end,
        case when (right(id::text,2)::int % 2)=0 then 3 else 5 end,
        'Fixture review ' || right(id::text,2), timestamptz '2026-10-02T00:00:00Z' + right(id::text,2)::int * interval '1 minute',
        right(id::text,2)<>'18', 'PRIVATE CLIENT NAME'
      from public.bookings;
  `);
  await db.exec(apply);
  await db.exec('set role anon');
  const rows = (await db.query('select * from public.get_public_performer_booking_reviews($1::uuid)', [owner])).rows;
  assert.equal(rows.length, 12);
  assert.ok(rows.every(item => item.performer_id === owner && item.reviewer_name === 'Клиент'));
  assert.ok(rows.every(item => Number(item.total_reviews) === 16 && Number(item.average_rating) === 4));
  assert.equal(rows[0].review_text, 'Fixture review 16');
  const encoded = JSON.stringify(rows);
  assert.ok(!encoded.includes('PRIVATE') && !encoded.includes('booking_id') && !encoded.includes('client_account_id'));
  assert.equal((await db.query('select * from public.get_public_performer_booking_reviews($1::uuid)', [other])).rows.length, 1);
  assert.equal((await db.query('select * from public.get_public_performer_booking_reviews(null)')).rows.length, 0);
  assert.equal((await db.query('select * from public.get_public_performer_booking_reviews($1::uuid)', ['99999999-9999-4999-8999-999999999999'])).rows.length, 0);
  await assert.rejects(() => db.query('select * from public.booking_reviews'), /permission denied/);
  assert.equal((await db.query('select public.get_public_booking_reviews() as legacy')).rows[0].legacy, 'legacy unchanged');
  await db.exec('reset role');
  const contract = (await db.query(`select p.prosecdef, p.provolatile, p.proconfig, has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
    from pg_proc p where p.oid='public.get_public_performer_booking_reviews(uuid)'::regprocedure`)).rows[0];
  assert.equal(contract.prosecdef, true);
  assert.equal(contract.provolatile, 's');
  assert.equal(contract.anon_execute, true);
  assert.ok(contract.proconfig.includes('search_path=""'));
  await db.exec(rollback);
  assert.equal((await db.query("select to_regprocedure('public.get_public_performer_booking_reviews(uuid)') as rpc")).rows[0].rpc, null);
  assert.equal((await db.query('select public.get_public_booking_reviews() as legacy')).rows[0].legacy, 'legacy unchanged');
  await db.exec(apply);
  await db.exec('set role authenticated');
  assert.equal((await db.query('select * from public.get_public_performer_booking_reviews($1::uuid)', [owner])).rows.length, 12);
  console.log('PASS: PostgreSQL apply/anon/actor isolation/hidden/cancelled/no-show/mismatch/limits/privacy/grants/legacy/rollback/reapply/authenticated');
} finally {
  await db.close();
}
