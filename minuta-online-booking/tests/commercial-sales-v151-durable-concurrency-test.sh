#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"
: "${MINUTA_TEST_PROJECT_REF:?MINUTA_TEST_PROJECT_REF is required}"
: "${MINUTA_PRODUCTION_PROJECT_REF:?MINUTA_PRODUCTION_PROJECT_REF is required}"
db="${MINUTA_TEST_DATABASE_URL/:6543/:5432}"
run_key="${1:?run key is required}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="${RUNNER_TEMP:-/tmp}/v151-durable-${run_key}"
mkdir -p "$tmp"
app_a="v151-${run_key}-a"
app_b="v151-${run_key}-b"
pid_a=''
pid_b=''
stop_children() {
  for pid in "$pid_a" "$pid_b"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  done
  psql "$db" -X -q -v ON_ERROR_STOP=1 --set=app_a="$app_a" --set=app_b="$app_b" >/dev/null 2>&1 <<'SQL' || true
  select pg_terminate_backend(pid)
  from pg_catalog.pg_stat_activity
  where pid<>pg_backend_pid() and application_name in(:'app_a',:'app_b');
SQL
  for pid in "$pid_a" "$pid_b"; do
    if [[ -n "$pid" ]]; then wait "$pid" 2>/dev/null || true; fi
  done
}
finish() {
  local rc=$?
  local cleanup_rc=0
  trap - EXIT
  set +e
  stop_children
  psql "$db" -X -q -v ON_ERROR_STOP=1 -v run_key="$run_key" -f "$root/tests/commercial-sales-v151-durable-cleanup.sql" || cleanup_rc=1
  psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase-migration-v148.sql" || cleanup_rc=1
  psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase-migration-v149.sql" || cleanup_rc=1
  psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase-migration-v150.sql" || cleanup_rc=1
  psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase-migration-v151.sql" || cleanup_rc=1
  if (( rc == 0 && cleanup_rc != 0 )); then rc=$cleanup_rc; fi
  exit "$rc"
}

test "$MINUTA_TEST_PROJECT_REF" != "$MINUTA_PRODUCTION_PROJECT_REF"
marker="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 --set=expected_ref="$MINUTA_TEST_PROJECT_REF" <<'SQL'
select count(*) from minuta_migration_guard.target where project_ref=:'expected_ref' and allow_migrations is true;
SQL
)"
test "$(tr -d '[:space:]' <<<"$marker")" = 1
state="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -f "$root/scripts/commercial-sales-v151-state.sql" | grep '^{' | tail -n 1)"
jq -e '.classification=="exact" and .criticalSchemaExact' <<<"$state" >/dev/null
trap finish EXIT

psql "$db" -X -q -v ON_ERROR_STOP=1 -v run_key="$run_key" -f "$root/tests/commercial-sales-v151-durable-setup.sql"
read -r owner seller org client product cash request_a request_b request_c <<<"$(
  psql "$db" -X -qAt -F ' ' -v ON_ERROR_STOP=1 --set=run_key="$run_key" <<'SQL'
select owner_id,seller_id,organization_id,client_id,product_id,cash_id,
  request_from_v147,request_from_v151,request_concurrent
from minuta_v151_test.fixture where run_key=:'run_key';
SQL
)"

call_v147() {
  local request="$1"
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c "select set_config('request.jwt.claim.sub','$owner',false); select public.sell_minuta_commercial_product_v147('$org',null,'$client','benefit_product','$product',null,null,1,300000,0,'cash','$cash','$request');" | grep '^{' | tail -n 1
}
call_v151() {
  local request="$1" requested_seller="${2:-$owner}"
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c "select set_config('request.jwt.claim.sub','$owner',false); select public.sell_minuta_commercial_product_v151('$org',null,'$client','$requested_seller','benefit_product','$product',null,null,1,300000,0,'cash','$cash','$request');" | grep '^{' | tail -n 1
}
counts() {
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c "with chosen as(select id from public.commercial_sales where organization_id='$org' and request_id in('$request_a','$request_b')) select json_build_object('sales',(select count(*) from chosen),'lines',(select count(*) from public.commercial_sale_lines where sale_id in(select id from chosen)),'instruments',(select count(*) from public.client_benefit_instruments where id in(select benefit_instrument_id from public.commercial_sale_lines where sale_id in(select id from chosen))),'transactions',(select count(*) from public.financial_transactions where source_type='commercial_sale' and source_id in(select id from chosen)),'postings',(select count(*) from public.financial_postings where transaction_id in(select id from public.financial_transactions where source_type='commercial_sale' and source_id in(select id from chosen))),'audit',(select count(*) from public.commercial_audit_log where subject_id in(select id from chosen)));"
}

a_v147="$(call_v147 "$request_a")"
a_v151="$(call_v151 "$request_a")"
test "$(jq -r .id <<<"$a_v147")" = "$(jq -r .id <<<"$a_v151")"
test "$(jq -r .replayed <<<"$a_v151")" = true

