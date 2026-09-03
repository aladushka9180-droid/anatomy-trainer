import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const provider = read('provider.js');
const migration = read('supabase-migration-v98.sql');
const signatureMatch = migration.match(/create(?: or replace)? function public\.create_minuta_historical_booking\s*\(([\s\S]*?)\)\s*returns jsonb/i);
assert.ok(signatureMatch, 'historical booking RPC must exist');
const rpcArguments = signatureMatch[1].split(',').map(value => value.trim()).filter(Boolean);

assert.match(provider, /create_minuta_historical_booking/);
assert.match(provider, /newBookingHistoricalMode/);
assert.doesNotMatch(provider, /id="newBookingDate" type="date" min=/);
assert.match(provider, /historical:newBookingHistoricalMode/);
assert.match(provider, /Boolean\(preset\.historical \|\| draft\?\.historical\)/);
assert.match(provider, /p_duration_minutes:durationMinutes/);
assert.doesNotMatch(provider, /p_total_price_rub/);
assert.doesNotMatch(provider, /create_minuta_historical_booking[\s\S]{0,2600}applyPerMinuteBookingTerms/);
assert.doesNotMatch(provider, /create_minuta_historical_booking[\s\S]{0,2600}rollbackCreatedBookings/);
assert.match(provider, /data-create-booking-at[\s\S]{0,300}role="slider"[\s\S]{0,300}tabindex="0"/);
assert.match(provider, /event\.key === 'Enter' \|\| event\.key === ' '/);
assert.match(provider, /id="newBookingError" role="alert" aria-live="assertive"/);
assert.equal(rpcArguments.length, 7, 'historical booking RPC must use the seven-argument contract');
assert.match(migration, /p_duration_minutes integer/);
assert.doesNotMatch(signatureMatch[1], /p_total_price_rub/);
assert.match(migration, /v_role is null or v_role not in \('owner','admin','specialist'\)/);
assert.match(migration, /v_role='specialist' and v_performer<>v_actor/);
assert.match(migration, /p_date\s*\+\s*p_time\s*\+\s*make_interval\(\s*mins\s*=>\s*v_effective_duration\s*\)\s*>\s*timezone\(\s*v_timezone\s*,\s*now\(\)\s*\)/i);
assert.match(migration, /extensions\.gen_random_bytes\s*\(/i);
assert.match(migration, /original_price_rub,total_price_rub/);
const serverPriceAssignments = [...migration.matchAll(/\b(v_[a-z0-9_]*(?:total|price)[a-z0-9_]*)\s*:=\s*([^;]+);/gi)];
assert.ok(
  serverPriceAssignments.some(([, , expression]) => /\*/.test(expression) && /duration/i.test(expression) && /(?:price|rate)/i.test(expression)),
  'total_price_rub must be calculated by the server from the service rate and duration'
);
assert.match(migration, /grant execute[\s\S]*to authenticated/);
assert.match(migration, /revoke all[\s\S]*anon/);

console.log('v98 historical provider booking static checks passed');
