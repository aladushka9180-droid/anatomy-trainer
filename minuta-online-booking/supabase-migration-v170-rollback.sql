begin;
set local lock_timeout='10s';
drop function if exists public.book_minuta_appointment_v3(
  uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text
);
commit;
