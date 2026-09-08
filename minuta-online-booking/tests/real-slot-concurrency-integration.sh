#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

request_one="$(cat /proc/sys/kernel/random/uuid)"
request_two="$(cat /proc/sys/kernel/random/uuid)"
client_one="$(cat /proc/sys/kernel/random/uuid)"
client_two="$(cat /proc/sys/kernel/random/uuid)"
test_performer="$(cat /proc/sys/kernel/random/uuid)"
test_service="$(cat /proc/sys/kernel/random/uuid)"
test_location="$(cat /proc/sys/kernel/random/uuid)"
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
    -c 'alter table public.bookings enable trigger bookings_enqueue_created_notification' \
    >/dev/null 2>&1 || true
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 \
    -v request_one="$request_one" -v request_two="$request_two" \
    -v client_one="$client_one" -v client_two="$client_two" \
    -v test_performer="$test_performer" -v test_service="$test_service" \
    -v test_location="$test_location" <<'SQL' >/dev/null 2>&1 || true
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
set session_replication_role=replica;
delete from public.bookings where request_id in (:'request_one'::uuid, :'request_two'::uuid);
delete from public.services where id=:'test_service'::uuid;
delete from public.provider_schedule where performer_id=:'test_performer'::uuid;
delete from public.organization_memberships where user_id=:'test_performer'::uuid;
delete from public.locations where id=:'test_location'::uuid;
delete from public.performer_profiles where id=:'test_performer'::uuid;
delete from auth.users where id in (:'client_one'::uuid, :'client_two'::uuid, :'test_performer'::uuid);
set session_replication_role=origin;
SQL
  rm -f -- "$first_log" "$second_log"
  return 0
}
trap cleanup EXIT

seed_row="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' <<'SQL'
select organization.public_slug,
       organization.id,
       seed_location.id,
       seed_service.id,
       current_date + 7,
       extract(isodow from current_date + 7)::integer
from public.organizations organization
cross join lateral (
  select service.id
  from public.services service
  order by service.id
  limit 1
) seed_service
cross join lateral (
  select location.id
  from public.locations location
  order by location.id
  limit 1
) seed_location
where organization.status='active'
  and organization.public_booking_enabled
order by organization.id
limit 1;
SQL
)"

if [[ -z "$seed_row" ]]; then
  echo "No active public organization or seed fixture is available" >&2
  exit 1
fi
IFS='|' read -r slug organization_id seed_location seed_service target_date schedule_weekday <<<"$seed_row"
performer_id="$test_performer"
location_id="$test_location"

psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v client_one="$client_one" -v client_two="$client_two" \
  -v performer_id="$test_performer" -v service_id="$test_service" \
  -v location_id="$test_location" -v organization_id="$organization_id" \
  -v seed_location="$seed_location" -v seed_service="$seed_service" \
  -v weekday="$schedule_weekday" <<'SQL' >/dev/null
set session_replication_role=replica;
insert into auth.users(
  id,instance_id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  (:'client_one'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'primetime-concurrency-a@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  (:'client_two'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'primetime-concurrency-b@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now()),
  (:'performer_id'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'primetime-concurrency-provider@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
insert into public.performer_profiles(id,display_name)
values(:'performer_id'::uuid,'PrimeTime Concurrency Specialist');
insert into public.locations
select (jsonb_populate_record(null::public.locations,to_jsonb(location)||jsonb_build_object(
  'id',:'location_id','organization_id',:'organization_id','name','PrimeTime concurrency location',
  'timezone','Europe/Samara','active',true,'is_primary',false,'created_at',now(),'updated_at',now()
))).*
from public.locations location
where location.id=:'seed_location'::uuid;
insert into public.organization_memberships(
  organization_id,user_id,role,is_bookable,active,created_by
) values (
  :'organization_id'::uuid,:'performer_id'::uuid,'specialist',true,true,:'performer_id'::uuid
);
insert into public.services
select (jsonb_populate_record(null::public.services,to_jsonb(service)||jsonb_build_object(
  'id',:'service_id','performer_id',:'performer_id','name','PrimeTime concurrency service',
  'active',true,'created_at',now(),'updated_at',now()
))).*
from public.services service
where service.id=:'seed_service'::uuid;
insert into public.provider_schedule(
  performer_id,weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes
) values (
  :'performer_id'::uuid,:'weekday'::integer,true,'12:00','14:00',null,null,30
);
set session_replication_role=origin;
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

# The isolated test project currently has a legacy v46 notification trigger
# whose insert no longer satisfies notification_outbox.organization_id. Keep
# every booking/scope/concurrency trigger enabled and isolate only that known
# delivery-schema defect while this race is running.
psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'alter table public.bookings disable trigger bookings_enqueue_created_notification' \
  >/dev/null

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
psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c 'alter table public.bookings enable trigger bookings_enqueue_created_notification' \
  >/dev/null

if [[ "$second_status" -eq 0 ]]; then
  echo "Both authenticated clients acquired the same slot" >&2
  exit 1
fi
if ! grep -Eqi '(^|[^[:alnum:]_])slot_unavailable|booking_slot_unavailable|exclusion|conflict|bookings_performer_active_no_overlap' "$second_log"; then
  echo "The rejected authenticated client did not receive a recognized slot-conflict result" >&2
  sed -n '1,40p' "$second_log" >&2
  exit 1
fi

booking_count="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.bookings where request_id in ('$request_one'::uuid,'$request_two'::uuid);")"
test "$booking_count" = "1"

echo "real test-project slot concurrency: PASS (two auth accounts raced; one booking accepted, one rejected)"
