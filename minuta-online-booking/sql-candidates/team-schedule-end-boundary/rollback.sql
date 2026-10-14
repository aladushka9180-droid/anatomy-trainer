-- SOURCE candidate only: ROOT must qualify the protected restore and assign the migration.
-- Changes function bodies only; signatures, ownership, ACL and security settings survive.
begin;
do $patch$
declare
  item record;
  definition text;
begin
  for item in select * from (values
    ('public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer)', 'p_date + p_time + make_interval(mins=>p_duration) <= p_date + shift_row.end_time', 'p_time + make_interval(mins=>p_duration) <= shift_row.end_time'),
    (case when to_regprocedure('public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)') is not null
      then 'public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)'
      else 'public.set_minuta_branch_shifts_enabled(uuid,boolean)' end,
      'booking.booking_date+booking.booking_time+make_interval(mins=>booking.duration_minutes)<=booking.booking_date+shift_row.end_time', 'booking.booking_time+make_interval(mins=>booking.duration_minutes)<=shift_row.end_time')
  ) as changes(signature, previous_expression, next_expression) loop
    definition := pg_get_functiondef(item.signature::regprocedure);
    if strpos(definition, item.previous_expression) > 0
       and strpos(definition, item.next_expression) = 0
       and (length(definition)-length(replace(definition,item.previous_expression,'')))/length(item.previous_expression) = 1 then
      execute replace(definition,item.previous_expression,item.next_expression);
    elsif strpos(definition,item.previous_expression) = 0
       and (length(definition)-length(replace(definition,item.next_expression,'')))/length(item.next_expression) = 1 then
      null; -- This exact transformation has already been applied.
    else
      raise exception 'team_schedule_end_boundary_source_mismatch: %', item.signature;
    end if;
  end loop;
end;
$patch$;
commit;
