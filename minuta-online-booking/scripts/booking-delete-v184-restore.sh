#!/usr/bin/env bash
# Invoked only for v184 by the existing network-disabled restore drill.
set -Eeuo pipefail
umask 077
container="${1:?}"
private_log="${2:?}"
result="${3:?}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
test -d "${RUNNER_TEMP:?}"
cleanup_v184() {
  rm -f -- "$RUNNER_TEMP/v184-restore-apply.sql" "$RUNNER_TEMP/v184-restore-rollback.sql" \
    "$RUNNER_TEMP/v184-restore-certificate.json"
}
trap cleanup_v184 EXIT

node "$script_dir/booking-delete-v184-release-sql.mjs" verify
cmp "$MINUTA_RESTORE_MIGRATION_SQL" "$script_dir/../supabase-migration-v184.sql"
cmp "$MINUTA_RESTORE_ROLLBACK_SQL" "$script_dir/../supabase-migration-v184-rollback.sql"
node "$script_dir/booking-delete-v184-release-sql.mjs" apply "$RUNNER_TEMP/v184-restore-apply.sql"
node "$script_dir/booking-delete-v184-release-sql.mjs" rollback "$RUNNER_TEMP/v184-restore-rollback.sql"
for phase in apply rollback; do
  docker cp "$RUNNER_TEMP/v184-restore-$phase.sql" "$container:/tmp/v184-$phase.sql" >/dev/null
done

# The backup intentionally omits ACLs. Reconstruct this one audited RPC contract
# only in the offline clone, before the preservation baseline. Production ACLs
# are independently checked read-only and preserved transactionally at release.
docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
  -c 'revoke all on function public.provider_delete_booking(uuid) from public, anon, authenticated, service_role;
      grant execute on function public.provider_delete_booking(uuid) to authenticated;' >>"$private_log" 2>&1
baseline="$(docker exec "$container" psql -U postgres -X -qAt -v ON_ERROR_STOP=1 \
  -c "select md5(pg_get_functiondef('public.provider_delete_booking(uuid)'::regprocedure));" 2>>"$private_log")"
test -n "$baseline"
candidate_sha="$(node -p "require('$script_dir/../recovery/booking-delete-v184-manifest.json').candidateSha256")"
rollback_sha="$(node -p "require('$script_dir/../recovery/booking-delete-v184-manifest.json').rollbackSha256")"
for phase in apply rollback apply; do
  docker exec "$container" psql -U postgres -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate \
    -f "/tmp/v184-$phase.sql" > "$RUNNER_TEMP/v184-restore-certificate.json" 2>>"$private_log"
  jq -e --arg operation "$phase" --arg candidate "$candidate_sha" --arg rollback "$rollback_sha" '
    .status == "success" and .operation == $operation and .candidateVersion == "v184" and
    .businessRowsChanged == false and .historyPreserved == true and .securityPreserved == true and
    .deletionInvoked == false and .candidateSqlSha256 == $candidate and .rollbackSqlSha256 == $rollback
  ' "$RUNNER_TEMP/v184-restore-certificate.json" >/dev/null
  if test "$phase" = rollback; then
    test "$(docker exec "$container" psql -U postgres -X -qAt -v ON_ERROR_STOP=1 \
      -c "select md5(pg_get_functiondef('public.provider_delete_booking(uuid)'::regprocedure));" 2>>"$private_log")" = "$baseline"
  fi
done
jq --arg candidate "$candidate_sha" --arg rollback "$rollback_sha" '. + {
  candidateMigrationApplied:true,candidateRollbackVerified:true,candidateReapplied:true,
  candidateHistoryPreserved:true,candidateSecurityPreserved:true,deletionInvoked:false,
  candidateSqlSha256:$candidate,rollbackSqlSha256:$rollback,rpcAclReconstructed:true
}' "$result" > "$result.candidate"
mv "$result.candidate" "$result"
