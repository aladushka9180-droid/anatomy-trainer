// Offline source-contract tests. Do not run the shell script or contact any DB/API.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8').replaceAll('\r', '');
const shell = read('crm-test-restore.sh');
const workflow = read('../../.github/workflows/minuta-crm-test-restore.yml');
const preflight = read('crm-test-restore-preflight.sql');
const phase = (name) => {
  const marker = `\nphase=${name}\n`;
  const start = shell.indexOf(marker);
  assert.ok(start >= 0, `Missing phase ${name}`);
  const next = shell.indexOf('\nphase=', start + marker.length);
  return shell.slice(start, next < 0 ? undefined : next);
};

test('workflow defaults to validate and exposes only test credentials', () => {
  assert.match(workflow, /options: \[validate, restore\]\s+default: validate/);
  assert.match(workflow, /environment: minuta-test/);
  assert.match(workflow, /group: minuta-test-database\s+cancel-in-progress: false/);
  assert.match(workflow, /VALIDATION_RUN_ID: \$\{\{ inputs\.validation_run_id \}\}/);
  const secretNames = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(secretNames, ['BACKUP_ENCRYPTION_PASSWORD', 'MINUTA_TEST_DATABASE_URL']);
  assert.doesNotMatch(shell + workflow, /cawexmmrqjvothcbgjxr|SUPABASE_SERVICE_ROLE_KEY|MINUTA_PRODUCTION_DATABASE_URL/);
  assert.match(shell, /unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGAPPNAME PGPASSFILE/);
  assert.match(shell, /PGDATABASE=postgres PGPORT=5432 PGSSLMODE=require/);
});

test('actual URL guard rejects production, impostor hosts, options and database names', () => {
  const guard = phase('exact-test-url-guard');
  const source = guard.slice(guard.indexOf("<<'JS'\n") + 7, guard.lastIndexOf('\nJS'))
    .replace(/^import .*;\n/gm, '');
  assert.ok(source.includes("new URL(process.env.MINUTA_TEST_DATABASE_URL)"));
  const run = (url) => {
    const writes = [];
    vm.runInNewContext(source, {
      assert, URL, process: { env: { MINUTA_TEST_DATABASE_URL: url, CRM_RESTORE_PRIVATE_DIR: '/synthetic' } },
      writeFileSync: (...args) => writes.push(args),
    }, { timeout: 1000 });
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], '/synthetic/connection.json');
    assert.equal(writes[0][2].mode, 0o600);
    return JSON.parse(writes[0][1]);
  };
  const ref = 'umazhvvxutnsyuphbhda';
  assert.equal(run(`postgresql://postgres:fake@db.${ref}.supabase.co/postgres`).port, '5432');
  assert.equal(run(`postgres://postgres.${ref}:fake@aws-0-eu.pooler.supabase.com:6543/postgres?sslmode=require`).port, '5432');
  for (const url of [
    'postgresql://postgres:fake@db.cawexmmrqjvothcbgjxr.supabase.co/postgres',
    'postgres://postgres.cawexmmrqjvothcbgjxr:fake@aws-0-eu.pooler.supabase.com/postgres',
    `postgres://postgres:fake@db.${ref}.supabase.co.attacker.example/postgres`,
    `postgres://postgres.${ref}:fake@pooler.supabase.com.attacker.example/postgres`,
    `postgres://postgres:fake@db.${ref}.supabase.co/other`,
    `postgres://postgres:fake@db.${ref}.supabase.co/postgres?host=other`,
    `postgres://postgres:fake@db.${ref}.supabase.co/postgres?sslmode=disable`,
    `postgres://postgres:fake@db.${ref}.supabase.co:5433/postgres`,
  ]) assert.throws(() => run(url), 'Unsafe synthetic connection must be rejected');
});

test('validate exits before every mutating phase and only reads target metadata', () => {
  const block = phase('offline-target-sql-validation');
  assert.match(block, /if \[\[ "\$RESTORE_MODE" == validate \]\]; then[\s\S]*\n  exit 0\nfi/);
  const exitPosition = shell.indexOf('\n  exit 0\nfi', shell.indexOf('phase=offline-target-sql-validation'));
  for (const name of ['prior-read-only-validation-certificate', 'test-only-quiesce', 'test-only-atomic-restore']) {
    assert.ok(shell.indexOf(`phase=${name}`) > exitPosition);
  }
  const beforeExit = shell.slice(0, exitPosition);
  assert.doesNotMatch(beforeExit, /-f "[^"\n]*(?:quiesce|before|after)\.sql"|--single-transaction/);
  assert.equal((beforeExit.match(/"\$pg_bin\/psql" -X/g) || []).length, 2);
  assert.match(preflight, /begin read only;[\s\S]*rollback;/);
  assert.match(phase('protected-handler-metadata'), /<<'SQL'\nbegin read only;[\s\S]*\nrollback;\nSQL/);
});

