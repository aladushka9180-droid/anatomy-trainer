begin;

do $$
declare
  v_table text;
  v_has_rows boolean;
begin
  foreach v_table in array array[
    'resource_groups','resources','service_resource_requirements',
    'booking_resource_allocations','resource_audit_log'
  ] loop
    if to_regclass(format('public.%I',v_table)) is not null then
      execute format('select exists(select 1 from public.%I)',v_table) into v_has_rows;
      if v_has_rows then
        raise exception using errcode = 'P0001', message = 'v69_rollback_blocked_resources_in_use';
      end if;
    end if;
  end loop;
end;
$$;

drop trigger if exists bookings_sync_minuta_resources on public.bookings;

drop function if exists public.get_reschedule_slots_v3(uuid,date,date);
drop function if exists public.get_minuta_team_calendar_v2(uuid,date,date,uuid,uuid,uuid);
drop function if exists public.get_public_minuta_catalog_v3(text);
drop function if exists public.get_public_minuta_available_slots_v3(text,uuid,uuid,date,date);
drop function if exists public.replace_minuta_service_resource_requirements(uuid,uuid,jsonb);
drop function if exists public.update_minuta_resource(uuid,uuid,uuid,text,boolean);
drop function if exists public.create_minuta_resource(uuid,uuid,uuid,text);
drop function if exists public.update_minuta_resource_group(uuid,text,text,text,boolean);
drop function if exists public.create_minuta_resource_group(uuid,text,text,text);
drop function if exists public.get_minuta_resource_workspace(uuid);
drop function if exists public.sync_minuta_booking_resources();
drop function if exists public.allocate_minuta_booking_resources(uuid);
drop function if exists public.write_minuta_resource_audit(uuid,text,uuid,jsonb);
drop function if exists public.require_minuta_resource_manager(uuid);

drop table if exists public.resource_audit_log;
drop table if exists public.booking_resource_allocations;
drop table if exists public.service_resource_requirements;
drop table if exists public.resources;
drop table if exists public.resource_groups;

alter table public.bookings
  drop constraint if exists bookings_id_organization_location_key;

commit;
