import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('./supabase-migration-v101.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('./supabase-migration-v101-rollback.sql', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const providerHtml = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const booking = readFileSync(new URL('./booking.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(migration, /booking_buffer_enabled boolean not null default false/i, 'buffer must be opt-in');
assert.match(migration, /booking_buffer_minutes integer not null default 60/i, 'buffer must default to one hour');
assert.match(migration, /booking_buffer_minutes between 1 and 1440/i, 'server must enforce 1 minute through one day');
assert.match(migration, /booking\.booking_date = p_date[\s\S]*booking\.status <> 'cancelled'/i, 'availability must only inspect active bookings on the same day');
assert.match(migration, /client_phone[\s\S]*0000000000[\s\S]*<>/i, 'manual schedule blocks must not gain another buffer');
assert.match(migration, /get_available_slots_v101[\s\S]*minuta_slot_respects_booking_buffer/i, 'legacy availability must be buffer-aware');
assert.match(migration, /get_public_minuta_available_slots_v101[\s\S]*get_public_minuta_available_slots_group_safe[\s\S]*minuta_slot_respects_booking_buffer/i, 'team availability must preserve shift, resource and group checks before the buffer');
assert.match(migration, /get_reschedule_slots_v101[\s\S]*get_minuta_group_safe_reschedule_slots[\s\S]*booking\.id/i, 'self-service rescheduling must ignore the current booking but respect other buffers');
assert.match(migration, /pg_advisory_xact_lock[\s\S]*booking_buffer_conflict/i, 'writes must serialize before rejecting buffer conflicts');
assert.match(migration, /before insert or update of performer_id, booking_date, booking_time, duration_minutes, status, client_phone/i, 'all placement-changing writes must be protected');
assert.match(migration, /tg_op = 'UPDATE'[\s\S]*old\.status = 'cancelled'[\s\S]*return new;/i, 'ordinary outcome and phone edits must not revalidate unchanged legacy placement');
assert.match(migration, /grant execute on function public\.get_available_slots_v101[\s\S]*to anon, authenticated/i, 'public booking needs buffered legacy slots');
assert.match(migration, /grant execute on function public\.get_public_minuta_available_slots_v101[\s\S]*to anon, authenticated/i, 'public team booking needs buffered slots');
assert.match(migration, /grant execute on function public\.get_reschedule_slots_v101[\s\S]*to anon, authenticated/i, 'client rescheduling needs buffered slots');

for (const name of ['bookingBufferEnabled', 'bookingBufferMinutes', 'bookingBufferDuration']) {
  assert.match(providerHtml, new RegExp(`id="${name}"`), `${name} control is required`);
}
for (const value of ['15', '30', '60', '120', '1440']) {
  assert.match(providerHtml, new RegExp(`data-booking-buffer-minutes="${value}"`), `preset ${value} is required`);
}
assert.match(providerHtml, /от 1 минуты до 24 часов/i, 'the exact supported range must be explained');
assert.match(provider, /getProviderAvailableSlots[\s\S]*get_available_slots_v101/, 'provider slot pickers must prefer buffered availability');
assert.equal((provider.match(/getProviderAvailableSlots\s*\(/g) || []).length, 6, 'all five provider slot consumers plus the helper must use one path');
assert.match(provider, /function automaticBookingBreaks[\s\S]*automatic_break:true/i, 'timeline must derive visible automatic breaks');
assert.match(provider, /Math\.max\(workStart, start - buffer\)[\s\S]*Math\.min\(workEnd, end \+ buffer\)/i, 'visual breaks must be clipped at workday edges');
assert.match(provider, /booking_buffer_minutes[\s\S]*1440/i, 'provider validation must support a full day');
assert.match(app, /get_public_minuta_available_slots_v101[\s\S]*get_public_minuta_available_slots_group_safe/i, 'client team flow must prefer v101 and keep a compatibility fallback');
assert.match(app, /get_available_slots_v101[\s\S]*get_available_slots/, 'client personal flow must prefer v101 and keep a compatibility fallback');
assert.match(booking, /get_reschedule_slots_v101[\s\S]*get_minuta_group_safe_reschedule_slots/, 'booking management must prefer buffer-aware rescheduling');
assert.match(styles, /timeline-booking\.automatic-break/i, 'automatic breaks need a distinct timeline treatment');
assert.match(rollback, /drop trigger if exists zz_bookings_buffer_v101/i, 'rollback must remove the enforcement trigger');
assert.match(rollback, /drop column if exists booking_buffer_minutes[\s\S]*drop column if exists booking_buffer_enabled/i, 'rollback must remove both policy columns');

console.log('Automatic booking buffer v101 static checks passed.');
