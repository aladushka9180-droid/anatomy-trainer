#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
test -f "${CRM_SOURCE_DUMP:?}"
test -d "${RUNNER_TEMP:?}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
box="crm-offline-$GITHUB_RUN_ID"
private_log="$RUNNER_TEMP/crm-offline-private.log"
stage=container-start
trap 'code=$?; printf "Offline preparation failed at stage %s (exit %s); private output withheld\n" "$stage" "$code" >&2' ERR
trap 'docker rm -f "$box" >/dev/null 2>&1 || true' EXIT
docker pull postgres:17 >/dev/null
docker run --detach --rm --network none --name "$box" --memory=3g --pids-limit=256 \
  -e POSTGRES_PASSWORD=isolated-ephemeral-only postgres:17 >/dev/null
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$box")" = none
for attempt in $(seq 1 30); do
  # The image starts a temporary socket-only server during initialization.
  # Wait for the final TCP listener, not that short-lived bootstrap server.
  if docker exec "$box" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$box" pg_isready -h 127.0.0.1 -U postgres >/dev/null
stage=bootstrap
docker cp "$CRM_SOURCE_DUMP" "$box:/tmp/source.dump" >/dev/null
docker cp "$script_dir/crm-snapshot-offline-bootstrap.sql" "$box:/tmp/bootstrap.sql" >/dev/null
docker exec "$box" psql -U postgres -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f /tmp/bootstrap.sql >"$private_log" 2>&1
stage=archive-list
docker exec "$box" pg_restore --list /tmp/source.dump > "$RUNNER_TEMP/source.toc" 2>>"$private_log"
node "$script_dir/crm-snapshot-toc.mjs" toc "$RUNNER_TEMP/source.toc" "$RUNNER_TEMP/public.toc"
docker cp "$RUNNER_TEMP/public.toc" "$box:/tmp/public.toc" >/dev/null
for section in pre-data data post-data; do
  stage="archive-$section"
  docker exec "$box" pg_restore --use-list=/tmp/public.toc --no-owner --no-privileges \
    --section="$section" --file="/tmp/$section.sql" /tmp/source.dump >>"$private_log" 2>&1
done
docker cp "$box:/tmp/post-data.sql" "$RUNNER_TEMP/public-post-data.sql" >/dev/null
stage=auth-placeholders
node "$script_dir/crm-snapshot-toc.mjs" auth "$RUNNER_TEMP/public-post-data.sql" "$RUNNER_TEMP/auth-placeholders.sql"
docker cp "$RUNNER_TEMP/auth-placeholders.sql" "$box:/tmp/auth-placeholders.sql" >/dev/null
for phase in pre-data data auth-placeholders post-data; do
  stage="load-$phase"
  if ! docker exec "$box" psql -U postgres -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f "/tmp/$phase.sql" >>"$private_log" 2>&1; then
    echo "Offline snapshot load failed at $phase; private SQL output not published" >&2
    grep -E '^psql:/tmp/[a-z-]+\.sql:[0-9]+: ERROR:  [0-9A-Z]{5}$' "$private_log" >&2 || true
    exit 1
  fi
done
stage=structure-metadata
docker exec "$box" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 -c \
  "select jsonb_build_object('columns',(select jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name) order by table_name,ordinal_position) from information_schema.columns where table_schema='public'),'foreignKeys',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'target',confrelid::regclass::text,'definition',pg_get_constraintdef(oid))) from pg_constraint where contype='f' and connamespace='public'::regnamespace));" \
  > "$RUNNER_TEMP/crm-snapshot-structure.json" 2>>"$private_log"
# No raw data/schema/log is uploaded. Sanitizer must fail closed on unknown data.
docker cp "$script_dir/crm-snapshot-anonymize.sql" "$box:/tmp/anonymize.sql" >/dev/null
stage=anonymize
if ! docker exec "$box" psql -U postgres -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=sqlstate -f /tmp/anonymize.sql >>"$private_log" 2>&1; then
  echo 'Offline anonymization refused the snapshot; no testDB changes' >&2
  grep -E '^psql:/tmp/anonymize\.sql:[0-9]+: ERROR:  [0-9A-Z]{5}$' "$private_log" >&2 || true
  exit 1
fi
stage=export
if ! docker exec "$box" pg_dump -U postgres --schema=public --format=custom --no-owner --no-privileges \
  --file=/tmp/anonymized.dump >>"$private_log" 2>&1; then
  echo 'Anonymized snapshot export failed; private output not published' >&2
  exit 1
fi
docker cp "$box:/tmp/anonymized.dump" "$RUNNER_TEMP/crm-anonymized.dump" >/dev/null
echo 'Offline snapshot prepared; target restore remains a separate guarded stage'
