\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)') is null then
    raise exception using errcode='55000',message='v138_requires_public_schedule_v101';
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v138_requires_pgcrypto';
  end if;
end
$guard$;

create table if not exists public.primetime_server_credentials(
  credential_key text primary key,
  secret_sha256 text not null,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  constraint primetime_server_credentials_key_check
    check(credential_key~'^[a-z0-9_-]{3,80}$'),
  constraint primetime_server_credentials_hash_check
    check(secret_sha256~'^[0-9a-f]{64}$')
);
alter table public.primetime_server_credentials enable row level security;
revoke all on table public.primetime_server_credentials
  from public,anon,authenticated,service_role;
insert into public.primetime_server_credentials(
  credential_key,secret_sha256,active
) values(
  'schedule_v138','0ac8045f0e9b31d6834d30de8887b0e2d556e3fafb4897ddd34e378c24c0732c',true
)
on conflict(credential_key) do update set
  secret_sha256=excluded.secret_sha256,
  active=true;

-- Validate the public booking-page query before the expensive schedule graph
-- is evaluated, and keep every response within a fixed bound.
create or replace function public.get_public_minuta_available_slots_v101(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date
)
returns table(booking_date date,booking_time time without time zone)
language plpgsql stable security definer set search_path to '' as $$
begin
  if p_slug is null
     or p_slug<>lower(trim(p_slug))
     or p_slug!~'^[a-z0-9][a-z0-9-]{1,79}$'
     or p_location is null or p_service is null
     or p_start is null or p_end is null
     or p_start<current_date-1
     or p_end<p_start
     or p_end>current_date+14
     or p_end-p_start>14 then
    raise exception using errcode='22023',message='invalid_public_schedule_scope';
  end if;
  return query
  select slot.booking_date,slot.booking_time
  from public.get_public_minuta_available_slots_group_safe(
    p_slug,p_location,p_service,p_start,p_end
  ) slot
  where public.minuta_slot_respects_booking_buffer(
    p_service,slot.booking_date,slot.booking_time,null,null
  )
  order by slot.booking_date,slot.booking_time
  limit 512;
end
$$;

-- PrimeTime calls one authenticated server-to-server batch. The browser never
-- receives this credential and no per-card upstream fan-out is required.
create or replace function public.get_primetime_schedule_v138(p_requests jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_headers jsonb;
  v_secret text;
  v_count integer;
  v_invalid boolean;
  v_result jsonb;
begin
  begin
    v_headers:=coalesce(nullif(current_setting('request.headers',true),''),'{}')::jsonb;
  exception when others then
    v_headers:='{}'::jsonb;
  end;
  v_secret:=coalesce(v_headers->>'x-primetime-upstream-key','');
  if char_length(v_secret)<>64 or not exists(
    select 1 from public.primetime_server_credentials credential
    where credential.credential_key='schedule_v138' and credential.active
      and credential.secret_sha256=encode(
        extensions.digest(convert_to(v_secret,'UTF8'),'sha256'),'hex'
      )
  ) then
    raise exception using errcode='42501',message='schedule_access_denied';
  end if;

  if p_requests is null or jsonb_typeof(p_requests)<>'array'
     or octet_length(p_requests::text)>8192 then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;
  v_count:=jsonb_array_length(p_requests);
  if v_count<1 or v_count>12 then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;

  select coalesce(bool_or(
    jsonb_typeof(item)<>'object'
    or item-array['key','slug','location','service','start','end','period']::text[]<>'{}'::jsonb
    or coalesce(item->>'key','')!~'^[a-z0-9][a-z0-9:_-]{1,179}$'
    or coalesce(item->>'slug','')!~'^[a-z0-9][a-z0-9-]{1,79}$'
    or coalesce(item->>'location','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(item->>'service','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(item->>'period','') not in('any','morning','day','evening')
    or coalesce(item->>'start','')!~'^\d{4}-\d{2}-\d{2}$'
    or coalesce(item->>'end','')!~'^\d{4}-\d{2}-\d{2}$'
  ),false) into v_invalid from jsonb_array_elements(p_requests) item;
  if v_invalid then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;

  begin
    select coalesce(bool_or(
      (item->>'start')::date::text<>item->>'start'
      or (item->>'end')::date::text<>item->>'end'
      or (item->>'start')::date<current_date
      or (item->>'end')::date<(item->>'start')::date
      or (item->>'end')::date>current_date+8
      or (item->>'end')::date-(item->>'start')::date>8
    ),false) into v_invalid from jsonb_array_elements(p_requests) item;
  exception when others then
    v_invalid:=true;
  end;
  if v_invalid or (
    select count(distinct item->>'key')<>v_count
    from jsonb_array_elements(p_requests) item
  ) then
    raise exception using errcode='22023',message='invalid_primetime_schedule_scope';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key',request.item->>'key','slots',coalesce(slots.value,'[]'::jsonb)
  ) order by request.ordinality),'[]'::jsonb) into v_result
  from jsonb_array_elements(p_requests) with ordinality request(item,ordinality)
  left join lateral(
    select jsonb_agg(jsonb_build_object(
      'booking_date',bounded.booking_date,'booking_time',bounded.booking_time
    ) order by bounded.booking_date,bounded.booking_time) value
    from(
      select ranked.booking_date,ranked.booking_time
      from(
        select slot.booking_date,slot.booking_time,
          row_number() over(
            partition by slot.booking_date order by slot.booking_time
          ) day_position
        from public.get_public_minuta_available_slots_v101(
          request.item->>'slug',(request.item->>'location')::uuid,
          (request.item->>'service')::uuid,(request.item->>'start')::date,
          (request.item->>'end')::date
        ) slot
        where case request.item->>'period'
          when 'morning' then slot.booking_time<'12:00'::time
          when 'day' then slot.booking_time>='12:00'::time and slot.booking_time<'17:00'::time
          when 'evening' then slot.booking_time>='17:00'::time
          else true end
      ) ranked
      where ranked.day_position<=4
      order by ranked.booking_date,ranked.booking_time
      limit 24
    ) bounded
  ) slots on true;
  return v_result;
end
$$;

revoke all on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)
  from public,anon,authenticated,service_role;
grant execute on function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)
  to anon,authenticated;
revoke all on function public.get_primetime_schedule_v138(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.get_primetime_schedule_v138(jsonb) to anon;

do $verify$
begin
  if to_regprocedure('public.get_primetime_schedule_v138(jsonb)') is null
     or has_table_privilege('anon','public.primetime_server_credentials','SELECT')
     or has_table_privilege('authenticated','public.primetime_server_credentials','SELECT')
     or not has_function_privilege('anon','public.get_primetime_schedule_v138(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.get_primetime_schedule_v138(jsonb)','EXECUTE')
     or position('limit 512' in lower(pg_get_functiondef(
       'public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)'::regprocedure
     )))=0 then
    raise exception using errcode='55000',message='v138_verification_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
