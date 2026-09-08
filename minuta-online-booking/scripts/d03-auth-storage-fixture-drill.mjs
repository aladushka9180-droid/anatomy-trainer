#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultContractPath = resolve(scriptDirectory, '../recovery/d03-auth-storage-contract.json');
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FORBIDDEN_ENVIRONMENT = [
  'SUPABASE_DB_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MINUTA_PRODUCTION_PROJECT_REF',
  'MINUTA_RESTORE_TEST_DB_URL',
  'MINUTA_BACKUP_S3_ACCESS_KEY_ID',
  'MINUTA_BACKUP_S3_SECRET_ACCESS_KEY',
  'BACKUP_ENCRYPTION_PASSWORD',
];

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(record, allowed, context) {
  if (!isPlainObject(record)) fail(`${context}: ожидается объект`);
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key));
  if (unknown.length) fail(`${context}: запрещённые или неизвестные поля: ${unknown.join(', ')}`);
}

function assertNonEmptyString(value, context) {
  if (typeof value !== 'string' || !value.trim()) fail(`${context}: ожидается непустая строка`);
}

function assertNoForbiddenFields(fields, fragments, context) {
  for (const field of fields) {
    const normalized = field.toLowerCase();
    const fragment = fragments.find((item) => normalized.includes(item.toLowerCase()));
    if (fragment) fail(`${context}: поле ${field} совпало с запретом ${fragment}`);
  }
}

