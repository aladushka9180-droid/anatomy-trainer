#!/usr/bin/env bash
# No production database credential is accepted or used. Never invoke this script
# outside the manually authorized workflow. It restores no Storage bytes and
# deploys no functions, notification workers, or CRM migrations.
set -euo pipefail
umask 077
phase=initial-validation
private_dir=''
cleanup() {
  local status=$?
  trap - EXIT
  if ((status != 0)); then
    if [[ "$phase" == commit-confirmed-journal ]]; then
      printf 'Test restore committed, but journal creation failed; do not retry blindly.\n' >&2
    else
      printf 'Test restore stopped in phase: %s\n' "$phase" >&2
    fi
    if [[ -n "$private_dir" && -f "$private_dir/transform.log" ]]; then
      sed -nE 's/^Target snapshot SQL preparation refused input; no database accessed (\{"code":"[A-Z_]+"(,"statementIndex":[0-9]+)?(,"shape":"[A-Z ]*")?\})$/\1/p' "$private_dir/transform.log" >&2
    fi
    # SQLSTATE only. Never print SQL text, server DETAIL, row values, or raw logs.
    if [[ -n "$private_dir" && -f "$private_dir/database.log" ]]; then
      sed -nE 's/^psql:[^:]+:[0-9]+: ERROR:  ([0-9A-Z]{5})$/SQLSTATE: \1/p' \
        "$private_dir/database.log" | tail -n 1 >&2
      sed -nE 's/^psql:[^:]+:([0-9]+): ERROR: +([0-9A-Z]{5}): ([a-z_]+)$/Guard line \1: \2 \3/p' \
        "$private_dir/database.log" | tail -n 1 >&2
    fi
  fi
  if [[ -n "$private_dir" && "$private_dir" == "$(realpath "$RUNNER_TEMP")/minuta-crm-test-restore-private" ]]; then
    rm -rf -- "$private_dir"
  fi
  exit "$status"
}
trap cleanup EXIT
[[ "${GITHUB_ACTIONS:-}" == true ]]
[[ "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]]
[[ "${GITHUB_REF:-}" == refs/heads/main || "${GITHUB_REF:-}" == refs/heads/codex/client-record-files ]]
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ ]]
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
[[ "${GITHUB_REPOSITORY:-}" == aladushka9180-droid/anatomy-trainer ]]
[[ "${SNAPSHOT_RUN_ID:-}" =~ ^[0-9]+$ && "${TEST_BACKUP_RUN_ID:-}" =~ ^[0-9]+$ ]]
[[ "${SNAPSHOT_SHA:-}" =~ ^[a-f0-9]{40}$ && "${BACKUP_SHA:-}" =~ ^[a-f0-9]{40}$ ]]
[[ "${RESTORE_CONFIRM:-}" == RESTORE_UMAZHVVXUTNSYUPHBHDA_ANONYMIZED_CRM ]]
[[ "${RESTORE_MODE:-}" == validate || "${RESTORE_MODE:-}" == restore ]]
[[ -n "${BACKUP_ENCRYPTION_PASSWORD:-}" && -n "${MINUTA_TEST_DATABASE_URL:-}" ]]
test -d "$RUNNER_TEMP"
candidate_dir="$(realpath "$RUNNER_TEMP")/minuta-crm-test-restore-private"
test ! -e "$candidate_dir"
mkdir -m 700 "$candidate_dir"
private_dir="$candidate_dir"
export CRM_RESTORE_PRIVATE_DIR="$private_dir"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
pg_bin=/usr/lib/postgresql/17/bin
"$pg_bin/pg_restore" --version | grep -qE '^pg_restore \(PostgreSQL\) 17\.'
"$pg_bin/psql" --version | grep -qE '^psql \(PostgreSQL\) 17\.'
test ! -e "$RUNNER_TEMP/crm-test-restore-success.json"

phase=exact-test-url-guard
node --input-type=module >"$private_dir/guard.log" 2>&1 <<'JS'
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const u=new URL(process.env.MINUTA_TEST_DATABASE_URL);
const ref='umazhvvxutnsyuphbhda';
const user=decodeURIComponent(u.username);
assert(['postgres:','postgresql:'].includes(u.protocol));
assert(u.pathname==='/postgres' && !u.hash);
assert(['','5432','6543'].includes(u.port));
assert((u.hostname===`db.${ref}.supabase.co` && user==='postgres') ||
  (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) && user===`postgres.${ref}`));
