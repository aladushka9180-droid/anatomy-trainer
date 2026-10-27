import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { ids, fixtureSQL } from './provider-visit-terms-v197-fixture.mjs';

const { PGlite } = await import(process.env.MINUTA_PGLITE_MODULE
  ? pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href : '@electric-sql/pglite');
const root = fileURLToPath(new URL('../../', import.meta.url));
const migrations = `${root}supabase/migrations/`;
const files = readdirSync(migrations).filter(name => name.endsWith('_provider_visit_terms_v197.sql'));
assert.equal(files.length, 1);
const forward = readFileSync(migrations + files[0], 'utf8');
const rollback = readFileSync(`${root}minuta-online-booking/recovery/rollback-provider-visit-terms-v197.sql`, 'utf8');
const scalar = async (db, sql, values = []) => (await db.query(sql, values)).rows[0]?.value;
const data = db => scalar(db, `select jsonb_build_object(
  'bookings',(select jsonb_agg(to_jsonb(b) order by b.id) from public.bookings b),
  'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.booking_session_items i),
  'revisions',(select jsonb_agg(to_jsonb(r) order by r.id) from public.booking_session_revisions r)) as value`);
const revisionCheck = db => scalar(db, `select pg_get_constraintdef(oid) as value from pg_constraint
  where conrelid='public.booking_session_revisions'::regclass and conname='booking_session_revisions_total_duration_minutes_check'`);
async function fixture(action) {
  const db = new PGlite();
  try {
    await db.exec(fixtureSQL);
    for (const name of ['supabase-migration-v53.sql','supabase-migration-v156.sql']) {
      await db.exec(readFileSync(`${root}minuta-online-booking/${name}`, 'utf8'));
    }
    const booking = await scalar(db, `insert into public.bookings(request_id,performer_id,organization_id,service_id,
      booking_date,booking_time,duration_minutes,client_phone,original_price_rub,total_price_rub)
      values(gen_random_uuid(),$1,$2,$3,'2099-10-28','12:30',36,'synthetic-client',20,720) returning id as value`,
    [ids.actor, ids.organization, ids.service]);
    await db.exec(forward);
    await action(db, booking);
  } finally { await db.close(); }
}
async function held(db, message) {
  await assert.rejects(db.exec(rollback), new RegExp(message));
  // A deliberately rejected multi-statement migration leaves its transaction aborted.
  await db.exec('rollback');
  assert.equal(await scalar(db, "select to_regclass('public.provider_visit_terms_edits_v197') is not null as value"), true);
  assert.match(await revisionCheck(db), /total_duration_minutes >= 1/);
}

test('unused contract rolls back without changing existing bookings/history and can be reapplied', () => fixture(async db => {
  const before = await data(db);
  const oldSave = await scalar(db, "select prosrc as value from pg_proc where oid='public.save_booking_session(uuid,jsonb)'::regprocedure");
  await db.exec(rollback);
  assert.deepEqual(await data(db), before);
  assert.equal(await scalar(db, "select to_regclass('public.provider_visit_terms_edits_v197') as value"), null);
  assert.equal(await scalar(db, "select to_regprocedure('public.save_minuta_visit_terms_v197(uuid,uuid,jsonb,numeric,numeric)') as value"), null);
  assert.match(await revisionCheck(db), /total_duration_minutes >= 5/);
  assert.equal(await scalar(db, "select prosrc as value from pg_proc where oid='public.save_booking_session(uuid,jsonb)'::regprocedure"), oldSave);
  await db.exec(forward);
  assert.match(await revisionCheck(db), /total_duration_minutes >= 1/);
  assert.deepEqual(await data(db), before);
}));

