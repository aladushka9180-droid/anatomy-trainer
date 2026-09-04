\set ON_ERROR_STOP on
begin;
do $$ begin
  if to_regclass('public.booking_funnel_events') is not null and exists(select 1 from public.booking_funnel_events limit 1) then
    raise exception using errcode='P0001',message='v107_rollback_blocked_funnel_data_exists';
  end if;
end $$;
drop function if exists public.get_minuta_utm_funnel_v107(uuid,date,date);
drop function if exists public.track_public_booking_funnel_event(text,uuid,text,uuid,uuid,text,text,text,text,text,text,text);
drop table if exists public.booking_funnel_events;
notify pgrst,'reload schema';
commit;
