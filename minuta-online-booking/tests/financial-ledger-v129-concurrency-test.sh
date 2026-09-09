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
role_request="00000000-0000-4000-8000-000000129106"
disable_request="00000000-0000-4000-8000-000000129107"
role_signal="129129102"
disable_signal="129129103"
organization_request="00000000-0000-4000-8000-000000129108"
organization_signal="129129104"
actor_id="00000000-0000-4000-8000-000000129199"

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
  psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=0 -v actor_id="$actor_id" <<'SQL' >/dev/null
begin;
update public.organizations set status='active'
where id in(select organization_id from public.organization_memberships where user_id=:'actor_id'::uuid);
delete from public.organization_memberships where user_id=:'actor_id'::uuid;
delete from auth.users where id=:'actor_id'::uuid;
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
join public.organizations organization on organization.id=membership.organization_id
where organization.status='active' and membership.active and membership.role in('owner','admin')
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
  -v owner_id="$owner_id" -v actor_id="$actor_id" -v organization_id="$organization_id" \
  -v seed_booking="$seed_booking" -v booking_id="$booking_id" \
  -v booking_request="$booking_request" -v account_request="$account_request" <<'SQL' >/dev/null
set session_replication_role=replica;
select format(
  'insert into public.bookings(%1$s) select %2$s from public.bookings seed '
  'cross join lateral jsonb_populate_record(null::public.bookings,to_jsonb(seed)||jsonb_build_object('
  '''id'',%3$L::uuid,''booking_code'',''V129-CONCURRENCY'',''manage_token'',gen_random_uuid(),'
  '''request_id'',%4$L::uuid,''request_fingerprint'',repeat(''1'',64),'
  '''client_name'',''V129 synthetic fixture'',''client_phone'',''0000000000'','
  '''booking_date'',''1901-01-01'',''booking_time'',''00:00:00'','
  '''status'',''confirmed'',''deposit_amount_rub'',0,''payment_status'',''not_required'','
  '''payment_url'','''',''series_id'',null,''series_occurrence'',null,'
  '''created_at'',now(),''updated_at'',now())) cloned where seed.id=%5$L::uuid',
  string_agg(format('%I',attribute.attname),',' order by attribute.attnum),
  string_agg(format('cloned.%I',attribute.attname),',' order by attribute.attnum),
  :'booking_id',:'booking_request',:'seed_booking'
)
from pg_attribute attribute
where attribute.attrelid='public.bookings'::regclass and attribute.attnum>0
  and not attribute.attisdropped and attribute.attgenerated=''
\gexec
insert into public.booking_outcomes(
  booking_id,performer_id,visit_status,payment_method,amount_rub,
  calculated_amount_rub,completion_source,updated_at
)
select :'booking_id'::uuid,performer_id,'completed','cash',600,1000,'manual',now()
from public.bookings where id=:'booking_id'::uuid;
insert into auth.users(
  id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data
) values(
  :'actor_id'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'minuta-v129-race@example.invalid',now(),now(),now(),'{}','{}'
);
set session_replication_role=origin;
insert into public.organization_memberships(
  organization_id,user_id,role,is_bookable,active,created_by
) values(:'organization_id'::uuid,:'actor_id'::uuid,'admin',false,true,:'owner_id'::uuid);
select set_config('request.jwt.claim.sub',:'actor_id',false);
set role authenticated;
select public.set_minuta_finance_enabled_v129(:'organization_id'::uuid,true);
select public.create_minuta_financial_account_v129(
  :'organization_id'::uuid,:'account_request'::uuid,'V129 concurrency cash','cash'
);
reset role;
SQL

account_id="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
  -c "select id from public.financial_accounts where creation_request_id='$account_request'::uuid")"
test -n "$account_id"

# A writer that passed the optimistic role check must fail if the membership is
# revoked while it is waiting for the organization-wide ledger lock.
psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v organization_id="$organization_id" -v signal="$role_signal" <<'SQL' >/dev/null &
begin;
select pg_advisory_xact_lock(hashtextextended(:'organization_id'::text||':financial-ledger',129));
select pg_advisory_xact_lock(:'signal'::bigint);
select pg_sleep(8);
commit;
SQL
role_blocker_pid=$!

