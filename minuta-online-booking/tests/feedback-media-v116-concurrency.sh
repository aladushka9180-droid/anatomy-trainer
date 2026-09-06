#!/usr/bin/env bash
# Synthetic-only PostgreSQL 17 concurrency gate. Never a remote DB client.
# Reviewed API baseline: operations 4b42654b282e575b39b33058d50825bd903d5625.
# v116 git-blob SHA256: 74d4fc5237eff7b42c1a15854788a27ff556e2232faff7ae7673388201736495.
# Runtime execution remains pending until the frozen SQL and this gate are integrated
# at one reviewed SHA and an owner dispatches or pushes the sole integration branch.
set -Eeuo pipefail
umask 077
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_OS:-} == Linux ]]
case ${GITHUB_EVENT_NAME:-} in
  workflow_dispatch) ;;
  push)
    [[ ${GITHUB_REF:-} == refs/heads/codex/feedback-media-integration ]]
    [[ ${REVIEWED_SQL_SHA256:-} == 74d4fc5237eff7b42c1a15854788a27ff556e2232faff7ae7673388201736495 ]]
    ;;
  *) exit 1;;
esac
[[ ${GITHUB_REPOSITORY:-} == aladushka9180-droid/anatomy-trainer ]]
[[ ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[0-9]+$ ]]
[[ ${RELEASE_SHA:-} =~ ^[a-f0-9]{40}$ && ${REVIEWED_SQL_SHA256:-} =~ ^[a-f0-9]{64}$ ]]
[[ $RELEASE_SHA == "$GITHUB_SHA" && $SYNTHETIC_CONFIRM == SYNTHETIC_PG_V116_ONLY ]]
[[ -z ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} ]]
[[ -z ${MINUTA_TEST_DATABASE_URL:-} && -z ${MINUTA_PRODUCTION_DATABASE_URL:-} && -z ${DATABASE_URL:-} ]]
test "$(git rev-parse HEAD)" = "$RELEASE_SHA"
test -z "$(git status --porcelain)"
app="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test "$(sha256sum "$app/supabase-migration-v116.sql" | cut -d' ' -f1)" = "$REVIEWED_SQL_SHA256"

# Docker Official Image: https://hub.docker.com/_/postgres
# Published linux/amd64 digest and size (156170168 compressed bytes):
# https://github.com/docker-library/repo-info/blob/master/repos/postgres/remote/17.11-bookworm.md
# Verified 2026-09-06 against registry-1.docker.io/v2/library/postgres/manifests/<digest>:
# HTTP 200, Docker-Content-Digest identical. No floating tag or mirror fallback.
image='postgres:17.11-bookworm@sha256:7bade6d532592ca8ce7ee32def7399dad2607c4ea5583839fc4352a095a11ea6'
box="minuta-media-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
private="$(mktemp -d "$RUNNER_TEMP/minuta-media-concurrency.XXXXXXXX")"
phase=initialization
cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    printf 'FAIL synthetic v116 stage=%s exit=%s\n' "$phase" "$status" >&2
    # Only synthetic fixture/RPC errors are recorded. No credentials or real rows.
    find "$private" -maxdepth 1 -name '*.log' -type f -exec tail -n 12 {} \; >&2
  fi
  if [[ $(docker inspect --format '{{index .Config.Labels "minuta.synthetic.run"}}' "$box" 2>/dev/null || true) == "$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" ]]; then
    docker rm -f "$box" >/dev/null 2>&1 || true
  fi
  case "$(realpath "$private")" in "$(realpath "$RUNNER_TEMP")"/minuta-media-concurrency.*) rm -rf -- "$private";; esac
  exit "$status"
}
trap cleanup EXIT
docker pull --platform linux/amd64 "$image" >/dev/null
export POSTGRES_PASSWORD
POSTGRES_PASSWORD="$(openssl rand -hex 32)"
docker run --detach --rm --platform linux/amd64 --network none --name "$box" \
  --label "minuta.synthetic.run=$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT" \
  --memory=1g --pids-limit=128 --tmpfs /var/lib/postgresql/data:rw,size=512m \
  -e POSTGRES_PASSWORD -e POSTGRES_DB=minuta_media_test "$image" \
  postgres -c listen_addresses=127.0.0.1 -c max_connections=20 >/dev/null
