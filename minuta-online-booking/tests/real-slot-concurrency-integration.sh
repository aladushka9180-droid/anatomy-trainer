#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

request_one="00000000-0000-4000-8000-000000009001"
request_two="00000000-0000-4000-8000-000000009002"
lock_key="900090"
first_log="${RUNNER_TEMP:-/tmp}/primetime-concurrency-first.log"
second_log="${RUNNER_TEMP:-/tmp}/primetime-concurrency-second.log"

cleanup() {
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 \
    -v request_one="$request_one" -v request_two="$request_two" <<'SQL' >/dev/null
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
SQL
  rm -f -- "$first_log" "$second_log"
}
trap cleanup EXIT
cleanup

slot_row="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' <<'SQL'
with chosen as (
  select service.id,
         organization.public_slug,
         location.id as location_id
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
)
select chosen.public_slug,
       chosen.location_id,
       chosen.id,
       slot.booking_date,
       slot.booking_time
from chosen
cross join lateral public.get_available_slots(
  chosen.id,
  current_date + 1,
  current_date + 62
) slot
order by slot.booking_date, slot.booking_time
limit 1;
SQL
)"

if [[ -z "$slot_row" ]]; then
  echo "No real test-project slot is available for the concurrency check" >&2
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' <<'SQL' >&2
select
  (select count(*) from public.organizations where status='active' and public_booking_enabled),
  (select count(*) from public.organization_memberships where active and is_bookable),
  (select count(*) from public.locations where active and is_primary and timezone='Europe/Samara'),
  (select count(*) from public.services where active),
  (select count(*) from public.provider_schedule where enabled);
SQL
  exit 1
fi
IFS='|' read -r slug location_id service_id target_date target_time <<<"$slot_row"

psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v request_id="$request_one" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$service_id" -v booking_date="$target_date" \
  -v booking_time="$target_time" -v lock_key="$lock_key" >"$first_log" 2>&1 <<'SQL' &
begin;
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
  echo "The first booking did not reach the concurrent hold state" >&2
  exit 1
fi

set +e
psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v request_id="$request_two" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$service_id" -v booking_date="$target_date" \
  -v booking_time="$target_time" >"$second_log" 2>&1 <<'SQL'
select * from public.book_minuta_appointment(
  :'request_id'::uuid, :'slug', :'location_id'::uuid, :'service_id'::uuid,
  :'booking_date'::date, :'booking_time'::time,
  'PrimeTime concurrency B', '+79990009002'
);
SQL
second_status=$?
set -e
wait "$first_pid"

if [[ "$second_status" -eq 0 ]]; then
  echo "Both concurrent clients acquired the same slot" >&2
  exit 1
fi
if ! grep -Eqi 'booking_slot_unavailable|exclusion|conflict|bookings_performer_active_no_overlap' "$second_log"; then
  echo "The rejected client did not receive a recognized slot-conflict result" >&2
  sed -n '1,20p' "$second_log" >&2
  exit 1
fi

booking_count="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atc \
  "select count(*) from public.bookings where request_id in ('$request_one'::uuid,'$request_two'::uuid);")"
test "$booking_count" = "1"

echo "real test-project slot concurrency: PASS (one booking accepted, one rejected)"
