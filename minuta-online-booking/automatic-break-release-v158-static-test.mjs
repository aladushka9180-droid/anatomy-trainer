#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v158.sql');
const rollback = read('./supabase-migration-v158-rollback.sql');

for (const table of ['booking_buffer_release_requests_v158','booking_buffer_release_sources_v158']) {
  assert.match(migration, new RegExp(`create table public\\.${table}`, 'i'));
  assert.match(migration, new RegExp(`alter table public\\.${table} force row level security`, 'i'));
  assert.match(migration, new RegExp(`revoke all on table[\\s\\S]*${table}[\\s\\S]*from public,anon,authenticated,service_role`, 'i'));
}
for (const rpc of ['get_minuta_provider_automatic_breaks_v158','release_minuta_provider_automatic_break_v158']) {
  assert.match(migration, new RegExp(`create function public\\.${rpc}`, 'i'));
  assert.match(migration, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]*to authenticated`, 'i'));
  assert.doesNotMatch(migration, new RegExp(`grant execute on function public\\.${rpc}[\\s\\S]{0,160}to anon`, 'i'));
}
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(p_request_id::text,15801\)\)/i);
assert.match(migration, /booking_buffer_release_request_reused/i);
assert.match(migration, /booking_buffer_interval_changed/i);
assert.match(migration, /source_snapshot=public\.minuta_booking_buffer_source_snapshot_v158/i);
assert.match(migration, /create or replace function public\.minuta_slot_respects_booking_buffer[\s\S]*minuta_booking_buffer_allows_interval_v158/i);
assert.match(migration, /create or replace function public\.enforce_minuta_booking_buffer_v101[\s\S]*minuta_booking_buffer_allows_interval_v158/i);
assert.match(migration, /source_side text not null check\(source_side in\('before','after'\)\)/i);
assert.match(migration, /if \(select count\(\*\)[\s\S]*<>v_source_count then[\s\S]*booking_buffer_interval_changed/i);
assert.match(rollback, /v158_rollback_blocked_durable_history_exists/i);
assert.match(rollback, /create or replace function public\.minuta_slot_respects_booking_buffer/i);
assert.match(rollback, /create or replace function public\.enforce_minuta_booking_buffer_v101/i);

console.log('automatic break release v158 static test passed');