role_ready="f"
for _ in {1..100}; do
  role_ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
    -c "select not pg_try_advisory_lock($role_signal::bigint)")"
  [[ "$role_ready" == "t" ]] && break
  sleep 0.05
done
if [[ "$role_ready" != "t" ]]; then
  wait "$role_blocker_pid" || true
  echo "v129 role-race blocker did not acquire the organization lock" >&2
  exit 1
fi

role_output_file="$(mktemp)"
set +e
PGAPPNAME="minuta-v129-role-race" psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v actor_id="$actor_id" -v organization_id="$organization_id" -v request_id="$role_request" \
  >"$role_output_file" 2>&1 <<'SQL' &
select set_config('application_name','minuta-v129-role-race',false);
select set_config('request.jwt.claim.sub',:'actor_id',false);
set role authenticated;
select public.create_minuta_financial_account_v129(
  :'organization_id'::uuid,:'request_id'::uuid,'V129 revoked role cash','cash'
);
SQL
role_writer_pid=$!
set -e

role_waiting="0"
for _ in {1..100}; do
  role_waiting="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name='minuta-v129-role-race' and state='active' and wait_event_type='Lock'")"
  [[ "$role_waiting" == "1" ]] && break
  sleep 0.05
done
if [[ "$role_waiting" != "1" ]]; then
  wait "$role_writer_pid" || true
  wait "$role_blocker_pid" || true
  rm -f -- "$role_output_file"
  echo "v129 role-race writer did not wait on the organization lock" >&2
  exit 1
fi

psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c "update public.organization_memberships set role='specialist' where organization_id='$organization_id'::uuid and user_id='$actor_id'::uuid" >/dev/null
set +e
wait "$role_writer_pid"
role_status=$?
set -e
wait "$role_blocker_pid"
role_output="$(<"$role_output_file")"
rm -f -- "$role_output_file"
if [[ "$role_status" -eq 0 ]] || ! grep -q 'financial_manager_role_required' <<<"$role_output"; then
  echo "v129 revoked role completed a ledger write after waiting" >&2
  exit 1
fi
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
  -c "select count(*) from public.financial_accounts where creation_request_id='$role_request'::uuid")" = "0"
psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c "update public.organization_memberships set role='admin' where organization_id='$organization_id'::uuid and user_id='$actor_id'::uuid" >/dev/null

# Organization suspension is checked under a parent-row lock after the writer
# acquires the ledger lock. A queued writer must observe the committed change.
psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v organization_id="$organization_id" -v signal="$organization_signal" <<'SQL' >/dev/null &
begin;
select pg_advisory_xact_lock(hashtextextended(:'organization_id'::text||':financial-ledger',129));
select pg_advisory_xact_lock(:'signal'::bigint);
select pg_sleep(8);
commit;
SQL
organization_blocker_pid=$!

organization_ready="f"
for _ in {1..100}; do
  organization_ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
    -c "select not pg_try_advisory_lock($organization_signal::bigint)")"
  [[ "$organization_ready" == "t" ]] && break
  sleep 0.05
done
if [[ "$organization_ready" != "t" ]]; then
  wait "$organization_blocker_pid" || true
  echo "v129 organization-race blocker did not acquire the ledger lock" >&2
  exit 1
fi

organization_output_file="$(mktemp)"
set +e
PGAPPNAME="minuta-v129-organization-race" psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v actor_id="$actor_id" -v organization_id="$organization_id" -v request_id="$organization_request" \
  >"$organization_output_file" 2>&1 <<'SQL' &
select set_config('application_name','minuta-v129-organization-race',false);
select set_config('request.jwt.claim.sub',:'actor_id',false);
set role authenticated;
select public.create_minuta_financial_account_v129(
  :'organization_id'::uuid,:'request_id'::uuid,'V129 suspended organization cash','cash'
);
SQL
organization_writer_pid=$!
set -e

organization_waiting="0"
for _ in {1..100}; do
  organization_waiting="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c \
    "select count(*) from pg_stat_activity where application_name='minuta-v129-organization-race' and state='active' and wait_event_type='Lock'")"
  [[ "$organization_waiting" == "1" ]] && break
  sleep 0.05
