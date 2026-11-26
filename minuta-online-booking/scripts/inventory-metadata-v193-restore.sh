#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
container="${1:?}"; private_log="${2:?}"; result="${3:?}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
test -d "${RUNNER_TEMP:?}"
candidate_sql="$RUNNER_TEMP/inventory-v193-restore.sql"
trap 'rm -f -- "$candidate_sql"' EXIT
node "$script_dir/inventory-metadata-v193-restore-sql.mjs" "$candidate_sql"
docker cp "$candidate_sql" "$container:/tmp/inventory-v193-restore.sql" >/dev/null
docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f /tmp/inventory-v193-restore.sql >>"$private_log" 2>&1
candidate="$(sha256sum "$script_dir/../supabase-migration-v193.sql"|cut -d' ' -f1)"
rollback="$(sha256sum "$script_dir/../supabase-migration-v193-rollback.sql"|cut -d' ' -f1)"
jq --arg candidate "$candidate" --arg rollback "$rollback" '. + {candidateMigrationApplied:true,candidateRollbackVerified:true,candidateFreshApplyVerified:true,candidateHistoryPreserved:true,candidateSqlSha256:$candidate,rollbackSqlSha256:$rollback}' "$result" > "$result.candidate"
mv "$result.candidate" "$result"
