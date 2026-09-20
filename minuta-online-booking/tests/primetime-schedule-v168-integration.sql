\set ON_ERROR_STOP on

begin;

do $fixture$
declare
  v_service uuid;
  v_performer uuid;
begin
  select service.id,service.performer_id
  into v_service,v_performer
  from public.services service
  join public.booking_policies policy on policy.performer_id=service.performer_id
  order by service.id
  limit 1;
  if v_service is null then
    raise exception 'v168_test_requires_service_policy_fixture';
  end if;
  perform set_config('minuta.v168_service',v_service::text,true);
  perform set_config('minuta.v168_performer',v_performer::text,true);
end
$fixture$;

create or replace function public.get_public_minuta_available_slots_group_safe(
  p_slug text,p_location uuid,p_service uuid,p_start date,p_end date
)
returns table(booking_date date,booking_time time without time zone)
language sql stable security definer set search_path to '' as $$
  select p_start,make_time(value,0,0)
  from generate_series(9,11) value
  order by value
$$;

create or replace function public.minuta_slot_respects_booking_buffer(
  p_service uuid,p_date date,p_time time without time zone,
  p_duration integer default null,p_ignore_booking uuid default null
)
returns boolean language sql stable security definer set search_path to '' as $$
  select false
$$;

update public.booking_policies
set booking_buffer_enabled=false
where performer_id=current_setting('minuta.v168_performer')::uuid;

do $disabled$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.get_public_minuta_available_slots_v101(
    'test-slug','11111111-1111-4111-8111-111111111111'::uuid,
    current_setting('minuta.v168_service')::uuid,current_date,current_date
  );
  if v_count<>3 then
    raise exception 'disabled_buffer_fast_path_failed:%',v_count;
  end if;
end
$disabled$;

update public.booking_policies
set booking_buffer_enabled=true
where performer_id=current_setting('minuta.v168_performer')::uuid;

do $enabled$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.get_public_minuta_available_slots_v101(
    'test-slug','11111111-1111-4111-8111-111111111111'::uuid,
    current_setting('minuta.v168_service')::uuid,current_date,current_date
  );
  if v_count<>0 then
    raise exception 'enabled_buffer_legacy_path_failed:%',v_count;
  end if;
end
$enabled$;

do $contract$
declare
  v_body text:=lower(pg_get_functiondef(
    'public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)'::regprocedure
  ));
begin
  if position('if not coalesce(v_buffer_enabled,false)' in v_body)=0
     or position('minuta_slot_respects_booking_buffer' in v_body)=0
     or not has_function_privilege('anon','public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)','EXECUTE')
     or has_function_privilege('service_role','public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)','EXECUTE') then
    raise exception 'v168_contract_failed';
  end if;
end
$contract$;

rollback;
