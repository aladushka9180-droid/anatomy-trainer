#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"
node minuta-online-booking/scripts/migration-config-guard.mjs

booking_id="00000000-0000-4000-8000-000000129101"
booking_request="00000000-0000-4000-8000-000000129102"
account_request="00000000-0000-4000-8000-000000129103"
post_one="00000000-0000-4000-8000-000000129104"
post_two="00000000-0000-4000-8000-000000129105"
hold_key="129129101"

cleanup() {
  psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=0 \
    -v booking_id="$booking_id" -v account_request="$account_request" <<'SQL' >/dev/null
begin;
create temp table v129_cleanup_organizations(organization_id uuid primary key) on commit drop;
insert into v129_cleanup_organizations
select organization_id from public.financial_accounts where creation_request_id=:'account_request'::uuid
union
select organization_id from public.bookings where id=:'booking_id'::uuid
on conflict do nothing;
set session_replication_role=replica;
delete from public.financial_postings where transaction_id in(
  select id from public.financial_transactions where source_id=:'booking_id'::uuid
     or reversal_of in(select id from public.financial_transactions where source_id=:'booking_id'::uuid)
);
delete from public.financial_transactions where source_id=:'booking_id'::uuid
   or reversal_of in(select id from public.financial_transactions where source_id=:'booking_id'::uuid);
delete from public.booking_outcomes where booking_id=:'booking_id'::uuid;
delete from public.bookings where id=:'booking_id'::uuid;
delete from public.financial_accounts account where account.organization_id in(
  select organization_id from v129_cleanup_organizations
) and not exists(
  select 1 from public.financial_postings posting where posting.account_id=account.id
);
delete from public.organization_finance_settings setting where setting.organization_id in(
  select organization_id from v129_cleanup_organizations
) and not exists(
  select 1 from public.financial_accounts account where account.organization_id=setting.organization_id
);
set session_replication_role=origin;
commit;
SQL
}
trap cleanup EXIT
cleanup

IFS='|' read -r owner_id organization_id seed_booking < <(
  psql "$MINUTA_TEST_DATABASE_URL" -X -qAt -F '|' -v ON_ERROR_STOP=1 <<'SQL'
select membership.user_id,membership.organization_id,booking.id
from public.organization_memberships membership
join public.bookings booking on booking.organization_id=membership.organization_id
where membership.active and membership.role in('owner','admin')
  and not exists(select 1 from public.organization_finance_settings setting
    where setting.organization_id=membership.organization_id)
order by booking.created_at desc limit 1;
SQL
)
if [[ -z "${seed_booking:-}" ]]; then
  echo "v129 concurrency test requires an organization without finance data" >&2
  exit 1
fi

psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v owner_id="$owner_id" -v organization_id="$organization_id" \
  -v seed_booking="$seed_booking" -v booking_id="$booking_id" \
  -v booking_request="$booking_request" -v account_request="$account_request" <<'SQL' >/dev/null
set session_replication_role=replica;
insert into public.bookings
select (jsonb_populate_record(null::public.bookings,to_jsonb(seed)||jsonb_build_object(
  'id',:'booking_id','booking_code','V129-CONCURRENCY','manage_token',gen_random_uuid(),
  'request_id',:'booking_request','request_fingerprint',repeat('1',64),
  'client_name','V129 synthetic fixture','client_phone','0000000000',
  'booking_date','1901-01-01','booking_time','00:00:00','slot_start',null,'slot_end',null,
  'status','confirmed','deposit_amount_rub',0,'payment_status','not_required',
  'payment_url','','series_id',null,'series_occurrence',null,
  'created_at',now(),'updated_at',now()
))).* from public.bookings seed where seed.id=:'seed_booking'::uuid;
insert into public.booking_outcomes(
  booking_id,performer_id,visit_status,payment_method,amount_rub,
  calculated_amount_rub,completion_source,updated_at
)
select :'booking_id'::uuid,performer_id,'completed','cash',600,1000,'manual',now()
from public.bookings where id=:'booking_id'::uuid;
set session_replication_role=origin;
select set_config('request.jwt.claim.sub',:'owner_id',false);
set role authenticated;
select public.set_minuta_finance_enabled_v129(:'organization_id'::uuid,true);
select public.create_minuta_financial_account_v129(
  :'organization_id'::uuid,:'account_request'::uuid,'V129 concurrency cash','cash'
);
reset role;
SQL

account_id="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt -v account_request="$account_request" \
  -c "select id from public.financial_accounts where creation_request_id=:'account_request'::uuid")"
test -n "$account_id"

psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v owner_id="$owner_id" -v organization_id="$organization_id" \
  -v booking_id="$booking_id" -v account_id="$account_id" -v request_id="$post_one" \
  -v hold_key="$hold_key" <<'SQL' >/dev/null &
begin;
select set_config('request.jwt.claim.sub',:'owner_id',true);
set local role authenticated;
select public.post_minuta_visit_finance_v129(
  :'organization_id'::uuid,:'booking_id'::uuid,:'account_id'::uuid,:'request_id'::uuid
);
reset role;
select pg_advisory_xact_lock(:'hold_key'::bigint);
select pg_sleep(5);
commit;
SQL
first_pid=$!

ready="f"
for _ in {1..100}; do
  ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt -v hold_key="$hold_key" \
    -c "select not pg_try_advisory_lock(:'hold_key'::bigint)")"
  [[ "$ready" == "t" ]] && break
  sleep 0.05
done
if [[ "$ready" != "t" ]]; then
  wait "$first_pid" || true
  echo "v129 first session did not reach the concurrent state" >&2
  exit 1
fi

set +e
second_output="$(psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v owner_id="$owner_id" -v organization_id="$organization_id" \
  -v booking_id="$booking_id" -v account_id="$account_id" -v request_id="$post_two" 2>&1 <<'SQL'
select set_config('request.jwt.claim.sub',:'owner_id',false);
set role authenticated;
select public.post_minuta_visit_finance_v129(
  :'organization_id'::uuid,:'booking_id'::uuid,:'account_id'::uuid,:'request_id'::uuid
);
SQL
)"
second_status=$?
set -e
wait "$first_pid"
if [[ "$second_status" -eq 0 ]] || ! grep -q 'financial_visit_already_posted' <<<"$second_output"; then
  echo "v129 concurrent source write was not rejected" >&2
  exit 1
fi

test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt -v booking_id="$booking_id" \
  -c "select count(*) from public.financial_transactions where operation_type='visit_service' and source_id=:'booking_id'::uuid")" = "1"
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt -v booking_id="$booking_id" \
  -c "select coalesce(sum(case side when 'debit' then amount_minor else -amount_minor end),0) from public.financial_postings where transaction_id=(select id from public.financial_transactions where source_id=:'booking_id'::uuid)")" = "0"

echo "financial ledger v129 real PostgreSQL concurrency: OK"