unset POSTGRES_PASSWORD
test "$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$box")" = none
docker inspect "$box" | jq -e '.[0].HostConfig.PortBindings // {} | length==0' >/dev/null
for n in $(seq 1 100); do
  if docker exec "$box" pg_isready -h 127.0.0.1 -U postgres -d minuta_media_test >/dev/null 2>&1; then break; fi
  sleep 0.1
done
docker exec "$box" pg_isready -h 127.0.0.1 -U postgres -d minuta_media_test >/dev/null

db() {
  printf '%s\n' "$1" | docker exec -i -e "PGAPPNAME=${2:-media-observer}" \
    -e "PGOPTIONS=-c statement_timeout=70000 -c lock_timeout=50000" "$box" \
    psql -U postgres -d minuta_media_test -X -qAt -v ON_ERROR_STOP=1 -v VERBOSITY=verbose
}
assert_sql() { test "$(db "select ($1);")" = t || { echo "Assertion: $2" >&2; return 1; }; }
await_sql() {
  local until=$((SECONDS+35))
  until [[ $(db "select ($1);") == t ]]; do
    (( SECONDS < until )) || { echo "Barrier timed out: $2" >&2; return 1; }
    sleep 0.05
  done
}
uuid() { printf '00000000-0000-4000-8000-%012d' "$1"; }
as_actor() { printf "set local role authenticated; set local request.jwt.claim.sub='%s';" "$1"; }
legacy="public.create_minuta_feedback(null,'problem','Synthetic concurrency request',null,'/provider.html','test','synthetic',null)"
media() { printf "public.create_minuta_feedback_media_v3('%s',null,'problem','Synthetic concurrency request',null,'/provider.html','test','synthetic',%s)" "$1" "${2:-'[]'::jsonb}"; }
actor_lock() { printf "select pg_advisory_xact_lock(hashtextextended('feedback-media:%s',0));" "$1"; }
open_gate() { db "insert into media_test.gates(name) values('$1');" >/dev/null; }
release_gate() { db "update media_test.gates set released=true where name='$1';" >/dev/null; }
ready() { await_sql "exists(select 1 from pg_locks where locktype='advisory' and classid=116 and objid=$1 and granted)" "$2"; }
start_holder() {
  local name=$1 marker=$2 body=$3
  open_gate "$name"
  db "begin; $body select pg_advisory_xact_lock(116,$marker); select media_test.wait_gate('$name'); commit;" "$name" >"$private/$name.log" 2>&1 &
  holder_job=$!
  ready "$marker" "$name ready"
  holder_pid="$(db "select pid from pg_stat_activity where application_name='$name';")"
  [[ $holder_pid =~ ^[0-9]+$ ]]
}
start_worker() {
  db "begin; $(as_actor "$2") select $3; commit;" "$1" >"$private/$1.log" 2>&1 &
  worker_job=$!
}
two_waiters() {
  await_sql "(select count(*)=2 and count(distinct pid)=2 from pg_stat_activity where application_name in ('$1','$2') and cardinality(pg_blocking_pids(pid))>0)" 'two distinct waiting backends'
  db "select jsonb_agg(jsonb_build_object('pid',pid,'blocked_by',pg_blocking_pids(pid)) order by pid) from pg_stat_activity where application_name in ('$1','$2');"
}
wait_success() { wait "$1"; }
wait_status() { if wait "$1"; then last_status=0; else last_status=$?; fi; }
receipt() { grep -E '^\{' "$private/$1.log"; }

phase=bootstrap
assert_sql "current_database()='minuta_media_test' and current_user='postgres' and current_setting('server_version_num')::integer=170011" 'pinned PostgreSQL 17.11 only'
for file in tests/feedback-media-v116-concurrency-bootstrap.sql supabase-migration-v109.sql supabase-migration-v116.sql; do
  # Exactly two named migrations, on a brand-new synthetic database. Never 112–115/latest.
  db "$(cat "$app/$file")" >"$private/bootstrap.log" 2>&1
done
db 'update public.product_feedback_media_settings set enabled=true;' >/dev/null

