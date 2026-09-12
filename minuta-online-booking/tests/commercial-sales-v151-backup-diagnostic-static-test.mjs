import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const workflow = read('../../.github/workflows/minuta-commercial-sales-v151-backup-diagnostic.yml');
const shell = read('../scripts/commercial-sales-v151-backup-diagnostic.sh');
const sql = read('../scripts/commercial-sales-v151-backup-diagnostic.sql');

for (const token of [
  'workflow_dispatch:',
  'SOURCE_BACKUP_RUN_ID: "34711919645"',
  'SOURCE_BACKUP_ARTIFACT_ID: "10303133907"',
  'SOURCE_BACKUP_ARTIFACT_NAME: minuta-2026-09-12T18-41-16Z',
  'SOURCE_BACKUP_HEAD_SHA: ed90edcfb79e16eb0eb6d31dc1b89f8a95ef6f4b',
  "'.github/workflows/minuta-supabase-backup.yml'",
  'actions: read',
  'contents: read',
  'BACKUP_ENCRYPTION_PASSWORD',
  'commercial-sales-v151-backup-diagnostic.sh',
  'if: always()',
]) assert.ok(workflow.includes(token), `workflow missing ${token}`);

assert.doesNotMatch(workflow, /SUPABASE_DB_URL|MINUTA_RESTORE_TEST_DB_URL/);
assert.match(workflow, /test "\$\(jq '\[\.artifacts\[\] \| select\(\.expired==false\)\] \| length'/);
assert.match(workflow, /\.sourceBackupArtifactId:\$artifactId|sourceBackupArtifactId:\$artifactId/);
assert.match(workflow, /find "\$RUNNER_TEMP\/encrypted-source" -type f -delete/);

for (const token of [
  '--network none',
  '--no-owner --no-privileges',
  'for section in pre-data post-data',
  'for phase in pre-data auth-placeholders post-data',
  'commercial-sales-v151-backup-diagnostic.sql',
  'ephemeralContainerDestroyed:true',
  'productionWritten:false',
  'testDatabaseWritten:false',
]) assert.ok(shell.includes(token), `shell missing ${token}`);

assert.doesNotMatch(shell, /--section="data"|load-data|\/tmp\/data\.sql/);
assert.doesNotMatch(shell, /select count\(\*\) from public\.(services|bookings)/i);

for (const token of [
  "'catalogOnly',true",
  "'tableDataRestored',false",
  "'rowsRead',false",
  "'aclVerifiable',false",
  "'ownerVerifiable',false",
  "'referenceMayBeUsedAsProductionExpected',false",
  "'ddlMatchesRealTestComponents'",
  "'ddlComponentFingerprints'",
  "'ddlContract'",
]) assert.ok(sql.includes(token), `SQL missing ${token}`);

assert.doesNotMatch(sql, /select\s+\*\s+from/i);
assert.doesNotMatch(sql, /from\s+public\.(services|bookings|clients)\b/i);

console.log('commercial sales v151 backup diagnostic static test passed');
