import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase-migration-v167.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase-migration-v167-rollback.sql', import.meta.url), 'utf8');

function body(source, start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.ok(from >= 0 && to > from, `${start} boundary`);
  return source.slice(from, to);
}

test('v167 is one public all-or-none route over ordinary authoritative bookings', () => {
  const create = body(migration, 'create or replace function public.book_minuta_multi_service_route_v167', "revoke all on function public.book_minuta_multi_service_route_v167");
  assert.match(create, /security definer[\s\S]*set search_path to ''/u);
  assert.match(create, /jsonb_array_length\(p_items\)/u);
  assert.match(create, /count\(\*\) from jsonb_object_keys\(v_item\)/u);
  assert.match(create, /v_count not between 2 and 6/u);
  assert.match(create, /count\(distinct item->>'service_id'\)/u);
  assert.match(create, /group by service\.performer_id[\s\S]*having count\(\*\)=v_count/u);
  assert.match(create, /get_public_minuta_catalog_v5/u);
  assert.match(create, /public\.book_minuta_appointment_v2\(/u);
  assert.match(create, /public\.bookings booking/u);
  assert.doesNotMatch(create, /\b(?:commit|rollback)\s*;/u);
  assert.doesNotMatch(create, /create_minuta_batch_bookings/u);
});

test('v167 replay is route-scoped, fingerprinted and returns only a complete route', () => {
  const create = body(migration, 'create or replace function public.book_minuta_multi_service_route_v167', "revoke all on function public.book_minuta_multi_service_route_v167");
  assert.match(create, /pg_advisory_xact_lock/u);
  assert.match(create, /request_fingerprint is distinct from v_fingerprint/u);
  assert.match(create, /items_payload is distinct from v_normalized/u);
  assert.match(create, /message='multi_service_request_conflict'/u);
  assert.match(create, /message='multi_service_replay_incomplete'/u);
  assert.match(create, /message='multi_service_commit_incomplete'/u);
  assert.ok(create.indexOf('multi_service_replay_incomplete') < create.indexOf('insert into public.public_multi_service_routes_v167'));
});

test('v167 exposes no route tables and grants only the exact RPC roles', () => {
  assert.match(migration, /enable row level security/u);
  assert.match(migration, /revoke all on table public\.public_multi_service_routes_v167,public\.public_multi_service_route_items_v167[\s\S]*from public,anon,authenticated,service_role/u);
  assert.match(migration, /grant execute on function public\.book_minuta_multi_service_route_v167\(uuid,text,uuid,text,text,jsonb\)[\s\S]*to anon,authenticated/u);
  assert.doesNotMatch(migration, /grant (?:select|insert|update|delete).*public_multi_service/u);
});

test('operational rollback disables the RPC and preserves bookings and journal rows', () => {
  assert.match(rollback, /drop function if exists public\.book_minuta_multi_service_route_v167/u);
  assert.doesNotMatch(rollback, /drop table|truncate|delete from/u);
  assert.match(rollback, /disable-only/u);
});
