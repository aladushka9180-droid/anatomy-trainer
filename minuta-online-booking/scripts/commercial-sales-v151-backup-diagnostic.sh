#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
test -f "${MINUTA_RESTORE_SOURCE_DUMP:?}"
test -d "${RUNNER_TEMP:?}"

script_dir="$(cd "$(dirname "$0")" && pwd)"
container="minuta-v151-ddl-$GITHUB_RUN_ID"
image="${MINUTA_POSTGRES_IMAGE:?}"
expected_image_digest="${MINUTA_POSTGRES_IMAGE_DIGEST:?}"
[[ "$image" == postgres:17@sha256:* ]]
[[ "$expected_image_digest" =~ ^sha256:[a-f0-9]{64}$ ]]
test "${image##*@}" = "$expected_image_digest"
container_active=true
private_log="$RUNNER_TEMP/minuta-v151-ddl-private.log"
result="$RUNNER_TEMP/minuta-v151-backup-ddl-diagnostic.json"
stage=container-start

cleanup() {
  if [[ "$container_active" == true ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  rm -f -- "$private_log" "$RUNNER_TEMP/source.toc" "$RUNNER_TEMP/public.toc" \
    "$RUNNER_TEMP/public-ddl.toc" "$RUNNER_TEMP/public-post-data.sql" "$RUNNER_TEMP/filtered-post-data.sql" \
    "$RUNNER_TEMP/auth-placeholders.sql"
}
trap cleanup EXIT
trap 'code=$?; printf "v151 backup DDL diagnostic failed at stage %s (exit %s); private database output withheld\n" "$stage" "$code" >&2' ERR

docker pull "$image" >/dev/null
resolved_image_id="$(docker image inspect --format '{{.Id}}' "$image")"
[[ "$resolved_image_id" =~ ^sha256:[a-f0-9]{64}$ ]]
docker run --detach --rm --network none --name "$container" --memory=3g --pids-limit=256 \
  -e POSTGRES_PASSWORD=isolated-ephemeral-only "$image" >/dev/null
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
docker cp "$script_dir/commercial-sales-v151-backup-diagnostic.sql" "$container:/tmp/diagnostic.sql" >/dev/null
docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate -f /tmp/bootstrap.sql >"$private_log" 2>&1

stage=archive-list
docker exec "$container" pg_restore --list /tmp/source.dump > "$RUNNER_TEMP/source.toc" 2>>"$private_log"
node "$script_dir/crm-snapshot-toc.mjs" toc "$RUNNER_TEMP/source.toc" "$RUNNER_TEMP/public.toc"
awk '!/ (TABLE DATA|SEQUENCE SET|MATERIALIZED VIEW DATA) public /' \
  "$RUNNER_TEMP/public.toc" > "$RUNNER_TEMP/public-ddl.toc"
test -s "$RUNNER_TEMP/public-ddl.toc"
if grep -Eq ' (TABLE DATA|SEQUENCE SET|MATERIALIZED VIEW DATA) public ' "$RUNNER_TEMP/public-ddl.toc"; then
  echo 'DDL-only TOC unexpectedly contains data entries' >&2
  exit 1
fi
grep -q ' TABLE public commercial_sales ' "$RUNNER_TEMP/public-ddl.toc"
docker cp "$RUNNER_TEMP/public-ddl.toc" "$container:/tmp/public-ddl.toc" >/dev/null

for section in pre-data post-data; do
  stage="archive-$section"
  docker exec "$container" pg_restore --use-list=/tmp/public-ddl.toc --no-owner --no-privileges \
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

for phase in pre-data auth-placeholders post-data; do
  stage="load-$phase"
  if ! docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate -f "/tmp/$phase.sql" >>"$private_log" 2>&1; then
    echo "v151 backup DDL load failed at $phase; private SQL output withheld" >&2
    sed -nE 's/^(psql:\/tmp\/[a-z-]+\.sql:[0-9]+: ERROR:  [0-9A-Z]{5}):.*$/\1/p' \
      "$private_log" >&2
    exit 1
  fi
done

stage=catalog-diagnostic
if ! docker exec -i "$container" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 \
  -v VERBOSITY=sqlstate -f /tmp/diagnostic.sql >"$result" 2>>"$private_log"; then
  echo 'v151 catalog diagnostic failed; private database output withheld' >&2
  exit 1
fi

stage=validate-output
test -s "$result"
jq -e '
  .status == "success" and
  .operation == "commercial-sales-v151-backup-ddl-diagnostic" and
  .catalogOnly == true and
  .tableDataRestored == false and
  .rowsRead == false and
  .aclVerifiable == false and
  .ownerVerifiable == false and
  .referenceMayBeUsedAsProductionExpected == false and
  (.ddlFingerprint | test("^[a-f0-9]{64}$")) and
  (.ddlComponentFingerprints | length == 6) and
  (.ddlComponentMatches | length == 6)
' "$result" >/dev/null

server_version="$(docker exec "$container" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 \
  -c 'show server_version' 2>>"$private_log")"
server_version_num="$(docker exec "$container" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 \
  -c 'show server_version_num' 2>>"$private_log")"
[[ "$server_version_num" =~ ^17[0-9]{4}$ ]]

stage=destroy-container
docker rm -f "$container" >/dev/null
if docker inspect "$container" >/dev/null 2>&1; then
  echo 'v151 DDL diagnostic container still exists after removal' >&2
  exit 1
fi
container_active=false
jq --arg image "$image" --arg imageDigest "$expected_image_digest" --arg imageId "$resolved_image_id" \
  --arg serverVersion "$server_version" --arg serverVersionNum "$server_version_num" \
  '. + {
    networkMode:"none",
    postgresImage:$image,
    postgresImageDigest:$imageDigest,
    postgresImageId:$imageId,
    serverVersion:$serverVersion,
    serverVersionNum:$serverVersionNum,
    ephemeralContainerDestroyed:true,
    productionWritten:false,
    testDatabaseWritten:false
  }' "$result" > "$result.final"
chmod 600 "$result.final"
mv "$result.final" "$result"
jq -e '.ephemeralContainerDestroyed == true and .productionWritten == false and .testDatabaseWritten == false' \
  "$result" >/dev/null

echo 'v151 backup DDL diagnostic completed; isolated container destroyed'
