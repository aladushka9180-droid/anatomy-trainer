begin;
set local search_path=public,extensions,pg_catalog;

-- Test/pre-release rollback only. Refuse to erase any real loyalty history.
do $guard$
begin
  if exists(select 1 from public.loyalty_program_settings_v166)
     or exists(select 1 from public.loyalty_program_rules_v166)
     or exists(select 1 from public.loyalty_program_accounts_v166)
     or exists(select 1 from public.loyalty_program_visits_v166)
     or exists(select 1 from public.loyalty_program_rewards_v166)
     or exists(select 1 from public.loyalty_program_history_v166) then
    raise exception using errcode='55000',message='v166_schema_rollback_refuses_nonempty_data';
  end if;
end
$guard$;

drop trigger if exists booking_outcomes_loyalty_program_v166 on public.booking_outcomes;
drop trigger if exists bookings_loyalty_program_v166 on public.bookings;
drop function if exists public.reconcile_minuta_loyalty_outcome_v166();
drop function if exists public.reconcile_minuta_loyalty_booking_status_v166();
drop function if exists public.reconcile_minuta_loyalty_booking_v166(uuid);
drop function if exists public.get_client_loyalty_program_v166(text,uuid);
drop function if exists public.get_minuta_loyalty_program_workspace_v166(uuid);
drop function if exists public.redeem_minuta_loyalty_reward_v166(uuid,uuid,uuid,text,uuid);
drop function if exists public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid);
drop function if exists public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid);
drop function if exists public.expire_minuta_loyalty_rewards_v166(uuid,uuid);
drop function if exists public.protect_minuta_loyalty_program_history_v166();
drop function if exists public.get_minuta_loyalty_program_role_v166(uuid);

drop table public.loyalty_program_history_v166;
drop table public.loyalty_program_rewards_v166;
drop table public.loyalty_program_visits_v166;
drop table public.loyalty_program_accounts_v166;
drop table public.loyalty_program_rules_v166;
drop table public.loyalty_program_settings_v166;

notify pgrst,'reload schema';
commit;
