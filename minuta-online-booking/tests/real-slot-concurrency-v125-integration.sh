#!/usr/bin/env bash
set -euo pipefail
: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

request_one="$(cat /proc/sys/kernel/random/uuid)"
request_two="$(cat /proc/sys/kernel/random/uuid)"
client_one="$(cat /proc/sys/kernel/random/uuid)"
client_two="$(cat /proc/sys/kernel/random/uuid)"
performer="$(cat /proc/sys/kernel/random/uuid)"
service="$(cat /proc/sys/kernel/random/uuid)"
location="$(cat /proc/sys/kernel/random/uuid)"
lock_key=1250090
first_log="${RUNNER_TEMP:-/tmp}/v125-first.log"
second_log="${RUNNER_TEMP:-/tmp}/v125-second.log"
first_pid=""

cleanup() {
  if [[ -n "$first_pid" ]] && kill -0 "$first_pid" 2>/dev/null; then
    kill "$first_pid" 2>/dev/null || true
    wait "$first_pid" 2>/dev/null || true
  fi
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 \
    -v r1="$request_one" -v r2="$request_two" -v c1="$client_one" -v c2="$client_two" \
    -v performer="$performer" -v service="$service" -v location="$location" <<'SQL' >/dev/null 2>&1 || true
set session_replication_role=replica;
delete from public.bookings where request_id in (:'r1'::uuid,:'r2'::uuid);
delete from public.services where id=:'service'::uuid;
delete from public.provider_schedule where performer_id=:'performer'::uuid;
delete from public.organization_memberships where user_id=:'performer'::uuid;
delete from public.locations where id=:'location'::uuid;
delete from public.performer_profiles where id=:'performer'::uuid;
delete from auth.users where id in (:'c1'::uuid,:'c2'::uuid,:'performer'::uuid);
set session_replication_role=origin;
SQL
  rm -f -- "$first_log" "$second_log"
  return 0
}
trap cleanup EXIT

seed="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' <<'SQL'
select organization.public_slug,organization.id,
       (select id from public.locations order by id limit 1),
       (select id from public.services order by id limit 1),
       current_date+7,extract(isodow from current_date+7)::integer
from public.organizations organization
where organization.status='active' and organization.public_booking_enabled
order by organization.id limit 1;
SQL
)"
[[ -n "$seed" ]] || { echo 'No public organization or seed rows are available' >&2; exit 1; }
IFS='|' read -r slug organization seed_location seed_service booking_date weekday <<<"$seed"

psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v c1="$client_one" -v c2="$client_two" -v performer="$performer" \
  -v service="$service" -v location="$location" -v organization="$organization" \
  -v seed_location="$seed_location" -v seed_service="$seed_service" -v weekday="$weekday" <<'SQL' >/dev/null
set session_replication_role=replica;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
(:'c1'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','v125-a@example.invalid',now(),'{}','{}',now(),now()),
(:'c2'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','v125-b@example.invalid',now(),'{}','{}',now(),now()),
(:'performer'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','v125-provider@example.invalid',now(),'{}','{}',now(),now());
insert into public.performer_profiles(id,display_name) values(:'performer'::uuid,'v125 concurrency provider');
insert into public.locations
select (jsonb_populate_record(null::public.locations,to_jsonb(seed)||jsonb_build_object(
  'id',:'location','organization_id',:'organization','name','v125 concurrency location',
  'timezone','Europe/Samara','active',true,'is_primary',false,'created_at',now(),'updated_at',now()))).*
from public.locations seed where seed.id=:'seed_location'::uuid;
insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
values(:'organization'::uuid,:'performer'::uuid,'specialist',true,true,:'performer'::uuid);
insert into public.services
select (jsonb_populate_record(null::public.services,to_jsonb(seed)||jsonb_build_object(
  'id',:'service','performer_id',:'performer','name','v125 concurrency service',
  'active',true,'created_at',now(),'updated_at',now()))).*
from public.services seed where seed.id=:'seed_service'::uuid;
insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes)
values(:'performer'::uuid,:'weekday'::integer,true,'12:00','14:00',null,null,30);
set session_replication_role=origin;
SQL

slot="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' \
  -v service="$service" -v booking_date="$booking_date" <<'SQL'
select booking_date,booking_time from public.get_available_slots(:'service'::uuid,:'booking_date'::date,:'booking_date'::date)
order by booking_time limit 1;
SQL
)"
[[ -n "$slot" ]] || { echo 'The v125 fixture did not produce a free slot' >&2; exit 1; }
IFS='|' read -r booking_date booking_time <<<"$slot"

psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v client="$client_one" -v request="$request_one" -v slug="$slug" -v location="$location" \
  -v service="$service" -v booking_date="$booking_date" -v booking_time="$booking_time" \
  -v lock_key="$lock_key" >"$first_log" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub',:'client',true);
select * from public.book_minuta_appointment(:'request'::uuid,:'slug',:'location'::uuid,:'service'::uuid,
  :'booking_date'::date,:'booking_time'::time,'v125 client A','+79990012501');
select pg_advisory_xact_lock(:'lock_key'::bigint);
select pg_sleep(5);
commit;
SQL
first_pid=$!

ready=f
for _ in $(seq 1 30); do
  ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -v lock_key="$lock_key" <<'SQL'
select not pg_try_advisory_lock(:'lock_key'::bigint);
SQL
)"
  [[ "$ready" == t ]] && break
  sleep 0.1
done
if [[ "$ready" != t ]]; then
  kill "$first_pid" 2>/dev/null || true
  wait "$first_pid" 2>/dev/null || true
  first_pid=""
  echo 'First authenticated client did not reach the hold state' >&2
  sed -n '1,80p' "$first_log" >&2
  exit 1
fi

set +e
psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v client="$client_two" -v request="$request_two" -v slug="$slug" -v location="$location" \
  -v service="$service" -v booking_date="$booking_date" -v booking_time="$booking_time" >"$second_log" 2>&1 <<'SQL'
begin;
select set_config('request.jwt.claim.sub',:'client',true);
select * from public.book_minuta_appointment(:'request'::uuid,:'slug',:'location'::uuid,:'service'::uuid,
  :'booking_date'::date,:'booking_time'::time,'v125 client B','+79990012502');
commit;
SQL
second_status=$?
set -e
wait "$first_pid"
first_pid=""

[[ "$second_status" -ne 0 ]] || { echo 'Both clients booked the same slot' >&2; exit 1; }
grep -Eqi '(^|[^[:alnum:]_])slot_unavailable|booking_slot_unavailable|exclusion|conflict' "$second_log" || {
  echo 'Second client did not receive a recognized conflict' >&2; sed -n '1,40p' "$second_log" >&2; exit 1;
}
count="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.bookings where request_id in ('$request_one'::uuid,'$request_two'::uuid)")"
[[ "$count" == 1 ]]
echo 'v125 two-auth-account slot concurrency without disabled triggers: PASS'
