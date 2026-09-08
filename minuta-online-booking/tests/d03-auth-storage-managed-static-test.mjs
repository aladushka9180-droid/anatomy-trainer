#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, contractText] = await Promise.all([
  readFile(new URL('../scripts/d03-managed-recovery-preflight.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../recovery/d03-managed-recovery-contract.json', import.meta.url), 'utf8'),
]);
const contract = JSON.parse(contractText);

assert.equal(contract.scope, 'offline-managed-auth-storage-recovery-preflight');
assert.equal(contract.target.purpose, 'disposable-d03-recovery');
assert(contract.target.forbiddenManagedResidue.includes('authSessions'));
assert(contract.target.forbiddenManagedResidue.includes('authRefreshTokens'));
assert(contract.target.forbiddenManagedResidue.includes('authOneTimeTokens'));
assert(contract.target.forbiddenManagedResidue.includes('authMfaChallenges'));
assert.equal(contract.gates.auth, 'RESTORE_AUTH_ONLY_DISPOSABLE_D03_TARGET');
assert.equal(contract.gates.storage, 'RESTORE_STORAGE_ONLY_DISPOSABLE_D03_TARGET');
assert.equal(contract.gates.cleanup, 'DELETE_ONLY_DISPOSABLE_D03_TARGET');
assert.equal(contract.journal.requiredSafetyEvidence.productionWritten, false);
assert.equal(contract.journal.requiredSafetyEvidence.sharedTestWritten, false);
assert.equal(contract.journal.requiredSafetyEvidence.networkAccessUsed, false);
assert.equal(contract.journal.requiredSafetyEvidence.externalTargetRecheckRequired, true);
assert.equal(contract.journal.requiredSafetyEvidence.targetEvidenceVerified, true);
assert(contract.forbiddenEnvironment.includes('SUPABASE_SERVICE_ROLE_KEY'));
assert(contract.forbiddenEnvironment.includes('SUPABASE_ACCESS_TOKEN'));
assert(contract.forbiddenEnvironment.includes('MINUTA_TEST_DATABASE_URL'));

for (const forbidden of [
  /\bfetch\s*\(/,
  /from\s+['"]node:(?:http|https|net|tls|dns|child_process)['"]/,
  /\b(?:exec|spawn|fork)\s*\(/,
  /pg_restore|psql|supabase\s+functions/i,
]) {
  assert(!forbidden.test(source), `Managed preflight must remain offline-only: ${forbidden}`);
}
assert.match(source, /open\(path, ['"]wx['"]/);
assert.match(source, /buildStorageManifest/);
assert.match(source, /validateAuthFixture/);
assert.match(source, /restorePerformed:\s*false/);
assert.match(source, /productionWritten:\s*false/);
assert.match(source, /offline preflight: ОТКАЗ/);

console.log('D03 managed Auth/Storage static safety checks: OK');