done
if [[ "$organization_waiting" != "1" ]]; then
  wait "$organization_writer_pid" || true
  wait "$organization_blocker_pid" || true
  rm -f -- "$organization_output_file"
  echo "v129 organization-race writer did not wait on the ledger lock" >&2
  exit 1
fi

psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c "update public.organizations set status='suspended' where id='$organization_id'::uuid" >/dev/null
set +e
wait "$organization_writer_pid"
organization_status=$?
set -e
wait "$organization_blocker_pid"
organization_output="$(<"$organization_output_file")"
rm -f -- "$organization_output_file"
if [[ "$organization_status" -eq 0 ]] || ! grep -q 'financial_manager_role_required' <<<"$organization_output"; then
  echo "v129 suspended organization completed a queued ledger write" >&2
  exit 1
fi
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
  -c "select count(*) from public.financial_accounts where creation_request_id='$organization_request'::uuid")" = "0"
psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -c "update public.organizations set status='active' where id='$organization_id'::uuid" >/dev/null

# Disabling finance owns the same organization lock. A writer queued behind it
# must re-read the setting and fail instead of committing after the disable.
psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v actor_id="$actor_id" -v organization_id="$organization_id" -v signal="$disable_signal" <<'SQL' >/dev/null &
begin;
select set_config('request.jwt.claim.sub',:'actor_id',true);
set local role authenticated;
select public.set_minuta_finance_enabled_v129(:'organization_id'::uuid,false);
reset role;
select pg_advisory_xact_lock(:'signal'::bigint);
select pg_sleep(5);
commit;
SQL
disable_pid=$!

disable_ready="f"
for _ in {1..100}; do
  disable_ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
    -c "select not pg_try_advisory_lock($disable_signal::bigint)")"
  [[ "$disable_ready" == "t" ]] && break
  sleep 0.05
done
if [[ "$disable_ready" != "t" ]]; then
  wait "$disable_pid" || true
  echo "v129 disable-race session did not reach the concurrent state" >&2
  exit 1
fi

set +e
disable_output="$(psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v actor_id="$actor_id" -v organization_id="$organization_id" -v request_id="$disable_request" 2>&1 <<'SQL'
select set_config('request.jwt.claim.sub',:'actor_id',false);
set role authenticated;
select public.create_minuta_financial_account_v129(
  :'organization_id'::uuid,:'request_id'::uuid,'V129 disabled cash','cash'
);
SQL
)"
disable_status=$?
set -e
wait "$disable_pid"
if [[ "$disable_status" -eq 0 ]] || ! grep -q 'finance_disabled' <<<"$disable_output"; then
  echo "v129 ledger write completed after finance was disabled" >&2
  exit 1
fi
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
  -c "select count(*) from public.financial_accounts where creation_request_id='$disable_request'::uuid")" = "0"
psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v actor_id="$actor_id" -v organization_id="$organization_id" <<'SQL' >/dev/null
select set_config('request.jwt.claim.sub',:'actor_id',false);
set role authenticated;
select public.set_minuta_finance_enabled_v129(:'organization_id'::uuid,true);
SQL

psql "$MINUTA_TEST_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 \
  -v actor_id="$actor_id" -v organization_id="$organization_id" \
  -v booking_id="$booking_id" -v account_id="$account_id" -v request_id="$post_one" \
  -v hold_key="$hold_key" <<'SQL' >/dev/null &
begin;
select set_config('request.jwt.claim.sub',:'actor_id',true);
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
  ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
    -c "select not pg_try_advisory_lock($hold_key::bigint)")"
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
  -v actor_id="$actor_id" -v organization_id="$organization_id" \
  -v booking_id="$booking_id" -v account_id="$account_id" -v request_id="$post_two" 2>&1 <<'SQL'
select set_config('request.jwt.claim.sub',:'actor_id',false);
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

test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
  -c "select count(*) from public.financial_transactions where operation_type='visit_service' and source_id='$booking_id'::uuid")" = "1"
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -qAt \
  -c "select coalesce(sum(case side when 'debit' then amount_minor else -amount_minor end),0) from public.financial_postings where transaction_id=(select id from public.financial_transactions where source_id='$booking_id'::uuid)")" = "0"

echo "financial ledger v129 real PostgreSQL concurrency: OK"