function assertNoForbiddenNestedKeys(value, fragments, context) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenNestedKeys(item, fragments, `${context}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  assertNoForbiddenFields(Object.keys(value), fragments, context);
  for (const [key, child] of Object.entries(value)) {
    assertNoForbiddenNestedKeys(child, fragments, `${context}.${key}`);
  }
}

export function assertNoExternalAccessEnvironment(environment = process.env) {
  const present = FORBIDDEN_ENVIRONMENT.filter((name) => String(environment[name] || '').trim());
  if (present.length) {
    fail(`Fixture-drill запрещает production, внешние подключения и секреты: ${present.join(', ')}`);
  }
}

export async function loadContract(contractPath = defaultContractPath) {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  if (contract.schemaVersion !== 1 || contract.scope !== 'fixture-only-auth-storage-recovery-preparation') {
    fail('Неподдерживаемый D03 contract');
  }
  const authEntityNames = ['users', 'identities', 'mfaFactors', 'tenantLinks'];
  assertExactKeys(contract.auth.entities, authEntityNames, 'contract.auth.entities');
  for (const entity of authEntityNames) {
    const fields = contract.auth.entities[entity];
    if (!Array.isArray(fields) || !fields.length || fields.some((field) => typeof field !== 'string')) {
      fail(`contract.auth.entities.${entity}: allowlist должен быть непустым`);
    }
    assertNoForbiddenFields(fields, contract.auth.forbiddenFieldFragments, `contract.auth.entities.${entity}`);
  }
  const mandatoryExcluded = ['sessions', 'refresh_tokens', 'one_time_tokens', 'mfa_challenges', 'flow_state'];
  for (const entity of mandatoryExcluded) {
    if (!contract.auth.excludedEntities.includes(entity)) fail(`contract.auth.excludedEntities: отсутствует ${entity}`);
  }
  for (const fragment of ['password', 'secret', 'token', 'otp', 'challenge', 'credential']) {
    if (!contract.auth.forbiddenFieldFragments.includes(fragment)) {
      fail(`contract.auth.forbiddenFieldFragments: отсутствует ${fragment}`);
    }
  }
  const verification = contract.auth.verificationIdentity;
  assertExactKeys(verification, [
    'originalCredentialRestored',
    'activeSessionRestored',
    'credentialSource',
    'mfaRequiresReenrollment',
  ], 'contract.auth.verificationIdentity');
  if (verification.originalCredentialRestored !== false ||
      verification.activeSessionRestored !== false ||
      verification.credentialSource !== 'generated-in-isolated-target-only' ||
      verification.mfaRequiresReenrollment !== true) {
    fail('contract.auth.verificationIdentity: небезопасная стратегия тестового входа');
  }
  assertExactKeys(contract.storage.entities, ['buckets', 'policies', 'objects'], 'contract.storage.entities');
  for (const entity of ['buckets', 'policies', 'objects']) {
    if (!Array.isArray(contract.storage.entities[entity]) || !contract.storage.entities[entity].length) {
      fail(`contract.storage.entities.${entity}: allowlist должен быть непустым`);
    }
  }
  for (const evidence of ['size', 'sha256']) {
    if (!contract.storage.requiredObjectEvidence.includes(evidence)) {
      fail(`contract.storage.requiredObjectEvidence: отсутствует ${evidence}`);
    }
  }
  return contract;
}

export function validateAuthFixture(authFixture, contract) {
  assertExactKeys(authFixture, Object.keys(contract.auth.entities), 'auth fixture');
  const counts = {};
  for (const [entity, fields] of Object.entries(contract.auth.entities)) {
    const rows = authFixture[entity];
    if (!Array.isArray(rows)) fail(`auth.${entity}: ожидается массив`);
    rows.forEach((row, index) => {
      assertExactKeys(row, fields, `auth.${entity}[${index}]`);
      assertNoForbiddenNestedKeys(row, contract.auth.forbiddenFieldFragments, `auth.${entity}[${index}]`);
      for (const key of Object.keys(row)) {
        if (row[key] === undefined) fail(`auth.${entity}[${index}].${key}: undefined запрещён`);
      }
    });
    counts[entity] = rows.length;
  }
  const userIds = new Set(authFixture.users.map((user, index) => {
    assertNonEmptyString(user.id, `auth.users[${index}].id`);
    return user.id;
  }));
  if (userIds.size !== authFixture.users.length) fail('auth.users: id должны быть уникальны');
  for (const entity of ['identities', 'mfaFactors', 'tenantLinks']) {
    authFixture[entity].forEach((row, index) => {
      if (!userIds.has(row.user_id)) fail(`auth.${entity}[${index}]: user_id не найден в users`);
    });
  }
  authFixture.mfaFactors.forEach((factor, index) => {
    if (factor.status !== 'unverified') {
      fail(`auth.mfaFactors[${index}]: без секрета разрешён только status=unverified`);
    }
  });
  return counts;
}

function assertSafeRelativePath(path, context) {
  assertNonEmptyString(path, context);
  if (isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) {
    fail(`${context}: путь должен оставаться внутри fixture-каталога`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hashFile(filePath) {
  const bytes = await readFile(filePath);
  return {
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function buildStorageManifest(storageFixture, objectsRoot, contract) {
  assertExactKeys(storageFixture, Object.keys(contract.storage.entities), 'storage fixture');
  const buckets = storageFixture.buckets;
  const policies = storageFixture.policies;
  const objects = storageFixture.objects;
  if (!Array.isArray(buckets) || !Array.isArray(policies) || !Array.isArray(objects)) {
    fail('storage fixture: buckets, policies и objects должны быть массивами');
  }
  buckets.forEach((row, index) => assertExactKeys(row, contract.storage.entities.buckets, `storage.buckets[${index}]`));
  policies.forEach((row, index) => assertExactKeys(row, contract.storage.entities.policies, `storage.policies[${index}]`));
  const bucketIds = new Set(buckets.map((bucket, index) => {
    assertNonEmptyString(bucket.id, `storage.buckets[${index}].id`);
    return bucket.id;
  }));
  if (bucketIds.size !== buckets.length) fail('storage.buckets: id должны быть уникальны');

  const root = await realpath(objectsRoot);
  const entries = [];
  const seen = new Set();
  for (const [index, object] of objects.entries()) {
    assertExactKeys(object, contract.storage.entities.objects, `storage.objects[${index}]`);
    assertNonEmptyString(object.bucket_id, `storage.objects[${index}].bucket_id`);
    assertNonEmptyString(object.name, `storage.objects[${index}].name`);
    assertSafeRelativePath(object.name, `storage.objects[${index}].name`);
    assertSafeRelativePath(object.relative_path, `storage.objects[${index}].relative_path`);
    if (!bucketIds.has(object.bucket_id)) fail(`storage.objects[${index}]: неизвестный bucket ${object.bucket_id}`);
    const identity = `${object.bucket_id}\n${object.name}`;
    if (seen.has(identity)) fail(`storage.objects[${index}]: дублирующийся объект`);
    seen.add(identity);

    const candidate = resolve(root, ...object.relative_path.split('/'));
    const relativeCandidate = relative(root, candidate);
    if (!relativeCandidate || relativeCandidate.startsWith('..') || isAbsolute(relativeCandidate)) {
      fail(`storage.objects[${index}]: путь выходит за fixture-каталог`);
    }
    const linkState = await lstat(candidate);
    if (linkState.isSymbolicLink() || !linkState.isFile()) fail(`storage.objects[${index}]: ожидается обычный файл`);
    const resolvedFile = await realpath(candidate);
    const resolvedRelative = relative(root, resolvedFile);
    if (resolvedRelative.startsWith('..') || isAbsolute(resolvedRelative)) {
      fail(`storage.objects[${index}]: разрешённый путь выходит за fixture-каталог`);
    }
    const evidence = await hashFile(resolvedFile);
    entries.push({
      bucket_id: object.bucket_id,
      name: object.name,
      relative_path: object.relative_path,
      mime_type: object.mime_type,
      size: evidence.size,
      sha256: evidence.sha256,
    });
  }
  return {
    schemaVersion: 1,
    buckets,
    policies,
    objects: entries,
  };
}

function scanForbiddenJournalKeys(value, forbiddenKeys, path = 'journal') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForbiddenJournalKeys(item, forbiddenKeys, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.includes(key.toLowerCase())) fail(`${path}.${key}: персональный идентификатор запрещён в журнале`);
    scanForbiddenJournalKeys(child, forbiddenKeys, `${path}.${key}`);
  }
}

export function buildRedactedJournal(authCounts, storageManifest, contract) {
  const objectEvidence = storageManifest.objects.map(({ size, sha256 }) => ({ size, sha256 }));
  for (const [index, evidence] of objectEvidence.entries()) {
    if (!Number.isSafeInteger(evidence.size) || evidence.size < 0 || !SHA256_PATTERN.test(evidence.sha256)) {
      fail(`storage.objects[${index}]: отсутствуют корректные size/SHA-256`);
    }
  }
  const journal = {
    schemaVersion: 1,
    operation: 'd03-auth-storage-fixture-contract',
    status: 'success',
    fixtureOnly: true,
    restorePerformed: false,
    isolatedTargetRequired: true,
    productionWritten: false,
    externalSystemsWritten: false,
    networkAccessUsed: false,
    temporaryPlaintextCleaned: true,
    auth: {
      users: authCounts.users,
      identities: authCounts.identities,
      mfaFactors: authCounts.mfaFactors,
      tenantLinks: authCounts.tenantLinks,
      excludedEntityCount: contract.auth.excludedEntities.length,
    },
    storage: {
      buckets: storageManifest.buckets.length,
      policies: storageManifest.policies.length,
      objects: storageManifest.objects.length,
      totalBytes: objectEvidence.reduce((sum, object) => sum + object.size, 0),
      contentSetSha256: createHash('sha256').update(canonicalJson(objectEvidence)).digest('hex'),
    },
  };
  for (const [key, expected] of Object.entries(contract.journal.requiredSafetyEvidence)) {
    if (journal[key] !== expected) fail(`journal.${key}: обязательное доказательство безопасности отсутствует`);
  }
  scanForbiddenJournalKeys(journal, contract.journal.forbiddenKeys.map((key) => key.toLowerCase()));
  return journal;
}

export async function runFixtureDrill({
  authPath,
  storagePath,
  objectsRoot,
  outputPath,
  contractPath = defaultContractPath,
  temporaryRoot = tmpdir(),
  environment = process.env,
}) {
  assertNoExternalAccessEnvironment(environment);
  const contract = await loadContract(contractPath);
  const workspace = await mkdtemp(join(temporaryRoot, 'primetime-d03-'));
  let journal;
  try {
    const authFixture = JSON.parse(await readFile(authPath, 'utf8'));
    const storageFixture = JSON.parse(await readFile(storagePath, 'utf8'));
    const authCounts = validateAuthFixture(authFixture, contract);
    const manifest = await buildStorageManifest(storageFixture, objectsRoot, contract);
    await writeFile(join(workspace, 'storage-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    journal = buildRedactedJournal(authCounts, manifest, contract);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
  await writeFile(outputPath, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  return journal;
}

async function main() {
  const [command, authPath, storagePath, objectsRoot, outputPath] = process.argv.slice(2);
  if (command !== 'fixture-drill' || !authPath || !storagePath || !objectsRoot || !outputPath) {
    console.error('Использование: node d03-auth-storage-fixture-drill.mjs fixture-drill <auth.json> <storage.json> <objects-root> <journal.json>');
    process.exitCode = 2;
    return;
  }
  const journal = await runFixtureDrill({ authPath, storagePath, objectsRoot, outputPath });
  console.log(JSON.stringify(journal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
