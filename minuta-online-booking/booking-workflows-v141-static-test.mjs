import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const update = readFileSync(new URL('./site-update.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./supabase-migration-v141.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('./supabase-migration-v141-rollback.sql', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/minuta-v141-safe-release.yml', import.meta.url), 'utf8');

for (const required of [
  'Визит уже состоялся',
  'Когда состоялся визит',
  'Для будущей записи выберите день со свободным рабочим окном.',
  'Новая запись · ${bookingDateLabel',
  'id="newBookingContactPicker"',
  "navigator.contacts.select(['name','tel'], { multiple:false })",
  'bookingNearbyTimeSlots(newBookingSlots, newBookingTime)',
  'bookingRemainingTimeSlots(slots, nearbySlots, selectedTime)',
  'bookingRemainingTimeMarkup(newBookingSlots, nearbySlots, newBookingTime)',
  'Шаг 5 мин · ещё ${remaining.length}',
  "details.addEventListener('toggle'",
  'activateBookingRemainingTimeScroll(holder)',
  'id="newBookingClientEntry"',
  "newBookingTime = preferredTime && newBookingSlots.includes(preferredTime) ? preferredTime : '';",
  'submit.disabled = !newBookingTime;',
  "service:block ? '' : service,",
  "db.rpc('get_provider_block_slots_v141'",
  "db.rpc('create_provider_block_v141'",
  "db.rpc('update_provider_block_v141'",
  '(!block && !service)',
  "block ? await saveBookingColor",
  ": $('#newBookingName');",
  'Перенести запись',
]) assert.ok(provider.includes(required), `missing provider contract: ${required}`);
assert.ok((provider.match(/id,organization_id,location_id,booking_code/g) || []).length >= 3,
  'Block creation and editing must retain the branch identity loaded with each booking');

for (const forbidden of [
  'Создать вне графика',
  'Выбрать время вне графика',
  '<strong>1. Выберите час</strong>',
  '<strong>2. Выберите время</strong>',
  'Перенести или изменить',
  'Клиент уже был',
  'new-booking-draft-status" id="newBookingDraftStatus',
  'id="newBookingClientSearch"',
  'data-add-new-booking-client',
  'id="newBookingPresetTime"',
  'data-change-new-booking-time',
]) assert.ok(!provider.includes(forbidden), `stale workflow remains: ${forbidden}`);

for (const required of [
  '.booking-sheet-submit-bar',
  'position:sticky',
  '.new-booking-phone-control',
  '.booking-time-slots-nearby',
  '.booking-more-times',
  '.booking-move-summary',
  '.booking-sheet-open #siteUpdateNotice',
]) assert.ok(styles.includes(required), `missing responsive style: ${required}`);

for (const required of [
  'ensure_minuta_block_service_v141',
  'get_provider_block_slots_v141',
  'p_ignore_booking',
  'create_provider_block_v141',
  'update_provider_block_v141',
  "client_phone<>'0000000000'",
  "raise exception using errcode='40001',message='block_changed'",
  "delete from public.notification_outbox where booking_id=p_booking",
]) assert.ok(migration.includes(required), `missing migration guard: ${required}`);

for (const signature of [
  'update_provider_block_v141',
  'create_provider_block_v141',
  'get_provider_block_slots_v141',
  'minuta_block_slot_valid_v141',
  'ensure_minuta_block_service_v141',
]) assert.ok(rollback.includes(`drop function if exists public.${signature}`), `missing rollback: ${signature}`);

assert.ok(update.includes("zIndex:'2147483000'"), 'update notice behavior unexpectedly removed');
for (const required of [
  'options: [test-v141, validate-production-v141, apply-production-v141, observe-production-v141]',
  'BACKUP_VERIFIED',
  'minuta-supabase-backup.yml',
  'minuta-supabase-restore-drill.yml',
  'booking-workflows-v141-integration.sql',
]) assert.ok(workflow.includes(required), `missing safe-release gate: ${required}`);
console.log('Booking workflows v141 static checks passed.');


