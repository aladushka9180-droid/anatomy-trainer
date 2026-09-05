#!/usr/bin/env bash
# Test only. No production credential, HTTP Storage client, Edge deployment,
# delivery worker, or production BACKUP_VERIFIED marker is used here.
set -euo pipefail
umask 077
phase=configuration
private_dir=''
cleanup() {
  local status=$?
  trap - EXIT
  if ((status!=0)); then
    printf 'Test CRM rehearsal stopped in phase: %s. No automatic recovery or replay was attempted.\n' "$phase" >&2
    if [[ -n "$private_dir" && -f "$private_dir/database.log" ]]; then
      sed -nE 's/^psql:[^:]+:[0-9]+: ERROR:  ([0-9A-Z]{5})$/SQLSTATE: \1/p' "$private_dir/database.log" | tail -n 1 >&2
    fi
  fi
  if [[ -n "$private_dir" && "$private_dir" == "$(realpath "$RUNNER_TEMP")/minuta-crm-test-migrations-private" ]]; then
    rm -rf -- "$private_dir"
  fi
  exit "$status"
}
trap cleanup EXIT
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_EVENT_NAME:-}" == workflow_dispatch ]]
[[ "${GITHUB_REPOSITORY:-}" == aladushka9180-droid/anatomy-trainer ]]
[[ "${GITHUB_REF:-}" == refs/heads/main || "${GITHUB_REF:-}" == refs/heads/codex/client-record-files ]]
[[ "${GITHUB_SHA:-}" =~ ^[a-f0-9]{40}$ && "${RELEASE_SHA:-}" == "$GITHUB_SHA" ]]
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
[[ "${RESTORE_RUN_ID:-}" =~ ^[0-9]+$ && "${TEST_BACKUP_RUN_ID:-}" =~ ^[0-9]+$ ]]
[[ "${RESTORE_SHA:-}" =~ ^[a-f0-9]{40}$ && "${BACKUP_SHA:-}" =~ ^[a-f0-9]{40}$ ]]
[[ "${MIGRATION_MODE:-}" == validate || "${MIGRATION_MODE:-}" == exercise ]]
resume_v112=false
if [[ -n "${RESUME_V112_RUN_ID:-}" || -n "${RESUME_V112_SHA:-}" ]]; then
  # This is a reviewed, one-off partial state, not a generic failed-run bypass.
  [[ "${RESUME_V112_RUN_ID:-}" == 33983858607 ]]
  [[ "${RESUME_V112_SHA:-}" == 678ada88563f200b804267bfe9d93195bbade4cf ]]
  resume_v112=true
fi
if [[ "$MIGRATION_MODE" == exercise ]]; then
  [[ "${EXERCISE_CONFIRM:-}" == TEST_CRM_V112_V114_APPLY_ROLLBACK_REAPPLY ]]
fi
candidate="$(realpath "$RUNNER_TEMP")/minuta-crm-test-migrations-private"
test ! -e "$candidate"
mkdir -m 700 "$candidate"
private_dir="$candidate"
export CRM_MIGRATION_PRIVATE_DIR="$private_dir"
test ! -e "$RUNNER_TEMP/crm-test-migrations-result.json"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(dirname "$script_dir")"
pg_bin=/usr/lib/postgresql/17/bin
"$pg_bin/psql" --version | grep -qE '^psql \(PostgreSQL\) 17\.'

phase=exact-test-project
node --input-type=module >"$private_dir/guard.log" 2>&1 <<'JS'
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const u=new URL(process.env.MINUTA_TEST_DATABASE_URL);
const ref='umazhvvxutnsyuphbhda',user=decodeURIComponent(u.username);
assert(['postgres:','postgresql:'].includes(u.protocol)&&u.pathname==='/postgres'&&!u.hash);
assert(['','5432','6543'].includes(u.port));
assert((u.hostname===`db.${ref}.supabase.co`&&user==='postgres')||
  (/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname)&&user===`postgres.${ref}`));
assert(u.password&&[...u.searchParams.keys()].every(k=>['sslmode','pgbouncer'].includes(k)));
assert(!u.searchParams.has('sslmode')||u.searchParams.get('sslmode')==='require');
writeFileSync(`${process.env.CRM_MIGRATION_PRIVATE_DIR}/connection.json`,JSON.stringify({
  host:u.hostname,user,password:decodeURIComponent(u.password)
}),{mode:0o600});
JS