test('a successful edit makes rollback retain its receipt and every booking/history row', () => fixture(async (db, booking) => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.actor]);
  const expected = await scalar(db, 'select public.get_minuta_visit_terms_v197($1::uuid) as value', [booking]);
  await db.query('select public.save_minuta_visit_terms_v197(gen_random_uuid(),$1::uuid,$2::jsonb,23,36)', [booking, JSON.stringify(expected)]);
  const before = await data(db);
  const receipts = await scalar(db, 'select jsonb_agg(to_jsonb(e)) as value from public.provider_visit_terms_edits_v197 e');
  await held(db, 'v197_rollback_data_retention_hold');
  assert.deepEqual(await data(db), before);
  assert.deepEqual(await scalar(db, 'select jsonb_agg(to_jsonb(e)) as value from public.provider_visit_terms_edits_v197 e'), receipts);
}));

test('one-minute history is retained even without a v197 receipt', () => fixture(async (db, booking) => {
  await db.query('update public.booking_session_revisions set total_duration_minutes=1 where booking_id=$1', [booking]);
  const before = await data(db);
  await held(db, 'v197_rollback_data_retention_hold');
  assert.deepEqual(await data(db), before);
}));

test('changed function source cannot authorize its own rollback by updating the source stamp', () => fixture(async db => {
  const signature = 'public.get_minuta_visit_terms_v197(uuid)';
  const definition = await scalar(db, 'select pg_get_functiondef($1::regprocedure) as value', [signature]);
  await db.exec(definition.replace('authentication_required', 'synthetic_source_drift'));
  const hash = await scalar(db, "select encode(sha256(convert_to(replace(prosrc,E'\\r',''),'UTF8')),'hex') as value from pg_proc where oid=$1::regprocedure", [signature]);
  await db.exec(`comment on function ${signature} is 'minuta_visit_terms_v197:sha256=${hash}'`);
  await held(db, 'v197_rollback_function_drift');
}));

test('new grants or receipt columns stop rollback without dropping the changed objects', () => fixture(async db => {
  await db.exec('grant execute on function public.get_minuta_visit_terms_v197(uuid) to anon');
  await held(db, 'v197_rollback_function_acl_drift');
  await db.exec('revoke execute on function public.get_minuta_visit_terms_v197(uuid) from anon');
  await db.exec('alter table public.provider_visit_terms_edits_v197 add column synthetic_new_column text');
  await held(db, 'v197_rollback_receipt_table_drift');
  assert.equal(await scalar(db, "select count(*)::integer as value from pg_attribute where attrelid='public.provider_visit_terms_edits_v197'::regclass and attname='synthetic_new_column'"), 1);
}));

test('later defaults, replaced constraints and added indexes survive a rejected rollback', () => fixture(async db => {
  await db.exec('alter table public.provider_visit_terms_edits_v197 alter column request_id set default gen_random_uuid()');
  await held(db, 'v197_rollback_receipt_table_drift');
  assert.equal(await scalar(db, "select pg_get_expr(adbin,adrelid) as value from pg_attrdef where adrelid='public.provider_visit_terms_edits_v197'::regclass and adnum=1"), 'gen_random_uuid()');
  await db.exec('alter table public.provider_visit_terms_edits_v197 alter column request_id drop default');
  await db.exec(`alter table public.provider_visit_terms_edits_v197 drop constraint provider_visit_terms_edits_v197_request_fingerprint_check;
    alter table public.provider_visit_terms_edits_v197 add constraint provider_visit_terms_edits_v197_request_fingerprint_check check(length(request_fingerprint)=32)`);
  await held(db, 'v197_rollback_receipt_table_drift');
  assert.match(await scalar(db, "select pg_get_constraintdef(oid) as value from pg_constraint where conrelid='public.provider_visit_terms_edits_v197'::regclass and conname='provider_visit_terms_edits_v197_request_fingerprint_check'"), /= 32/);
  await db.exec(`alter table public.provider_visit_terms_edits_v197 drop constraint provider_visit_terms_edits_v197_request_fingerprint_check;
    alter table public.provider_visit_terms_edits_v197 add constraint provider_visit_terms_edits_v197_request_fingerprint_check check(length(request_fingerprint)=64);
    create index synthetic_later_index on public.provider_visit_terms_edits_v197(booking_id)`);
  await held(db, 'v197_rollback_receipt_table_drift');
  assert.equal(await scalar(db, "select to_regclass('public.synthetic_later_index') is not null as value"), true);
}));
