#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { open, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildStorageManifest,
  loadContract as loadAuthStorageContract,
  validateAuthFixture,
} from './d03-auth-storage-fixture-drill.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultManagedContractPath = resolve(scriptDirectory, '../recovery/d03-managed-recovery-contract.json');
const defaultAuthStorageContractPath = resolve(scriptDirectory, '../recovery/d03-auth-storage-contract.json');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertExactKeys(record, allowed, context) {
  assert(isPlainObject(record), `${context}: ожидается объект`);
  const actual = Object.keys(record).sort();
  const expected = [...allowed].sort();
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    `${context}: набор полей не соответствует контракту`);
}

function assertInteger(value, context) {
  assert(Number.isSafeInteger(value) && value >= 0, `${context}: ожидается неотрицательное целое число`);
}

function parseUtc(value, context) {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value),
    `${context}: ожидается UTC ISO timestamp`);
  const timestamp = Date.parse(value);
  assert(Number.isFinite(timestamp), `${context}: недопустимое время`);
  return timestamp;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function scanForbiddenKeys(value, forbiddenKeys, context = 'journal') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenKeys(item, forbiddenKeys, `${context}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (forbiddenKeys.some((fragment) => normalized.includes(fragment))) {
      fail(`${context}: запрещённый ключ журнала`);
    }
    scanForbiddenKeys(child, forbiddenKeys, `${context}.${key}`);
  }
}

export async function loadManagedContract(contractPath = defaultManagedContractPath) {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  assert(contract.schemaVersion === 1 && contract.scope === 'offline-managed-auth-storage-recovery-preflight',
    'Неподдерживаемый managed D03 contract');
  assert(Array.isArray(contract.forbiddenEnvironment) && contract.forbiddenEnvironment.length > 0,
    'contract.forbiddenEnvironment: ожидается непустой список');
  assert(Array.isArray(contract.target.countKeys) && contract.target.countKeys.length > 0,
    'contract.target.countKeys: ожидается непустой список');
  assertExactKeys(contract.gates, ['plan', 'auth', 'storage', 'cleanup'], 'contract.gates');
  return contract;
}

export function assertOfflineEnvironment(environment, contract) {
  const present = contract.forbiddenEnvironment.filter((name) => String(environment[name] || '').trim());
  if (present.length) fail('Offline preflight запрещает внешние подключения и секреты');
}

export function validateAuthorization(authorization, contract) {
  assertExactKeys(authorization, [
    'schemaVersion',
    'scope',
    'runId',
    'sourceCommitSha',
    'runNonceSha256',
    'expectedTargetProjectRef',
    'productionProjectRef',
    'sharedTestProjectRef',
    'gates',
  ], 'authorization');
  assert(authorization.schemaVersion === 1 && authorization.scope === 'd03-managed-recovery-authorization',
    'authorization: неподдерживаемый формат');
  assert(RUN_ID_PATTERN.test(authorization.runId), 'authorization.runId: недопустимый формат');
  assert(new RegExp(contract.target.commitShaPattern).test(authorization.sourceCommitSha),
    'authorization.sourceCommitSha: ожидается commit SHA');
  assert(SHA256_PATTERN.test(authorization.runNonceSha256), 'authorization.runNonceSha256: ожидается SHA-256');
  const refPattern = new RegExp(contract.target.projectRefPattern);
  for (const key of ['expectedTargetProjectRef', 'productionProjectRef', 'sharedTestProjectRef']) {
    assert(refPattern.test(authorization[key]), `authorization.${key}: недопустимый project ref`);
  }
  assert(authorization.expectedTargetProjectRef !== authorization.productionProjectRef,
    'authorization: recovery target совпадает с production');
  assert(authorization.expectedTargetProjectRef !== authorization.sharedTestProjectRef,
    'authorization: recovery target совпадает с общей тестовой базой');
  assert(authorization.productionProjectRef !== authorization.sharedTestProjectRef,
    'authorization: production и shared test должны различаться');
  assertExactKeys(authorization.gates, ['plan', 'auth', 'storage', 'cleanup'], 'authorization.gates');
  for (const [gate, expected] of Object.entries(contract.gates)) {
    assert(authorization.gates[gate] === expected, `authorization.gates.${gate}: opt-in отсутствует`);
  }
}

function validateCounts(counts, contract, context) {
  assertExactKeys(counts, contract.target.countKeys, context);
  for (const key of contract.target.countKeys) assertInteger(counts[key], `${context}.${key}`);
}

function validateInventory(inventory, authorization, contract) {
  assertExactKeys(inventory, ['mode', 'counts', 'unknownCounts', 'ownedFixtures'], 'targetReport.inventory');
  assert(contract.target.inventoryModes.includes(inventory.mode), 'targetReport.inventory.mode: недопустимый режим');
  validateCounts(inventory.counts, contract, 'targetReport.inventory.counts');
  validateCounts(inventory.unknownCounts, contract, 'targetReport.inventory.unknownCounts');
  assert(Array.isArray(inventory.ownedFixtures), 'targetReport.inventory.ownedFixtures: ожидается массив');
  assert(Object.values(inventory.unknownCounts).every((count) => count === 0),
    'targetReport.inventory: обнаружены неизвестные ресурсы');
  for (const key of contract.target.forbiddenManagedResidue) {
    assert(inventory.counts[key] === 0, `targetReport.inventory.counts.${key}: managed residue запрещён`);
  }

  if (inventory.mode === 'empty') {
    assert(Object.values(inventory.counts).every((count) => count === 0),
      'targetReport.inventory: empty target содержит ресурсы');
    assert(inventory.ownedFixtures.length === 0,
      'targetReport.inventory: empty target не должен содержать fixture inventory');
    return;
  }

  const accounted = Object.fromEntries(contract.target.countKeys.map((key) => [key, 0]));
  const markers = new Set();
  const prefix = `${contract.target.fixturePrefix}${authorization.runId}-`;
  for (const [index, fixture] of inventory.ownedFixtures.entries()) {
    assertExactKeys(fixture, ['kind', 'marker', 'evidenceSha256', 'size'],
      `targetReport.inventory.ownedFixtures[${index}]`);
    const countKey = contract.target.fixtureKinds[fixture.kind];
    assert(Boolean(countKey), `targetReport.inventory.ownedFixtures[${index}].kind: неизвестный тип`);
    assert(typeof fixture.marker === 'string' && fixture.marker.startsWith(prefix),
      `targetReport.inventory.ownedFixtures[${index}].marker: fixture не принадлежит этому запуску`);
    assert(!markers.has(fixture.marker), `targetReport.inventory.ownedFixtures[${index}].marker: дубликат`);
    markers.add(fixture.marker);
    assert(SHA256_PATTERN.test(fixture.evidenceSha256),
      `targetReport.inventory.ownedFixtures[${index}].evidenceSha256: ожидается SHA-256`);
    assertInteger(fixture.size, `targetReport.inventory.ownedFixtures[${index}].size`);
    if (fixture.kind !== 'storage-object') {
      assert(fixture.size === 0, `targetReport.inventory.ownedFixtures[${index}].size: размер разрешён только объекту`);
    }
    accounted[countKey] += 1;
    if (fixture.kind === 'storage-object') accounted.storageBytes += fixture.size;
  }
  for (const key of contract.target.countKeys) {
    assert(inventory.counts[key] === accounted[key],
      `targetReport.inventory.counts.${key}: ресурсы не покрыты fixture allowlist`);
  }
}

export function validateTargetReport(targetReport, authorization, contract, nowUtc = new Date().toISOString()) {
  assertExactKeys(targetReport, [
    'schemaVersion',
    'scope',
    'evidence',
    'observationMode',
    'observedAtUtc',
    'projectRef',
    'connectionIdentityRef',
    'purpose',
    'disposable',
    'activeJobs',
    'guardRows',
    'inventory',
  ], 'targetReport');
  assert(targetReport.schemaVersion === 1 && targetReport.scope === 'd03-managed-target-readonly-preflight',
    'targetReport: неподдерживаемый формат');
  assertExactKeys(targetReport.evidence, [
    'sourceWorkflowRunId',
    'sourceCommitSha',
    'collectorSha256',
    'sqlTransactionReadOnly',
    'authApiReadOnly',
    'storageApiReadOnly',
  ], 'targetReport.evidence');
  assert(new RegExp(contract.target.workflowRunIdPattern).test(targetReport.evidence.sourceWorkflowRunId),
    'targetReport.evidence.sourceWorkflowRunId: недопустимый run ID');
  assert(targetReport.evidence.sourceCommitSha === authorization.sourceCommitSha,
    'targetReport.evidence.sourceCommitSha: отчёт собран другим commit');
  assert(SHA256_PATTERN.test(targetReport.evidence.collectorSha256),
    'targetReport.evidence.collectorSha256: ожидается SHA-256');
  assert(targetReport.evidence.sqlTransactionReadOnly === true &&
    targetReport.evidence.authApiReadOnly === true &&
    targetReport.evidence.storageApiReadOnly === true,
  'targetReport.evidence: не доказан read-only сбор DB/Auth/Storage');
  assert(targetReport.observationMode === contract.target.observationMode,
    'targetReport: допускается только read-only observation');
  assert(targetReport.projectRef === authorization.expectedTargetProjectRef,
    'targetReport: project ref не совпадает с разрешённой целью');
  assert(targetReport.connectionIdentityRef === targetReport.projectRef,
    'targetReport: connection identity не совпадает с целью');
  assert(targetReport.projectRef !== authorization.productionProjectRef,
    'targetReport: production запрещён');
  assert(targetReport.projectRef !== authorization.sharedTestProjectRef,
    'targetReport: shared test запрещён');
  assert(targetReport.purpose === contract.target.purpose && targetReport.disposable === true,
    'targetReport: цель не подтверждена как одноразовая recovery-среда');
  assertInteger(targetReport.activeJobs, 'targetReport.activeJobs');
  assert(targetReport.activeJobs === 0, 'targetReport: обнаружены активные задачи');

  const observed = parseUtc(targetReport.observedAtUtc, 'targetReport.observedAtUtc');
  const now = parseUtc(nowUtc, 'nowUtc');
  const ageSeconds = (now - observed) / 1000;
  assert(ageSeconds >= 0 && ageSeconds <= contract.target.maxObservationAgeSeconds,
    'targetReport: read-only inventory устарел или находится в будущем');

  assert(Array.isArray(targetReport.guardRows) && targetReport.guardRows.length === 1,
    'targetReport.guardRows: требуется ровно один guard');
  const guard = targetReport.guardRows[0];
  assertExactKeys(guard, [
    'projectRef',
    'purpose',
    'runId',
    'runNonceSha256',
    'allowManagedAuthRestore',
    'allowManagedStorageRestore',
    'allowCleanup',
    'expiresAtUtc',
  ], 'targetReport.guardRows[0]');
  assert(guard.projectRef === targetReport.projectRef && guard.purpose === contract.target.purpose,
    'targetReport.guardRows[0]: guard принадлежит другой цели');
  assert(guard.runId === authorization.runId && guard.runNonceSha256 === authorization.runNonceSha256,
    'targetReport.guardRows[0]: guard принадлежит другому запуску');
  assert(guard.allowManagedAuthRestore === true && guard.allowManagedStorageRestore === true && guard.allowCleanup === true,
    'targetReport.guardRows[0]: отдельные разрешения Auth/Storage/cleanup отсутствуют');
  const expires = parseUtc(guard.expiresAtUtc, 'targetReport.guardRows[0].expiresAtUtc');
  assert(expires > now && expires - now <= 24 * 60 * 60 * 1000,
    'targetReport.guardRows[0]: guard истёк или действует более 24 часов');
  validateInventory(targetReport.inventory, authorization, contract);
}

function validateAuthExport(authExport, authStorageContract) {
  assertExactKeys(authExport, ['schemaVersion', 'scope', 'users', 'identities', 'mfaFactors', 'tenantLinks'],
    'authExport');
  assert(authExport.schemaVersion === 1 && authExport.scope === 'd03-managed-auth-allowlist',
    'authExport: неподдерживаемый формат');
  return validateAuthFixture({
    users: authExport.users,
    identities: authExport.identities,
    mfaFactors: authExport.mfaFactors,
    tenantLinks: authExport.tenantLinks,
  }, authStorageContract);
}

async function validateStorageExport(storageExport, objectsRoot, authStorageContract) {
  assertExactKeys(storageExport, ['schemaVersion', 'scope', 'buckets', 'policies', 'objects'], 'storageExport');
  assert(storageExport.schemaVersion === 1 && storageExport.scope === 'd03-managed-storage-allowlist',
    'storageExport: неподдерживаемый формат');
  return buildStorageManifest({
    buckets: storageExport.buckets,
    policies: storageExport.policies,
    objects: storageExport.objects,
  }, objectsRoot, authStorageContract);
}

function buildRedactedJournal({ authorization, targetReport, authCounts, storageManifest, contract, authStorageContract }) {
  const objectEvidence = storageManifest.objects.map(({ size, sha256: digest }) => ({ size, sha256: digest }));
  const journal = {
    schemaVersion: 1,
    operation: 'd03-managed-auth-storage-offline-preflight',
    status: 'ready-for-external-managed-drill',
    runId: authorization.runId,
    sourceCommitSha: authorization.sourceCommitSha,
    targetRefSha256: sha256(targetReport.projectRef),
    targetInventoryMode: targetReport.inventory.mode,
    separateOptInGatesVerified: true,
    guardVerified: true,
    preflightOnly: true,
    restorePerformed: false,
    targetWritten: false,
    productionWritten: false,
    sharedTestWritten: false,
    externalSystemsWritten: false,
    networkAccessUsed: false,
    temporaryPlaintextCreated: false,
    unsafeAuthStateRestored: false,
    externalTargetRecheckRequired: true,
    targetEvidenceVerified: true,
    auth: {
      users: authCounts.users,
      identities: authCounts.identities,
      mfaFactors: authCounts.mfaFactors,
      tenantLinks: authCounts.tenantLinks,
      excludedEntityCount: authStorageContract.auth.excludedEntities.length,
      allowlistVerified: true,
    },
    storage: {
      buckets: storageManifest.buckets.length,
      policies: storageManifest.policies.length,
      objects: storageManifest.objects.length,
      totalBytes: objectEvidence.reduce((sum, item) => sum + item.size, 0),
      contentSetSha256: sha256(canonicalJson(objectEvidence)),
      everyObjectHasSizeAndSha256: objectEvidence.every((item) => Number.isSafeInteger(item.size) && SHA256_PATTERN.test(item.sha256)),
    },
  };
  for (const [key, expected] of Object.entries(contract.journal.requiredSafetyEvidence)) {
    assert(journal[key] === expected, `journal.${key}: отсутствует обязательное доказательство безопасности`);
  }
  scanForbiddenKeys(journal, contract.journal.forbiddenKeys.map((key) => key.toLowerCase()));
  return journal;
}

async function writePrivateExclusive(path, value) {
  let handle;
  let failure;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } catch (error) {
    failure = error;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        failure ||= error;
      }
    }
  }
  if (failure) {
    if (handle) await rm(path, { force: true });
    throw failure;
  }
}

function assertOutputIsolation({
  authorizationPath,
  targetReportPath,
  authExportPath,
  storageExportPath,
  objectsRoot,
  manifestOutputPath,
  journalOutputPath,
}) {
  const inputs = [authorizationPath, targetReportPath, authExportPath, storageExportPath].map((path) => resolve(path));
  const outputs = [manifestOutputPath, journalOutputPath].map((path) => resolve(path));
  assert(outputs[0] !== outputs[1], 'output: manifest и journal должны иметь разные пути');
  assert(outputs.every((path) => !inputs.includes(path)), 'output: нельзя перезаписывать входные файлы');
  const root = resolve(objectsRoot);
  for (const output of outputs) {
    const candidate = relative(root, output);
    assert(candidate && (candidate.startsWith('..') || isAbsolute(candidate)),
      'output: manifest и journal нельзя создавать внутри каталога Storage objects');
  }
}

export async function runManagedRecoveryPreflight({
  authorizationPath,
  targetReportPath,
  authExportPath,
  storageExportPath,
  objectsRoot,
  manifestOutputPath,
  journalOutputPath,
  managedContractPath = defaultManagedContractPath,
  authStorageContractPath = defaultAuthStorageContractPath,
  environment = process.env,
  nowUtc = new Date().toISOString(),
}) {
  const contract = await loadManagedContract(managedContractPath);
  assertOfflineEnvironment(environment, contract);
  assertOutputIsolation({
    authorizationPath,
    targetReportPath,
    authExportPath,
    storageExportPath,
    objectsRoot,
    manifestOutputPath,
    journalOutputPath,
  });
  const authStorageContract = await loadAuthStorageContract(authStorageContractPath);
  const authorization = JSON.parse(await readFile(authorizationPath, 'utf8'));
  const targetReport = JSON.parse(await readFile(targetReportPath, 'utf8'));
  const authExport = JSON.parse(await readFile(authExportPath, 'utf8'));
  const storageExport = JSON.parse(await readFile(storageExportPath, 'utf8'));

  validateAuthorization(authorization, contract);
  validateTargetReport(targetReport, authorization, contract, nowUtc);
  const authCounts = validateAuthExport(authExport, authStorageContract);
  const storageManifest = await validateStorageExport(storageExport, objectsRoot, authStorageContract);
  const manifest = {
    schemaVersion: 1,
    scope: 'd03-managed-storage-content-manifest',
    buckets: storageManifest.buckets,
    policies: storageManifest.policies,
    objects: storageManifest.objects,
  };
  const journal = buildRedactedJournal({
    authorization,
    targetReport,
    authCounts,
    storageManifest,
    contract,
    authStorageContract,
  });

  let manifestWritten = false;
  try {
    await writePrivateExclusive(manifestOutputPath, manifest);
    manifestWritten = true;
    await writePrivateExclusive(journalOutputPath, journal);
  } catch (error) {
    if (manifestWritten) await rm(manifestOutputPath, { force: true });
    throw error;
  }
  return journal;
}

async function main() {
  const [command, authorizationPath, targetReportPath, authExportPath, storageExportPath,
    objectsRoot, manifestOutputPath, journalOutputPath] = process.argv.slice(2);
  if (command !== 'preflight' || !journalOutputPath) {
    console.error('Использование: node d03-managed-recovery-preflight.mjs preflight <authorization.json> <target-report.json> <auth-export.json> <storage-export.json> <objects-root> <storage-manifest.json> <redacted-journal.json>');
    process.exitCode = 2;
    return;
  }
  try {
    const journal = await runManagedRecoveryPreflight({
      authorizationPath,
      targetReportPath,
      authExportPath,
      storageExportPath,
      objectsRoot,
      manifestOutputPath,
      journalOutputPath,
    });
    console.log(JSON.stringify(journal));
  } catch {
    console.error('D03 managed Auth/Storage offline preflight: ОТКАЗ');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