verify_run() {
  local id="$1" sha="$2" path="$3" branches="$4" output="$5" max_age="$6" age
  gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id" >"$output" 2>"$private_dir/gh.log"
  jq -e --arg sha "$sha" --arg path "$path" --arg repo "$GITHUB_REPOSITORY" --argjson branches "$branches" '
    .status=="completed" and .conclusion=="success" and .head_sha==$sha and .path==$path
    and .repository.full_name==$repo and .head_repository.full_name==$repo and .event=="workflow_dispatch"
    and (.head_branch as $b | $branches | index($b)!=null)
  ' "$output" >/dev/null
  age="$(( $(date -u +%s) - $(date -u -d "$(jq -r '.created_at' "$output")" +%s) ))"
  test "$age" -ge 0 && test "$age" -le "$max_age"
}
download() {
  local id="$1" name="$2" destination="$3" count="$4"
  gh api "repos/$GITHUB_REPOSITORY/actions/runs/$id/artifacts?per_page=100" >"$private_dir/artifacts.json" 2>"$private_dir/gh.log"
  jq -e --arg name "$name" '[.artifacts[]|select(.name==$name and .expired==false)]|length==1' "$private_dir/artifacts.json" >/dev/null
  mkdir -m 700 "$destination"
  gh run download "$id" --repo "$GITHUB_REPOSITORY" --name "$name" --dir "$destination" >"$private_dir/download.log" 2>&1
  test "$(find "$destination" -type f | wc -l)" = "$count"
  test -z "$(find "$destination" -type l -print -quit)"
}
digest() {
  local file="$1" expected
  expected="$(tr -d '[:space:]' < "$file.sha256")"
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]]
  test "$(sha256sum "$file" | awk '{print $1}')" = "$expected"
  printf '%s' "$expected"
}

phase=restore-certificate
verify_run "$RESTORE_RUN_ID" "$RESTORE_SHA" .github/workflows/minuta-crm-test-restore.yml \
  '["main","codex/client-record-files"]' "$private_dir/restore-run.json" 86400
download "$RESTORE_RUN_ID" "crm-test-restore-$RESTORE_RUN_ID" "$private_dir/restore" 1
restore_journal="$private_dir/restore/crm-test-restore-success.json"
jq -e --arg sha "$RESTORE_SHA" --arg run "$RESTORE_RUN_ID" '
  .schemaVersion==1 and .status=="success" and .operation=="authorized-anonymized-test-restore"
  and .codeSha==$sha and .runId==$run and .testProjectRef=="umazhvvxutnsyuphbhda"
  and .databaseRole=="postgres" and .transactionCommitted==true and .testDatabaseWritten==true
  and .productionWritten==false and .storageWritten==false and .workersDeployed==false
  and .crmMigrationsApplied==false and (.snapshotRunId|test("^[0-9]+$"))
  and (.snapshotSha|test("^[a-f0-9]{40}$")) and (.snapshotEncryptedSha256|test("^[a-f0-9]{64}$"))
' "$restore_journal" >/dev/null
snapshot_run="$(jq -r '.snapshotRunId' "$restore_journal")"
snapshot_sha="$(jq -r '.snapshotSha' "$restore_journal")"
verify_run "$snapshot_run" "$snapshot_sha" .github/workflows/minuta-crm-snapshot-prepare.yml \
  '["main","codex/client-record-files"]' "$private_dir/snapshot-run.json" 86400
download "$snapshot_run" "crm-anonymized-$snapshot_run" "$private_dir/snapshot" 3
snapshot_digest="$(digest "$private_dir/snapshot/crm-anonymized.dump.gpg")"
test "$snapshot_digest" = "$(jq -r '.snapshotEncryptedSha256' "$restore_journal")"
jq -e --arg sha "$snapshot_sha" --arg hash "$snapshot_digest" \
  --arg sourceRun "$(jq -r '.sourceBackupRunId' "$restore_journal")" \
  --arg sourceSha "$(jq -r '.sourceBackupSha' "$restore_journal")" '
  .schemaVersion==1 and .status=="success" and .operation=="offline-anonymization"
  and .codeSha==$sha and .encryptedSha256==$hash and .networkMode=="none"
  and .testDatabaseWritten==false and .productionWritten==false
  and .sourceBackupRunId==$sourceRun and .sourceSha==$sourceSha
