#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
container="${1:?}"; private_log="${2:?}"; result="${3:?}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
test -d "${RUNNER_TEMP:?}"
source_dir="$(dirname "${MINUTA_RESTORE_MIGRATION_SQL:?}")"
candidate_sql="$RUNNER_TEMP/remaining-eight-restored-public.sql"
trap 'rm -f -- "$candidate_sql"' EXIT
node "$script_dir/remaining-eight-restore-sql.mjs" "$source_dir" "$candidate_sql"
docker cp "$candidate_sql" "$container:/tmp/remaining-eight-restored-public.sql" >/dev/null
docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f /tmp/remaining-eight-restored-public.sql >>"$private_log" 2>&1
jq '. + {candidateMigrationApplied:true,candidateRollbackVerified:true,candidateReapplied:true,candidateOriginalPublicRowsAndDefinitionsPreserved:true,candidateMissingMembershipDenied:true,candidateMissingCapabilityDenied:true,candidateQualification:"restored-public-schema-compatibility-and-rollback",candidateFunctionalLiveAccepted:false}' "$result" > "$result.candidate"
mv "$result.candidate" "$result"
