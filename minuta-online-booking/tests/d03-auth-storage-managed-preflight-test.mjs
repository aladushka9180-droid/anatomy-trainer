#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadManagedContract,
  runManagedRecoveryPreflight,
  validateAuthorization,
  validateTargetReport,
} from '../scripts/d03-managed-recovery-preflight.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(testDirectory, 'fixtures/d03-auth-storage');
const nowUtc = '2026-09-08T20:00:00Z';
const targetRef = 'zzzzzzzzzzzzzzzzzzzz';
const productionRef = 'cawexmmrqjvothcbgjxr';
const sharedTestRef = 'umazhvvxutnsyuphbhda';
const runId = 'd03-run-20260908';
const sourceCommitSha = '1'.repeat(40);
const runNonceSha256 = 'a'.repeat(64);

function clone(value) {
  return structuredClone(value);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function doesNotExist(path) {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

const baseAuth = JSON.parse(await readFile(join(fixtureRoot, 'auth.json'), 'utf8'));
const baseStorage = JSON.parse(await readFile(join(fixtureRoot, 'storage.json'), 'utf8'));
const authorization = {
  schemaVersion: 1,
  scope: 'd03-managed-recovery-authorization',
  runId,
  sourceCommitSha,
  runNonceSha256,
  expectedTargetProjectRef: targetRef,
  productionProjectRef: productionRef,
  sharedTestProjectRef: sharedTestRef,
  gates: {
    plan: 'PREPARE_D03_MANAGED_RECOVERY_PLAN_ONLY',
    auth: 'RESTORE_AUTH_ONLY_DISPOSABLE_D03_TARGET',
    storage: 'RESTORE_STORAGE_ONLY_DISPOSABLE_D03_TARGET',
    cleanup: 'DELETE_ONLY_DISPOSABLE_D03_TARGET',
  },
};
const emptyCounts = {
  businessRows: 0,
  authUsers: 0,
  authIdentities: 0,
  authMfaFactors: 0,
  authSessions: 0,
  authRefreshTokens: 0,
  authOneTimeTokens: 0,
  authMfaChallenges: 0,
  storageBuckets: 0,
  storageObjects: 0,
  storageBytes: 0,
};
const targetReport = {
  schemaVersion: 1,
  scope: 'd03-managed-target-readonly-preflight',
  evidence: {
    sourceWorkflowRunId: '123456789',
    sourceCommitSha,
    collectorSha256: 'f'.repeat(64),
    sqlTransactionReadOnly: true,
    authApiReadOnly: true,
    storageApiReadOnly: true,
  },
  observationMode: 'read-only',
  observedAtUtc: '2026-09-08T19:58:00Z',
  projectRef: targetRef,
  connectionIdentityRef: targetRef,
  purpose: 'disposable-d03-recovery',
  disposable: true,
  activeJobs: 0,
  guardRows: [{
    projectRef: targetRef,
    purpose: 'disposable-d03-recovery',
    runId,
    runNonceSha256,
    allowManagedAuthRestore: true,
    allowManagedStorageRestore: true,
    allowCleanup: true,
    expiresAtUtc: '2026-09-08T21:00:00Z',
  }],
  inventory: {
    mode: 'empty',
    counts: clone(emptyCounts),
    unknownCounts: clone(emptyCounts),
    ownedFixtures: [],
  },
};
const authExport = {
  schemaVersion: 1,
  scope: 'd03-managed-auth-allowlist',
  ...baseAuth,
};
const storageExport = {
  schemaVersion: 1,
  scope: 'd03-managed-storage-allowlist',
  ...baseStorage,
};

const root = await mkdtemp(join(tmpdir(), 'primetime-d03-managed-test-'));
try {
  let sequence = 0;
  async function invoke({
    authorizationValue = authorization,
    targetValue = targetReport,
    authValue = authExport,
    storageValue = storageExport,
    environment = {},
    seedJournal = false,
  } = {}) {
    sequence += 1;
    const prefix = join(root, `case-${sequence}`);
    const authorizationPath = `${prefix}-authorization.json`;
    const targetReportPath = `${prefix}-target.json`;
    const authExportPath = `${prefix}-auth.json`;
    const storageExportPath = `${prefix}-storage.json`;
    const manifestOutputPath = `${prefix}-manifest.json`;
    const journalOutputPath = `${prefix}-journal.json`;
    await Promise.all([
      writeJson(authorizationPath, authorizationValue),
      writeJson(targetReportPath, targetValue),
      writeJson(authExportPath, authValue),
      writeJson(storageExportPath, storageValue),
    ]);
    if (seedJournal) await writeFile(journalOutputPath, 'preserve-me\n', 'utf8');
    const promise = runManagedRecoveryPreflight({
      authorizationPath,
      targetReportPath,
      authExportPath,
      storageExportPath,
      objectsRoot: join(fixtureRoot, 'objects'),
      manifestOutputPath,
      journalOutputPath,
      environment,
      nowUtc,
    });
    return { promise, manifestOutputPath, journalOutputPath };
  }

  const happy = await invoke();
  const journal = await happy.promise;
  const manifest = JSON.parse(await readFile(happy.manifestOutputPath, 'utf8'));
  const journalOnDisk = await readFile(happy.journalOutputPath, 'utf8');
  assert.equal(journal.status, 'ready-for-external-managed-drill');
  assert.equal(journal.restorePerformed, false);
  assert.equal(journal.targetWritten, false);
  assert.equal(journal.productionWritten, false);
  assert.equal(journal.sharedTestWritten, false);
  assert.equal(journal.networkAccessUsed, false);
  assert.equal(journal.targetEvidenceVerified, true);
  assert.equal(journal.auth.users, 1);
  assert.equal(journal.storage.objects, 1);
  assert.equal(manifest.objects.length, 1);
  assert(Number.isSafeInteger(manifest.objects[0].size) && manifest.objects[0].size > 0);
  assert.match(manifest.objects[0].sha256, /^[a-f0-9]{64}$/);
  assert(!journalOnDisk.includes('restore-fixture@example.invalid'));
  assert(!journalOnDisk.includes('10000000-0000-4000-8000-000000000001'));
  assert(!journalOnDisk.includes('synthetic/example.bin'));

  const contract = await loadManagedContract();
  const ownedTarget = clone(targetReport);
  ownedTarget.inventory.mode = 'owned-fixtures-only';
  ownedTarget.inventory.counts.authUsers = 1;
  ownedTarget.inventory.counts.storageBuckets = 1;
  ownedTarget.inventory.counts.storageObjects = 1;
  ownedTarget.inventory.counts.storageBytes = 17;
  ownedTarget.inventory.ownedFixtures = [
    { kind: 'auth-user', marker: `primetime-d03-${runId}-auth-1`, evidenceSha256: 'b'.repeat(64), size: 0 },
    { kind: 'storage-bucket', marker: `primetime-d03-${runId}-bucket-1`, evidenceSha256: 'c'.repeat(64), size: 0 },
    { kind: 'storage-object', marker: `primetime-d03-${runId}-object-1`, evidenceSha256: 'd'.repeat(64), size: 17 },
  ];
  validateAuthorization(authorization, contract);
  validateTargetReport(ownedTarget, authorization, contract, nowUtc);

  async function expectRefusal(options, pattern) {
    const attempt = await invoke(options);
    await assert.rejects(attempt.promise, pattern);
    assert(await doesNotExist(attempt.manifestOutputPath));
    assert(await doesNotExist(attempt.journalOutputPath));
  }

  const productionAuthorization = clone(authorization);
  productionAuthorization.expectedTargetProjectRef = productionRef;
  await expectRefusal({ authorizationValue: productionAuthorization }, /совпадает с production/);

  const sharedAuthorization = clone(authorization);
  sharedAuthorization.expectedTargetProjectRef = sharedTestRef;
  await expectRefusal({ authorizationValue: sharedAuthorization }, /совпадает с общей тестовой базой/);

  const missingAuthGate = clone(authorization);
  missingAuthGate.gates.auth = '';
  await expectRefusal({ authorizationValue: missingAuthGate }, /opt-in отсутствует/);

  const noGuard = clone(targetReport);
  noGuard.guardRows = [];
  await expectRefusal({ targetValue: noGuard }, /требуется ровно один guard/);

  const writableCollector = clone(targetReport);
  writableCollector.evidence.storageApiReadOnly = false;
  await expectRefusal({ targetValue: writableCollector }, /не доказан read-only сбор/);

  const expiredGuard = clone(targetReport);
  expiredGuard.guardRows[0].expiresAtUtc = '2026-09-08T19:59:00Z';
  await expectRefusal({ targetValue: expiredGuard }, /guard истёк/);

  const unknownTarget = clone(targetReport);
  unknownTarget.inventory.counts.authUsers = 1;
  unknownTarget.inventory.unknownCounts.authUsers = 1;
  await expectRefusal({ targetValue: unknownTarget }, /обнаружены неизвестные ресурсы/);

  const activeSessionTarget = clone(targetReport);
  activeSessionTarget.inventory.counts.authSessions = 1;
  await expectRefusal({ targetValue: activeSessionTarget }, /managed residue запрещён/);

  const forbiddenAuthField = clone(authExport);
  forbiddenAuthField.users[0].encrypted_password = 'never-copy-this';
  await expectRefusal({ authValue: forbiddenAuthField }, /набор полей не соответствует контракту|запрещённые или неизвестные поля/);

  const forbiddenNestedAuthField = clone(authExport);
  forbiddenNestedAuthField.users[0].raw_user_meta_data.api_token = 'never-copy-this';
  await expectRefusal({ authValue: forbiddenNestedAuthField }, /совпало с запретом token/);

  const sessionExport = clone(authExport);
  sessionExport.sessions = [];
  await expectRefusal({ authValue: sessionExport }, /набор полей не соответствует контракту/);

  const unsafeStoragePath = clone(storageExport);
  unsafeStoragePath.objects[0].relative_path = '../outside.bin';
  await expectRefusal({ storageValue: unsafeStoragePath }, /путь должен оставаться внутри fixture-каталога/);

  await expectRefusal({ environment: { SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' } }, /запрещает внешние подключения и секреты/);

  const existingOutput = await invoke({ seedJournal: true });
  await assert.rejects(existingOutput.promise, /EEXIST/);
  assert(await doesNotExist(existingOutput.manifestOutputPath));
  assert.equal(await readFile(existingOutput.journalOutputPath, 'utf8'), 'preserve-me\n');

  console.log('D03 managed Auth/Storage offline preflight tests: OK');
} finally {
  await rm(root, { recursive: true, force: true });
}
