import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('.', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v124.sql', root), 'utf8');
const rollback = readFileSync(new URL('supabase-migration-v124-rollback.sql', root), 'utf8');
const provider = readFileSync(new URL('provider.js', root), 'utf8');
const html = readFileSync(new URL('provider.html', root), 'utf8');
const styles = readFileSync(new URL('provider-ux.css', root), 'utf8');
const help = readFileSync(new URL('help/help-data.js', root), 'utf8');

assert.match(migration, /add column if not exists auto_complete_payment_method text not null default 'cash'/);
assert.match(migration, /auto_complete_payment_method in \('unpaid','cash','transfer','card'\)/);
assert.match(migration, /policy\.auto_complete_payment_method/);
assert.match(migration, /case when v_payment='unpaid' then 0 else v_value end/);
assert.match(migration, /for update of booking skip locked/i);
assert.match(migration, /revoke all on function public\.process_minuta_auto_completed_visits_v106\(integer\) from public,anon,authenticated,service_role/i);
assert.doesNotMatch(rollback, /delete from|truncate|drop table|drop column/i);
assert.match(rollback, /payment_method='cash'/);

assert.match(html, /id="autoCompletePaymentMethod"/);
assert.match(html, /Автоматически завершать прошедшие визиты/);
assert.match(html, /id="autoCompleteVisitsSetting"[\s\S]*<details class="booking-advanced-settings">[\s\S]*<summary>Дополнительно: перерывы<\/summary>/);
assert.doesNotMatch(html, /<summary>[^<]*автозавершение/i);
assert.match(provider, /auto_complete_payment_method: 'cash'/);
assert.match(provider, /function completedOutcomeDraft/);
assert.match(provider, /paymentMethod === 'unpaid' \? 0 : calculatedAmount/);
assert.match(provider, /data-quick-complete-booking/);
assert.match(provider, /data-open-auto-complete-settings/);
assert.match(provider, /function openAutoCompleteSettings/);
assert.match(provider, /async function quickCompleteBookingOutcome/);
assert.match(provider, /auto_complete_payment_method,visitor_notifications_enabled/);
assert.doesNotMatch(provider, /completionSource === 'auto' && method !== 'unpaid'/);
assert.match(styles, /\.auto-complete-payment-field/);
assert.match(styles, /\.auto-complete-primary-setting/);
assert.match(styles, /\.booking-auto-complete-action/);
assert.match(styles, /\.booking-outcome-quick/);
assert.match(help, /Настройте автоучёт/);
assert.match(help, /оплату по умолчанию/);

console.log('Visit outcome defaults v124 static checks passed.');