cap_race() {
  local number=$1 left_kind=$2 right_kind=$3 actor req_left req_right left right j1 j2 s1 s2 winner
  actor=$(uuid "$number"); req_left=$(uuid "$((100+number))"); req_right=$(uuid "$((200+number))")
  phase="cap-$left_kind-$right_kind"
  db "begin; $(as_actor "$actor") do \$\$ begin for i in 1..19 loop perform $legacy; end loop; end \$\$; commit;" >"$private/seed.log" 2>&1
  start_holder "cap-hold-$number" "$number" "$(actor_lock "$actor")"
  left=$legacy; right=$legacy
  [[ $left_kind != media ]] || left=$(media "$req_left")
  [[ $right_kind != media ]] || right=$(media "$req_right")
  start_worker "cap-left-$number" "$actor" "$left"; j1=$worker_job
  start_worker "cap-right-$number" "$actor" "$right"; j2=$worker_job
  two_waiters "cap-left-$number" "cap-right-$number"
  release_gate "cap-hold-$number"; wait_success "$holder_job"
  wait_status "$j1"; s1=$last_status; wait_status "$j2"; s2=$last_status
  [[ $s1 == 0 && $s2 != 0 || $s1 != 0 && $s2 == 0 ]]
  grep -q 'feedback_daily_limit' "$private/cap-left-$number.log" "$private/cap-right-$number.log"
  assert_sql "(select count(*)=20 from public.product_feedback where reporter_user_id='$actor')" 'shared cap is exactly 20'
  # A duplicate media request remains replayable at the cap, not a new INSERT.
  winner=''
  if [[ $s1 == 0 && $left_kind == media ]]; then winner=$req_left; fi
  if [[ $s2 == 0 && $right_kind == media ]]; then winner=$req_right; fi
  if [[ -n $winner ]]; then
    db "begin; $(as_actor "$actor") select $(media "$winner"); commit;" >/dev/null
    assert_sql "(select count(*)=20 from public.product_feedback where reporter_user_id='$actor')" 'replay does not use daily capacity'
  fi
  echo "PASS shared 20/day: $left_kind versus $right_kind"
}
cap_race 1 legacy media
cap_race 2 media media
cap_race 3 legacy legacy

phase=same-key-idempotency
actor=$(uuid 4); request=$(uuid 404)
start_holder duplicate-hold 4 "$(actor_lock "$actor")"
start_worker duplicate-left "$actor" "$(media "$request")"; j1=$worker_job
start_worker duplicate-right "$actor" "$(media "$request")"; j2=$worker_job
two_waiters duplicate-left duplicate-right
release_gate duplicate-hold; wait_success "$holder_job"; wait_success "$j1"; wait_success "$j2"
test "$(receipt duplicate-left)" = "$(receipt duplicate-right)"
assert_sql "(select count(*)=1 from public.product_feedback where reporter_user_id='$actor') and (select count(*)=1 from public.product_feedback_media_requests where actor_id='$actor')" 'one feedback and immutable request row'
before=$(db "select md5(jsonb_build_array((select jsonb_agg(to_jsonb(f) order by id) from public.product_feedback f),(select jsonb_agg(to_jsonb(r) order by actor_id,request_id) from public.product_feedback_media_requests r))::text);")
if db "begin; $(as_actor "$actor") select public.create_minuta_feedback_media_v3('$request',null,'problem','A changed synthetic payload',null,'/provider.html','test','synthetic','[]'); commit;" >"$private/conflict.log" 2>&1; then exit 1; fi
grep -q feedback_request_payload_conflict "$private/conflict.log"
after=$(db "select md5(jsonb_build_array((select jsonb_agg(to_jsonb(f) order by id) from public.product_feedback f),(select jsonb_agg(to_jsonb(r) order by actor_id,request_id) from public.product_feedback_media_requests r))::text);")
test "$before" = "$after"
echo 'PASS concurrent exact-key receipts match; changed payload preserves full existing rows'

