#!/usr/bin/env bash
# Existing offline restore container only. No live connection or outbound network.
set -Eeuo pipefail
umask 077
container="${1:?}"
private_log="${2:?}"
result="${3:?}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
test -d "${RUNNER_TEMP:?}"
trap 'rm -f -- "$RUNNER_TEMP/v192-restore.sql"' EXIT
node "$script_dir/day-actions-v192-restore-sql.mjs" "$RUNNER_TEMP/v192-restore.sql"
docker cp "$RUNNER_TEMP/v192-restore.sql" "$container:/tmp/v192-restore.sql" >/dev/null
docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f /tmp/v192-restore.sql >>"$private_log" 2>&1
candidate="$(sha256sum "$script_dir/../supabase-migration-v192.sql"|cut -d' ' -f1)"
rollback="$(sha256sum "$script_dir/../supabase-migration-v192-rollback.sql"|cut -d' ' -f1)"
jq --arg candidate "$candidate" --arg rollback "$rollback" '. + {candidateMigrationApplied:true,candidateRollbackVerified:true,candidateFreshApplyVerified:true,candidateHistoryPreserved:true,candidateSqlSha256:$candidate,rollbackSqlSha256:$rollback}' "$result" > "$result.candidate"
mv "$result.candidate" "$result"
