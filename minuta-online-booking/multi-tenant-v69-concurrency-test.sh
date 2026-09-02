#!/usr/bin/env bash
set -euo pipefail

: "${MINUTA_TEST_DATABASE_URL:?MINUTA_TEST_DATABASE_URL is required}"

request_one="00000000-0000-4000-8000-000000006911"
request_two="00000000-0000-4000-8000-000000006912"
group_id="00000000-0000-4000-8000-000000006913"
resource_id="00000000-0000-4000-8000-000000006914"
specialist_id="00000000-0000-4000-8000-000000006915"
specialist_service_id="00000000-0000-4000-8000-000000006916"

cleanup() {
  psql "$MINUTA_TEST_DATABASE_URL" -X -v ON_ERROR_STOP=0 \
    -v request_one="$request_one" -v request_two="$request_two" \
    -v resource_id="$resource_id" -v group_id="$group_id" \
    -v specialist_id="$specialist_id" -v specialist_service_id="$specialist_service_id" <<'SQL' >/dev/null
select set_config('minuta.test_request_one', :'request_one', false);
select set_config('minuta.test_request_two', :'request_two', false);
do $$
declare booking record;
begin
  for booking in select id,performer_id from public.bookings where request_id in (
    current_setting('minuta.test_request_one')::uuid,current_setting('minuta.test_request_two')::uuid
  ) loop
    perform set_config('request.jwt.claim.sub',booking.performer_id::text,true);
    perform public.provider_delete_booking(booking.id);
  end loop;
end $$;
delete from public.booking_resource_allocations where resource_id=:'resource_id'::uuid;
delete from public.service_resource_requirements where group_id=:'group_id'::uuid;
delete from public.resource_audit_log
where action='requirements_replaced' and details::text like '%' || :'group_id' || '%';
delete from public.resources where id=:'resource_id'::uuid;
delete from public.resource_groups where id=:'group_id'::uuid;
delete from public.services where id=:'specialist_service_id'::uuid;
delete from public.provider_schedule where performer_id=:'specialist_id'::uuid;
delete from public.organization_memberships where user_id=:'specialist_id'::uuid;
delete from public.performer_profiles where id=:'specialist_id'::uuid;
delete from auth.users where id=:'specialist_id'::uuid;
SQL
}
trap cleanup EXIT
cleanup

IFS='|' read -r slug organization_id location_id owner_service_id owner_id duration target_date target_time < <(
  psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X -At -F '|' <<'SQL'
with chosen as (
  select service.id,service.performer_id,service.duration_minutes,organization.id organization_id,
    organization.public_slug,location.id location_id
  from public.services service
  join public.organization_memberships membership
    on membership.user_id=service.performer_id and membership.active and membership.is_bookable
  join public.organizations organization
    on organization.id=membership.organization_id and organization.status='active' and organization.public_booking_enabled
  join public.locations location
    on location.organization_id=organization.id and location.active and location.is_primary and location.timezone='Europe/Samara'
  where service.active order by service.id limit 1
)
select chosen.public_slug,chosen.organization_id,chosen.location_id,chosen.id,chosen.performer_id,
  chosen.duration_minutes,slot.booking_date,slot.booking_time
from chosen
cross join lateral public.get_available_slots(chosen.id,current_date+1,current_date+62) slot
order by slot.booking_date,slot.booking_time
limit 1;
SQL
)
if [[ -z "${target_date:-}" ]]; then
  echo "v69 concurrency test requires an available owner slot" >&2
  exit 1
fi

# A second specialist receives the same schedule and an equivalent service so
# performer overlap cannot mask the resource conflict.
psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v specialist_id="$specialist_id" -v specialist_service_id="$specialist_service_id" \
  -v owner_id="$owner_id" -v owner_service_id="$owner_service_id" \
  -v organization_id="$organization_id" -v group_id="$group_id" \
  -v resource_id="$resource_id" -v location_id="$location_id" <<'SQL' >/dev/null
