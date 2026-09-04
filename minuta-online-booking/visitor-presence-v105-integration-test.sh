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
declare saved record;
begin
  if to_regclass('public.minuta_v105_presence_fixture') is not null then
    delete from public.booking_page_visits visit
    using public.minuta_v105_presence_fixture fixture
    where visit.organization_id=fixture.organization_id
      and visit.performer_id=fixture.performer_id
      and visit.source_label=fixture.marker;
    delete from public.staff_schedule_audit_log audit using public.minuta_v105_presence_fixture fixture where audit.subject_id=fixture.booking_id;
    delete from public.booking_events event using public.minuta_v105_presence_fixture fixture where event.booking_id=fixture.booking_id;
    delete from public.notification_marks mark using public.minuta_v105_presence_fixture fixture where mark.booking_id=fixture.booking_id;
    delete from public.notification_outbox outbox using public.minuta_v105_presence_fixture fixture where outbox.booking_id=fixture.booking_id;
    delete from public.booking_resource_allocations allocation using public.minuta_v105_presence_fixture fixture where allocation.booking_id=fixture.booking_id;
    delete from public.booking_session_revisions revision using public.minuta_v105_presence_fixture fixture where revision.booking_id=fixture.booking_id;
    delete from public.booking_session_items item using public.minuta_v105_presence_fixture fixture where item.booking_id=fixture.booking_id;
    delete from public.booking_outcomes outcome using public.minuta_v105_presence_fixture fixture where outcome.booking_id=fixture.booking_id;
    delete from public.bookings booking using public.minuta_v105_presence_fixture fixture where booking.id=fixture.booking_id;
  end if;
  if to_regclass('public.minuta_v105_presence_policy_fixture') is not null then
    alter table public.booking_policies disable trigger booking_policies_touch_updated_at;
    for saved in select * from public.minuta_v105_presence_policy_fixture loop
      update public.booking_policies set visitor_notifications_enabled=saved.was_enabled,updated_at=saved.was_updated_at
      where performer_id=saved.performer_id;
    end loop;
    alter table public.booking_policies enable trigger booking_policies_touch_updated_at;
  end if;
  drop table if exists public.minuta_v105_presence_policy_fixture;
  drop table if exists public.minuta_v105_presence_fixture;
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
create table public.minuta_v105_presence_fixture(
  organization_id uuid not null,
  performer_id uuid not null,
  slug text not null,
  marker text not null,
  concurrency_session uuid not null,
  booking_id uuid not null,
  client_name text not null,
  client_phone text not null
);
create table public.minuta_v105_presence_policy_fixture(
  performer_id uuid primary key,
  was_enabled boolean not null,
  was_updated_at timestamptz not null
);

do $$
declare
  candidate record;
  v_marker text:='v105-test-'||extensions.gen_random_uuid()::text;
  v_booking uuid:=extensions.gen_random_uuid();
  v_client_name text;
  v_client_phone text:='+7 999 105-00-01';
begin
  select organization.id organization_id,membership.user_id owner_id,organization.public_slug slug,
         location.id location_id,service.id service_id,service.performer_id booking_performer_id,
         service.duration_minutes,service.price_rub
  into candidate
  from public.organizations organization
  join public.organization_memberships membership on membership.organization_id=organization.id
    and membership.active and membership.role='owner'
  join public.booking_policies policy on policy.performer_id=membership.user_id
  join public.locations location on location.organization_id=organization.id and location.active
  join public.organization_memberships bookable on bookable.organization_id=organization.id and bookable.active and bookable.is_bookable
  join public.services service on service.performer_id=bookable.user_id and service.active
  where organization.status='active' and organization.public_booking_enabled
    and organization.public_slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'
    and service.duration_minutes between 5 and 240
    and not exists(select 1 from public.service_resource_requirements requirement
                   where requirement.organization_id=organization.id and requirement.service_id=service.id and requirement.active)
    and (select count(*) from public.booking_page_visits visit
         where visit.organization_id=organization.id and visit.performer_id=membership.user_id
           and visit.session_id is not null and visit.created_at>=now()-interval '1 minute')<55
  order by location.is_primary desc,organization.id,service.id
  limit 1;
  if candidate.organization_id is null then raise exception 'v105_presence_fixture_missing'; end if;
  v_client_name:='V105 '||substr(v_marker,11);

  insert into public.minuta_v105_presence_policy_fixture(performer_id,was_enabled,was_updated_at)
  select distinct policy.performer_id,policy.visitor_notifications_enabled,policy.updated_at
  from public.organization_memberships membership
  join public.booking_policies policy on policy.performer_id=membership.user_id
  where membership.organization_id=candidate.organization_id and membership.active and membership.role='owner';
  update public.booking_policies policy set visitor_notifications_enabled=(policy.performer_id=candidate.owner_id)
  where policy.performer_id in (select performer_id from public.minuta_v105_presence_policy_fixture);

  insert into public.bookings(
    id,booking_code,manage_token,request_id,request_fingerprint,
    performer_id,service_id,client_name,client_phone,
    booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
    status,deposit_amount_rub,payment_status,payment_url,
    organization_id,location_id,booking_scope_source,
    booking_source,created_by_user_id,created_by_role,created_at
  ) values(
    v_booking,'V105-'||upper(substr(replace(v_booking::text,'-',''),1,10)),
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),
    replace(extensions.gen_random_uuid()::text,'-','')||replace(extensions.gen_random_uuid()::text,'-',''),
    candidate.booking_performer_id,candidate.service_id,v_client_name,v_client_phone,
    timezone('Europe/Samara',now())::date+800,time '02:00',candidate.duration_minutes,candidate.price_rub,candidate.price_rub,
    'confirmed',0,'not_required','',candidate.organization_id,candidate.location_id,'team',
    'admin_manual',candidate.owner_id,'owner',now()
  );

  insert into public.minuta_v105_presence_fixture values(
    candidate.organization_id,candidate.owner_id,candidate.slug,v_marker,extensions.gen_random_uuid(),v_booking,
    v_client_name,v_client_phone
  );
