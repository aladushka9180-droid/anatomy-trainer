import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [source, contractText] = await Promise.all([
  readFile(new URL('../scripts/d03-auth-storage-fixture-drill.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../recovery/d03-auth-storage-contract.json', import.meta.url), 'utf8'),
]);
const contract = JSON.parse(contractText);

assert.equal(contract.schemaVersion, 1);
assert.equal(contract.scope, 'fixture-only-auth-storage-recovery-preparation');
assert.deepEqual(Object.keys(contract.auth.entities), ['users', 'identities', 'mfaFactors', 'tenantLinks']);
assert.ok(contract.auth.excludedEntities.every((entity) =>
  ['sessions', 'refresh_tokens', 'one_time_tokens', 'mfa_challenges', 'flow_state', 'audit_log_entries', 'sso_sessions'].includes(entity)));
assert.ok(['password', 'secret', 'token', 'otp', 'challenge', 'credential'].every((fragment) =>
  contract.auth.forbiddenFieldFragments.includes(fragment)));
assert.deepEqual(contract.auth.verificationIdentity, {
  originalCredentialRestored: false,
  activeSessionRestored: false,
  credentialSource: 'generated-in-isolated-target-only',
  mfaRequiresReenrollment: true,
});
assert.deepEqual(contract.storage.requiredObjectEvidence, ['size', 'sha256']);
assert.deepEqual(contract.journal.requiredSafetyEvidence, {
  fixtureOnly: true,
  restorePerformed: false,
  productionWritten: false,
  externalSystemsWritten: false,
  networkAccessUsed: false,
  temporaryPlaintextCleaned: true,
});

assert.doesNotMatch(source, /\bfetch\s*\(/);
assert.doesNotMatch(source, /from\s+['"](?:node:https|node:http|node:net|node:tls|node:child_process|pg|postgres|@supabase)/);
assert.doesNotMatch(source, /\b(?:createClient|execSync|spawnSync|spawn|execFile)\s*\(/);
assert.match(source, /FORBIDDEN_ENVIRONMENT[\s\S]*SUPABASE_DB_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
assert.match(source, /finally\s*\{[\s\S]*rm\(workspace, \{ recursive: true, force: true \}\)/);
assert.ok(source.indexOf('await rm(workspace') < source.indexOf('await writeFile(outputPath'));
assert.match(source, /productionWritten: false/);
assert.match(source, /externalSystemsWritten: false/);
assert.match(source, /networkAccessUsed: false/);
assert.match(source, /restorePerformed: false/);

console.log('D03 Auth/Storage static contract: PASS');