assert(u.password);
assert([...u.searchParams.keys()].every(k=>['sslmode','pgbouncer'].includes(k)));
assert(!u.searchParams.has('sslmode') || u.searchParams.get('sslmode')==='require');
writeFileSync(`${process.env.CRM_RESTORE_PRIVATE_DIR}/connection.json`,JSON.stringify({
  host:u.hostname,user,password:decodeURIComponent(u.password),database:'postgres',port:'5432'
}),{mode:0o600});
JS

verify_run() {
  local id="$1" sha="$2" path="$3" branches="$4" output="$5" age
  gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id" >"$output" 2>"$private_dir/gh.log"
  jq -e --arg sha "$sha" --arg path "$path" --arg repo "$GITHUB_REPOSITORY" \
    --argjson branches "$branches" '
    .status=="completed" and .conclusion=="success" and .head_sha==$sha and .path==$path
    and .repository.full_name==$repo and .head_repository.full_name==$repo
    and .event=="workflow_dispatch" and (.head_branch as $b | $branches | index($b)!=null)
  ' "$output" >/dev/null
  age="$(( $(date -u +%s) - $(date -u -d "$(jq -r '.created_at' "$output")" +%s) ))"
  test "$age" -ge 0 && test "$age" -le 21600
}
download_artifact() {
  local id="$1" name="$2" destination="$3" count="${4:-3}"
  gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/artifacts?per_page=100" \
    >"$private_dir/artifacts.json" 2>"$private_dir/gh.log"
  jq -e --arg name "$name" '[.artifacts[] | select(.name==$name and .expired==false)] | length==1' \
    "$private_dir/artifacts.json" >/dev/null
  mkdir -m 700 "$destination"
  gh run download "$id" --repo "$GITHUB_REPOSITORY" --name "$name" --dir "$destination" \
    >"$private_dir/download.log" 2>&1
  test "$(find "$destination" -type f | wc -l)" = "$count"
  test -z "$(find "$destination" -type l -print -quit)"
}
verify_digest() {
  local file="$1" expected
  expected="$(tr -d '[:space:]' < "$file.sha256")"
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]]
  test "$(sha256sum "$file" | awk '{print $1}')" = "$expected"
  printf '%s' "$expected"
}

phase=source-run-provenance
verify_run "$SNAPSHOT_RUN_ID" "$SNAPSHOT_SHA" .github/workflows/minuta-crm-snapshot-prepare.yml \
  '["main","codex/client-record-files"]' "$private_dir/snapshot-run.json"
verify_run "$TEST_BACKUP_RUN_ID" "$BACKUP_SHA" .github/workflows/minuta-crm-test-backup.yml \
  '["main"]' "$private_dir/test-backup-run.json"
download_artifact "$SNAPSHOT_RUN_ID" "crm-anonymized-$SNAPSHOT_RUN_ID" "$private_dir/snapshot"
download_artifact "$TEST_BACKUP_RUN_ID" "crm-testdb-before-$TEST_BACKUP_RUN_ID" "$private_dir/test-backup"

phase=encrypted-artifact-verification
snapshot_digest="$(verify_digest "$private_dir/snapshot/crm-anonymized.dump.gpg")"
backup_digest="$(verify_digest "$private_dir/test-backup/test-before.dump.gpg")"
jq -e --arg sha "$BACKUP_SHA" --arg digest "$backup_digest" '
  .schemaVersion==1 and .status=="success" and .scope=="test-db-backup-only"
  and .testProjectRef=="umazhvvxutnsyuphbhda" and .sourceSha==$sha
  and .encryptedSha256==$digest and .databaseWritten==false and .storageBytesIncluded==false
