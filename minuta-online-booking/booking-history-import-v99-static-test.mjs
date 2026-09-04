import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const migration = read('supabase-migration-v99.sql');
const rollback = read('recovery/rollback-booking-history-import-v99.sql');
const clientImport = read('client-import.js');
const provider = read('provider.js');
const vendor = read('vendor/xlsx-0.20.3.full.min.js');

assert.match(migration, /create table if not exists public\.organization_imported_booking_history/i);
assert.match(migration, /unique \(organization_id,source_fingerprint\)/i);
assert.match(migration, /v_role is null or v_role not in \('owner','admin'\)/i);
assert.match(migration, /on conflict \(organization_id,source_fingerprint\) do nothing/i);
assert.match(migration, /grant execute on function public\.import_minuta_booking_history\(uuid,jsonb,uuid,text\) to authenticated/i);
assert.match(migration, /grant execute on function public\.get_minuta_imported_booking_history\(uuid,integer,integer\) to authenticated/i);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[^;]*to authenticated/i);
assert.match(rollback, /v99_rollback_blocked_history_exists/i);
assert.match(clientImport, /parseBookingJournalWorkbook/);
assert.match(clientImport, /import_minuta_booking_history/);
assert.match(provider, /importedBookingHistory/);
assert.match(provider, /is_imported_history:true/);
assert.match(provider, /Стоимость из журнала/);
assert.match(provider, /function importedHistoryForBookingView\(\)[\s\S]*?item\.booking_date <= today[\s\S]*?String\(item\.organization_id \|\| ''\) === String\(organizationId\)/, 'Импортированная история не защищена периодом и активной организацией');
assert.match(provider, /function bookingSourceItems\(\)[\s\S]*?\[\.\.\.allBookings, \.\.\.importedHistoryForBookingView\(\)\]/, 'Импортированные посещения не добавлены в журнал записей');
assert.match(provider, /function renderTimeline\(sourceItems\)[\s\S]*?operationalItems = sourceItems\.filter\(item => !item\.is_imported_history\)[\s\S]*?automaticBookingBreaks\(operationalItems\)/, 'Импортированная история влияет на рабочие перерывы');
assert.match(provider, /function openBookingSheet\(id\)[\s\S]*?if \(item\.is_imported_history\)[\s\S]*?Архивная запись доступна только для просмотра[\s\S]*?return;/, 'Импортированная запись открывается как редактируемая рабочая запись');
assert.match(provider, /bookingCard\.matches\('\[data-imported-history\]'\)/, 'Импортированную запись можно перетащить в расписании');
assert.match(provider, /providerBookingViewRevisions\.delete\('bookings'\);[\s\S]*?updateBookingStats\(\);[\s\S]*?renderBookings\(\)/, 'Журнал не обновляется после загрузки импортированной истории');

const xlsxContext = {};
vm.runInNewContext(vendor, xlsxContext);
const context = { window:{ crypto:globalThis.crypto,XLSX:xlsxContext.XLSX } };
vm.runInNewContext(clientImport, context);
const workbook = xlsxContext.XLSX.utils.book_new();
const sheet = xlsxContext.XLSX.utils.aoa_to_sheet([
  ['', 'Рамиль'],
  ['10:00', '10:00 - 11:00 (3 000 RUB)\nАнна\n+7 999 111-22-33\nМассаж спины\nПо сертификату']
]);
xlsxContext.XLSX.utils.book_append_sheet(workbook, sheet, '04.08.2026');
const futureSheet = xlsxContext.XLSX.utils.aoa_to_sheet([
  ['', 'Рамиль'],
  ['11:00', '11:00 - 12:00 (2 000 RUB)\nБудущий клиент\n+7 999 444-55-66\nДругая услуга']
]);
xlsxContext.XLSX.utils.book_append_sheet(workbook, futureSheet, '05.08.2026');
const parsed = context.window.MinutaClientImport.parseBookingJournalWorkbook(workbook, { today:'2026-08-04',nowMinutes:12 * 60 });
assert.equal(parsed.kind, 'history');
assert.equal(parsed.rows.length, 1);
assert.equal(parsed.futureCount, 1);
assert.equal(parsed.rows[0].client_name, 'Анна');
assert.equal(parsed.rows[0].phone, '79991112233');
assert.equal(parsed.rows[0].duration_minutes, 60);
assert.equal(parsed.rows[0].price_rub, 3000);
assert.equal(parsed.rows[0].service_name, 'Массаж спины');
assert.equal(parsed.rows[0].source_note.toLowerCase(), 'по сертификату');

console.log('v99 booking history import static checks passed');