set session_replication_role=replica;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values(:'specialist_id'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'v69-concurrent-specialist@example.invalid',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
set session_replication_role=origin;
insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
values(:'organization_id'::uuid,:'specialist_id'::uuid,'specialist',true,true,:'owner_id'::uuid);
insert into public.performer_profiles(id,display_name)
values(:'specialist_id'::uuid,'V69 Concurrent Specialist');
insert into public.services
select (jsonb_populate_record(null::public.services,to_jsonb(service)||jsonb_build_object(
  'id',:'specialist_service_id','performer_id',:'specialist_id','name','V69 Concurrent Service','created_at',now(),'updated_at',now()
))).* from public.services service where service.id=:'owner_service_id'::uuid;
insert into public.provider_schedule(performer_id,weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes)
select :'specialist_id'::uuid,weekday,enabled,start_time,end_time,break_start,break_end,slot_interval_minutes
from public.provider_schedule where performer_id=:'owner_id'::uuid;
insert into public.resource_groups(id,organization_id,kind,name)
values(:'group_id'::uuid,:'organization_id'::uuid,'room','V69 Concurrent Rooms');
insert into public.resources(id,organization_id,location_id,group_id,name)
values(:'resource_id'::uuid,:'organization_id'::uuid,:'location_id'::uuid,:'group_id'::uuid,'V69 Concurrent Room');
SQL

psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v owner_id="$owner_id" -v organization_id="$organization_id" \
  -v owner_service_id="$owner_service_id" -v specialist_service_id="$specialist_service_id" \
  -v group_id="$group_id" <<'SQL' >/dev/null
select set_config('request.jwt.claim.sub',:'owner_id',false);
set role authenticated;
select public.replace_minuta_service_resource_requirements(
  :'organization_id'::uuid,:'owner_service_id'::uuid,
  jsonb_build_array(jsonb_build_object('group_id',:'group_id','quantity',1))
);
select public.replace_minuta_service_resource_requirements(
  :'organization_id'::uuid,:'specialist_service_id'::uuid,
  jsonb_build_array(jsonb_build_object('group_id',:'group_id','quantity',1))
);
reset role;
SQL

set +e
rollback_output="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -f minuta-online-booking/recovery/rollback-resource-scheduling-v69.sql 2>&1)"
rollback_status=$?
set -e
if [[ "$rollback_status" -eq 0 ]] || ! grep -q 'v69_rollback_blocked_resources_in_use' <<<"$rollback_output"; then
  echo "v69 rollback guard did not block configured resources" >&2
  exit 1
fi

# Session one creates a real booking/allocation and holds its transaction. The
# second specialist races the same resource through the public booking RPC.
holder_app="minuta_v69_resource_holder_$$"
PGAPPNAME="$holder_app" psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v request_id="$request_one" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$owner_service_id" -v booking_date="$target_date" -v booking_time="$target_time" <<'SQL' >/dev/null &
begin;
select * from public.book_minuta_appointment(
  :'request_id'::uuid,:'slug',:'location_id'::uuid,:'service_id'::uuid,
  :'booking_date'::date,:'booking_time'::time,'V69 Concurrent One','+79990006911'
);
select pg_sleep(5);
commit;
SQL
first_pid=$!

ready="f"
for _ in {1..200}; do
  ready="$(psql "$MINUTA_TEST_DATABASE_URL" -X -At -v holder_app="$holder_app" \
    -c "select exists(select 1 from pg_stat_activity where application_name=:'holder_app' and state='active' and query~*'pg_sleep')")"
  [[ "$ready" == "t" ]] && break
  sleep 0.05
done
if [[ "$ready" != "t" ]]; then
  wait "$first_pid" || true
  echo "v69 holder did not reach concurrent state" >&2
  exit 1
fi

set +e
conflict_output="$(psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v request_id="$request_two" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$specialist_service_id" -v booking_date="$target_date" -v booking_time="$target_time" 2>&1 <<'SQL'
select * from public.book_minuta_appointment(
  :'request_id'::uuid,:'slug',:'location_id'::uuid,:'service_id'::uuid,
  :'booking_date'::date,:'booking_time'::time,'V69 Concurrent Two','+79990006912'
);
SQL
)"
conflict_status=$?
set -e
wait "$first_pid"
if [[ "$conflict_status" -eq 0 ]] || ! grep -Eqi 'resource_unavailable|exclusion|booking_resources_active_no_overlap' <<<"$conflict_output"; then
  echo "v69 concurrent booking did not reject the occupied resource" >&2
  echo "$conflict_output" >&2
  exit 1
fi

booking_one="$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select id from public.bookings where request_id='$request_one'::uuid")"
test -n "$booking_one"
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select count(*) from public.booking_resource_allocations where booking_id='$booking_one'::uuid and resource_id='$resource_id'::uuid and booking_status='active'")" = "1"
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select count(*) from public.bookings where request_id='$request_two'::uuid")" = "0"

# Exact retry must not duplicate the allocation.
psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v request_id="$request_one" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$owner_service_id" -v booking_date="$target_date" -v booking_time="$target_time" <<'SQL' >/dev/null
select * from public.book_minuta_appointment(
  :'request_id'::uuid,:'slug',:'location_id'::uuid,:'service_id'::uuid,
  :'booking_date'::date,:'booking_time'::time,'V69 Concurrent One','+79990006911'
);
SQL
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select count(*) from public.booking_resource_allocations where booking_id='$booking_one'::uuid")" = "1"

# Cancellation releases the resource; the rejected specialist can then book
# the same interval through the same public RPC.
psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -c "update public.bookings set status='cancelled' where id='$booking_one'::uuid" >/dev/null
psql "$MINUTA_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -X \
  -v request_id="$request_two" -v slug="$slug" -v location_id="$location_id" \
  -v service_id="$specialist_service_id" -v booking_date="$target_date" -v booking_time="$target_time" <<'SQL' >/dev/null
select * from public.book_minuta_appointment(
  :'request_id'::uuid,:'slug',:'location_id'::uuid,:'service_id'::uuid,
  :'booking_date'::date,:'booking_time'::time,'V69 Concurrent Two','+79990006912'
);
SQL
booking_two="$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select id from public.bookings where request_id='$request_two'::uuid")"
test -n "$booking_two"
test "$(psql "$MINUTA_TEST_DATABASE_URL" -X -Atc "select count(*) from public.booking_resource_allocations where booking_id='$booking_two'::uuid and resource_id='$resource_id'::uuid and booking_status='active'")" = "1"

echo "multi-tenant v69 concurrency test: OK"