prepare_attachment() {
  actor=$(uuid "$1"); request=$(uuid "$((500+$1))"); attachment=$(uuid "$((600+$1))")
  object_path="$actor/$request/$attachment.webp"
  db "begin; $(as_actor "$actor") select public.reserve_minuta_feedback_upload_v3('$request','$attachment','photo.webp','image/webp',13); insert into storage.objects(bucket_id,name,metadata) values('product-feedback-media','$object_path','{\"size\":13,\"mimetype\":\"image/webp\"}'); commit;" >/dev/null
  attachments="jsonb_build_array(jsonb_build_object('path','$object_path','name','photo.webp','mime','image/webp','size',13))"
}
phase=create-before-cleanup-claim
prepare_attachment 5
# Pin create's transaction now() BEFORE choosing the committed TTL boundary.
# Actual v116 checks eligibility with now(), not clock_timestamp(). While create
# waits on its actor lock, the observer makes the reservation eligible for that
# transaction but expired for the later cleanup transaction. No launch-time TTL
# cushion or sleep controls correctness; all existing bounded barriers remain.
start_holder ttl-actor-hold 15 "$(actor_lock "$actor")"
ttl_job=$holder_job; ttl_pid=$holder_pid
open_gate create-hold
db "begin; $(as_actor "$actor") select $(media "$request" "$attachments"); select pg_advisory_xact_lock(116,5); select media_test.wait_gate('create-hold'); commit;" create-hold >"$private/create-hold.log" 2>&1 &
holder_job=$!
await_sql "exists(select 1 from pg_stat_activity where application_name='create-hold' and xact_start is not null and pid<>$ttl_pid and $ttl_pid=any(pg_blocking_pids(pid)))" 'create transaction pinned behind actor lock before TTL setup'
db "update public.product_feedback_media_uploads set created_at=(select xact_start from pg_stat_activity where application_name='create-hold')-interval '48 hours'+interval '1 second' where object_path='$object_path';" >/dev/null
assert_sql "(select u.state='reserved' and u.created_at>a.xact_start-interval '48 hours' from public.product_feedback_media_uploads u cross join pg_stat_activity a where u.object_path='$object_path' and a.application_name='create-hold')" 'committed reservation is eligible for pinned create transaction'
await_sql "(select created_at+interval '48 hours'<=clock_timestamp() from public.product_feedback_media_uploads where object_path='$object_path')" 'committed reservation expires for a later cleanup transaction'
release_gate ttl-actor-hold; wait_success "$ttl_job"
ready 5 'eligible create has executed and still holds reservation row'
create_pid="$(db "select pid from pg_stat_activity where application_name='create-hold';")"
[[ $create_pid =~ ^[0-9]+$ ]]
claim=$(db "begin; set local role service_role; select jsonb_build_object('pid',pg_backend_pid(),'result',public.claim_minuta_feedback_cleanup_v116()); commit;" claim-skip)
test "$(jq -r .pid <<<"$claim")" != "$create_pid"
test "$(jq '.result|length' <<<"$claim")" = 0
release_gate create-hold; wait_success "$holder_job"
assert_sql "(select state='linked' and feedback_id is not null and cleanup_token is null from public.product_feedback_media_uploads where object_path='$object_path')" 'claim skips uncommitted create and never leases linked row'
echo 'PASS pinned eligible create holds expired committed reservation; independent cleanup claim SKIP LOCKED returns no lease'

phase=cleanup-claim-before-create
prepare_attachment 6
db "update public.product_feedback_media_uploads set created_at=clock_timestamp()-interval '49 hours' where object_path='$object_path';" >/dev/null
start_holder claim-hold 6 'set local role service_role; select public.claim_minuta_feedback_cleanup_v116();'
claim_pid=$holder_pid
start_worker create-after-claim "$actor" "$(media "$request" "$attachments")"; j1=$worker_job
await_sql "exists(select 1 from pg_stat_activity where application_name='create-after-claim' and pid<>$claim_pid and $claim_pid=any(pg_blocking_pids(pid)))" 'create must wait for the cleanup row lock'
release_gate claim-hold; wait_success "$holder_job"; wait_status "$j1"; test "$last_status" != 0
grep -q feedback_attachment_missing "$private/create-after-claim.log"
assert_sql "(select state='cleanup' and cleanup_token is not null and feedback_id is null from public.product_feedback_media_uploads where object_path='$object_path') and not exists(select 1 from public.product_feedback where reporter_user_id='$actor') and (select count(*)=1 from storage.objects where name='$object_path')" 'claimed attachment cannot be linked or deleted by SQL'
echo 'PASS committed cleanup lease rejects waiting create; no feedback or physical Storage deletion'
phase=complete
echo "PASS synthetic PostgreSQL concurrency at $RELEASE_SHA; v116 SHA256=$REVIEWED_SQL_SHA256"
echo 'Not Storage HTTP, verified JWT, Supabase remote integration, production or operational rollout proof.'
