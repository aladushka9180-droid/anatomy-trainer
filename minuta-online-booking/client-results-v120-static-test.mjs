import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const migration=read('supabase-migration-v120.sql');
const rollback=read('supabase-migration-v120-rollback.sql');
const integration=read('tests/client-results-v120-integration.sql');
const workflow=read('../.github/workflows/minuta-v120-safe-release.yml');
const providerHtml=read('provider.html');
const providerJs=read('provider.js');
const serviceWorker=read('sw.js');

for(const table of ['client_result_series','client_result_assets','client_result_consents']){
  assert.match(migration,new RegExp(`create table if not exists public\\.${table}`,'i'));
  assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
  assert.match(migration,new RegExp(`revoke all on[\\s\\S]*public\\.${table}[\\s\\S]*from public,anon,authenticated`,'i'));
}
for(const rpc of ['get_minuta_client_results_v120','get_minuta_client_result_v120','save_minuta_client_result_v120',
  'create_minuta_client_result_media_v120','complete_minuta_client_result_media_v120','archive_minuta_client_result_media_v120']){
  assert.match(migration,new RegExp(`create or replace function public\\.${rpc}`,'i'));
}
assert.match(migration,/create_minuta_client_result_media_v120\(\s*p_organization uuid,p_phone text,p_result uuid,p_id uuid,p_purpose text,p_mime_type text,p_byte_size integer/i);
assert.doesNotMatch(migration,/create_minuta_client_result_media_v120\([^)]*p_booking/i);
assert.match(migration,/jsonb_build_object\('enabled',[\s\S]*'entries',v_entries,'media',v_media\)/i);
assert.match(migration,/jsonb_build_object\('enabled',[\s\S]*'entry',[\s\S]*'media',v_media\)/i);
assert.match(migration,/payload_hash text not null/i);
assert.match(migration,/recorded_by=v_actor and consent\.request_id=p_request/i);
assert.match(migration,/client_result_request_conflict/i);
assert.match(migration,/client_result_settings|client_record_settings/i);
assert.match(migration,/not exists\(select 1 from public\.client_result_assets asset where asset\.record_entry_id=entry\.id\)/i);
assert.match(migration,/asset\.result_id=any\(v_ids\)/i);
assert.match(migration,/public\.create_minuta_client_record\(/i);
assert.doesNotMatch(migration,/create table[^;]*feedback/i);
assert.doesNotMatch(rollback,/drop table/i);
assert.match(rollback,/return false; end if;/i);
assert.match(integration,/retry duplicated consent events/i);
assert.match(integration,/result duplicated in generic records/i);
assert.match(integration,/archive physically deleted media/i);
for(const phase of ['test-v120','validate-production-v120','apply-production-v120','observe-production-v120']) assert.match(workflow,new RegExp(phase));
assert.match(workflow,/APPLY_V120_TO_PRODUCTION/);
assert.match(workflow,/minuta-supabase-backup\.yml/);
assert.match(workflow,/supabase-migration-v120-rollback\.sql/);
assert.match(workflow,/client-results-v120-integration\.sql/);
assert.match(workflow,/client-results-v120-pglite-test\.mjs/);
assert.match(providerHtml,/client-results\.css\?v=558/);
assert.match(providerHtml,/client-results\.js\?v=558[\s\S]*provider\.js\?v=558/);
for(const call of ['mount','save','setClient','setOrganization','reset']) assert.match(providerJs,new RegExp(`clientResultsController\\.${call}\\(`));
assert.match(providerJs,/bookingClientResultMarkup/);
assert.match(providerJs,/id="bookingVisitResultForm"/);
assert.match(providerJs,/saveBookingVisitResult/);
assert.doesNotMatch(providerJs,/clientResultsVisitActive/);
assert.match(providerJs,/mount\(\{ form:\$\('#bookingVisitResultForm'\), booking:item, expandEditor:true \}\)/);
assert.match(serviceWorker,/client-results\.css\?v=558/);
assert.match(serviceWorker,/client-results\.js\?v=558/);
assert.match(serviceWorker,/provider\.js\?v=558/);
assert.match(serviceWorker,/CACHE_PREFIX}v558/);
console.log('Client results v120 static contract: PASS');
