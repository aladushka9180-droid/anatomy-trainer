\set ON_ERROR_STOP on

begin;

drop function if exists public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text,integer
);
drop function if exists public.create_minuta_historical_booking(
  uuid,uuid,date,time without time zone,text,text
);

commit;
