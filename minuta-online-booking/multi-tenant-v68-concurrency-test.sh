#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

request_one="00000000-0000-4000-8000-000000006811"
request_two="00000000-0000-4000-8000-000000006812"

cleanup() {
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 \
    -v request_one="$request_one" -v request_two="$request_two" <<'SQL' >/dev/null
select set_config('minuta.test_request_one', :'request_one', false);
select set_config('minuta.test_request_two', :'request_two', false);
do $$
declare
  booking record;
begin
  for booking in
    select id, performer_id from public.bookings
    where request_id in (
      current_setting('minuta.test_request_one')::uuid,
      current_setting('minuta.test_request_two')::uuid
    )
  loop
    perform set_config('request.jwt.claim.sub', booking.performer_id::text, true);
    perform public.provider_delete_booking(booking.id);
  end loop;
end;
$$;
SQL
}
trap cleanup EXIT
cleanup

mapfile -t slots < <(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -At -F '|' <<'SQL'
with chosen_service as (
  select service.id, service.performer_id, service.duration_minutes,
         organization.public_slug, location.id as location_id
  from public.services service
  join public.organization_memberships membership
    on membership.user_id = service.performer_id
   and membership.active
   and membership.is_bookable
  join public.organizations organization
    on organization.id = membership.organization_id
   and organization.status = 'active'
   and organization.public_booking_enabled
  join public.locations location
    on location.organization_id = organization.id
   and location.active
   and location.is_primary
   and location.timezone = 'Europe/Samara'
  where service.active
  order by service.id
  limit 1
), available_slots as (
  select chosen.public_slug, chosen.location_id, chosen.id, chosen.performer_id,
         chosen.duration_minutes, available.booking_date, available.booking_time,
         available.booking_date + available.booking_time as starts_at
  from chosen_service chosen
  cross join lateral public.get_available_slots(
    chosen.id,
    current_date + 1,
    current_date + 62
  ) available
), first_slot as (
  select * from available_slots order by starts_at limit 1
), second_slot as (
  select available.*
  from available_slots available cross join first_slot first
  where available.starts_at >= first.starts_at + make_interval(mins => first.duration_minutes)
  order by available.starts_at
  limit 1
), third_slot as (
  select available.*
  from available_slots available cross join second_slot second
  where available.starts_at >= second.starts_at + make_interval(mins => second.duration_minutes)
  order by available.starts_at
  limit 1
), selected_slots as (
  select * from first_slot
  union all select * from second_slot
  union all select * from third_slot
)
select public_slug, location_id, id, performer_id, booking_date, booking_time
from selected_slots
order by starts_at;
SQL
)

if [[ "${#slots[@]}" -lt 3 ]]; then
  echo "v68 concurrency test requires three available slots" >&2
  exit 1
fi

IFS='|' read -r slug location_id service_id performer_id date_one time_one <<<"${slots[0]}"
IFS='|' read -r _ _ _ _ date_two time_two <<<"${slots[1]}"
IFS='|' read -r _ _ _ _ target_date target_time <<<"${slots[2]}"

psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v request_id="$request_one" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$service_id" -v booking_date="$date_one" -v booking_time="$time_one" <<'SQL' >/dev/null
select * from public.book_minuta_appointment(
  :'request_id'::uuid, :'slug', :'location_id'::uuid, :'service_id'::uuid,
  :'booking_date'::date, :'booking_time'::time, 'V68 Concurrent One', '+79990000011'
);
SQL
booking_one="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc "select id from public.bookings where request_id='$request_one'::uuid;")"
test -n "$booking_one"
psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v request_id="$request_two" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$service_id" -v booking_date="$date_two" -v booking_time="$time_two" <<'SQL' >/dev/null
select * from public.book_minuta_appointment(
  :'request_id'::uuid, :'slug', :'location_id'::uuid, :'service_id'::uuid,
  :'booking_date'::date, :'booking_time'::time, 'V68 Concurrent Two', '+79990000012'
);
SQL
booking_two="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc "select id from public.bookings where request_id='$request_two'::uuid;")"
test -n "$booking_two"

set +e
rollback_output="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -f minuta-online-booking/recovery/rollback-team-calendar-v68.sql 2>&1)"
rollback_status=$?
set -e
if [[ "$rollback_status" -eq 0 ]] || ! grep -q 'v68_rollback_blocked_team_bookings_exist' <<<"$rollback_output"; then
  echo "v68 rollback guard did not block active team bookings" >&2
  echo "$rollback_output" >&2
  exit 1
fi

lock_key="680068"
psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v booking_id="$booking_one" -v target_date="$target_date" -v target_time="$target_time" \
  -v lock_key="$lock_key" <<'SQL' >/dev/null &
begin;
update public.bookings
set booking_date = :'target_date'::date,
    booking_time = :'target_time'::time
where id = :'booking_id'::uuid;
select pg_advisory_xact_lock(:'lock_key'::bigint);
select pg_sleep(15);
commit;
SQL
first_pid=$!

holder_ready="f"
for _ in {1..40}; do
  holder_ready="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -At \
    -v lock_key="$lock_key" <<'SQL'
select not pg_try_advisory_lock(:'lock_key'::bigint);
SQL
)"
  [[ "$holder_ready" == "t" ]] && break
  sleep 0.05
done
if [[ "$holder_ready" != "t" ]]; then
  wait "$first_pid" || true
  echo "v68 concurrency holder did not reach the locked state" >&2
  exit 1
fi

set +e
second_output="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v booking_id="$booking_two" -v target_date="$target_date" -v target_time="$target_time" 2>&1 <<'SQL'
update public.bookings
set booking_date = :'target_date'::date,
    booking_time = (:'target_time'::time + interval '30 seconds')::time
where id = :'booking_id'::uuid;
SQL
)"
second_status=$?
set -e
wait "$first_pid"

if [[ "$second_status" -eq 0 ]] || ! grep -Eqi 'exclusion|conflict|bookings_performer_active_no_overlap' <<<"$second_output"; then
  echo "v68 concurrent overlap was not rejected" >&2
  echo "$second_output" >&2
  exit 1
fi

same_target_count="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -Atc \
  "select count(*) from public.bookings where id in ('$booking_one'::uuid,'$booking_two'::uuid) and booking_date='$target_date'::date and booking_time >= '$target_time'::time and booking_time < '$target_time'::time + interval '1 minute';")"
test "$same_target_count" = "1"
echo "multi-tenant v68 concurrency test: OK"