b_v151="$(call_v151 "$request_b")"
before_rollback="$(counts)"
jq -e '.sales==2 and .lines==2 and .instruments==2 and .transactions==2 and .postings==4 and .audit==2' <<<"$before_rollback" >/dev/null
psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase-migration-v151-rollback.sql"
test "$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c "select to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null")" = t
test "$(jq -S . <<<"$(counts)")" = "$(jq -S . <<<"$before_rollback")"
b_v147="$(call_v147 "$request_b")"
test "$(jq -r .id <<<"$b_v151")" = "$(jq -r .id <<<"$b_v147")"
test "$(jq -r .replayed <<<"$b_v147")" = true

psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase-migration-v151.sql"
psql "$db" -X -q -v ON_ERROR_STOP=1 -f "$root/supabase-migration-v151.sql"
a_replay="$(call_v151 "$request_a")"
b_replay="$(call_v151 "$request_b")"
test "$(jq -r .id <<<"$a_replay")" = "$(jq -r .id <<<"$a_v147")"
test "$(jq -r .id <<<"$b_replay")" = "$(jq -r .id <<<"$b_v151")"
test "$(jq -r .replayed <<<"$a_replay")" = true
test "$(jq -r .replayed <<<"$b_replay")" = true
test "$(jq -S . <<<"$(counts)")" = "$(jq -S . <<<"$before_rollback")"
if call_v151 "$request_b" "$seller" >"$tmp/seller-conflict.log" 2>&1; then
  echo 'seller change reused a request id' >&2
  exit 1
fi
grep -q 'commercial_sale_idempotency_conflict' "$tmp/seller-conflict.log"

PGAPPNAME="$app_a" psql "$db" -X -qAt -v ON_ERROR_STOP=1 >"$tmp/a.log" <<SQL &
begin;
select set_config('request.jwt.claim.sub','$owner',false);
select public.sell_minuta_commercial_product_v151('$org',null,'$client','$owner','benefit_product','$product',null,null,1,300000,0,'cash','$cash','$request_c');
select pg_advisory_xact_lock(hashtextextended('$run_key:signal',0));
select pg_sleep(6);
commit;
SQL
pid_a=$!
signalled=false
for _ in {1..40}; do
  if psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c "select not pg_try_advisory_lock(hashtextextended('$run_key:signal',0))" | grep -qx t; then
    signalled=true
    break
  fi
  sleep 0.25
done
test "$signalled" = true
PGAPPNAME="$app_b" psql "$db" -X -qAt -v ON_ERROR_STOP=1 >"$tmp/b.log" <<SQL &
select set_config('request.jwt.claim.sub','$owner',false);
select public.sell_minuta_commercial_product_v151('$org',null,'$client','$owner','benefit_product','$product',null,null,1,300000,0,'cash','$cash','$request_c');
SQL
pid_b=$!

observed=false
for _ in {1..20}; do
  if psql "$db" -X -qAt -v ON_ERROR_STOP=1 --set=app="$app_b" <<'SQL' | grep -qx t; then
select exists(
  select 1 from pg_catalog.pg_stat_activity
  where application_name=:'app' and state='active' and wait_event_type='Lock'
);
SQL
    observed=true
    break
  fi
  sleep 0.25
done
test "$observed" = true
wait "$pid_a"
wait "$pid_b"

result_a="$(grep '^{' "$tmp/a.log" | tail -n 1)"
result_b="$(grep '^{' "$tmp/b.log" | tail -n 1)"
test "$(jq -r .id <<<"$result_a")" = "$(jq -r .id <<<"$result_b")"
test "$(printf '%s\n%s\n' "$(jq -r .replayed <<<"$result_a")" "$(jq -r .replayed <<<"$result_b")" | sort | tr '\n' ' ')" = "false true "
psql "$db" -X -qAt -v ON_ERROR_STOP=1 -c "with sale as(select id from public.commercial_sales where organization_id='$org' and request_id='$request_c') select json_build_object('sales',(select count(*) from sale),'lines',(select count(*) from public.commercial_sale_lines where sale_id in(select id from sale)),'instruments',(select count(*) from public.client_benefit_instruments where id in(select benefit_instrument_id from public.commercial_sale_lines where sale_id in(select id from sale))),'transactions',(select count(*) from public.financial_transactions where source_type='commercial_sale' and source_id in(select id from sale)),'postings',(select count(*) from public.financial_postings where transaction_id in(select id from public.financial_transactions where source_type='commercial_sale' and source_id in(select id from sale))),'audit',(select count(*) from public.commercial_audit_log where subject_id in(select id from sale)))" \
  | jq -e '.sales==1 and .lines==1 and .instruments==1 and .transactions==1 and .postings==2 and .audit==1' >/dev/null

jq -n --argjson before "$before_rollback" '{mixedVersionReplayBothDirections:true,committedRollbackPersistence:true,twoPsqlConnections:true,observedLockWait:true,singleCommittedSale:true,beforeRollback:$before}' >"$tmp/result.json"
