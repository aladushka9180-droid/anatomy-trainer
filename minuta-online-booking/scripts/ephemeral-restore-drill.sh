#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
test -f "${MINUTA_RESTORE_SOURCE_DUMP:?}"
test -d "${RUNNER_TEMP:?}"

script_dir="$(cd "$(dirname "$0")" && pwd)"
container="minuta-restore-$GITHUB_RUN_ID"
container_active=true
private_log="$RUNNER_TEMP/minuta-restore-private.log"
result="$RUNNER_TEMP/minuta-ephemeral-restore.json"
stage=container-start

cleanup() {
  if [[ "$container_active" == true ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  rm -f -- "$private_log" "$RUNNER_TEMP/source.toc" "$RUNNER_TEMP/public.toc" \
    "$RUNNER_TEMP/public-post-data.sql" "$RUNNER_TEMP/filtered-post-data.sql" \
    "$RUNNER_TEMP/auth-placeholders.sql"
}
trap cleanup EXIT
trap 'code=$?; printf "Ephemeral restore failed at stage %s (exit %s); private database output withheld\n" "$stage" "$code" >&2' ERR

docker pull postgres:17 >/dev/null
docker run --detach --rm --network none --name "$container" --memory=3g --pids-limit=256 \
  -e POSTGRES_PASSWORD=isolated-ephemeral-only postgres:17 >/dev/null
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none

for attempt in $(seq 1 30); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null

stage=bootstrap
docker cp "$MINUTA_RESTORE_SOURCE_DUMP" "$container:/tmp/source.dump" >/dev/null
docker cp "$script_dir/crm-snapshot-offline-bootstrap.sql" "$container:/tmp/bootstrap.sql" >/dev/null
docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate -f /tmp/bootstrap.sql >"$private_log" 2>&1

stage=archive-list
docker exec "$container" pg_restore --list /tmp/source.dump > "$RUNNER_TEMP/source.toc" 2>>"$private_log"
node "$script_dir/crm-snapshot-toc.mjs" toc "$RUNNER_TEMP/source.toc" "$RUNNER_TEMP/public.toc"
docker cp "$RUNNER_TEMP/public.toc" "$container:/tmp/public.toc" >/dev/null

for section in pre-data data post-data; do
  stage="archive-$section"
  docker exec "$container" pg_restore --use-list=/tmp/public.toc --no-owner --no-privileges \
    --section="$section" --file="/tmp/$section.sql" /tmp/source.dump >>"$private_log" 2>&1
done

docker cp "$container:/tmp/post-data.sql" "$RUNNER_TEMP/public-post-data.sql" >/dev/null
stage=strip-outbound-webhooks
node "$script_dir/crm-snapshot-postdata.mjs" \
  "$RUNNER_TEMP/public-post-data.sql" "$RUNNER_TEMP/filtered-post-data.sql"
docker cp "$RUNNER_TEMP/filtered-post-data.sql" "$container:/tmp/post-data.sql" >/dev/null

stage=auth-placeholders
node "$script_dir/crm-snapshot-toc.mjs" auth \
  "$RUNNER_TEMP/public-post-data.sql" "$RUNNER_TEMP/auth-placeholders.sql"
docker cp "$RUNNER_TEMP/auth-placeholders.sql" "$container:/tmp/auth-placeholders.sql" >/dev/null

for phase in pre-data data auth-placeholders post-data; do
  stage="load-$phase"
  if ! docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate -f "/tmp/$phase.sql" >>"$private_log" 2>&1; then
    echo "Ephemeral restore load failed at $phase; private SQL output withheld" >&2
    sed -nE 's/^(psql:\/tmp\/[a-z-]+\.sql:[0-9]+: ERROR:  [0-9A-Z]{5}):.*$/\1/p' \
      "$private_log" >&2
    exit 1
  fi
done

stage=validate-query
relations="$(docker exec "$container" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 \
  -c "select (to_regclass('public.services') is not null)::int||'|'||(to_regclass('public.bookings') is not null)::int;" \
  2>>"$private_log")"
if [[ "$relations" != "1|1" ]]; then
  echo "Required restored tables present (services|bookings): $relations" >&2
  exit 1
fi
if ! docker exec -i "$container" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate <<'SQL' > "$result" 2>>"$private_log"
select jsonb_build_object(
  'schemaVersion', 1,
  'status', 'success',
  'operation', 'ephemeral-production-backup-restore',
  'databaseEngine', current_setting('server_version'),
  'networkMode', 'none',
  'sourceScope', 'public-schema-and-data-with-inert-auth-uuid-placeholders',
  'restoredSchemas', jsonb_build_array('public'),
  'publicTables', (select count(*) from pg_tables where schemaname='public'),
  'publicFunctions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
  'publicIndexes', (select count(*) from pg_indexes where schemaname='public'),
  'publicForeignKeys', (
    select count(*) from pg_constraint c
    join pg_namespace n on n.oid=c.connamespace
    where n.nspname='public' and c.contype='f'
  ),
  'services', (select count(*) from public.services),
  'bookings', (select count(*) from public.bookings),
  'authUuidPlaceholders', (select count(*) from auth.users),
  'authUsersRestored', false,
  'managedSchemasRestored', false,
  'storageMetadataRestored', false,
  'storageObjectsRestored', false,
  'outboundWebhooksRestored', false,
  'productionWritten', false,
  'testDatabaseWritten', false,
  'ephemeralContainerDestroyed', false
)
where to_regclass('public.services') is not null
  and to_regclass('public.bookings') is not null;
SQL
then
  echo 'Ephemeral restore validation query failed; private database output withheld' >&2
  sed -nE 's/^(ERROR:  [0-9A-Z]{5}):.*$/\1/p' "$private_log" >&2
  exit 1
fi

stage=validate-contract
test -s "$result"
jq '{status,publicTables,publicFunctions,publicIndexes,publicForeignKeys,services,bookings,networkMode,productionWritten,testDatabaseWritten}' \
  "$result"
if ! jq -e '
  .status == "success" and
  .publicTables > 0 and
  .publicFunctions > 0 and
  .publicIndexes > 0 and
  .services > 0 and
  .bookings >= 0 and
  .networkMode == "none" and
  .restoredSchemas == ["public"] and
  .authUsersRestored == false and
  .managedSchemasRestored == false and
  .storageMetadataRestored == false and
  .storageObjectsRestored == false and
  .outboundWebhooksRestored == false and
  .productionWritten == false and
  .testDatabaseWritten == false
' "$result" >/dev/null; then
  jq '{status,publicTables,publicFunctions,publicIndexes,publicForeignKeys,services,bookings,networkMode,productionWritten,testDatabaseWritten}' \
    "$result" >&2
  exit 1
fi

stage=destroy-container
docker rm -f "$container" >/dev/null
if docker inspect "$container" >/dev/null 2>&1; then
  echo 'Ephemeral restore container still exists after removal' >&2
  exit 1
fi
container_active=false
jq '.ephemeralContainerDestroyed = true' "$result" > "$result.final"
chmod 600 "$result.final"
mv "$result.final" "$result"
jq -e '.ephemeralContainerDestroyed == true' "$result" >/dev/null

echo "Ephemeral production backup restore validated; isolated container destroyed"
