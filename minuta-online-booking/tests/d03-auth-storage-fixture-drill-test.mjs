import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertNoExternalAccessEnvironment,
  buildStorageManifest,
  loadContract,
  runFixtureDrill,
  validateAuthFixture,
} from '../scripts/d03-auth-storage-fixture-drill.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureDirectory = resolve(testDirectory, 'fixtures/d03-auth-storage');
const authPath = resolve(fixtureDirectory, 'auth.json');
const storagePath = resolve(fixtureDirectory, 'storage.json');
const objectsRoot = resolve(fixtureDirectory, 'objects');

async function temporaryCase() {
  const root = await mkdtemp(resolve(tmpdir(), 'primetime-d03-test-'));
  return {
    root,
    outputPath: resolve(root, 'journal.json'),
    temporaryRoot: await mkdir(resolve(root, 'temporary'), { recursive: true }).then(() => resolve(root, 'temporary')),
  };
}

test('contract allowlists Auth recovery data and excludes sessions, OTP and secrets', async () => {
  const contract = await loadContract();
  assert.deepEqual(Object.keys(contract.auth.entities), ['users', 'identities', 'mfaFactors', 'tenantLinks']);
  for (const entity of ['sessions', 'refresh_tokens', 'one_time_tokens', 'mfa_challenges', 'flow_state']) {
    assert.ok(contract.auth.excludedEntities.includes(entity));
  }
  for (const fragment of ['password', 'secret', 'token', 'otp', 'challenge', 'credential']) {
    assert.ok(contract.auth.forbiddenFieldFragments.includes(fragment));
  }
  assert.ok(!contract.auth.entities.users.includes('encrypted_password'));
  assert.ok(!contract.auth.entities.mfaFactors.includes('secret'));
  assert.deepEqual(contract.auth.verificationIdentity, {
    originalCredentialRestored: false,
    activeSessionRestored: false,
    credentialSource: 'generated-in-isolated-target-only',
    mfaRequiresReenrollment: true,
  });
});

test('Auth fixture fails closed on an unknown or secret-bearing field', async () => {
  const contract = await loadContract();
  const fixture = JSON.parse(await readFile(authPath, 'utf8'));
  assert.deepEqual(validateAuthFixture(fixture, contract), {
    users: 1,
    identities: 1,
    mfaFactors: 1,
    tenantLinks: 1,
  });
  fixture.users[0].encrypted_password = 'must-never-pass';
  assert.throws(() => validateAuthFixture(fixture, contract), /запрещённые или неизвестные поля/);
  delete fixture.users[0].encrypted_password;
  fixture.users[0].raw_user_meta_data.access_token = 'must-never-pass';
  assert.throws(() => validateAuthFixture(fixture, contract), /поле access_token совпало с запретом token/);
  delete fixture.users[0].raw_user_meta_data.access_token;
  fixture.mfaFactors[0].status = 'verified';
  assert.throws(() => validateAuthFixture(fixture, contract), /разрешён только status=unverified/);
});

test('Storage manifest binds every fixture object to exact size and SHA-256', async () => {
  const contract = await loadContract();
  const fixture = JSON.parse(await readFile(storagePath, 'utf8'));
  const manifest = await buildStorageManifest(fixture, objectsRoot, contract);
  assert.equal(manifest.objects.length, 1);
  assert.ok(manifest.objects[0].size > 0);
  assert.match(manifest.objects[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.objects[0].bucket_id, 'fixture-private');
});

test('Storage manifest rejects traversal, unknown buckets and undeclared metadata', async () => {
  const contract = await loadContract();
  const base = JSON.parse(await readFile(storagePath, 'utf8'));
  const traversal = structuredClone(base);
  traversal.objects[0].relative_path = '../outside.bin';
  await assert.rejects(buildStorageManifest(traversal, objectsRoot, contract), /fixture-каталога/);
  const unknownBucket = structuredClone(base);
  unknownBucket.objects[0].bucket_id = 'missing';
  await assert.rejects(buildStorageManifest(unknownBucket, objectsRoot, contract), /неизвестный bucket/);
  const unknownField = structuredClone(base);
  unknownField.objects[0].access_token = 'must-never-pass';
  await assert.rejects(buildStorageManifest(unknownField, objectsRoot, contract), /запрещённые или неизвестные поля/);
});

test('fixture drill emits only redacted safety evidence and removes plaintext workspace', async () => {
  const state = await temporaryCase();
  try {
    const journal = await runFixtureDrill({
      authPath,
      storagePath,
      objectsRoot,
      outputPath: state.outputPath,
      temporaryRoot: state.temporaryRoot,
      environment: {},
    });
    assert.equal(journal.productionWritten, false);
    assert.equal(journal.externalSystemsWritten, false);
    assert.equal(journal.networkAccessUsed, false);
    assert.equal(journal.restorePerformed, false);
    assert.equal(journal.temporaryPlaintextCleaned, true);
    assert.deepEqual(await readdir(state.temporaryRoot), []);
    const serialized = await readFile(state.outputPath, 'utf8');
    assert.doesNotMatch(serialized, /example\.invalid|synthetic\/example|10000000-|40000000-/);
    assert.match(journal.storage.contentSetSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(state.root, { recursive: true, force: true });
  }
});

test('fixture drill removes plaintext workspace after a validation failure and writes no journal', async () => {
  const state = await temporaryCase();
  const invalidAuthPath = resolve(state.root, 'invalid-auth.json');
  try {
    const fixture = JSON.parse(await readFile(authPath, 'utf8'));
    fixture.users[0].confirmation_token = 'must-never-pass';
    await writeFile(invalidAuthPath, JSON.stringify(fixture));
    await assert.rejects(runFixtureDrill({
      authPath: invalidAuthPath,
      storagePath,
      objectsRoot,
      outputPath: state.outputPath,
      temporaryRoot: state.temporaryRoot,
      environment: {},
    }), /запрещённые или неизвестные поля/);
    assert.deepEqual(await readdir(state.temporaryRoot), []);
    await assert.rejects(readFile(state.outputPath, 'utf8'), /ENOENT/);
  } finally {
    await rm(state.root, { recursive: true, force: true });
  }
});

test('fixture drill refuses credentials and production connection variables', () => {
  for (const name of ['SUPABASE_DB_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MINUTA_PRODUCTION_PROJECT_REF', 'BACKUP_ENCRYPTION_PASSWORD']) {
    assert.throws(() => assertNoExternalAccessEnvironment({ [name]: 'present' }), new RegExp(name));
  }
  assert.doesNotThrow(() => assertNoExternalAccessEnvironment({}));
});
