#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

request_one="00000000-0000-4000-8000-000000009001"
request_two="00000000-0000-4000-8000-000000009002"
test_performer="00000000-0000-4000-8000-000000009003"
test_service="00000000-0000-4000-8000-000000009004"
lock_key="900090"
first_log="${RUNNER_TEMP:-/tmp}/primetime-concurrency-first.log"
second_log="${RUNNER_TEMP:-/tmp}/primetime-concurrency-second.log"
schedule_weekday=""

cleanup() {
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 \
    -v request_one="$request_one" -v request_two="$request_two" \
    -v test_performer="$test_performer" -v test_service="$test_service" <<'SQL' >/dev/null
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
delete from public.provider_schedule where performer_id=:'test_performer'::uuid;
delete from public.organization_memberships where user_id=:'test_performer'::uuid;
delete from public.performer_profiles where id=:'test_performer'::uuid;
delete from auth.users where id=:'test_performer'::uuid;
SQL
  rm -f -- "$first_log" "$second_log"
}
trap cleanup EXIT
cleanup

seed_row="$(psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -At -F '|' <<'SQL'
select organization.public_slug,
       location.id,
       organization.id,
       coalesce(
         organization.legacy_performer_id,
         (select membership.user_id from public.organization_memberships membership
          where membership.organization_id=organization.id and membership.role='owner'
          order by membership.created_at limit 1)
       ),
       (select service.id from public.services service order by service.id limit 1),
       current_date + 7,
       extract(dow from current_date + 7)::integer
from public.organizations organization
join public.locations location
  on location.organization_id = organization.id
 and location.active
 and location.is_primary
 and location.timezone = 'Europe/Samara'
where organization.status = 'active'
  and organization.public_booking_enabled
order by organization.id
limit 1;
SQL
)"

if [[ -z "$seed_row" ]]; then
  echo "No active public test-project service is available for the concurrency check" >&2
  exit 1
fi
IFS='|' read -r slug location_id organization_id owner_id seed_service target_date schedule_weekday <<<"$seed_row"

psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v performer_id="$test_performer" -v service_id="$test_service" \
  -v organization_id="$organization_id" -v owner_id="$owner_id" \
  -v seed_service="$seed_service" -v weekday="$schedule_weekday" <<'SQL' >/dev/null
set session_replication_role=replica;
insert into auth.users(
  id,instance_id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values (
  :'performer_id'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'primetime-concurrency@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now()
);
set session_replication_role=origin;
insert into public.performer_profiles(id,display_name)
values(:'performer_id'::uuid,'PrimeTime Concurrency Specialist');
insert into public.organization_memberships(
  organization_id,user_id,role,is_bookable,active,created_by
) values (
  :'organization_id'::uuid,:'performer_id'::uuid,'specialist',true,true,:'owner_id'::uuid
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
  echo "The isolated test schedule did not produce a bookable slot" >&2
  exit 1
fi
IFS='|' read -r target_date target_time <<<"$slot_row"
service_id="$test_service"

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
