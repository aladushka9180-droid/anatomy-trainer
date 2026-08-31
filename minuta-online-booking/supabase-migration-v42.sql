begin;

alter table public.services
  drop constraint if exists services_duration_minutes_check;

alter table public.services
  add constraint services_duration_minutes_check
  check (duration_minutes >= 5 and duration_minutes <= 480);

commit;
