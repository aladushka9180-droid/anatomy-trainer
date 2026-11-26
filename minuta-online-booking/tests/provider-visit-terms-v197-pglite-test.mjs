import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, after } from 'node:test';
import { ids, fixtureSQL } from './provider-visit-terms-v197-fixture.mjs';

const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
after(() => db.close());
const root = fileURLToPath(new URL('../../', import.meta.url));
const migrations = `${root}supabase/migrations/`;
const file = readdirSync(migrations).filter(name => name.endsWith('_provider_visit_terms_v197.sql'));
assert.equal(file.length, 1);
const forward = readFileSync(migrations + file[0], 'utf8');
const legacy = name => readFileSync(`${root}minuta-online-booking/${name}`, 'utf8');
const uuid = async () => (await db.query('select gen_random_uuid() as id')).rows[0].id;
const scalar = async (sql, values = [], key = 'value') => (await db.query(sql, values)).rows[0]?.[key];
async function actor(id, action, role = 'authenticated') {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec('reset role'); }
}
const read = booking => actor(ids.actor, () => scalar('select public.get_minuta_visit_terms_v197($1::uuid) as value', [booking]));
const save = (request, booking, expected, rate, minutes, who = ids.actor) => actor(who, () => scalar(
  'select public.save_minuta_visit_terms_v197($1::uuid,$2::uuid,$3::jsonb,$4::numeric,$5::numeric) as value',
  [request, booking, JSON.stringify(expected), rate, minutes]));
const snapshot = async () => (await db.query(`select jsonb_build_object(
  'bookings',(select jsonb_agg(to_jsonb(b) order by b.id) from public.bookings b),
  'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.booking_session_items i),
  'revisions',(select jsonb_agg(to_jsonb(r) order by r.id) from public.booking_session_revisions r),
  'receipts',(select jsonb_agg(to_jsonb(e) order by e.request_id) from public.provider_visit_terms_edits_v197 e)) as value`)).rows[0].value;

await db.exec(fixtureSQL);
await db.exec(legacy('supabase-migration-v53.sql'));
await db.exec(legacy('supabase-migration-v156.sql'));
const oldSave = await scalar("select prosrc as value from pg_proc where oid='public.save_booking_session(uuid,jsonb)'::regprocedure");
await db.exec(forward);

