-- Disable flexible creation without deleting bookings or replay evidence.
begin;
set local lock_timeout = '10s';
revoke all on function public.book_flexible_appointment_v178(
  uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text)
  from public,anon,authenticated,service_role;
drop function public.book_flexible_appointment_v178(
  uuid,uuid,date,time without time zone,time without time zone,text,text,text,uuid,integer,integer,text);
notify pgrst,'reload schema';
commit;
