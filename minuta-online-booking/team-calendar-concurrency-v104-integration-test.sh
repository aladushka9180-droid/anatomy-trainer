#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MINUTA_TEST_DATABASE_URL:-}" ]]; then
  echo "MINUTA_TEST_DATABASE_URL is required" >&2
  exit 1
fi
db_url="${MINUTA_TEST_DATABASE_URL/:6543/:5432}"
log_one="$(mktemp)"
log_two="$(mktemp)"

cleanup_fixture() {
  psql "$db_url" -v ON_ERROR_STOP=1 -X -q <<'SQL'
do $$
declare fixture record;
begin
  if to_regclass('public.minuta_v104_concurrency_fixture') is null then return; end if;
  for fixture in select * from public.minuta_v104_concurrency_fixture loop
    delete from public.staff_schedule_audit_log where subject_id=fixture.booking_id;
    delete from public.booking_events where booking_id=fixture.booking_id;
    delete from public.notification_marks where booking_id=fixture.booking_id;
    delete from public.notification_outbox where booking_id=fixture.booking_id;
    delete from public.booking_resource_allocations where booking_id=fixture.booking_id;
    delete from public.booking_session_revisions where booking_id=fixture.booking_id;
    delete from public.booking_session_items where booking_id=fixture.booking_id;
    delete from public.booking_outcomes where booking_id=fixture.booking_id;
    delete from public.bookings where id=fixture.booking_id;
    if fixture.shift_setting_existed then
      update public.organization_shift_settings
      set enabled=fixture.shift_setting_enabled,updated_at=now()
      where organization_id=fixture.organization_id;
    else
      delete from public.organization_shift_settings
      where organization_id=fixture.organization_id;
    end if;
  end loop;
  drop table public.minuta_v104_concurrency_fixture;
end $$;
SQL
}

finish() {
  cleanup_fixture || true
  rm -f -- "$log_one" "$log_two"
}
trap finish EXIT
cleanup_fixture

fixture="$(psql "$db_url" -v ON_ERROR_STOP=1 -X -qAt -F '|' <<'SQL'
create table public.minuta_v104_concurrency_fixture(
  actor_id uuid not null,
  organization_id uuid not null,
  booking_id uuid not null,
  performer_id uuid not null,
  location_id uuid not null,
  service_id uuid not null,
  booking_date date not null,
  booking_time time without time zone not null,
  first_target time without time zone not null,
  second_target time without time zone not null,
  shift_setting_existed boolean not null,
  shift_setting_enabled boolean not null
);

do $$
declare
  v_actor uuid;
  v_organization uuid;
  v_location uuid;
  v_service uuid;
  v_performer uuid;
  v_duration integer;
  v_price integer;
  v_booking uuid:=extensions.gen_random_uuid();
  v_date date:=timezone('Europe/Samara',now())::date+700;
  v_setting_exists boolean;
  v_setting_enabled boolean;
