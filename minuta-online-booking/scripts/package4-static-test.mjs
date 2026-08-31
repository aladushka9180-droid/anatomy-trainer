#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [backup, restore, operations, recovery, guard] = await Promise.all([
  readFile(new URL('../../.github/workflows/minuta-supabase-backup.yml', import.meta.url), 'utf8'),
  readFile(new URL('../../.github/workflows/minuta-supabase-restore-drill.yml', import.meta.url), 'utf8'),
  readFile(new URL('../OPERATIONS.md', import.meta.url), 'utf8'),
  readFile(new URL('../RECOVERY.md', import.meta.url), 'utf8'),
  readFile(new URL('./backup-config-guard.mjs', import.meta.url), 'utf8'),
]);

assert.match(backup, /cron: ["']17 0 \* \* \*["']/);
assert.match(backup, /object-lock-mode COMPLIANCE/);
assert.match(backup, /head-object/);
assert.match(backup, /write-backup-journal\.mjs backup/);
assert.match(backup, /retention-days: 35/);
assert.match(backup, /MINUTA_BACKUP_S3_ENDPOINT/);
assert.ok(backup.indexOf('secrets.') > backup.indexOf('steps:'), 'Секреты backup не должны быть доступны всему job');
assert.doesNotMatch(backup, /actions\/(?:checkout|upload-artifact)@v\d/);

assert.match(restore, /cron: ["']43 2 1 \* \*["']/);
assert.match(restore, /backup-config-guard\.mjs restore/);
assert.match(restore, /minuta_restore_guard\.target/);
assert.ok(restore.indexOf('minuta_restore_guard.target') < restore.indexOf('--clean'),
  'Маркер тестовой базы должен проверяться до destructive restore');
assert.match(restore, /MINUTA_RESTORE_CONFIRM/);
assert.match(restore, /restore-journal/);
assert.ok(restore.indexOf('secrets.') > restore.indexOf('steps:'), 'Секреты restore не должны быть доступны всему job');
assert.doesNotMatch(restore, /actions\/(?:checkout|upload-artifact)@v\d/);

assert.match(guard, /retentionDays >= 30/);
assert.match(guard, /productionIdentity !== restoreIdentity/);
assert.match(guard, /RESTORE_ONLY_ISOLATED_TEST_DATABASE/);
assert.match(operations, /Object Lock/);
assert.match(recovery, /RPO: не более 24 часов/);
assert.match(recovery, /RTO: до 4 часов/);

console.log('Пакет 4: статические проверки пройдены.');
