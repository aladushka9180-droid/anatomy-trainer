#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';

const type = process.argv[2];
const output = process.argv[3];

if (!['backup', 'restore'].includes(type) || !output) {
  console.error('Использование: node write-backup-journal.mjs <backup|restore> <output.json>');
  process.exit(2);
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Не задан ${name}`);
  return value;
}

const common = {
  schemaVersion: 1,
  operation: type,
  status: 'success',
  completedAtUtc: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY || 'local',
  workflowRunId: process.env.GITHUB_RUN_ID || 'local',
  workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT || '1',
  workflowRunUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
};

let record;
if (type === 'backup') {
  const sha256 = required('MINUTA_LOG_SHA256');
  const encryptedBytes = Number(required('MINUTA_LOG_BYTES'));
  const archiveEntries = Number(required('MINUTA_LOG_ARCHIVE_ENTRIES'));
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('MINUTA_LOG_SHA256 имеет недопустимый формат');
  if (!Number.isSafeInteger(encryptedBytes) || encryptedBytes <= 0) throw new Error('MINUTA_LOG_BYTES должен быть положительным целым числом');
  if (!Number.isSafeInteger(archiveEntries) || archiveEntries <= 0) throw new Error('MINUTA_LOG_ARCHIVE_ENTRIES должен быть положительным целым числом');
  record = {
    ...common,
    backupName: required('MINUTA_LOG_BACKUP_NAME'),
    objectKey: required('MINUTA_LOG_OBJECT_KEY'),
    encryptedSha256: sha256,
    encryptedBytes,
    archiveEntries,
    retentionUntilUtc: required('MINUTA_LOG_RETENTION_UNTIL'),
    encryption: 'OpenPGP symmetric AES-256',
    archiveFormat: 'PostgreSQL custom',
  };
} else {
  const sha256 = required('MINUTA_LOG_SHA256');
  const services = Number(required('MINUTA_LOG_SERVICES'));
  const bookings = Number(required('MINUTA_LOG_BOOKINGS'));
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('MINUTA_LOG_SHA256 имеет недопустимый формат');
  if (!Number.isSafeInteger(services) || services <= 0) throw new Error('MINUTA_LOG_SERVICES должен быть положительным целым числом');
  if (!Number.isSafeInteger(bookings) || bookings < 0) throw new Error('MINUTA_LOG_BOOKINGS должен быть неотрицательным целым числом');
  record = {
    ...common,
    sourceObjectKey: required('MINUTA_LOG_OBJECT_KEY'),
    sourceEncryptedSha256: sha256,
    restoredProjectRef: required('MINUTA_RESTORE_TEST_PROJECT_REF'),
    validation: {
      services,
      bookings,
      requiredTablesPresent: true,
    },
  };
}

await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
console.log(`Журнал ${type} создан: ${output}`);
