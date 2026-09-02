import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const base = new URL('./', import.meta.url);
const migration = await readFile(new URL('supabase-migration-v84.sql', base), 'utf8');
const rollback = await readFile(new URL('supabase-migration-v84-rollback.sql', base), 'utf8');
const benefitUi = await readFile(new URL('benefit-management.js', base), 'utf8');
const loyaltyUi = await readFile(new URL('loyalty-management.js', base), 'utf8');

for (const prerequisite of [
  'public.benefit_redemptions',
  'public.loyalty_redemptions',
  'public.loyalty_promo_redemptions',
  'public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)',
  'public.redeem_minuta_loyalty(uuid,uuid,integer,uuid)',
  'public.redeem_minuta_promotion(uuid,text,uuid,uuid)'
]) assert.ok(migration.includes(prerequisite), `Нет prerequisite: ${prerequisite}`);

assert.match(migration, /having count\(distinct source\)>1/);
assert.match(migration, /v84_existing_booking_benefit_conflict/);
assert.match(migration, /status in \('reserved','redeemed'\)/);
assert.match(migration, /pg_advisory_xact_lock\([\s\S]*hashtextextended\(new\.organization_id::text\|\|':'\|\|new\.booking_id::text,8400\)/);

for (const trigger of [
  'benefit_redemptions_exclusivity_v84',
  'loyalty_redemptions_exclusivity_v84',
  'loyalty_promo_redemptions_exclusivity_v84'
]) {
  assert.match(migration, new RegExp(`create trigger ${trigger}`));
  assert.match(rollback, new RegExp(`drop trigger if exists ${trigger}`));
}

for (const table of ['public.benefit_redemptions','public.loyalty_redemptions','public.loyalty_promo_redemptions']) {
  assert.ok(migration.includes(`from ${table}`), `Нет серверной проверки ${table}`);
}

assert.match(rollback, /drop function if exists public\.enforce_minuta_booking_benefit_exclusivity\(\)/);
assert.ok(benefitUi.includes('booking_benefit_conflict'));
assert.ok(loyaltyUi.includes('booking_benefit_conflict'));
assert.ok(benefitUi.includes('только один вариант'));
assert.ok(loyaltyUi.includes('только один вариант'));

console.log('v84 benefit exclusivity static contract: ok');
