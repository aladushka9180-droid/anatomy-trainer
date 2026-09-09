import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration=readFileSync(new URL('./supabase-migration-v137.sql',import.meta.url),'utf8');
const rollback=readFileSync(new URL('./supabase-migration-v137-rollback.sql',import.meta.url),'utf8');
const integration=readFileSync(new URL('./tests/booking-funnel-v137-integration.sql',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/minuta-v137-booking-funnel.yml',import.meta.url),'utf8');

assert.match(migration,/create or replace function public\.track_public_booking_funnel_event/i);
assert.match(migration,/join public\.organization_memberships membership[\s\S]*membership\.organization_id=v_org[\s\S]*membership\.user_id=service\.performer_id[\s\S]*membership\.active[\s\S]*membership\.is_bookable/i);
assert.doesNotMatch(migration.slice(0,migration.indexOf('do $postcondition$')),/service\.organization_id/i);
assert.match(migration,/security definer set search_path to ''/i);
for(const role of ['anon','authenticated','service_role']) assert.match(migration,new RegExp(`has_function_privilege\\('${role}'`));
assert.match(migration,/revoke all on function[\s\S]*from public,anon,authenticated,service_role/i);
assert.match(migration,/grant execute on function[\s\S]*to anon,authenticated,service_role/i);
assert.match(rollback,/service\.organization_id/i);
for(const token of ['page_opened','service_selected','primetime_external_test','htmlpreview.github.io','rollback;']) assert.ok(integration.includes(token),`integration missing ${token}`);
assert.match(integration,/set local role anon/i);
assert.match(integration,/v137_cross_tenant_service_event_accepted/i);
for(const token of ['workflow_dispatch:','test-v137','validate-production-v137','apply-production-v137','observe-production-v137','BACKUP','RESTORE','environment: minuta-production','production-db-target-guard.mjs','supabase-migration-v137.sql','booking-funnel-v137-integration.sql']) assert.ok(workflow.includes(token),`workflow missing ${token}`);
for(const token of ['APPLY_V137_TO_PRODUCTION','default_transaction_read_only=on','production-health-check.mjs']) assert.ok(workflow.includes(token),`workflow missing ${token}`);
console.log('booking funnel v137 static checks passed');