' "$private_dir/snapshot/crm-anonymized.json" >/dev/null

phase=post-restore-encrypted-backup
verify_run "$TEST_BACKUP_RUN_ID" "$BACKUP_SHA" .github/workflows/minuta-crm-test-backup.yml \
  '["main"]' "$private_dir/backup-run.json" 21600
# A pre-restore backup cannot protect the post-restore migration baseline.
test "$(date -u -d "$(jq -r '.created_at' "$private_dir/backup-run.json")" +%s)" \
  -ge "$(date -u -d "$(jq -r '.completedAtUtc' "$restore_journal")" +%s)"
download "$TEST_BACKUP_RUN_ID" "crm-testdb-before-$TEST_BACKUP_RUN_ID" "$private_dir/backup" 3
backup_digest="$(digest "$private_dir/backup/test-before.dump.gpg")"
jq -e --arg sha "$BACKUP_SHA" --arg hash "$backup_digest" '
  .schemaVersion==1 and .status=="success" and .scope=="test-db-backup-only"
  and .testProjectRef=="umazhvvxutnsyuphbhda" and .sourceSha==$sha
  and .encryptedSha256==$hash and .databaseWritten==false and .storageBytesIncluded==false
' "$private_dir/backup/test-before.json" >/dev/null
# No dump is ever decrypted by this gate.

if [[ "$resume_v112" == true ]]; then
  phase=reviewed-v112-resume-certificate
  gh api "repos/$GITHUB_REPOSITORY/actions/runs/$RESUME_V112_RUN_ID" >"$private_dir/failed-run.json" 2>"$private_dir/gh.log"
  jq -e --arg sha "$RESUME_V112_SHA" --arg repo "$GITHUB_REPOSITORY" '
    .status=="completed" and .conclusion=="failure" and .head_sha==$sha
    and .path==".github/workflows/minuta-crm-test-migrations.yml"
    and .repository.full_name==$repo and .head_repository.full_name==$repo
    and .head_branch=="codex/client-record-files" and .event=="workflow_dispatch" and .run_attempt==1
  ' "$private_dir/failed-run.json" >/dev/null
  test "$(date -u -d "$(jq -r '.created_at' "$private_dir/backup-run.json")" +%s)" \
    -ge "$(date -u -d "$(jq -r '.updated_at' "$private_dir/failed-run.json")" +%s)"
  gh run view "$RESUME_V112_RUN_ID" --repo "$GITHUB_REPOSITORY" --log-failed >"$private_dir/failed-run-private.log" 2>"$private_dir/gh.log"
  grep -Fq 'Test CRM rehearsal stopped in phase: apply-v112-v114.' "$private_dir/failed-run-private.log"
  grep -Fq 'SQLSTATE: 42830' "$private_dir/failed-run-private.log"
  # Checkout may be shallow. Compare Git blob identities through the exact old
  # commit API, never fetch or evaluate old source or reveal failed-run logs.
  gh api "repos/$GITHUB_REPOSITORY/contents/minuta-online-booking/supabase-migration-v112.sql?ref=$RESUME_V112_SHA" \
    >"$private_dir/old-v112-blob.json" 2>"$private_dir/gh.log"
  old_v112_blob="$(jq -er 'select(.type=="file" and .path=="minuta-online-booking/supabase-migration-v112.sql")|.sha' "$private_dir/old-v112-blob.json")"
  [[ "$old_v112_blob" =~ ^[a-f0-9]{40}$ ]]
  test "$old_v112_blob" = "$(git rev-parse HEAD:minuta-online-booking/supabase-migration-v112.sql)"
fi

phase=named-file-contract
files=(supabase-migration-v112.sql supabase-migration-v113.sql supabase-migration-v114.sql
  supabase-migration-v114-rollback.sql supabase-migration-v113-rollback.sql recovery/rollback-client-records-v112.sql
  scripts/crm-server-release-schema-check.sql client-records-v112-integration.sql tests/profitability-v113-schema-check.sql)
for file in "${files[@]}"; do
  test -f "$app_dir/$file"
  git diff --quiet HEAD -- "minuta-online-booking/$file"
