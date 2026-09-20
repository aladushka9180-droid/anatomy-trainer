#!/usr/bin/env bash
set -euo pipefail

db="${MINUTA_TEST_DATABASE_URL/:6543/:5432}"
work="$(mktemp -d)"
cleanup(){
  set +e
  if [[ -n "${service_a:-}" && -n "${service_b:-}" ]]; then
    psql "$db" -X -q -v ON_ERROR_STOP=1 \
      --set=route="${route}" --set=item_a="${item_a}" --set=item_b="${item_b}" \
      --set=service_a="${service_a}" --set=service_b="${service_b}" \
      --set=location="${location}" --set=organization="${organization}" --set=performer="${performer}" <<'SQL'
begin;
delete from public.public_multi_service_route_items_v167 where route_request_id=:'route'::uuid;
delete from public.public_multi_service_routes_v167 where request_id=:'route'::uuid;
delete from public.bookings where request_id in(:'item_a'::uuid,:'item_b'::uuid);
delete from public.services where id in(:'service_a'::uuid,:'service_b'::uuid);
delete from public.locations where id=:'location'::uuid;
delete from public.organization_memberships where organization_id=:'organization'::uuid and user_id=:'performer'::uuid;
delete from public.organizations where id=:'organization'::uuid;
commit;
SQL
  fi
  rm -rf -- "$work"
}
trap cleanup EXIT

IFS='|' read -r performer organization slug location service_a service_b route item_a item_b < <(
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 -F '|' <<'SQL'
with candidate as (
  select candidate_service.performer_id
  from public.services candidate_service
  join public.organization_memberships membership on membership.user_id=candidate_service.performer_id and membership.active and membership.is_bookable
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where candidate_service.active
    and exists(select 1 from public.get_available_slots(candidate_service.id,current_date+1,current_date+7))
  order by candidate_service.id limit 1
), ids as (
  select performer_id,gen_random_uuid() organization_id,gen_random_uuid() location_id,
    gen_random_uuid() service_a,gen_random_uuid() service_b,gen_random_uuid() route_request,
    gen_random_uuid() item_a,gen_random_uuid() item_b from candidate
)
select performer_id,organization_id,'v167-'||replace(organization_id::text,'-',''),location_id,
  service_a,service_b,route_request,item_a,item_b from ids;
SQL
)

for value in "$organization" "$slug" "$location" "$performer" "$service_a" "$service_b" "$route" "$item_a" "$item_b"; do
  if [[ -z "$value" ]]; then echo "v167_concurrency_performer_missing" >&2; exit 1; fi
done

psql "$db" -X -q -v ON_ERROR_STOP=1 --set=performer="$performer" --set=organization="$organization" --set=slug="$slug" --set=location="$location" --set=service_a="$service_a" --set=service_b="$service_b" <<'SQL'
begin;
insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by)
values(:'organization'::uuid,'V167 concurrency organization',:'slug','active',true,:'performer'::uuid);
insert into public.locations(id,organization_id,name,address,timezone,active,is_primary)
values(:'location'::uuid,:'organization'::uuid,'V167 concurrency location','V167 address','Europe/Samara',true,true);
insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
values(:'organization'::uuid,:'performer'::uuid,'specialist',true,true,:'performer'::uuid);
insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
  (:'service_a'::uuid,:'performer'::uuid,'V167 concurrency A',30,1671,true),
  (:'service_b'::uuid,:'performer'::uuid,'V167 concurrency B',30,1672,true);
commit;
SQL

IFS='|' read -r date_value time_a time_b < <(
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 -F '|' --set=service_a="$service_a" --set=service_b="$service_b" <<'SQL'
select first_slot.booking_date,first_slot.booking_time,second_slot.booking_time
from public.get_available_slots(:'service_a'::uuid,current_date+1,current_date+7) first_slot
join public.get_available_slots(:'service_b'::uuid,current_date+1,current_date+7) second_slot
  on second_slot.booking_date=first_slot.booking_date and second_slot.booking_time>=first_slot.booking_time+interval '30 minutes'
order by first_slot.booking_date,first_slot.booking_time,second_slot.booking_time limit 1;
SQL
)

for value in "$date_value" "$time_a" "$time_b"; do
  if [[ -z "$value" ]]; then echo "v167_concurrency_slot_missing" >&2; exit 1; fi
done

call(){
  psql "$db" -X -qAt -v ON_ERROR_STOP=1 \
    --set=route="$route" --set=slug="$slug" --set=location="$location" \
    --set=item_a="$item_a" --set=item_b="$item_b" --set=service_a="$service_a" --set=service_b="$service_b" \
    --set=date_value="$date_value" --set=time_a="$time_a" --set=time_b="$time_b" <<'SQL'
begin;
set local role anon;
select public.book_minuta_multi_service_route_v167(
  :'route'::uuid,:'slug',:'location'::uuid,'V167 concurrent','+79990001673',jsonb_build_array(
    jsonb_build_object('request_id',:'item_a'::uuid,'service_id',:'service_a'::uuid,'booking_date',:'date_value'::date,'booking_time',:'time_a'::time,'expected_price_rub',1671,'expected_duration_minutes',30),
    jsonb_build_object('request_id',:'item_b'::uuid,'service_id',:'service_b'::uuid,'booking_date',:'date_value'::date,'booking_time',:'time_b'::time,'expected_price_rub',1672,'expected_duration_minutes',30)
  )
);
commit;
SQL
}

call >"$work/first.json" & first_pid=$!
call >"$work/second.json" & second_pid=$!
wait "$first_pid"
wait "$second_pid"

first_idempotent="$(jq -r .idempotent "$work/first.json")"
second_idempotent="$(jq -r .idempotent "$work/second.json")"
if [[ "$first_idempotent" = "$second_idempotent" ]]; then echo "v167_concurrency_replay_flag_invalid" >&2; exit 1; fi
if [[ "$(jq -r '.bookings|length' "$work/first.json")" != 2 ]]; then echo "v167_concurrency_booking_count_invalid" >&2; exit 1; fi
if [[ "$(jq -S '.bookings' "$work/first.json")" != "$(jq -S '.bookings' "$work/second.json")" ]]; then echo "v167_concurrency_replay_payload_mismatch" >&2; exit 1; fi

state="$(psql "$db" -X -qAt -v ON_ERROR_STOP=1 --set=route="$route" --set=item_a="$item_a" --set=item_b="$item_b" <<'SQL'
select json_build_object(
  'routes',(select count(*) from public.public_multi_service_routes_v167 where request_id=:'route'::uuid),
  'items',(select count(*) from public.public_multi_service_route_items_v167 where route_request_id=:'route'::uuid),
  'bookings',(select count(*) from public.bookings where request_id in(:'item_a'::uuid,:'item_b'::uuid))
);
SQL
)"
jq -e '.routes==1 and .items==2 and .bookings==2' <<<"$state" >/dev/null
printf '%s\n' '{"status":"success","sameRouteConcurrentCalls":2,"routes":1,"bookings":2,"duplicates":0}'