end $$;

select organization_id,performer_id,slug,marker,concurrency_session
from public.minuta_v105_presence_fixture;
SQL
)"

IFS='|' read -r organization_id performer_id slug marker concurrency_session <<<"$fixture"
if [[ -z "$organization_id" || -z "$concurrency_session" ]]; then
  echo "v105 fixture output is incomplete" >&2
  exit 1
fi

run_presence() {
  psql "$db_url" -v ON_ERROR_STOP=1 -X -qAt \
    --set=slug="$slug" --set=session="$concurrency_session" --set=marker="$marker" \
    -c "select public.upsert_public_booking_presence(:'slug',:'session','services','direct',:'marker',:'marker',null,null);"
}

run_presence >"$log_one" 2>&1 & pid_one=$!
run_presence >"$log_two" 2>&1 & pid_two=$!
wait "$pid_one"
wait "$pid_two"
if [[ "$(grep -cx t "$log_one" || true)" -ne 1 && "$(grep -cx t "$log_two" || true)" -ne 1 ]]; then
  echo "v105 concurrency did not produce a winner" >&2
  exit 1
fi
if [[ "$(grep -cx f "$log_one" || true)" -ne 1 && "$(grep -cx f "$log_two" || true)" -ne 1 ]]; then
  echo "v105 concurrency did not suppress the duplicate" >&2
  exit 1
fi

psql "$db_url" -v ON_ERROR_STOP=1 -X -q --set=marker="$marker" <<'SQL'
select public.upsert_public_booking_presence(fixture.slug,md5(:'marker'||':verified')::uuid,'details','direct',:'marker',:'marker',fixture.client_name,fixture.client_phone)
from public.minuta_v105_presence_fixture fixture;
select public.upsert_public_booking_presence(fixture.slug,md5(:'marker'||':forged')::uuid,'details','direct',:'marker',:'marker',fixture.client_name||' другое имя',fixture.client_phone)
from public.minuta_v105_presence_fixture fixture;
select public.upsert_public_booking_presence(fixture.slug,md5(:'marker'||series.value::text)::uuid,'services','direct',:'marker',:'marker',null,null)
from public.minuta_v105_presence_fixture fixture cross join generate_series(1,70) series(value);
SQL

psql "$db_url" -v ON_ERROR_STOP=1 -X -qAt --set=organization="$organization_id" --set=performer="$performer_id" --set=marker="$marker" <<'SQL' | grep -qx t
select
  (select count(*)=1 from public.booking_page_visits where organization_id=:'organization' and performer_id=:'performer' and source_label=:'marker' and session_id=md5(:'marker'||':verified')::uuid and client_name is not null and client_phone is not null)
  and (select count(*)=1 from public.booking_page_visits where organization_id=:'organization' and performer_id=:'performer' and source_label=:'marker' and session_id=md5(:'marker'||':forged')::uuid and client_name is null and client_phone is null)
  and (select count(*)<=60 from public.booking_page_visits where organization_id=:'organization' and performer_id=:'performer' and session_id is not null and created_at>=now()-interval '1 minute')
  and (select count(*)=1 from public.booking_page_visits where organization_id=:'organization' and performer_id=:'performer' and source_label=:'marker' and session_id=md5(:'marker'||':verified')::uuid);
SQL

echo "visitor presence v105 integration: OK"
