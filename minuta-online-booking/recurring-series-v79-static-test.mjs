import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const [migration, rollback, provider, styles] = await Promise.all([
  readFile(new URL('supabase-migration-v79.sql', root), 'utf8'),
  readFile(new URL('recovery/rollback-recurring-series-v79.sql', root), 'utf8'),
  readFile(new URL('provider.js', root), 'utf8'),
  readFile(new URL('styles.css', root), 'utf8')
]);

assert.match(migration, /create table if not exists public\.booking_series/i);
assert.match(migration, /add column if not exists series_id uuid/i);
assert.match(migration, /create or replace function public\.create_minuta_recurring_bookings/i);
assert.match(migration, /create or replace function public\.manage_minuta_booking_series/i);
assert.match(migration, /p_scope not in \('one', 'following', 'all'\)/i);
assert.match(migration, /cancel_minuta_booking_core\(v_target\.id, 'provider', 'always_full'\)/i);
assert.match(migration, /case when v_delta >= interval '0 seconds'/i);
assert.match(migration, /series_slot_unavailable/i);
assert.match(migration, /revoke all on function public\.manage_minuta_booking_series[\s\S]+from public, anon, authenticated, service_role/i);
assert.match(rollback, /v79_rollback_blocked_booking_series_exist/i);

assert.match(provider, /id="newBookingOccurrences"/);
assert.match(provider, /Только эту запись/);
assert.match(provider, /Эту и последующие/);
assert.match(provider, /Все будущие записи/);
assert.match(provider, /db\.rpc\('create_minuta_recurring_bookings'/);
assert.match(provider, /db\.rpc\('manage_minuta_booking_series'/);
assert.match(provider, /booking_series\(occurrence_count\)/);
assert.match(provider, /affected\.forEach\(entry => notifyTelegramClient/);
assert.match(provider, /Сначала примените миграцию v79/);
assert.match(styles, /\.booking-series-scope/);
assert.match(styles, /\.new-booking-recurrence/);

console.log('recurring-series-v79 static checks passed');
