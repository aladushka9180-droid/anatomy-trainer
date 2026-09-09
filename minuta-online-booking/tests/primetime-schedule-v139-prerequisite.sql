-- The isolated database may omit the public schedule function. The v139
-- integration replaces it transaction-locally with deterministic rows.
create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,
  p_location uuid,
  p_service uuid,
  p_start date,
  p_end date
) returns table(booking_date date,booking_time time)
language sql stable security definer set search_path=public,pg_temp
as $$
  select null::date,null::time where false
$$;

revoke all on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date) from public;
grant execute on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date) to anon,authenticated;

create table if not exists public.primetime_server_credentials(
  credential_key text primary key,
  secret_sha256 text not null,
  active boolean not null default true
);
revoke all on table public.primetime_server_credentials from public,anon,authenticated,service_role;
insert into public.primetime_server_credentials(credential_key,secret_sha256,active)
values('schedule_v138',repeat('0',64),true)
on conflict(credential_key) do nothing;

create or replace function public.get_primetime_schedule_v138(p_requests jsonb)
returns jsonb language sql stable security definer set search_path=public,pg_temp
as $$ select '[]'::jsonb $$;
revoke all on function public.get_primetime_schedule_v138(jsonb) from public,anon,authenticated,service_role;
