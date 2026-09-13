import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase-migration-v154.sql');
const rollback = read('../supabase-migration-v154-rollback.sql');
const integration = read('./booking-lookup-v154-integration.sql');
const state = read('../scripts/booking-lookup-v154-state.sql');
const contractScript = read('../scripts/booking-lookup-v154-contract.mjs');
const workflow = read('../../.github/workflows/minuta-v154-booking-lookup-release.yml');

const normalized = migration.replaceAll('\r\n', '\n');
const functionStart = normalized.search(
  /create\s+or\s+replace\s+function\s+public\.lookup_primetime_booking_request_v154\s*\(/i,
);
assert.ok(functionStart >= 0, 'lookup definition is missing');
const bodyMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1\s*;/i.exec(normalized.slice(functionStart));
assert.ok(bodyMatch, 'lookup body is missing');
const functionBody = bodyMatch[2].replaceAll('\r', '');
const sourceHash = createHash('sha256').update(functionBody).digest('hex');

assert.equal((migration.match(new RegExp(sourceHash, 'g')) ?? []).length, 2);
assert.equal((rollback.match(new RegExp(sourceHash, 'g')) ?? []).length, 1);
assert.match(migration, /security definer[\s\S]*set search_path to ''/i);
assert.match(migration, /language plpgsql\s+stable/i);
assert.match(migration, /current_setting\('request\.headers',true\)/i);
assert.match(migration, /x-primetime-booking-lookup-key/);
assert.match(migration, /char_length\(v_secret\)<>64/);
assert.match(migration, /v_secret!~'\^\[0-9A-Fa-f\]\{64\}\$'/);
assert.match(migration, /credential\.credential_key='booking_lookup_v154'[\s\S]*credential\.active/);
assert.match(migration, /extensions\.digest\(convert_to\(v_secret,'UTF8'\),'sha256'\)/);
assert.match(migration, /where booking\.request_id=p_request_id\s+limit 1/);
assert.doesNotMatch(functionBody, /\b(?:insert|update|delete|truncate|merge|alter|drop|create)\b/i);
assert.doesNotMatch(migration, /(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\.bookings/i);

assert.match(migration, /returns table\(\s*booking_code text,\s*manage_token uuid,\s*service_id uuid,\s*booking_date date,\s*booking_time time without time zone,\s*duration_minutes integer,\s*original_price_rub integer,\s*total_price_rub integer,\s*status text\s*\)/);
assert.match(migration, /revoke all on function public\.lookup_primetime_booking_request_v154\(uuid\)\s+from public,anon,authenticated,service_role/);
assert.match(migration, /grant execute on function public\.lookup_primetime_booking_request_v154\(uuid\) to anon/);
assert.deepEqual(
  [...migration.matchAll(/grant execute on function[^;]+;/gi)].map(match => match[0].replace(/\s+/g, ' ').trim()),
  ['grant execute on function public.lookup_primetime_booking_request_v154(uuid) to anon;'],
);
assert.match(migration, /aclexplode\(coalesce\([\s\S]*relation_row\.relacl,acldefault\('r',relation_row\.relowner\)/);
assert.match(migration, /role_row\.rolname in\('anon','authenticated','service_role'\)/);
assert.match(migration, /v154_apply_blocked_newer_function_definition/);
assert.match(migration, /minuta_booking_lookup_v154:sha256=/);
assert.doesNotMatch(migration, /booking_lookup_v154'\s*,\s*'[0-9a-f]{64}'/i);

assert.match(rollback, /v154_rollback_blocked_newer_function_definition/);
assert.match(rollback, /drop function if exists public\.lookup_primetime_booking_request_v154\(uuid\)/);
assert.match(rollback, /delete from public\.primetime_server_credentials\s+where credential_key='booking_lookup_v154'/);
assert.doesNotMatch(rollback, /(?:insert|update|delete|truncate)\s+(?:into\s+|from\s+)?public\.bookings/i);

assert.match(integration, /^-- ISOLATED TEST DATABASE ONLY\./);
assert.match(integration, /\bbegin\s*;/i);
assert.match(integration, /\brollback\s*;\s*$/i);
for (const label of [
  'missing_header_is_neutral',
  'malformed_headers_are_neutral',
  'malformed_secret_is_neutral',
  'mismatched_secret_is_neutral',
  'unknown_request_is_neutral',
  'inactive_credential_is_neutral',
  'exact_committed_snapshot_including_manage_token',
  'lookup_did_not_mutate_booking',
  'lookup_did_not_change_business_counts',
]) assert.match(integration, new RegExp(label));

assert.match(state, /repeatable read read only/);
assert.match(state, /'partial-or-newer'/);
assert.match(state, /has_function_privilege\('anon'/);
assert.match(state, /not has_function_privilege\('authenticated'/);
assert.match(state, /not has_function_privilege\('service_role'/);
assert.doesNotMatch(state, /\b(?:insert|update|delete|truncate|alter|drop|create)\b/i);
assert.match(contractScript, /createHash\('sha256'\)/);
assert.match(contractScript, /lookup_primetime_booking_request_v154/);

const job = name => {
  const match = new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|(?![\\s\\S]))`, 'm').exec(workflow);
  assert.ok(match, `missing job ${name}`);
  return match[0];
};

for (const phase of ['test-v154', 'validate-production-v154', 'apply-production-v154', 'observe-production-v154']) {
  assert.match(workflow, new RegExp(`\\b${phase}:`));
}
assert.match(workflow, /^on:\r?\n  workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^\s+(?:push|schedule|workflow_run):/m);
assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/);
assert.match(workflow, /git\/ref\/heads\/main/);
assert.match(workflow, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);

const testJob = job('test-v154');
assert.match(testJob, /environment: minuta-test/);
assert.match(testJob, /migration-config-guard\.mjs/);
assert.match(testJob, /booking-lookup-v154-integration\.sql/g);
const testSequence = [...testJob.matchAll(/-f minuta-online-booking\/(supabase-migration-v154(?:-rollback)?\.sql|tests\/booking-lookup-v154-integration\.sql)/g)]
  .map(match => match[1]);
assert.deepEqual(testSequence, [
  'supabase-migration-v154.sql',
  'supabase-migration-v154.sql',
  'tests/booking-lookup-v154-integration.sql',
  'supabase-migration-v154-rollback.sql',
  'supabase-migration-v154.sql',
  'tests/booking-lookup-v154-integration.sql',
]);
assert.match(testJob, /businessRowsChanged:false/);
assert.match(testJob, /externalMessagesSent:false/);
assert.match(testJob, /paymentsCharged:false/);

const validationJob = job('validate-production-v154');
assert.match(validationJob, /default_transaction_read_only=on/);
assert.doesNotMatch(validationJob, /supabase-migration-v154\.sql/);
assert.doesNotMatch(validationJob, /booking-lookup-v154-integration\.sql/);

const applyJob = job('apply-production-v154');
for (const evidence of ['TEST', 'VALIDATION', 'BACKUP', 'RESTORE']) {
  assert.match(applyJob, new RegExp(`check_run "\\$${evidence}"`));
}
assert.match(applyJob, /test "\$age" -ge 0 && test "\$age" -le 7200/);
assert.match(applyJob, /MINUTA_BOOKING_LOOKUP_KEY_V154/);
assert.match(applyJob, /printf '%s' "\$LOOKUP_KEY" \| sha256sum/);
assert.match(applyJob, /insert into public\.primetime_server_credentials/);
assert.match(applyJob, /booking-business-counts-v152-v153\.sql/g);
assert.match(applyJob, /test "\$\(jq -S \. <<<"\$after"\)" = "\$\(jq -S \. <<<"\$before"\)"/);
assert.doesNotMatch(applyJob, /booking-lookup-v154-integration\.sql/);
assert.doesNotMatch(applyJob, /(?:curl|wget).*?(?:sms|payment|telegram|edge)/i);

const observeJob = job('observe-production-v154');
assert.match(observeJob, /default_transaction_read_only=on/);
assert.match(observeJob, /sleep "\$\(\(MINUTES\*60\)\)"/);
assert.doesNotMatch(observeJob, /supabase-migration-v154\.sql/);
assert.doesNotMatch(observeJob, /booking-lookup-v154-integration\.sql/);

console.log('Minuta v154 least-privilege lookup static checks passed');
