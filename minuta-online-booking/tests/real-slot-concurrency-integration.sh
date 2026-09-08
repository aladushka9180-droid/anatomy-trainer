#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

request_one="$(cat /proc/sys/kernel/random/uuid)"
request_two="$(cat /proc/sys/kernel/random/uuid)"
client_one="$(cat /proc/sys/kernel/random/uuid)"
client_two="$(cat /proc/sys/kernel/random/uuid)"
test_service="$(cat /proc/sys/kernel/random/uuid)"
lock_key="900090"
first_log="${RUNNER_TEMP:-/tmp}/primetime-concurrency-first.log"
second_log="${RUNNER_TEMP:-/tmp}/primetime-concurrency-second.log"
first_pid=""

cleanup() {
  if [[ -n "$first_pid" ]] && kill -0 "$first_pid" 2>/dev/null; then
    kill "$first_pid" 2>/dev/null || true
    wait "$first_pid" 2>/dev/null || true
  fi
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 \
    -v request_one="$request_one" -v request_two="$request_two" \
    -v client_one="$client_one" -v client_two="$client_two" \
    -v test_service="$test_service" <<'SQL' >/dev/null 2>&1 || true
select set_config('minuta.test_request_one', :'request_one', false);
select set_config('minuta.test_request_two', :'request_two', false);
do $$
declare booking record;
begin
  for booking in
    select id, performer_id
    from public.bookings
    where request_id in (
      current_setting('minuta.test_request_one')::uuid,
      current_setting('minuta.test_request_two')::uuid
    )
  loop
    perform set_config('request.jwt.claim.sub', booking.performer_id::text, true);
    perform public.provider_delete_booking(booking.id);
  end loop;
end $$;
delete from public.services where id=:'test_service'::uuid;
set session_replication_role=replica;
delete from auth.users where id in (:'client_one'::uuid, :'client_two'::uuid);
set session_replication_role=origin;
SQL
  rm -f -- "$first_log" "$second_log"
  return 0
}
trap cleanup EXIT

seed_row="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' <<'SQL'
select organization.public_slug,
       organization.id,
       membership.user_id,
       location.id,
       seed_service.id,
       current_date + ((schedule.weekday - extract(isodow from current_date)::integer + 7) % 7) + 7
from public.organizations organization
join public.organization_memberships membership
  on membership.organization_id=organization.id
 and membership.active
 and membership.is_bookable
join public.provider_schedule schedule
  on schedule.performer_id=membership.user_id
 and schedule.enabled
join public.locations location
  on location.organization_id=organization.id
 and location.active
cross join lateral (
  select service.id
  from public.services service
  order by service.id
  limit 1
) seed_service
where organization.status='active'
  and organization.public_booking_enabled
order by organization.id,membership.user_id,schedule.weekday,location.is_primary desc
limit 1;
SQL
)"

if [[ -z "$seed_row" ]]; then
  echo "No active public organization with a bookable scheduled performer is available" >&2
  exit 1
fi
IFS='|' read -r slug organization_id performer_id location_id seed_service target_date <<<"$seed_row"

psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v client_one="$client_one" -v client_two="$client_two" \
  -v service_id="$test_service" -v performer_id="$performer_id" \
  -v seed_service="$seed_service" <<'SQL' >/dev/null
set session_replication_role=replica;
insert into auth.users(
  id,instance_id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  (:'client_one'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'primetime-concurrency-a@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  (:'client_two'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'primetime-concurrency-b@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
set session_replication_role=origin;
insert into public.services
select (jsonb_populate_record(null::public.services,to_jsonb(service)||jsonb_build_object(
  'id',:'service_id','performer_id',:'performer_id','name','PrimeTime concurrency service',
  'active',true,'created_at',now(),'updated_at',now()
))).*
from public.services service
where service.id=:'seed_service'::uuid;
SQL

slot_row="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' \
  -v service_id="$test_service" -v target_date="$target_date" <<'SQL'
select booking_date,booking_time
from public.get_available_slots(
  :'service_id'::uuid,:'target_date'::date,:'target_date'::date
)
order by booking_time
limit 1;
SQL
)"
if [[ -z "$slot_row" ]]; then
  echo "The selected real schedule did not produce a bookable slot" >&2
  exit 1
fi
IFS='|' read -r target_date target_time <<<"$slot_row"

psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v client_id="$client_one" -v request_id="$request_one" -v slug="$slug" \
  -v location_id="$location_id" -v service_id="$test_service" \
  -v booking_date="$target_date" -v booking_time="$target_time" \
  -v lock_key="$lock_key" >"$first_log" 2>&1 <<'SQL' &
begin;
select set_config('request.jwt.claim.sub', :'client_id', true);
select * from public.book_minuta_appointment(
  :'request_id'::uuid, :'slug', :'location_id'::uuid, :'service_id'::uuid,
  :'booking_date'::date, :'booking_time'::time,
  'PrimeTime concurrency A', '+79990009001'
);
select pg_advisory_xact_lock(:'lock_key'::bigint);
select pg_sleep(8);
commit;
SQL
first_pid=$!

holder_ready="f"
for _ in $(seq 1 80); do
  holder_ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At \
    -v lock_key="$lock_key" <<'SQL'
select not pg_try_advisory_lock(:'lock_key'::bigint);
SQL
)"
  [[ "$holder_ready" == "t" ]] && break
  sleep 0.1
done

if [[ "$holder_ready" != "t" ]]; then
  wait "$first_pid" || true
  first_pid=""
  echo "The first authenticated client did not reach the concurrent hold state" >&2
  sed -n '1,80p' "$first_log" >&2
  exit 1
fi

set +e
psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v client_id="$client_two" -v request_id="$request_two" -v slug="$slug" \
  -v location_id="$location_id" -v service_id="$test_service" \
  -v booking_date="$target_date" -v booking_time="$target_time" >"$second_log" 2>&1 <<'SQL'
begin;
select set_config('request.jwt.claim.sub', :'client_id', true);
select * from public.book_minuta_appointment(
  :'request_id'::uuid, :'slug', :'location_id'::uuid, :'service_id'::uuid,
  :'booking_date'::date, :'booking_time'::time,
  'PrimeTime concurrency B', '+79990009002'
);
commit;
SQL
second_status=$?
set -e
wait "$first_pid"
first_pid=""

if [[ "$second_status" -eq 0 ]]; then
  echo "Both authenticated clients acquired the same slot" >&2
  exit 1
fi
if ! grep -Eqi 'booking_slot_unavailable|exclusion|conflict|bookings_performer_active_no_overlap' "$second_log"; then
  echo "The rejected authenticated client did not receive a recognized slot-conflict result" >&2
  sed -n '1,40p' "$second_log" >&2
  exit 1
fi

booking_count="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.bookings where request_id in ('$request_one'::uuid,'$request_two'::uuid);")"
test "$booking_count" = "1"

echo "real test-project slot concurrency: PASS (two auth accounts raced; one booking accepted, one rejected)"
