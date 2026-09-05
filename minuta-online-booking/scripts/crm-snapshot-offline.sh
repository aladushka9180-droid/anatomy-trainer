#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
test -f "${CRM_SOURCE_DUMP:?}"
test -d "${RUNNER_TEMP:?}"
script_dir="$(cd "$(dirname "$0")" && pwd)"
box="crm-offline-$GITHUB_RUN_ID"
private_log="$RUNNER_TEMP/crm-offline-private.log"
trap 'docker rm -f "$box" >/dev/null 2>&1 || true' EXIT
docker pull postgres:17 >/dev/null
docker run --detach --rm --network none --name "$box" --memory=3g --pids-limit=256 \
  -e POSTGRES_PASSWORD=isolated-ephemeral-only postgres:17 >/dev/null
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$box")" = none
for attempt in $(seq 1 30); do
  if docker exec "$box" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$box" pg_isready -U postgres >/dev/null
docker cp "$CRM_SOURCE_DUMP" "$box:/tmp/source.dump" >/dev/null
docker cp "$script_dir/crm-snapshot-offline-bootstrap.sql" "$box:/tmp/bootstrap.sql" >/dev/null
docker exec "$box" psql -U postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/bootstrap.sql >"$private_log" 2>&1
docker exec "$box" pg_restore --list /tmp/source.dump > "$RUNNER_TEMP/source.toc" 2>>"$private_log"
node "$script_dir/crm-snapshot-toc.mjs" toc "$RUNNER_TEMP/source.toc" "$RUNNER_TEMP/public.toc"
docker cp "$RUNNER_TEMP/public.toc" "$box:/tmp/public.toc" >/dev/null
for section in pre-data data post-data; do
  docker exec "$box" pg_restore --use-list=/tmp/public.toc --no-owner --no-privileges \
    --section="$section" --file="/tmp/$section.sql" /tmp/source.dump >>"$private_log" 2>&1
done
docker cp "$box:/tmp/post-data.sql" "$RUNNER_TEMP/public-post-data.sql" >/dev/null
node "$script_dir/crm-snapshot-toc.mjs" auth "$RUNNER_TEMP/public-post-data.sql" "$RUNNER_TEMP/auth-placeholders.sql"
docker cp "$RUNNER_TEMP/auth-placeholders.sql" "$box:/tmp/auth-placeholders.sql" >/dev/null
for phase in pre-data data auth-placeholders post-data; do
  if ! docker exec "$box" psql -U postgres -X -q -v ON_ERROR_STOP=1 -f "/tmp/$phase.sql" >>"$private_log" 2>&1; then
    echo "Offline snapshot load failed at $phase; private SQL output not published" >&2
    exit 1
  fi
done
# No raw data/schema/log is uploaded. Sanitizer must fail closed on unknown data.
docker cp "$script_dir/crm-snapshot-anonymize.sql" "$box:/tmp/anonymize.sql" >/dev/null
if ! docker exec "$box" psql -U postgres -X -q -v ON_ERROR_STOP=1 -f /tmp/anonymize.sql >>"$private_log" 2>&1; then
  echo 'Offline anonymization refused the snapshot; no testDB changes' >&2
  exit 1
fi
if ! docker exec "$box" pg_dump -U postgres --schema=public --format=custom --no-owner --no-privileges \
  --file=/tmp/anonymized.dump >>"$private_log" 2>&1; then
  echo 'Anonymized snapshot export failed; private output not published' >&2
  exit 1
fi
docker cp "$box:/tmp/anonymized.dump" "$RUNNER_TEMP/crm-anonymized.dump" >/dev/null
echo 'Offline snapshot prepared; target restore remains a separate guarded stage'