begin
  select actor.user_id,actor.organization_id,location.id,service.id,
         service.performer_id,service.duration_minutes,service.price_rub
  into v_actor,v_organization,v_location,v_service,v_performer,v_duration,v_price
  from public.organization_memberships actor
  join public.organizations organization
    on organization.id=actor.organization_id and organization.status='active'
  join public.locations location
    on location.organization_id=actor.organization_id and location.active
  join public.organization_memberships performer
    on performer.organization_id=actor.organization_id
   and performer.active and performer.is_bookable
  join public.services service
    on service.performer_id=performer.user_id and service.active
  where actor.active and actor.role in ('owner','admin')
    and service.duration_minutes between 6 and 60
    and not exists(
      select 1 from public.service_resource_requirements requirement
      where requirement.organization_id=actor.organization_id
        and requirement.service_id=service.id and requirement.active
    )
  order by location.is_primary desc,actor.organization_id,service.id
  limit 1;
  if v_actor is null then raise exception 'v104_concurrency_fixture_missing'; end if;

  select exists(
    select 1 from public.organization_shift_settings
    where organization_id=v_organization
  ),coalesce((
    select enabled from public.organization_shift_settings
    where organization_id=v_organization
  ),false)
  into v_setting_exists,v_setting_enabled;
  insert into public.organization_shift_settings(organization_id,enabled,updated_at)
  values(v_organization,false,now())
  on conflict(organization_id) do update set enabled=false,updated_at=excluded.updated_at;

  insert into public.bookings(
    id,booking_code,manage_token,request_id,request_fingerprint,
    performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
    status,deposit_amount_rub,payment_status,payment_url,
    organization_id,location_id,booking_scope_source,
    booking_source,created_by_user_id,created_by_role,created_at
  ) values(
    v_booking,'V104-'||upper(substr(replace(v_booking::text,'-',''),1,10)),
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),
    replace(extensions.gen_random_uuid()::text,'-','')||replace(extensions.gen_random_uuid()::text,'-',''),
    v_performer,v_service,'V104 concurrency','0000000000',
    v_date,time '02:00',v_duration,v_price,v_price,
    'confirmed',0,'not_required','',v_organization,v_location,'team',
    'admin_manual',v_actor,'owner',now()
  );

  insert into public.minuta_v104_concurrency_fixture values(
    v_actor,v_organization,v_booking,v_performer,v_location,v_service,
    v_date,time '02:00',time '03:00',time '04:00',
    v_setting_exists,v_setting_enabled
  );
end $$;

select actor_id,organization_id,booking_id,performer_id,location_id,service_id,
       booking_date,booking_time,first_target,second_target
from public.minuta_v104_concurrency_fixture;
SQL
)"

IFS='|' read -r actor_id organization_id booking_id performer_id location_id service_id booking_date booking_time first_target second_target <<<"$fixture"
if [[ -z "$booking_id" || -z "$second_target" ]]; then
  echo "v104 fixture output is incomplete: $fixture" >&2
  exit 1
fi

run_move() {
  local target_time="$1"
  psql "$db_url" -v ON_ERROR_STOP=1 -X -qAtc "
    select set_config('request.jwt.claim.sub','$actor_id',false);
    select public.move_minuta_team_booking_v104(
      '$organization_id','$booking_id','$performer_id','$location_id','$service_id',
      '$booking_date','$booking_time','$location_id','$service_id','$booking_date','$target_time'
    );"
}

set +e
run_move "$first_target" >"$log_one" 2>&1 &
pid_one=$!
run_move "$second_target" >"$log_two" 2>&1 &
pid_two=$!
wait "$pid_one"; result_one=$?
wait "$pid_two"; result_two=$?
set -e

if [[ "$result_one" -eq 0 && "$result_two" -eq 0 ]] || [[ "$result_one" -ne 0 && "$result_two" -ne 0 ]]; then
  echo "v104 concurrency expected exactly one successful move" >&2
  sed -n '1,20p' "$log_one" >&2
  sed -n '1,20p' "$log_two" >&2
  exit 1
fi
if ! { grep -q 'team_booking_changed' "$log_one" || grep -q 'team_booking_changed' "$log_two"; }; then
  echo "v104 losing move did not fail with team_booking_changed" >&2
  exit 1
fi

psql "$db_url" -v ON_ERROR_STOP=1 -X -qAtc "
  select (
    booking.performer_id='$performer_id'::uuid
    and booking.location_id='$location_id'::uuid
    and booking.service_id='$service_id'::uuid
    and booking.booking_date='$booking_date'::date
    and booking.booking_time in ('$first_target'::time,'$second_target'::time)
    and (select count(*) from public.staff_schedule_audit_log audit
         where audit.subject_id=booking.id and audit.action='team_booking_moved')=1
  )
  from public.bookings booking where booking.id='$booking_id'::uuid;" | grep -qx t

echo "team calendar v104 concurrency integration: OK"
