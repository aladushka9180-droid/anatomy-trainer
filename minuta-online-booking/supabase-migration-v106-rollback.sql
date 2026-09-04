\set ON_ERROR_STOP on

begin;
drop function if exists public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text);
drop function if exists public.process_minuta_auto_completed_visits_v106(integer);
do $$
begin
  if to_regprocedure('public.save_minuta_booking_outcome_v106(uuid,text,text,integer,integer,text)') is not null
     or to_regprocedure('public.process_minuta_auto_completed_visits_v106(integer)') is not null then
    raise exception using errcode='P0001',message='v106_rollback_guard_failed';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
