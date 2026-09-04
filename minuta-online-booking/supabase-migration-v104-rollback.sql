-- v104 rollback: remove the compare-and-swap wrapper; v102 remains available.
begin;

drop function if exists public.move_minuta_team_booking_v104(
  uuid,uuid,uuid,uuid,date,time without time zone,uuid,uuid,date,time without time zone
);

drop function if exists public.move_minuta_team_booking_v104(
  uuid,uuid,uuid,uuid,uuid,date,time without time zone,uuid,uuid,date,time without time zone
);

commit;
