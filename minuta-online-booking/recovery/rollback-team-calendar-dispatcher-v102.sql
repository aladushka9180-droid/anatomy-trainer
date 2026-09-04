begin;

drop function if exists public.move_minuta_team_booking_v102(uuid,uuid,uuid,uuid,date,time without time zone);
drop function if exists public.create_minuta_team_booking_v102(uuid,uuid,uuid,uuid,date,time without time zone,text,text);
drop function if exists public.get_minuta_team_calendar_v3(uuid,date,date,uuid,uuid,uuid);

commit;
