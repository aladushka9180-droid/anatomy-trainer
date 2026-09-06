import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const migration=read('supabase-migration-v119.sql');
const rollback=read('supabase-migration-v119-rollback.sql');
const provider=read('provider.js');
const html=read('provider.html');
const app=read('app.js');
const css=read('client-records.css');
const integration=read('tests/client-profile-v119-integration.sql');

assert.match(migration,/create table if not exists public\.organization_client_profiles/i);
assert.match(migration,/primary key \(organization_id,normalized_phone\)/i);
assert.match(migration,/enable row level security/i);
assert.match(migration,/has_organization_role\(p_organization,array\['owner','admin'\]/i);
assert.match(migration,/create trigger zy_bookings_client_online_block_v119[\s\S]*before insert on public\.bookings/i);
assert.match(migration,/auth\.role\(\)='service_role'[\s\S]*organization_memberships[\s\S]*client_online_booking_blocked/i);
assert.doesNotMatch(migration,/grant (?:select|insert|update|delete|all) on public\.organization_client_profiles to (?:anon|authenticated)/i);
assert.match(rollback,/v119_rollback_blocked_active_client_blocks/i);
assert.doesNotMatch(rollback,/drop table/i);

for(const id of ['clientContactButton','clientMoreButton','clientContactDialog','clientBirthdayDialog','clientBlockDialog']) assert.match(html,new RegExp(`id="${id}"`));
for(const rpc of ['get_minuta_client_profile_v119','save_minuta_client_birthday_v119','set_minuta_client_online_booking_block_v119']) assert.match(provider,new RegExp(rpc));
assert.match(provider,/setClientProfileDetailMode\(true\)/);
assert.match(provider,/client-profile-detail-open/);
assert.match(app,/client_online_booking_blocked/);
assert.match(css,/@media \(max-width:760px\)[\s\S]*clients-layout\.is-detail[\s\S]*client-profile-dialog/);
assert.match(css,/client-profile-detail-open[\s\S]*>\.clients-search-tools/);
assert.match(css,/client-profile-detail-open[\s\S]*>#clientDirectoryFilters/);
assert.match(integration,/specialist_block_allowed/);
assert.match(integration,/outsider_read_allowed/);
assert.match(integration,/check_client_profile_v119_rollback/);
assert.match(integration,/check_client_profile_v119_reapply/);
assert.match(read('tests/client-profile-actions-browser-test.mjs'),/390,760[\s\S]*1440/);

console.log('Client profile v119 static contract: PASS');