' "$private_dir/test-backup/test-before.json" >/dev/null
jq -e --arg sha "$SNAPSHOT_SHA" --arg digest "$snapshot_digest" '
  .schemaVersion==1 and .status=="success" and .operation=="offline-anonymization"
  and .codeSha==$sha and .encryptedSha256==$digest and .networkMode=="none"
  and .testDatabaseWritten==false and .productionWritten==false
  and (.sourceSha | test("^[a-f0-9]{40}$")) and (.sourceBackupRunId | test("^[0-9]+$"))
' "$private_dir/snapshot/crm-anonymized.json" >/dev/null
source_sha="$(jq -r '.sourceSha' "$private_dir/snapshot/crm-anonymized.json")"
source_run="$(jq -r '.sourceBackupRunId' "$private_dir/snapshot/crm-anonymized.json")"
verify_run "$source_run" "$source_sha" .github/workflows/minuta-supabase-backup.yml \
  '["main"]' "$private_dir/source-backup-run.json"
# The test backup remains encrypted throughout this job. Only the sanitized
# offline snapshot is decrypted, in a private ephemeral directory.
printf '%s' "$BACKUP_ENCRYPTION_PASSWORD" | gpg --batch --yes --pinentry-mode loopback \
  --passphrase-fd 0 --output "$private_dir/anonymized.dump" \
  --decrypt "$private_dir/snapshot/crm-anonymized.dump.gpg" >"$private_dir/gpg.log" 2>&1

phase=offline-target-sql-preparation
"$pg_bin/pg_restore" --clean --if-exists --no-owner --no-privileges --no-comments \
  --file="$private_dir/raw-restore.sql" "$private_dir/anonymized.dump" >"$private_dir/restore.log" 2>&1

# Connection material never enters SQL, shell eval, command arguments, or logs.
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGAPPNAME PGPASSFILE
export PGHOST="$(jq -r '.host' "$private_dir/connection.json")"
export PGUSER="$(jq -r '.user' "$private_dir/connection.json")"
export PGPASSWORD="$(jq -r '.password' "$private_dir/connection.json")"
export PGDATABASE=postgres PGPORT=5432 PGSSLMODE=require PGCONNECT_TIMEOUT=20
export PGAPPNAME=minuta-authorized-test-restore
phase=read-only-target-preflight
"$pg_bin/psql" -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  -f "$script_dir/crm-test-restore-preflight.sql" >"$private_dir/database.log" 2>&1

phase=protected-handler-metadata
"$pg_bin/psql" -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  >"$private_dir/protected-functions.json" 2>"$private_dir/database.log" <<'SQL'
begin read only;
select coalesce(jsonb_agg(distinct 'public.'||p.proname),'[]'::jsonb)
from pg_proc p where p.pronamespace='public'::regnamespace and
(exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
        where c.relnamespace='auth'::regnamespace and t.tgfoid=p.oid and not t.tgisinternal)
 or exists(select 1 from pg_event_trigger e where e.evtfoid=p.oid));
rollback;
SQL
phase=offline-target-sql-validation
node "$script_dir/crm-snapshot-target-sql.mjs" "$private_dir/raw-restore.sql" \
  "$private_dir/target-fragment.sql" "$private_dir/protected-functions.json" \
  >"$private_dir/transform.log" 2>&1
if [[ "$RESTORE_MODE" == validate ]]; then
  jq -n --arg sha "$GITHUB_SHA" --arg run "$GITHUB_RUN_ID" \
    --arg snapshotRun "$SNAPSHOT_RUN_ID" --arg snapshotSha "$SNAPSHOT_SHA" \
    --arg snapshotDigest "$snapshot_digest" --arg backupRun "$TEST_BACKUP_RUN_ID" \
    --arg backupSha "$BACKUP_SHA" --arg backupDigest "$backup_digest" \
    '{schemaVersion:1,status:"validated",mode:"validate",codeSha:$sha,runId:$run,
      snapshotRunId:$snapshotRun,snapshotSha:$snapshotSha,snapshotDigest:$snapshotDigest,
      testBackupRunId:$backupRun,testBackupSha:$backupSha,testBackupDigest:$backupDigest,
      testProjectRef:"umazhvvxutnsyuphbhda",databaseWritten:false}' \
    >"$RUNNER_TEMP/crm-test-validate.json"
  printf 'Encrypted artifacts, protected handlers, target SQL and read-only preflight validated. No database writes.\n'
  exit 0