done
[[ "$(tail -n 1 "$app_dir/client-records-v112-integration.sql" | tr -d '\r[:space:]')" == 'rollback;' ]]
unset PGHOSTADDR PGSERVICE PGSERVICEFILE PGOPTIONS PGAPPNAME PGPASSFILE
export PGHOST="$(jq -r '.host' "$private_dir/connection.json")" PGUSER="$(jq -r '.user' "$private_dir/connection.json")"
export PGPASSWORD="$(jq -r '.password' "$private_dir/connection.json")"
export PGDATABASE=postgres PGPORT=5432 PGSSLMODE=require PGCONNECT_TIMEOUT=20
export PGAPPNAME=minuta-test-crm-migration-rehearsal
export PGOPTIONS='-c statement_timeout=600000 -c lock_timeout=10000'
psql_file() { "$pg_bin/psql" -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate "$@" >"$private_dir/database.log" 2>&1; }
isolation() {
  "$pg_bin/psql" -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate >"$private_dir/database.log" 2>&1 <<'SQL'
begin read only;
do $$ begin
  if current_database()<>'postgres' or current_user<>'postgres'
     or (select count(*) from minuta_migration_guard.target where project_ref='umazhvvxutnsyuphbhda' and allow_migrations)<>1
     or (select count(*) from minuta_restore_guard.target where project_ref='umazhvvxutnsyuphbhda' and not allow_destructive_restore)<>1 then
    raise exception 'test_migration_identity_guard_failed';
  end if;
  if exists(select 1 from public.organizations where public_booking_enabled)
     or exists(select 1 from public.client_device_sessions)
     or exists(select 1 from public.client_telegram_subscriptions)
     or exists(select 1 from public.notification_recipient_endpoints)
     or exists(select 1 from public.notification_outbox)
     or exists(select 1 from public.organization_notification_settings where enabled)
     or exists(select 1 from public.organization_notification_channels where enabled)
     or exists(select 1 from vault.secrets) or exists(select 1 from net.http_request_queue)
     or exists(select 1 from cron.job where jobname<>'telegram-client-reminders-hourly' or command<>'select 1' or schedule<>'0 0 1 1 *') then
    raise exception 'test_migration_isolation_guard_failed';
  end if;
end $$;
rollback;
SQL
}
counts() {
  "$pg_bin/psql" -X -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f "$private_dir/counts.sql" >"$1" 2>"$private_dir/database.log"
  jq -e 'type=="object" and length==24 and all(.[];type=="number" and .>=0)' "$1" >/dev/null
}
fingerprints() {
  "$pg_bin/psql" -X -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f "$private_dir/fingerprints.sql" >"$1" 2>"$private_dir/database.log"
  jq -e 'type=="object" and length==24 and all(.[]; (.count|type)=="number" and .count>=0 and (.sha256|test("^[a-f0-9]{64}$")))' "$1" >/dev/null
}
node --input-type=module <<'JS'
import {writeFileSync} from 'node:fs';
const publicTables=['organizations','locations','organization_memberships','performer_profiles','services','client_accounts',
  'bookings','booking_outcomes','booking_series','organization_inventory_settings','inventory_warehouses','inventory_items',
  'inventory_stock_balances','inventory_movements','inventory_service_usage','organization_payroll_settings','payroll_plans',
  'payroll_plan_tiers','payroll_periods','payroll_period_plan_snapshots','payroll_items','payroll_adjustments'];
const tables=[...publicTables.map(x=>'public.'+x),'storage.objects','auth.users'];
writeFileSync(`${process.env.CRM_MIGRATION_PRIVATE_DIR}/tables.json`,JSON.stringify(tables),{mode:0o600});
// Capture the original column list once, before any migration. Catalog metadata
// only crosses the connection; auth credentials and business row values do not.
writeFileSync(`${process.env.CRM_MIGRATION_PRIVATE_DIR}/column-manifest.sql`,
  'begin read only;\nselect jsonb_object_agg(name,columns) from (select wanted.name,'+
  'jsonb_agg(a.attname order by a.attnum) filter(where a.attnum is not null) as columns '+
  'from (values '+tables.map(x=>`('${x}')`).join(',')+') wanted(name) '+
  'left join pg_catalog.pg_attribute a on a.attrelid=to_regclass(wanted.name) '+
  'and a.attnum>0 and not a.attisdropped group by wanted.name) manifest;\nrollback;\n',{mode:0o600});
