import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const migration=readFileSync(resolve(root,'supabase-migration-v149.sql'),'utf8');
const rollback=readFileSync(resolve(root,'supabase-migration-v149-rollback.sql'),'utf8');
const controller=readFileSync(resolve(root,'benefit-management.js'),'utf8');
const integration=readFileSync(resolve(root,'tests/benefit-application-v149-integration.sql'),'utf8');
const lifecycle=readFileSync(resolve(root,'tests/benefit-application-v149-lifecycle.sql'),'utf8');

assert.match(migration,/create table if not exists public\.benefit_application_requests/i);
assert.match(migration,/unique\(organization_id,request_id\)/i);
assert.match(migration,/request_fingerprint text not null check\(request_fingerprint~'\^\[0-9a-f\]\{64\}\$'\)/i);
assert.match(migration,/create or replace function public\.apply_minuta_benefit_v149\([\s\S]*p_request_id uuid default null/i);
assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\(p_booking::text,7302\)\)[\s\S]*pg_advisory_xact_lock\(hashtextextended\(p_instrument::text,7300\)\)/i);
assert.match(migration,/p_action='redeem' and v_redemption\.status='redeemed'[\s\S]*p_action='release' and v_redemption\.status='released'/i);
assert.match(migration,/v_result:=public\.apply_minuta_benefit\(p_organization,p_instrument,p_booking,p_action,p_amount_rub\)/i);
assert.match(migration,/source_type='commercial_sale' and transaction_row\.source_id=v_sale/i);
assert.match(migration,/v_existing\.result_status[\s\S]*'commercial_sale_id',v_existing\.commercial_sale_id[\s\S]*'sale_transaction_id',v_existing\.sale_transaction_id/i);
assert.match(migration,/result_status text[\s\S]*commercial_sale_id uuid[\s\S]*sale_transaction_id uuid/i);
assert.match(migration,/v_status,v_sale,v_sale_transaction,auth\.uid\(\)/i);
assert.doesNotMatch(migration,/insert into public\.financial_(?:transactions|postings)[\s\S]*apply_minuta_benefit_v149/i,'application must not recognize product revenue twice');
assert.match(migration,/revoke all on table public\.benefit_application_requests from public,anon,authenticated,service_role/i);
assert.match(migration,/revoke all on function public\.apply_minuta_benefit\(uuid,uuid,uuid,text,integer\)[\s\S]*from public,anon,authenticated,service_role/i);
assert.match(migration,/grant execute on function public\.apply_minuta_benefit_v149\(uuid,uuid,uuid,text,integer,uuid\) to authenticated/i);
assert.match(rollback,/v149_rollback_blocked_by_application_history/i);
assert.match(rollback,/minuta-benefit-application-v149:'\|\|md5\(v_source\)[\s\S]*v149_rollback_newer_function_detected/i);
assert.match(rollback,/minuta-benefit-application-v149[\s\S]*v149_rollback_newer_table_detected/i);
assert.match(rollback,/grant execute on function public\.apply_minuta_benefit\(uuid,uuid,uuid,text,integer\) to authenticated/i);
assert.match(rollback,/drop function if exists public\.apply_minuta_benefit_v149\(uuid,uuid,uuid,text,integer,uuid\)/i);

assert.match(controller,/db\.rpc\('apply_minuta_benefit_v149',guarded\)/);
assert.doesNotMatch(controller,/db\.rpc\('apply_minuta_benefit'/);
assert.match(controller,/requestId=uuid\(\)[\s\S]*p_request_id:requestId/);
assert.match(controller,/instrumentSupportsBooking/);
assert.match(controller,/service_balances/);
assert.match(controller,/\['reserved','redeemed'\]\.includes\(item\.status\)/);
assert.match(integration,/legacy_rpc_not_directly_callable/);
assert.match(integration,/v149_outsider_rpc_was_allowed/);
assert.match(integration,/replay_same_sale_linkage/);
assert.match(lifecycle,/supabase-migration-v149-rollback\.sql[\s\S]*benefit-application-v149-rollback-check\.sql[\s\S]*supabase-migration-v149\.sql/);

console.log('benefit application v149 static tests passed');
