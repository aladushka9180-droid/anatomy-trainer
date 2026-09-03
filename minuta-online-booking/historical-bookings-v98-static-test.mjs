import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const provider = read('provider.js');
const migration = read('supabase-migration-v98.sql');

assert.match(provider, /create_minuta_historical_booking/);
assert.match(provider, /newBookingHistoricalMode/);
assert.doesNotMatch(provider, /id="newBookingDate" type="date" min=/);
assert.match(migration, /v_role not in \('owner','admin','specialist'\)/);
assert.match(migration, /v_role='specialist' and v_performer<>v_actor/);
assert.match(migration, /p_date\+p_time>=timezone\('Europe\/Samara',now\(\)\)/);
assert.match(migration, /grant execute[\s\S]*to authenticated/);
assert.match(migration, /revoke all[\s\S]*anon/);

console.log('v98 historical provider booking static checks passed');
