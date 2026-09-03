begin;

drop function if exists public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text
);

commit;
