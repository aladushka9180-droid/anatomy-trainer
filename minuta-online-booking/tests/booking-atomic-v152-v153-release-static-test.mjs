import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read('../../.github/workflows/minuta-v152-v153-booking-atomic-release.yml');
const state = read('../scripts/booking-atomic-v152-v153-state.sql');
const counts = read('../scripts/booking-business-counts-v152-v153.sql');
const contract = read('../scripts/booking-atomic-v152-v153-contract.mjs');

const job = name => {
  const match = new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|(?![\\s\\S]))`, 'm').exec(workflow);
  assert.ok(match, `missing job ${name}`);
  return match[0];
};

for (const phase of [
  'test-v152-v153',
  'validate-production-v152-v153',
  'apply-production-v152-v153',
  'observe-production-v152-v153',
]) {
  assert.match(workflow, new RegExp(`\\b${phase}:`));
}

assert.match(workflow, /^on:\r?\n  workflow_dispatch:/m);
assert.doesNotMatch(workflow, /^\s+(?:push|schedule|workflow_run):/m);
assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/);
assert.match(workflow, /git\/ref\/heads\/main/);
assert.match(workflow, /test "\$CONFIRMATION" = BACKUP_VERIFIED/);
assert.match(workflow, /minuta-v152-v153-booking-atomic-release\.yml/);

const testJob = job('test-v152-v153');
assert.match(testJob, /environment: minuta-test/);
assert.match(testJob, /migration-config-guard\.mjs/);
assert.match(testJob, /minuta_migration_guard\.target/);
assert.match(testJob, /booking-recovery-v152-integration\.sql/);
assert.match(testJob, /booking-atomic-create-v153-integration\.sql/);
assert.match(testJob, /isolatedDatabase:true/);
assert.match(testJob, /externalMessagesSent:false/);
assert.match(testJob, /paymentsCharged:false/);

const testSequence = [...testJob.matchAll(/-f minuta-online-booking\/(supabase-migration-v15[23](?:-rollback)?\.sql)/g)]
  .map(match => match[1]);
assert.deepEqual(testSequence, [
  'supabase-migration-v152.sql',
  'supabase-migration-v153.sql',
  'supabase-migration-v152.sql',
  'supabase-migration-v153.sql',
  'supabase-migration-v153-rollback.sql',
  'supabase-migration-v152-rollback.sql',
  'supabase-migration-v152.sql',
  'supabase-migration-v153.sql',
]);

const validationJob = job('validate-production-v152-v153');
assert.match(validationJob, /environment: minuta-production/);
assert.match(validationJob, /default_transaction_read_only=on/);
assert.match(validationJob, /production-db-target-guard\.mjs --session-url/);
assert.match(validationJob, /production-db-schema-guard\.sh/);
assert.doesNotMatch(validationJob, /supabase-migration-v15[23]\.sql/);
assert.doesNotMatch(validationJob, /booking-(?:recovery-v152|atomic-create-v153)-integration\.sql/);

const applyJob = job('apply-production-v152-v153');
assert.match(applyJob, /check_run "\$TEST" \.github\/workflows\/minuta-v152-v153-booking-atomic-release\.yml/);
assert.match(applyJob, /check_run "\$VALIDATION" \.github\/workflows\/minuta-v152-v153-booking-atomic-release\.yml/);
assert.match(applyJob, /check_run "\$BACKUP" \.github\/workflows\/minuta-supabase-backup\.yml/);
assert.match(applyJob, /check_run "\$RESTORE" \.github\/workflows\/minuta-supabase-restore-drill\.yml/);
assert.match(applyJob, /test "\$age" -ge 0 && test "\$age" -le 7200/);
assert.match(applyJob, /test "\$restore_age" -ge 0 && test "\$restore_age" -le 7200/);
assert.match(applyJob, /\.operation=="backup" and \.status=="success"/);
assert.match(applyJob, /\.archiveFormat=="PostgreSQL custom" and \.encryption=="OpenPGP symmetric AES-256"/);
assert.match(applyJob, /\.networkMode=="none"/);
assert.match(applyJob, /\.ephemeralContainerDestroyed/);
assert.match(applyJob, /\.sourceBackupRunId==\$backup and \.sourceBackupSha==\$sha/);
assert.match(applyJob, /production-db-target-guard\.mjs --session-url/);
assert.match(applyJob, /production-db-schema-guard\.sh/);
assert.match(applyJob, /supabase-migration-v152\.sql[\s\S]*supabase-migration-v153\.sql/);
assert.match(applyJob, /if ! psql[\s\S]*supabase-migration-v153\.sql/);
assert.match(applyJob, /test "\$initial" = absent[\s\S]*supabase-migration-v152-rollback\.sql/);
assert.match(applyJob, /booking-business-counts-v152-v153\.sql/g);
assert.match(applyJob, /test "\$\(jq -S \. <<<"\$after"\)" = "\$\(jq -S \. <<<"\$before"\)"/);
assert.doesNotMatch(applyJob, /booking-(?:recovery-v152|atomic-create-v153)-integration\.sql/);
assert.doesNotMatch(applyJob, /(?:curl|wget).*?(?:sms|payment|telegram|edge)/i);

const observeJob = job('observe-production-v152-v153');
assert.match(observeJob, /default_transaction_read_only=on/);
assert.match(observeJob, /case "\$MINUTES" in 30\|60/);
assert.match(observeJob, /sleep "\$\(\(MINUTES\*60\)\)"/);
assert.match(observeJob, /readOnly:true/);
assert.match(observeJob, /productionWritten:false/);
assert.doesNotMatch(observeJob, /supabase-migration-v15[23]\.sql/);
assert.doesNotMatch(observeJob, /production-health-check\.mjs/);
assert.doesNotMatch(observeJob, /\/functions\/v1\/|telegram-booking-notify|telegram-client-notify/);

for (const table of [
  'bookings',
  'booking_events',
  'notification_outbox',
  'notification_delivery_attempts',
  'notification_marks',
  'telegram_notification_log',
  'payments',
  'payment_events',
  'payment_provider_attempts',
  'payment_provider_refunds',
  'payment_provider_events',
  'payment_provider_reconciliations',
  'payment_provider_audit_log',
  'integration_provider_events_v144',
  'integration_webhook_outbox_v142',
]) {
  assert.match(counts, new RegExp(`public\\.${table}\\b`));
}
assert.match(counts, /repeatable read read only/);
assert.doesNotMatch(counts, /\b(?:insert|update|delete|truncate|alter|drop|create)\b/i);

assert.match(state, /repeatable read read only/);
assert.match(state, /recover_primetime_booking_request_v1\(uuid,uuid,uuid,uuid,date,time without time zone,text,text\)/);
assert.match(state, /book_minuta_appointment_v2\(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer\)/);
assert.match(state, /minuta_booking_recovery_v152:sha256=/);
assert.match(state, /minuta_atomic_create_v153:sha256=/);
assert.match(state, /when 'v152'[\s\S]*has_function_privilege\('service_role'/);
assert.match(state, /when 'v153'[\s\S]*has_function_privilege\('anon'[\s\S]*has_function_privilege\('authenticated'[\s\S]*not has_function_privilege\('service_role'/);
assert.match(state, /grant_row\.grantee=0 and grant_row\.privilege_type='EXECUTE'/);
assert.match(state, /'partial-or-newer'/);
assert.match(state, /'v152-only-exact'/);
assert.doesNotMatch(state, /\b(?:insert|update|delete|truncate|alter|drop|create)\b/i);

assert.match(contract, /supabase-migration-v152\.sql/);
assert.match(contract, /supabase-migration-v153\.sql/);
assert.match(contract, /booking-recovery-v152-integration\.sql/);
assert.match(contract, /booking-atomic-create-v153-integration\.sql/);
assert.match(contract, /functionName: 'recover_primetime_booking_request_v1'/);
assert.match(contract, /functionName: 'book_minuta_appointment_v2'/);
assert.match(contract, /createHash\('sha256'\)/);
assert.match(contract, /integration is not isolated by rollback/);

console.log('Minuta v152-v153 scoped release static checks passed');
