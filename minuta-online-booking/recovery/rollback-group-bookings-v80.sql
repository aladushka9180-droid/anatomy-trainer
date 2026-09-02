begin;

drop trigger if exists bookings_group_event_overlap on public.bookings;
drop trigger if exists zz_bookings_group_event_overlap_v86 on public.bookings;
drop function if exists public.prevent_minuta_group_event_booking_overlap();

drop trigger if exists organizations_group_booking_settings on public.organizations;
drop function if exists public.ensure_minuta_group_booking_settings();

drop function if exists public.get_minuta_group_safe_reschedule_slots(uuid,date,date);
drop function if exists public.get_public_minuta_available_slots_group_safe(text,uuid,uuid,date,date);
drop function if exists public.book_minuta_group_event(uuid,uuid,text,text,text);
drop function if exists public.get_public_minuta_group_events(text,date,date);
drop function if exists public.get_minuta_group_booking_admin(uuid,date,date);
drop function if exists public.set_minuta_group_participant_status(uuid,uuid,text);
drop function if exists public.set_minuta_group_event_status(uuid,uuid,text);
drop function if exists public.upsert_minuta_group_event(uuid,uuid,uuid,uuid,text,text,date,time without time zone,integer,integer,text);
drop function if exists public.set_minuta_group_bookings_enabled(uuid,boolean);
drop function if exists public.write_minuta_group_booking_audit(uuid,text,uuid,uuid,jsonb);
drop function if exists public.get_minuta_group_booking_role(uuid);

drop trigger if exists group_booking_events_scope on public.group_booking_events;
drop function if exists public.enforce_minuta_group_event_scope();
drop table if exists public.group_booking_audit_log;
drop table if exists public.group_booking_participants;
drop table if exists public.group_booking_events;
drop table if exists public.organization_group_booking_settings;

commit;