fi

phase=prior-read-only-validation-certificate
[[ "${VALIDATION_RUN_ID:-}" =~ ^[0-9]+$ ]]
verify_run "$VALIDATION_RUN_ID" "$GITHUB_SHA" .github/workflows/minuta-crm-test-restore.yml \
  '["main","codex/client-record-files"]' "$private_dir/validation-run.json"
download_artifact "$VALIDATION_RUN_ID" "crm-test-validate-$VALIDATION_RUN_ID" "$private_dir/validation" 1
jq -e --arg sha "$GITHUB_SHA" --arg run "$VALIDATION_RUN_ID" \
  --arg snapshotRun "$SNAPSHOT_RUN_ID" --arg snapshotSha "$SNAPSHOT_SHA" \
  --arg snapshotDigest "$snapshot_digest" --arg backupRun "$TEST_BACKUP_RUN_ID" \
  --arg backupSha "$BACKUP_SHA" --arg backupDigest "$backup_digest" '
  .schemaVersion==1 and .status=="validated" and .mode=="validate" and .codeSha==$sha and .runId==$run
  and .snapshotRunId==$snapshotRun and .snapshotSha==$snapshotSha and .snapshotDigest==$snapshotDigest
  and .testBackupRunId==$backupRun and .testBackupSha==$backupSha and .testBackupDigest==$backupDigest
  and .testProjectRef=="umazhvvxutnsyuphbhda" and .databaseWritten==false
' "$private_dir/validation/crm-test-validate.json" >/dev/null

phase=test-only-quiesce
# Recheck freshness immediately before the first mutation, not only at job start.
verify_run "$TEST_BACKUP_RUN_ID" "$BACKUP_SHA" .github/workflows/minuta-crm-test-backup.yml \
  '["main"]' "$private_dir/test-backup-run.json"
"$pg_bin/psql" -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  -v "restore_confirm=$RESTORE_CONFIRM" -f "$script_dir/crm-test-restore-quiesce.sql" \
  >"$private_dir/database.log" 2>&1

phase=test-only-atomic-restore
# -1 wraps all three files in one BEGIN/COMMIT. ON_ERROR_STOP causes rollback
# on any failed assertion, DDL, COPY, dependency or ACL operation.
"$pg_bin/psql" -X --single-transaction -v ON_ERROR_STOP=1 -v VERBOSITY=verbose \
  -f "$script_dir/crm-test-restore-before.sql" -f "$private_dir/target-fragment.sql" \
  -f "$script_dir/crm-test-restore-after.sql" >"$private_dir/database.log" 2>&1

phase=commit-confirmed-journal
jq -n --arg sha "$GITHUB_SHA" --arg run "$GITHUB_RUN_ID" \
  --arg snapshotRun "$SNAPSHOT_RUN_ID" --arg snapshotSha "$SNAPSHOT_SHA" \
  --arg snapshotDigest "$snapshot_digest" --arg backupRun "$TEST_BACKUP_RUN_ID" \
  --arg backupSha "$BACKUP_SHA" --arg backupDigest "$backup_digest" \
  --arg sourceRun "$source_run" --arg sourceSha "$source_sha" \
  --arg completed "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" '
  {schemaVersion:1,status:"success",operation:"authorized-anonymized-test-restore",codeSha:$sha,
   runId:$run,completedAtUtc:$completed,testProjectRef:"umazhvvxutnsyuphbhda",databaseRole:"postgres",
   snapshotRunId:$snapshotRun,snapshotSha:$snapshotSha,snapshotEncryptedSha256:$snapshotDigest,
   testBackupRunId:$backupRun,testBackupSha:$backupSha,testBackupEncryptedSha256:$backupDigest,
   sourceBackupRunId:$sourceRun,sourceBackupSha:$sourceSha,testDatabaseWritten:true,
   productionWritten:false,storageWritten:false,workersDeployed:false,crmMigrationsApplied:false,
   transactionCommitted:true}
' >"$RUNNER_TEMP/crm-test-restore-success.json"
printf 'Authorized test-only anonymized restore committed. Production untouched; CRM migrations not applied.\n'
