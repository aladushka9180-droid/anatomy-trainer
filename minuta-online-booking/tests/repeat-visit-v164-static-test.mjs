import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../supabase-migration-v164.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase-migration-v164-rollback.sql', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function body(source, start, end) {
  const from = source.indexOf(start);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.ok(from >= 0 && to > from, `${start} boundary`);
  return source.slice(from, to);
}

test('preview is authenticated, server-derived, and signs the complete repeat payload', () => {
  const helper = body(migration, 'create or replace function public.minuta_provider_repeat_visit_payload_v164', 'create or replace function public.get_provider_repeat_visit_v164');
  const preview = body(migration, 'create or replace function public.get_provider_repeat_visit_v164', 'create or replace function public.provider_repeat_appointment_v164');
  assert.match(preview, /auth\.uid\(\) is null/);
  assert.match(helper, /booking\.performer_id=p_actor/);
  assert.match(helper, /service\.performer_id=p_actor and service\.active/);
  assert.match(helper, /booking_session_items/);
  assert.match(helper, /inventory_movements[\s\S]*movement_type='service_use'/);
  assert.match(helper, /inventory_service_usage/);
  assert.match(helper, /extensions\.digest\(convert_to\(v_payload::text,'UTF8'\),'sha256'\)/);
});

test('repeat creation checks the signed source before one transactional copy', () => {
  const repeat = body(migration, 'create or replace function public.provider_repeat_appointment_v164', '-- A repeated visit consumes');
  assert.match(repeat, /pg_advisory_xact_lock/);
  assert.ok(repeat.indexOf("v_preview->>'source_signature' is distinct from") < repeat.indexOf('public.book_appointment('));
  assert.match(repeat, /message='repeat_source_changed'/);
  assert.match(repeat, /delete from public\.booking_session_items/);
  assert.match(repeat, /insert into public\.booking_session_items/);
  assert.match(repeat, /provider_note=btrim\(coalesce\(p_comment,''\)\)/);
  assert.match(repeat, /total_price_rub=p_total_price_rub/);
  assert.match(repeat, /'repeat_materials',v_preview->'materials'/);
  assert.match(repeat, /booking_source='provider_manual'/, 'provider-created repeats must keep provider attribution');
  assert.doesNotMatch(repeat, /booking_source='provider_repeat'/, 'v92 attribution remains immutable');
  assert.match(repeat, /other\.status<>'cancelled'/);
});

test('inventory completion honors the copied material snapshot and keeps ordinary fallback', () => {
  const consume = body(migration, 'create or replace function public.consume_minuta_inventory_for_booking', "notify pgrst,'reload schema'");
  assert.match(consume, /booking_policy_snapshot->'repeat_materials'/);
  assert.match(consume, /jsonb_array_elements\(v_repeat_materials\)/);
  assert.match(consume, /inventory_service_usage/);
  assert.match(consume, /insufficient_inventory_stock_for_completed_visit/);
  assert.match(consume, /repeat_material_unavailable/);
});

test('rollback removes only v164 APIs and restores the prior inventory behavior', () => {
  assert.match(rollback, /drop function if exists public\.provider_repeat_appointment_v164/);
  assert.match(rollback, /drop function if exists public\.get_provider_repeat_visit_v164/);
  assert.match(rollback, /create or replace function public\.consume_minuta_inventory_for_booking/);
  assert.doesNotMatch(rollback, /drop table|truncate|delete from/);
  assert.doesNotMatch(rollback, /repeat_materials/);
});

test('provider opens only a fresh online preview and submits its immutable signature', () => {
  const open = body(provider, 'async function openRepeatBookingFromSheet', 'function bookingIdFromRpcResult');
  const create = body(provider, 'async function createNewBooking', 'function closeBookingSheet');
  assert.match(open, /if \(!navigator\.onLine\)/);
  assert.match(open, /db\.rpc\('get_provider_repeat_visit_v164'/);
  assert.match(open, /normalizeRepeatVisitPreview\(data\)/);
  assert.match(create, /surface:repeatVisit \? 'repeat-booking' : 'new-booking'/);
  assert.match(create, /repeatSourceSignature:repeatVisit\?\.source_signature/);
  assert.match(create, /repeatTotalPrice/);
  assert.match(create, /repeatComment/);
  assert.match(create, /!repeatVisit && Number\(serviceModel\?\.duration_minutes\)/);
});

test('repeat preview exposes services, materials, price, comment, and mobile-safe layout', () => {
  const markup = body(provider, 'function repeatVisitPreviewMarkup', 'function openNewBookingSheet');
  assert.match(markup, /repeat\.items\.map/);
  assert.match(markup, /repeat\.materials/);
  assert.match(markup, /id="repeatVisitTotalPrice"/);
  assert.match(markup, /id="repeatVisitComment"/);
  assert.match(markup, /Проверим ещё раз при создании/);
  assert.match(styles, /\.repeat-visit-preview/);
  assert.match(styles, /@media \(max-width:760px\)[\s\S]*?\.repeat-visit-fields \{ grid-template-columns:1fr; \}/);
});