test('validation certificate is persisted separately from restore journal', () => {
  assert.match(workflow, /name: Persist read-only validation certificate\s+if: inputs\.mode == 'validate'[\s\S]*?name: crm-test-validate-\$\{\{ github\.run_id \}\}[\s\S]*?path: \$\{\{ runner\.temp \}\}\/crm-test-validate\.json\s+if-no-files-found: error/);
  const block = phase('offline-target-sql-validation');
  assert.match(block, /status:"validated",mode:"validate",codeSha:\$sha,runId:\$run/);
  assert.match(block, /testProjectRef:"umazhvvxutnsyuphbhda",databaseWritten:false/);
});

test('restore requires successful exact-code validation run and unique certificate artifact', () => {
  const block = phase('prior-read-only-validation-certificate');
  assert.ok(block.includes('[[ "${VALIDATION_RUN_ID:-}" =~ ^[0-9]+$ ]]'));
  assert.ok(block.includes('verify_run "$VALIDATION_RUN_ID" "$GITHUB_SHA" .github/workflows/minuta-crm-test-restore.yml'));
  assert.ok(block.includes('download_artifact "$VALIDATION_RUN_ID" "crm-test-validate-$VALIDATION_RUN_ID" "$private_dir/validation" 1'));
  for (const clause of ['.status=="completed"', '.conclusion=="success"', '.head_sha==$sha', '.path==$path',
    '.repository.full_name==$repo', '.head_repository.full_name==$repo', '.event=="workflow_dispatch"']) {
    assert.ok(shell.includes(clause));
  }
  assert.match(shell, /select\(\.name==\$name and \.expired==false\)\] \| length==1/);
  assert.ok(shell.includes('test "$age" -ge 0 && test "$age" -le 21600'));
});

test('actual certificate predicate rejects each mismatched or missing binding', () => {
  const block = phase('prior-read-only-validation-certificate');
  const predicate = block.match(/\n  (\.schemaVersion==1[\s\S]*?)\n' "\$private_dir\/validation\/crm-test-validate\.json"/)[1];
  const variables = { sha: 'a'.repeat(40), run: '123', snapshotRun: '456', snapshotSha: 'b'.repeat(40),
    snapshotDigest: 'c'.repeat(64), backupRun: '789', backupSha: 'd'.repeat(40), backupDigest: 'e'.repeat(64) };
  // Interpret only this deliberately tiny subset of jq. Unknown syntax fails the
  // test rather than silently treating an unenforced certificate field as valid.
  const atoms = predicate.split(/\s+and\s+/).map((atom) => {
    const match = atom.trim().match(/^\.([A-Za-z0-9_]+)==(\$[A-Za-z]+|"[^"]*"|false|true|[0-9]+)$/);
    assert.ok(match, `Unsupported certificate predicate atom: ${atom}`);
    return [match[1], match[2].startsWith('$') ? variables[match[2].slice(1)] : JSON.parse(match[2])];
  });
  assert.deepEqual(atoms.map(([key]) => key).sort(), ['schemaVersion', 'status', 'mode', 'codeSha', 'runId',
    'snapshotRunId', 'snapshotSha', 'snapshotDigest', 'testBackupRunId', 'testBackupSha', 'testBackupDigest',
    'testProjectRef', 'databaseWritten'].sort());
  const certificate = Object.fromEntries(atoms);
  const accepts = (candidate) => atoms.every(([key, value]) => candidate[key] === value);
  assert.equal(accepts(certificate), true);
  for (const [key, value] of atoms) {
    assert.equal(accepts({ ...certificate, [key]: typeof value === 'boolean' ? !value : 'mismatch' }), false, key);
    const missing = { ...certificate }; delete missing[key];
    assert.equal(accepts(missing), false, `Missing ${key}`);
  }
});

test('backup freshness is checked again immediately before quiesce', () => {
  const block = phase('test-only-quiesce');
  const verify = block.indexOf('verify_run "$TEST_BACKUP_RUN_ID" "$BACKUP_SHA" .github/workflows/minuta-crm-test-backup.yml');
  const mutation = block.indexOf('"$pg_bin/psql"');
  assert.ok(verify >= 0 && verify < mutation);
  assert.match(block.slice(verify, mutation), /'\["main"\]'/);
  assert.match(block, /-v "restore_confirm=\$RESTORE_CONFIRM" -f "\$script_dir\/crm-test-restore-quiesce\.sql"/);
});

test('atomic restore and post-commit failure reporting do not claim rollback', () => {
  const block = phase('test-only-atomic-restore');
  assert.match(block, /"\$pg_bin\/psql" -X --single-transaction -v ON_ERROR_STOP=1/);
  assert.match(block, /-f "\$script_dir\/crm-test-restore-before\.sql" -f "\$private_dir\/target-fragment\.sql"/);
  assert.match(block, /-f "\$script_dir\/crm-test-restore-after\.sql"/);
  assert.ok(shell.indexOf('\nphase=commit-confirmed-journal\n') > shell.indexOf('\nphase=test-only-atomic-restore\n'));
  assert.match(shell, /if \[\[ "\$phase" == commit-confirmed-journal \]\]; then\s+printf 'Test restore committed, but journal creation failed; do not retry blindly/);
  assert.doesNotMatch(shell, /stopped safely/);
});
