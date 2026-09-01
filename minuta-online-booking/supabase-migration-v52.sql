begin;

alter table public.booking_policies
  add column if not exists auto_complete_visits boolean not null default false;

alter table public.booking_outcomes
  add column if not exists completion_source text not null default 'manual';

alter table public.booking_outcomes
  drop constraint if exists booking_outcomes_completion_source_check;
alter table public.booking_outcomes
  add constraint booking_outcomes_completion_source_check
  check (completion_source in ('manual', 'auto'));

commit;
