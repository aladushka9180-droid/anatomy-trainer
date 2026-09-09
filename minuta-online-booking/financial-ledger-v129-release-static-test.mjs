import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/minuta-v129-safe-release.yml',import.meta.url),'utf8');

assert.match(workflow,/options: \[audit-production-v129, apply-production-v129, observe-production-v129\]/);
assert.match(workflow,/test "\$GITHUB_SHA" = "\$SHA"/);
assert.match(workflow,/git\/ref\/heads\/main/);
assert.match(workflow,/concurrency: \{ group: minuta-production-database, cancel-in-progress: false \}/);
assert.match(workflow,/default_transaction_read_only=on/);
assert.match(workflow,/production-db-schema-guard\.sh/);
assert.match(workflow,/v129Mode=="absent" or \.v129Mode=="full"/);
assert.match(workflow,/check_run "\$TEST" \.github\/workflows\/minuta-d06-financial-integration\.yml/);
assert.match(workflow,/v129-test-\$TEST/);
assert.match(workflow,/\.isolatedDatabase==true and \.productionWritten==false/);
assert.match(workflow,/\.name=="pglite" and \.conclusion=="success"/);
assert.match(workflow,/\.name=="financial_integration" and \.conclusion=="success"/);
assert.match(workflow,/check_run "\$BACKUP" \.github\/workflows\/minuta-supabase-backup\.yml/);
assert.match(workflow,/check_run "\$RESTORE" \.github\/workflows\/minuta-supabase-restore-drill\.yml/);
assert.match(workflow,/\.sourceBackupRunId==\$backup and \.sourceBackupSha==\$sha/);
assert.match(workflow,/test "\$age" -ge 0 && test "\$age" -le 7200/);
assert.match(workflow,/encryption=="OpenPGP symmetric AES-256"/);
assert.match(workflow,/confirmation:[\s\S]*BACKUP_VERIFIED/);
assert.match(workflow,/psql "\$db"[\s\S]*supabase-migration-v129\.sql/);
assert.match(workflow,/\.ledgerTriggers and \(\.financeEnabled\|not\)/);
assert.match(workflow,/financeActivated:false,financialRowsCreated:false/);
assert.match(workflow,/recoveredFromCommittedFull:\$recovered/);
assert.match(workflow,/observe-production-v129:/);
assert.match(workflow,/\.after\.settingsRows==0/);

console.log('financial ledger v129 safe release contract: OK');
