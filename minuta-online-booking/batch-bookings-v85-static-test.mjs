import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./supabase-migration-v85.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('./supabase-migration-v85-rollback.sql', import.meta.url), 'utf8');
const controller = readFileSync(new URL('./batch-bookings.js', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');

for (const table of ['organization_batch_booking_settings','booking_batches','booking_batch_items','booking_batch_audit_log']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'), `${table} must be created`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} must have RLS`);
  assert.match(rollback, new RegExp(`drop table if exists public\\.${table}`, 'i'), `${table} must be rollback-safe`);
}

assert.match(migration, /enabled boolean not null default false/i, 'batch booking must stay disabled by default');
assert.match(migration, /max_items integer not null default 12 check \(max_items between 2 and 24\)/i, 'server-side batch limit is required');
assert.match(migration, /unique \(organization_id,request_id\)/i, 'top-level idempotency key must be tenant-scoped');
assert.match(migration, /unique \(batch_id,request_id\)/i, 'item idempotency keys must be unique inside a batch');
assert.match(migration, /batch_booking_idempotency_mismatch/i, 'a replay with a changed payload must fail');
assert.match(migration, /batch_booking_items_overlap/i, 'overlaps inside one batch must fail');
assert.match(migration, /batch_slot_unavailable/i, 'slot conflicts must have an atomic batch error');
assert.match(migration, /public\.book_appointment\(v_item_request,p_service,v_date,v_time/i, 'protected booking core must create every visit');
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_performer::text\|\|':'\|\|v_lock_date::text,8001\)\)/i, 'group-event day lock must be shared with v80');
assert.match(migration, /join public\.group_booking_events event on event\.organization_id=p_organization[\s\S]*event\.location_id=p_location[\s\S]*event\.performer_id=v_performer/i, 'group overlap must use the effective tenant scope before legacy triggers run');
assert.match(migration, /update public\.bookings set provider_note=concat_ws/i, 'batch and per-visit comments must reach the booking card');
assert.doesNotMatch(migration, /update public\.bookings[\s\S]{0,160}series_id\s*=/i, 'v85 must not attach or modify recurring series');

for (const signature of [
  'set_minuta_batch_bookings_enabled(uuid,boolean,integer)',
  'get_minuta_batch_booking_workspace(uuid)',
  'create_minuta_batch_bookings(uuid,uuid,uuid,text,text,jsonb,uuid,text)'
]) {
  assert.match(migration, new RegExp(signature.replace(/[()]/g, value => `\\${value}`), 'i'), `${signature} must be granted explicitly`);
  assert.match(rollback, new RegExp(signature.replace(/[()]/g, value => `\\${value}`), 'i'), `${signature} must be removed by rollback`);
}

assert.match(controller, /missingRpc\(error,'get_minuta_batch_booking_workspace'\) \? 'unsupported'/, 'missing migration must produce a graceful fallback');
assert.match(controller, /data-batch-row/g, 'controller must manage dynamic date/time rows');
assert.match(controller, /p_request_id:requestId/, 'client must retain a top-level request id for retry');
assert.match(controller, /p_items:items/, 'all rows must be sent in one RPC');
assert.match(controller, /Ничего не создано/, 'atomic failure must be explained to the provider');
assert.match(provider, /batchBookingsController\.setOrganization\(organization\)/, 'controller must follow the active tenant');
assert.match(provider, /batchBookingsController\?\.setClient\(client\)/, 'composer must follow the selected client');
assert.match(html, /id="batchBookingRows"/, 'provider UI must contain the row composer');
assert.match(html, /id="batchBookingSettingsCard" hidden/, 'settings UI must start hidden until RPC support is confirmed');
assert.match(html, /id="batchBookingSettingsNav"[^>]+hidden/, 'settings navigation must stay hidden until RPC support is confirmed');
assert.match(controller, /settingsNav\.hidden = !supported/, 'settings navigation must follow RPC availability');
assert.match(html, /src="batch-bookings\.js\?v=\d+" defer/, 'provider must load the dedicated controller');
assert.match(worker, /\.\/batch-bookings\.js\?v=\d+/, 'offline cache must include the controller');

console.log('v85 batch booking static checks passed');
