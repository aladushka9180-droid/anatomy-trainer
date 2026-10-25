#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

[[ "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]]
test -d "${RUNNER_TEMP:?}"
test -n "${MINUTA_TEST_DATABASE_URL:-}"

root="$(cd "$(dirname "$0")/.." && pwd)"
private="$RUNNER_TEMP/v173-test-schema-$GITHUB_RUN_ID"
container="minuta-v173-schema-$GITHUB_RUN_ID"
log="$private/private.log"
stage=guard
container_active=false
mkdir -m 700 "$private"

cleanup() {
  if [[ "$container_active" == true ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -f -- "$private"/*
  rmdir -- "$private"
}
trap cleanup EXIT
trap 'code=$?; printf "v173 full test-schema rehearsal failed at %s (exit %s); private SQL withheld\n" "$stage" "$code" >&2' ERR

node --input-type=module <<'JS'
import assert from 'node:assert/strict';
const url = new URL(process.env.MINUTA_TEST_DATABASE_URL);
const ref = 'umazhvvxutnsyuphbhda';
const user = decodeURIComponent(url.username);
assert(['postgres:', 'postgresql:'].includes(url.protocol));
assert(url.pathname === '/postgres');
assert(['', '5432', '6543'].includes(url.port));
assert((url.hostname === `db.${ref}.supabase.co` && user === 'postgres') ||
  (url.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${ref}`));
assert(url.password);
assert([...url.searchParams.keys()].every(key => ['sslmode', 'pgbouncer'].includes(key)));
JS

stage=read-only-schema-dump
test_url="${MINUTA_TEST_DATABASE_URL/:6543/:5432}"
PGSSLMODE=require PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=5s' \
  /usr/lib/postgresql/17/bin/pg_dump --dbname="$test_url" --format=custom \
  --schema=public --schema-only --no-owner --no-privileges --no-comments \
  --no-publications --no-subscriptions --no-blobs --file="$private/schema.dump" >"$log" 2>&1

stage=filter-schema
/usr/lib/postgresql/17/bin/pg_restore --list "$private/schema.dump" > "$private/source.toc"
node "$root/tests/abuse-guards-v173-schema-toc.mjs" "$private/source.toc" "$private/public.toc"
for section in pre-data post-data; do
  /usr/lib/postgresql/17/bin/pg_restore --use-list="$private/public.toc" \
    --no-owner --no-privileges --section="$section" \
    --file="$private/$section.sql" "$private/schema.dump" >>"$log" 2>&1
done
node "$root/scripts/crm-snapshot-postdata.mjs" "$private/post-data.sql" "$private/filtered-post-data.sql" >>"$log" 2>&1

stage=start-offline-container
docker pull postgres:17@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675 >/dev/null
docker run --detach --rm --network none --name "$container" --memory=3g --pids-limit=256 \
  -e POSTGRES_PASSWORD=isolated-v173-only \
  postgres:17@sha256:67f41722b7a8cbdb868a44a4995c846eddfdc2973bccb291ce937dce88ad5675 >/dev/null
container_active=true
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$container")" = none
for attempt in $(seq 1 30); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null

for name in bootstrap pre-data filtered-post-data v173 v173-rollback integration; do
  case "$name" in
    bootstrap) source="$root/scripts/crm-snapshot-offline-bootstrap.sql" ;;
    v173) source="$root/supabase-migration-v173.sql" ;;
    v173-rollback) source="$root/supabase-migration-v173-rollback.sql" ;;
    integration) source="$root/tests/abuse-guards-v173-integration.sql" ;;
    *) source="$private/$name.sql" ;;
  esac
  docker cp "$source" "$container:/tmp/$name.sql" >/dev/null
done

for phase in bootstrap pre-data filtered-post-data v173 v173 integration v173-rollback v173 integration; do
  stage="offline-$phase"
  if ! docker exec "$container" psql -U postgres -X -q -v ON_ERROR_STOP=1 \
    -v VERBOSITY=sqlstate -f "/tmp/$phase.sql" >>"$log" 2>&1; then
    echo "v173 full test-schema rehearsal failed at $phase; private SQL withheld" >&2
    sed -nE 's/^(psql:\/tmp\/[^:]+:[0-9]+: ERROR:  [0-9A-Z]{5}):.*$/\1/p' "$log" >&2
    exit 1
  fi
done

stage=verify
result="$(docker exec "$container" psql -U postgres -X -q -At -v ON_ERROR_STOP=1 \
  -c "select count(*)::text||'|'||(to_regclass('public.minuta_abuse_rate_buckets_v173') is not null)::text from pg_tables where schemaname='public'" 2>>"$log")"
[[ "$result" =~ ^[0-9]+\|true$ ]]
tables="${result%%|*}"
test "$tables" -gt 50

stage=destroy
docker rm -f "$container" >/dev/null
container_active=false
echo "PASS: v173 apply/reapply/integration/rollback/reapply on $tables restored public test-schema tables in a network-isolated PostgreSQL 17"
