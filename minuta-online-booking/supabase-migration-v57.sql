begin;

alter table public.services
  drop constraint if exists services_duration_minutes_check;

alter table public.services
  add constraint services_duration_minutes_check
  check (duration_minutes >= 1 and duration_minutes <= 480);

alter table public.booking_outcomes
  add column if not exists actual_duration_minutes integer,
  add column if not exists calculated_amount_rub integer;

alter table public.booking_outcomes
  drop constraint if exists booking_outcomes_actual_duration_minutes_check;
alter table public.booking_outcomes
  add constraint booking_outcomes_actual_duration_minutes_check
  check (actual_duration_minutes is null or actual_duration_minutes between 0 and 1440);

alter table public.booking_outcomes
  drop constraint if exists booking_outcomes_calculated_amount_rub_check;
alter table public.booking_outcomes
  add constraint booking_outcomes_calculated_amount_rub_check
  check (calculated_amount_rub is null or calculated_amount_rub between 0 and 10000000);

commit;