writeFileSync(`${process.env.CRM_MIGRATION_PRIVATE_DIR}/counts.sql`,
  'begin read only;\nselect jsonb_object_agg(name,n) from ('+tables.map(x=>`select '${x}' as name,count(*) as n from ${x}`).join(' union all ')+') counters;\nrollback;\n',{mode:0o600});
JS
phase=read-only-baseline
psql_file -f "$script_dir/crm-test-restore-preflight.sql"
isolation
"$pg_bin/psql" -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -v "resume_v112=$resume_v112" >"$private_dir/database.log" 2>&1 <<'BASELINE_SQL'
begin read only;
set local search_path='pg_catalog';
select set_config('minuta.crm_resume_v112',:'resume_v112',true);
do $$ declare rpc text; relation text; begin
  if to_regprocedure('public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text)') is null
     or to_regclass('public.organization_inventory_cost_settings') is not null
     or to_regclass('public.notification_v114_organization_cutovers') is not null
     or exists(select 1 from cron.job) then raise exception 'test_crm_requires_unmodified_restored_v111'; end if;
  -- A failed statement is not proof that every partial object was rolled back.
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relname in (
              'inventory_cost_layers','inventory_cost_allocations','inventory_movement_cost_snapshots',
              'inventory_service_cost_settings','booking_confirmed_commissions',
              'notification_v114_worker_readiness','notification_v114_legacy_send_leases'))
     or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' and (p.proname like '%v113%' or p.proname like '%v114%'))
     or exists(select 1 from pg_attribute where not attisdropped and
               ((attrelid='public.inventory_movements'::regclass and attname='purchase_total_cost_kopecks')
                or (attrelid='public.notification_outbox'::regclass and attname='delivered_at')))
     or exists(select 1 from pg_trigger where tgname in ('inventory_movement_cost_v113','client_telegram_subscription_sync_v114')) then
    raise exception 'test_crm_unknown_partial_v113_v114_state';
  end if;
  if current_setting('minuta.crm_resume_v112')='true' then
    if to_regclass('public.client_record_settings') is null or to_regclass('public.client_record_entries') is null then
      raise exception 'test_crm_resume_requires_complete_v112_tables';
    end if;
    if exists(select 1 from public.client_record_settings) or exists(select 1 from public.client_record_entries)
       or exists(select 1 from storage.objects where bucket_id='minuta-client-records')
       or not exists(select 1 from storage.buckets where id='minuta-client-records' and name='minuta-client-records'
         and public is false and file_size_limit=10485760
         and allowed_mime_types=array['application/pdf','image/jpeg','image/png','image/webp']::text[]) then
      raise exception 'test_crm_resume_v112_is_not_pristine';
    end if;
    foreach relation in array array['public.client_record_settings','public.client_record_entries'] loop
      if not (select relrowsecurity from pg_class where oid=relation::regclass)
         or has_table_privilege('anon',relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or has_table_privilege('authenticated',relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
         or not has_table_privilege('service_role',relation,'SELECT')
         or not has_table_privilege('service_role',relation,'INSERT')
         or not has_table_privilege('service_role',relation,'UPDATE')
         or not has_table_privilege('service_role',relation,'DELETE') then
        raise exception 'test_crm_resume_v112_table_acl_changed';
      end if;
    end loop;
    foreach rpc in array array[
      'public.set_minuta_client_records_enabled(uuid,boolean)','public.get_minuta_client_records(uuid,text,integer)',
      'public.create_minuta_client_record(uuid,text,uuid,uuid,text,text,text,text,integer)',
      'public.complete_minuta_client_file(uuid)','public.archive_minuta_client_record(uuid)',
      'public.can_use_minuta_client_object(text,text)'] loop
      if to_regprocedure(rpc) is null or not has_function_privilege('authenticated',rpc,'EXECUTE')
         or has_function_privilege('anon',rpc,'EXECUTE') then raise exception 'test_crm_resume_v112_rpc_acl_changed'; end if;
    end loop;
    foreach rpc in array array['public.claim_expired_minuta_client_records(integer,boolean)',
      'public.finish_expired_minuta_client_record(uuid)'] loop
      if to_regprocedure(rpc) is null or not has_function_privilege('service_role',rpc,'EXECUTE')
         or has_function_privilege('authenticated',rpc,'EXECUTE') or has_function_privilege('anon',rpc,'EXECUTE') then
        raise exception 'test_crm_resume_v112_maintenance_acl_changed'; end if;
    end loop;
    if to_regprocedure('public.can_access_minuta_client_record(uuid,text,uuid)') is null
       or has_function_privilege('authenticated','public.can_access_minuta_client_record(uuid,text,uuid)','EXECUTE')
       or has_function_privilege('anon','public.can_access_minuta_client_record(uuid,text,uuid)','EXECUTE') then
      raise exception 'test_crm_resume_v112_helper_acl_changed';
    end if;
    -- Exact policy expression, role, command and permissiveness contract. The
    -- pg_catalog-only search_path makes helper qualification deterministic.
    if (select count(*) from pg_policy where polrelid='storage.objects'::regclass and polname like 'client_record_object_%')<>7
       or exists (
      select 1 from (values
        ('client_record_object_read_v112','r',true,'authenticated',
         '((bucket_id = ''minuta-client-records''::text) AND public.can_use_minuta_client_object(name, ''read''::text))',null),
        ('client_record_object_upload_v112','a',true,'authenticated',null,
         '((bucket_id = ''minuta-client-records''::text) AND public.can_use_minuta_client_object(name, ''upload''::text))'),
        ('client_record_object_guard_v112','r',false,'authenticated',
         '((bucket_id <> ''minuta-client-records''::text) OR public.can_use_minuta_client_object(name, ''read''::text))',null),
        ('client_record_object_insert_guard_v112','a',false,'authenticated',null,
         '((bucket_id <> ''minuta-client-records''::text) OR public.can_use_minuta_client_object(name, ''upload''::text))'),
        ('client_record_object_update_guard_v112','w',false,'authenticated',
         '(bucket_id <> ''minuta-client-records''::text)','(bucket_id <> ''minuta-client-records''::text)'),
        ('client_record_object_delete_guard_v112','d',false,'authenticated','(bucket_id <> ''minuta-client-records''::text)',null),
        ('client_record_object_anon_guard_v112','*',false,'anon',
         '(bucket_id <> ''minuta-client-records''::text)','(bucket_id <> ''minuta-client-records''::text)')
      ) expected(name,command,permissive,role_name,using_expression,check_expression)
      left join pg_policy p on p.polrelid='storage.objects'::regclass and p.polname=expected.name
      where p.oid is null or p.polcmd::text<>expected.command or p.polpermissive<>expected.permissive
        or p.polroles<>array[(select oid from pg_roles where rolname=expected.role_name)]::oid[]
        or pg_get_expr(p.polqual,p.polrelid) is distinct from expected.using_expression
        or pg_get_expr(p.polwithcheck,p.polrelid) is distinct from expected.check_expression
    ) then raise exception 'test_crm_resume_v112_storage_policy_changed'; end if;
  elsif to_regclass('public.client_record_settings') is not null or to_regclass('public.client_record_entries') is not null
        or exists(select 1 from storage.buckets where id='minuta-client-records') then
    raise exception 'test_crm_requires_unmodified_restored_v111';
  end if;
  -- Exact eligibility predicate used by client-records-v112-integration.sql.
  -- Fail before applying anything if its initial \gset would have no fixture.
  if not exists(
    select 1 from public.bookings b
    join public.organizations o on o.id=b.organization_id and o.status='active'
    join public.organization_memberships m on m.organization_id=o.id and m.role='owner' and m.active
    where public.normalize_client_phone(b.client_phone) ~ '^7[0-9]{10}$'
  ) then raise exception 'test_v112_active_owner_booking_fixture_missing'; end if;
end $$;
rollback;
BASELINE_SQL
counts "$private_dir/counts-before.json"
"$pg_bin/psql" -X -q -A -t -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  -f "$private_dir/column-manifest.sql" >"$private_dir/column-manifest.json" 2>"$private_dir/database.log"
node --input-type=module >"$private_dir/fingerprint-generator.log" 2>&1 <<'FINGERPRINT_JS'
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const directory=process.env.CRM_MIGRATION_PRIVATE_DIR;
const tables=JSON.parse(readFileSync(`${directory}/tables.json`,'utf8'));
const manifest=JSON.parse(readFileSync(`${directory}/column-manifest.json`,'utf8'));
assert(tables.length===24 && new Set(tables).size===24);
assert.deepEqual(Object.keys(manifest).sort(),[...tables].sort());
const quote=(name)=>'"'+name.replaceAll('"','""')+'"';
const branches=tables.map(table=>{
  assert(/^(public|storage|auth)\.[a-z_]+$/.test(table));
  const columns=manifest[table];
  assert(Array.isArray(columns) && columns.length>0 && new Set(columns).size===columns.length);
  assert(columns.every(column=>typeof column==='string' && column.length>0 && !column.includes('\0')));
  // ROW uses the frozen list, not t.*: additive columns are deliberately ignored.
  // Sort row hashes to preserve duplicates and eliminate physical scan ordering.
  const row='ROW('+columns.map(column=>'t.'+quote(column)).join(',')+')';
  return `select '${table}' as name,jsonb_build_object('count',count(*),'sha256',`+
    `encode(sha256(convert_to(coalesce(string_agg(row_hash,'' order by row_hash collate "C"),''),'UTF8')),'hex')) as fingerprint `+
    `from (select encode(sha256(convert_to(to_jsonb(${row})::text,'UTF8')),'hex') as row_hash from ${table.split('.').map(quote).join('.')} t) hashed_rows`;
});
const sql="begin read only;\nset local search_path='pg_catalog';\nset local timezone='UTC';\nset local datestyle='ISO, YMD';\n"+
  "set local intervalstyle='postgres';\nset local extra_float_digits=3;\nset local bytea_output='hex';\n"+
  'select jsonb_object_agg(name,fingerprint) from ('+branches.join(' union all ')+') fingerprints;\nrollback;\n';
writeFileSync(`${directory}/fingerprints.sql`,sql,{mode:0o600});
FINGERPRINT_JS
fingerprints "$private_dir/fingerprints-before.json"
if [[ "$MIGRATION_MODE" == exercise ]]; then
  phase=backup-freshness-before-first-write
  verify_run "$TEST_BACKUP_RUN_ID" "$BACKUP_SHA" .github/workflows/minuta-crm-test-backup.yml '["main"]' "$private_dir/backup-run.json" 21600
  # Reapplying the byte-identical, pristine v112 is intentional and idempotent.
  # All legacy fingerprints start at this freshly backed-up baseline; they do
  # not retroactively prove the earlier failed run preserved old row values.
  for version in 112 113 114; do phase="apply-v$version"; psql_file -f "$app_dir/supabase-migration-v$version.sql"; done
  psql_file -v expected_state=applied -f "$script_dir/crm-server-release-schema-check.sql"
  isolation
  phase=runtime-and-schema-contracts
  # This named integration creates only transaction-local fixtures and finishes
  # ROLLBACK. No HTTP upload occurs; Storage metadata is exercised inside SQL.
  psql_file -f "$app_dir/client-records-v112-integration.sql"
  psql_file -f "$app_dir/tests/profitability-v113-schema-check.sql"
  psql_file -v expected_state=applied -f "$script_dir/crm-server-release-schema-check.sql"
  counts "$private_dir/counts-after-runtime.json"
  cmp --silent "$private_dir/counts-before.json" "$private_dir/counts-after-runtime.json"
  fingerprints "$private_dir/fingerprints-after-runtime.json"
  cmp --silent "$private_dir/fingerprints-before.json" "$private_dir/fingerprints-after-runtime.json"
  isolation
  phase=inert-rollback-topology
  "$pg_bin/psql" -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate >"$private_dir/database.log" 2>&1 <<'SQL'
begin;
do $$ begin
  if exists(select 1 from cron.job) then raise exception 'test_cron_not_empty'; end if;
  perform cron.schedule('telegram-client-reminders-hourly','0 0 1 1 *','select 1');
  if (select count(*) from cron.job where jobname='telegram-client-reminders-hourly' and active and command='select 1' and schedule='0 0 1 1 *')<>1 then
    raise exception 'inert_test_cron_contract_failed'; end if;
end $$;
commit;
SQL
  phase=rollback-v114-v113-v112
  psql_file -f "$app_dir/supabase-migration-v114-rollback.sql"
  psql_file -f "$app_dir/supabase-migration-v113-rollback.sql"
  psql_file -f "$app_dir/recovery/rollback-client-records-v112.sql"
  psql_file -v expected_state=rolled_back -f "$script_dir/crm-server-release-schema-check.sql"
  isolation
  counts "$private_dir/counts-after-rollback.json"
  cmp --silent "$private_dir/counts-before.json" "$private_dir/counts-after-rollback.json"
  fingerprints "$private_dir/fingerprints-after-rollback.json"
  cmp --silent "$private_dir/fingerprints-before.json" "$private_dir/fingerprints-after-rollback.json"
  for version in 112 113 114; do phase="reapply-v$version"; psql_file -f "$app_dir/supabase-migration-v$version.sql"; done
  psql_file -v expected_state=applied -f "$script_dir/crm-server-release-schema-check.sql"
  psql_file -f "$app_dir/tests/profitability-v113-schema-check.sql"
  isolation
  phase=remove-only-known-inert-test-cron
  "$pg_bin/psql" -X -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate >"$private_dir/database.log" 2>&1 <<'SQL'
begin;
do $$ declare job record; begin
  if exists(select 1 from cron.job where jobname<>'telegram-client-reminders-hourly' or command<>'select 1' or schedule<>'0 0 1 1 *') then
    raise exception 'unexpected_test_cron_do_not_remove'; end if;
  for job in select jobid from cron.job where jobname='telegram-client-reminders-hourly' and command='select 1' and schedule='0 0 1 1 *'
  loop perform cron.unschedule(job.jobid); end loop;
  if exists(select 1 from cron.job) then raise exception 'test_cron_remains'; end if;
end $$;
commit;
SQL
fi
phase=final-invariants
isolation
counts "$private_dir/counts-after.json"
cmp --silent "$private_dir/counts-before.json" "$private_dir/counts-after.json"
fingerprints "$private_dir/fingerprints-after.json"
cmp --silent "$private_dir/fingerprints-before.json" "$private_dir/fingerprints-after.json"
jq -n --arg mode "$MIGRATION_MODE" --arg sha "$RELEASE_SHA" --arg run "$GITHUB_RUN_ID" \
  --arg restoreRun "$RESTORE_RUN_ID" --arg restoreSha "$RESTORE_SHA" \
  --arg snapshotRun "$snapshot_run" --arg snapshotSha "$snapshot_sha" \
  --arg backupRun "$TEST_BACKUP_RUN_ID" --arg backupSha "$BACKUP_SHA" --arg backupDigest "$backup_digest" \
  --arg resumeRun "${RESUME_V112_RUN_ID:-}" --arg resumeSha "${RESUME_V112_SHA:-}" \
  --arg completed "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" '
  {schemaVersion:1,status:(if $mode=="exercise" then "success" else "validated" end),mode:$mode,
   operation:"test-only-crm-migration-rehearsal",releaseSha:$sha,runId:$run,completedAtUtc:$completed,
   testProjectRef:"umazhvvxutnsyuphbhda",databaseRole:"postgres",restoreRunId:$restoreRun,restoreSha:$restoreSha,
   snapshotRunId:$snapshotRun,snapshotSha:$snapshotSha,testBackupRunId:$backupRun,testBackupSha:$backupSha,
   testBackupEncryptedSha256:$backupDigest,testDatabaseWritten:($mode=="exercise"),productionWritten:false,
   migrations:(if $mode=="exercise" then [112,113,114] else [] end),
   rollbackReverseVerified:($mode=="exercise"),reapplyVerified:($mode=="exercise"),
   coreTableCountsVerified:24,coreTableCountsUnchanged:true,oldColumnFingerprintsVerified:true,
   oldColumnFingerprintTables:24,featuresActivated:false,
   resumedV112RunId:$resumeRun,resumedV112Sha:$resumeSha,
   baselineScope:(if $resumeRun=="" then "restored-v111" else "fresh-backup-pristine-v112-after-reviewed-failure" end),
   priorFailedRunLegacyFingerprintsVerified:false,
   storageHttpUsed:false,edgeFunctionsDeployed:false,notificationWorkersStarted:false}
' >"$RUNNER_TEMP/crm-test-migrations-result.json"
printf 'Test CRM migration gate completed: %s. Core counts unchanged; production untouched.\n' "$MIGRATION_MODE"