let seedSequence = 0;
async function seed({ minutes = 36, rate = 20, addonPrice = 0, addonMinutes = 0, performer = ids.actor } = {}) {
  const booking = await uuid();
  const date = new Date('2099-10-28T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + seedSequence++);
  await db.query(`insert into public.bookings(id,request_id,performer_id,organization_id,service_id,booking_date,booking_time,
    duration_minutes,client_phone,original_price_rub,total_price_rub)
    values($1,gen_random_uuid(),$2,$3,$4,$8::date,'12:30',$5,'synthetic-client',$6,$7)`,
  [booking, performer, ids.organization, ids.service, minutes, rate, minutes * rate, date.toISOString().slice(0, 10)]);
  if (addonPrice || addonMinutes) {
    await db.query(`insert into public.booking_session_items(booking_id,performer_id,position,item_kind,title,duration_minutes,price_rub,extends_duration)
      values($1,$2,2,'addon','Synthetic addon',$3,$4,true)`, [booking, performer, addonMinutes, addonPrice]);
    await db.query('update public.bookings set total_price_rub=total_price_rub+$2,duration_minutes=duration_minutes+$3 where id=$1', [booking, addonPrice, addonMinutes]);
  }
  return booking;
}

test('atomic zero-rate one-minute edit has an exact one-minute primary and revision', async () => {
  const booking = await seed();
  const before = await read(booking);
  const result = await save(await uuid(), booking, before, 0, 1);
  assert.equal(result.status, 'applied');
  assert.equal(result.after.minuteRateRub, 0);
  assert.equal(result.after.durationMinutes, 1);
  assert.equal(result.after.totalAmountRub, 0);
  assert.equal(result.after.items[0].duration_minutes, 1);
  assert.equal(result.after.items[0].price_rub, 0);
  const revision = await scalar('select to_jsonb(r) as value from public.booking_session_revisions r where r.id=$1', [result.appliedRevisionId]);
  assert.equal(revision.total_duration_minutes, 1);
  assert.equal(revision.total_price_rub, 0);
  assert.deepEqual(await read(booking), result.after);
});

test('add-ons stay byte-identical and primary price is not the whole-session total', async () => {
  const booking = await seed({ addonPrice:100, addonMinutes:5 });
  const before = await read(booking);
  const addonBefore = await scalar("select to_jsonb(i) as value from public.booking_session_items i where booking_id=$1 and item_kind='addon'", [booking]);
  const result = await save(await uuid(), booking, before, 25, 36);
  assert.equal(result.after.totalAmountRub, 1000);
  assert.equal(result.after.durationMinutes, 41);
  assert.equal(result.after.items[0].price_rub, 900);
  assert.equal(result.after.items[0].id, before.items[0].id);
  assert.deepEqual(await scalar("select to_jsonb(i) as value from public.booking_session_items i where booking_id=$1 and item_kind='addon'", [booking]), addonBefore);
});

test('identical retry returns its receipt; another body or actor cannot reuse its request ID', async () => {
  const booking = await seed(); const expected = await read(booking); const request = await uuid();
  const first = await save(request, booking, expected, 23, 36);
  const afterFirst = await snapshot();
  const replay = await save(request, booking, expected, '23.0', '36.0');
  assert.equal(replay.replayed, true);
  assert.equal(replay.appliedRevisionId, first.appliedRevisionId);
  assert.equal(replay.currentMatchesReceipt, true);
  await assert.rejects(save(request, booking, expected, 25, 36), /visit_terms_request_reused/);
  await assert.rejects(save(request, booking, expected, 23, 36, ids.outsider), /visit_terms_access_denied/);
  assert.deepEqual(await snapshot(), afterFirst);
  await save(await uuid(), booking, first.after, 25, 36);
  assert.equal((await save(request, booking, expected, 23, 36)).currentMatchesReceipt, false);
});

test('stale items and late backdated revisions invalidate CAS without a partial edit', async () => {
  const booking = await seed({ addonPrice:100 }); const expected = await read(booking);
  await db.query("update public.booking_session_items set title='Changed addon' where booking_id=$1 and item_kind='addon'", [booking]);
  let before = await snapshot();
  await assert.rejects(save(await uuid(), booking, expected, 23, 36), /visit_terms_booking_changed/);
  assert.deepEqual(await snapshot(), before);
  const refreshed = await read(booking);
  await db.query(`insert into public.booking_session_revisions(booking_id,performer_id,items,total_price_rub,total_duration_minutes,created_at)
    select booking_id,performer_id,items,total_price_rub,total_duration_minutes,'2000-01-01' from public.booking_session_revisions where booking_id=$1 limit 1`, [booking]);
  before = await snapshot();
  await assert.rejects(save(await uuid(), booking, refreshed, 23, 36), /visit_terms_booking_changed/);
  assert.deepEqual(await snapshot(), before);
});

test('rate-only edits skip duration UPDATE triggers and propagate transactional failures', async () => {
  const booking = await seed();
  await db.exec(`create function public.synthetic_duration_failure() returns trigger language plpgsql as $$
    begin raise exception 'synthetic_duration_guard'; end $$;
    create trigger synthetic_duration_guard before update of duration_minutes on public.bookings for each row execute function public.synthetic_duration_failure()`);
  try {
    const result = await save(await uuid(), booking, await read(booking), 23, 36);
    assert.equal(result.after.durationMinutes, 36);
    const before = await snapshot();
    await assert.rejects(save(await uuid(), booking, result.after, 23, 37), /synthetic_duration_guard/);
    assert.deepEqual(await snapshot(), before);
  } finally { await db.exec('drop trigger synthetic_duration_guard on public.bookings; drop function public.synthetic_duration_failure()'); }
});

test('fractional/bounded inputs, creation IDs and completed visits fail without writes', async () => {
  const booking = await seed(); const expected = await read(booking);
  const creation = await scalar('select request_id as value from public.bookings where id=$1', [booking]);
  const before = await snapshot();
  for (const [rate,minutes] of [[1.5,36],[23,1.5],[-1,36],[1000001,1],[1,0],[1,481],[1000000,2]]) {
    await assert.rejects(save(await uuid(), booking, expected, rate, minutes), /invalid_visit_terms|primary_amount_out_of_range/);
  }
  await assert.rejects(save(creation, booking, expected, 23, 36), /creation_request_reused/);
  assert.deepEqual(await snapshot(), before);
  await db.query("insert into public.booking_outcomes(booking_id,visit_status) values($1,'completed')", [booking]);
  const completed = await snapshot();
  await assert.rejects(save(await uuid(), booking, await read(booking), 23, 36), /edit_not_qualified/);
  assert.deepEqual(await snapshot(), completed);
});

test('catalog price changes do not reprice a saved visit; later mode changes retain its explicit saved meaning', async () => {
  const booking = await seed(); const expected = await read(booking);
  await db.query('update public.services set price_rub=99 where id=$1', [ids.service]);
  const first = await save(await uuid(), booking, expected, 23, 36);
  assert.equal(first.after.minuteRateRub, 23);
  await db.query('update public.services set duration_minutes=60 where id=$1', [ids.service]);
  const saved = await read(booking);
  assert.equal(saved.pricingMode, 'per_minute');
  const second = await save(await uuid(), booking, saved, 25, 36);
  assert.equal(second.after.minuteRateRub, 25);
  await db.query('update public.services set price_rub=20,duration_minutes=1 where id=$1', [ids.service]);
});

test('anonymous/foreign callers and direct receipt access are denied; legacy RPC remains unchanged', async () => {
  const booking = await seed();
  await assert.rejects(actor(ids.outsider, () => scalar('select public.get_minuta_visit_terms_v197($1::uuid) as value', [booking])), /access_denied/);
  await assert.rejects(actor(null, () => scalar('select public.get_minuta_visit_terms_v197($1::uuid) as value', [booking])), /authentication_required/);
  for (const role of ['anon','authenticated','service_role']) {
    await assert.rejects(actor(ids.actor, () => db.query('select * from public.provider_visit_terms_edits_v197'), role), /permission denied/);
  }
  await assert.rejects(actor(ids.actor, () => scalar('select public.get_minuta_visit_terms_v197($1::uuid) as value', [booking]), 'anon'), /permission denied/);
  assert.equal(await scalar("select prosrc as value from pg_proc where oid='public.save_booking_session(uuid,jsonb)'::regprocedure"), oldSave);
});

test('silent primary metadata mutation aborts the complete edit', async () => {
  const booking = await seed(); const expected = await read(booking);
  await db.exec(`create function public.synthetic_primary_metadata() returns trigger language plpgsql as $$
    begin new.extends_duration:=not old.extends_duration; return new; end $$;
    create trigger synthetic_primary_metadata before update on public.booking_session_items for each row execute function public.synthetic_primary_metadata()`);
  try {
    const before = await snapshot();
    await assert.rejects(save(await uuid(), booking, expected, 23, 36), /readback_unconfirmed/);
    assert.deepEqual(await snapshot(), before);
  } finally { await db.exec('drop trigger synthetic_primary_metadata on public.booking_session_items; drop function public.synthetic_primary_metadata()'); }
});

test('service switch A to B to fixed A does not revive an old per-minute receipt', async () => {
  const booking = await seed();
  await save(await uuid(), booking, await read(booking), 23, 36);
  const alternate = await uuid();
  await db.query("insert into public.services(id,performer_id,name,duration_minutes,price_rub) values($1,$2,'Synthetic fixed B',60,828)", [alternate, ids.actor]);
  await db.query('update public.services set duration_minutes=60 where id=$1', [ids.service]);
  const legacyEdit = serviceId => actor(ids.actor, () => db.query('select * from public.save_booking_session($1::uuid,$2::jsonb)',
    [booking, JSON.stringify([{ kind:'primary',service_id:serviceId,title:'Synthetic service',duration_minutes:36,price_rub:828,extends_duration:true }])]));
  await legacyEdit(alternate);
  await legacyEdit(ids.service);
  try {
    const expected = await read(booking);
    assert.equal(expected.pricingMode, 'unqualified');
    const before = await snapshot();
    await assert.rejects(save(await uuid(), booking, expected, 25, 36), /edit_not_qualified/);
    assert.deepEqual(await snapshot(), before);
  } finally { await db.query('update public.services set duration_minutes=1 where id=$1', [ids.service]); }
});
