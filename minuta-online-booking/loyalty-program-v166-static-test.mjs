import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const migration = read('./supabase-migration-v166.sql');
const operational = read('./supabase-migration-v166-operational-rollback.sql');
const schemaRollback = read('./supabase-migration-v166-schema-rollback.sql');
const html = read('./provider.html');
const provider = read('./provider.js');
const module = read('./loyalty-program-v166.js');
const relationship = read('./client-relationship.js');

for (const table of ['settings','rules','accounts','visits','rewards','history']) {
  assert.match(migration,new RegExp(`create table public\\.loyalty_program_${table}_v166`,'i'));
}
for (const rpc of [
  'set_minuta_loyalty_program_v166','adjust_minuta_loyalty_progress_v166',
  'redeem_minuta_loyalty_reward_v166','get_minuta_loyalty_program_workspace_v166',
  'get_client_loyalty_program_v166'
]) assert.match(migration,new RegExp(`create or replace function public\\.${rpc}`,'i'));

assert.match(migration,/visit_status='completed'/i,'Only completed outcomes qualify');
assert.match(migration,/v_booking\.status<>'cancelled'/i,'Cancelled bookings never qualify');
assert.match(migration,/booking_id uuid primary key/i,'A booking can be counted once');
assert.match(migration,/unique\(organization_id,account_id,cycle_number\)/i,'A cycle has one durable reward identity');
assert.match(migration,/on conflict\(organization_id,account_id,cycle_number\) do update[\s\S]*status='voided'/i,'Only a voided entitlement can be safely re-earned');
assert.match(migration,/redemption_request_id uuid[\s\S]*unique\(organization_id,redemption_request_id\)/i,'Reward redemption is idempotent');
assert.match(migration,/resolve_client_identity_session_v155\(p_session_token\)/i,'Client contract uses the authoritative session resolver');
assert.match(migration,/client_loyalty_access_denied/i,'Client contract fails closed');
assert.doesNotMatch(migration,/clientRelationship|crm_status|relationship_status/i,'Client contract does not expose internal CRM status');
assert.match(migration,/'state',v_state[\s\S]*'progress',v_progress[\s\S]*'goal_visits'/i,'Client contract exposes only minimal progress state');
assert.match(operational,/set enabled=false/i);
assert.match(operational,/data-preserved/i);
assert.doesNotMatch(operational,/drop table|delete from|truncate/i,'Operational rollback preserves all history');
assert.match(schemaRollback,/refuses_nonempty_data/i,'Destructive test rollback refuses populated data');

assert.match(html,/Программа лояльности/);
assert.match(html,/id="loyaltyGoalPreset"[\s\S]*5 визитов[\s\S]*10 визитов[\s\S]*20 визитов/);
assert.match(html,/Скидка на следующий визит[\s\S]*Фиксированная скидка[\s\S]*Бонус или дополнение/);
assert.doesNotMatch(html,/id="loyaltyPanel"[\s\S]{0,5000}(?:Начислять, %|1 бонус = 1 ₽|Создать промокод)/i,'New panel does not expose points or promo mechanics');
assert.doesNotMatch(html,/Уровень отношений/);
for (const status of ['Новый','Вернулся','Постоянный','Лояльный']) assert.match(relationship,new RegExp(`title:'${status}'`));
assert.doesNotMatch(relationship,/уровень/i);
assert.match(provider,/script:'loyalty-program-v166\.js'/);
assert.match(provider,/ensureOrganizationFeature\('loyaltyPanel'\)[\s\S]*setClient/);
assert.match(provider,/clientLoyaltySettings[\s\S]{0,500}await Promise\.resolve\(activateOrganizationSectionFeature\(loyaltySection, \{ retry:true \}\)\)[\s\S]{0,160}loyaltySection\.hidden = false[\s\S]{0,300}scrollToProviderSection\(loyaltyButton\)/,
  'Client profile settings wait for and reveal the loyalty workspace before selecting it');
assert.match(module,/get_minuta_loyalty_program_workspace_v166/);
assert.match(module,/set_minuta_loyalty_program_v166/);
assert.match(module,/redeem_minuta_loyalty_reward_v166/);
assert.match(module,/const next = \{ fingerprint, requestId:uuid\(\) \}[\s\S]*localStorage\.setItem\(key, JSON\.stringify\(next\)\)/i,'Ambiguous writes keep an opaque retry intent across reloads');
assert.match(module,/if \(known\) clearIntent\(intent\)/,'Known business failures release the retry intent');
assert.doesNotMatch(module,/send_message|notification_outbox|referral|cashback/i,'V1 has no messaging, referrals or cashback');
assert.match(html,/provider\.js\?v=868/);
assert.match(html,/styles\.css\?v=868/);

console.log('loyalty program v166 static contract: PASS');
