import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('.', import.meta.url);
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const styles = readFileSync(new URL('styles.css', root), 'utf8');
const migration = readFileSync(new URL('supabase-migration-v145.sql', root), 'utf8');
const rollback = readFileSync(new URL('supabase-migration-v145-rollback.sql', root), 'utf8');
const html = readFileSync(new URL('provider.html', root), 'utf8');
const worker = readFileSync(new URL('sw.js', root), 'utf8');

assert.match(migration, /create or replace function public\.create_minuta_historical_booking\([\s\S]*?p_payment_method text,[\s\S]*?p_amount_rub integer/);
assert.match(migration, /v_created:=public\.create_minuta_historical_booking\([\s\S]*?p_duration_minutes[\s\S]*?\);/);
assert.match(migration, /v_outcome:=public\.save_minuta_booking_outcome_v106\([\s\S]*?v_booking,'completed',v_payment,v_amount/);
assert.match(migration, /historical_outcome_acknowledgement_invalid/);
assert.match(migration, /'calculated_amount_rub',\(v_outcome->>'calculated_amount_rub'\)::integer/);
assert.match(migration, /revoke all on function public\.create_minuta_historical_booking\([\s\S]*?integer,text,integer[\s\S]*?from public,anon,authenticated,service_role/);
assert.match(migration, /grant execute on function public\.create_minuta_historical_booking\([\s\S]*?integer,text,integer[\s\S]*?to authenticated/);
assert.match(rollback, /drop function if exists public\.create_minuta_historical_booking\([\s\S]*?integer,text,integer/);
assert.doesNotMatch(rollback, /delete from|truncate|drop table|drop column/i);

assert.match(provider, /id="newBookingHistoricalPayment"/);
assert.match(provider, /id="newBookingHistoricalPaymentMethod"/);
assert.match(provider, /id="newBookingHistoricalAmount"/);
assert.match(provider, /const historicalCaption = 'Сохранить';/);
assert.match(provider, /historical:dateIso < today \|\| \(dateIso === today && bookingMoveTimeIsPast\(dateIso, time\)\)/);
assert.doesNotMatch(provider, /newBookingHistoricalToggle|Визит уже состоялся/);
assert.match(provider, /p_payment_method:historicalPaymentMethod/);
assert.match(provider, /p_amount_rub:historicalAmount/);
assert.match(provider, /data\.visit_status === 'completed'/);
assert.match(provider, /учтено в статистике/);
assert.match(provider, /newBookingTime = preferredTime \|\| '';/);
assert.match(styles, /\.new-booking-historical-payment \{/);
assert.match(styles, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
assert.match(html, /provider\.js\?v=707/);
assert.match(worker, /const CACHE = `\$\{CACHE_PREFIX\}v707`/);
assert.match(worker, /\.\/provider\.js\?v=707/);

console.log('Historical paid booking v145 static checks passed.');
