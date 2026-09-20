with objects as (
  select
    to_regclass('public.loyalty_program_settings_v166') settings,
    to_regclass('public.loyalty_program_rules_v166') rules,
    to_regclass('public.loyalty_program_accounts_v166') accounts,
    to_regclass('public.loyalty_program_visits_v166') visits,
    to_regclass('public.loyalty_program_rewards_v166') rewards,
    to_regclass('public.loyalty_program_history_v166') history,
    to_regprocedure('public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid)') set_program,
    to_regprocedure('public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid)') adjust_progress,
    to_regprocedure('public.redeem_minuta_loyalty_reward_v166(uuid,uuid,uuid,text,uuid)') redeem_reward,
    to_regprocedure('public.get_minuta_loyalty_program_workspace_v166(uuid)') workspace,
    to_regprocedure('public.get_client_loyalty_program_v166(text,uuid)') client_contract
), facts as (
  select objects.*,
    exists(select 1 from pg_trigger where tgname='booking_outcomes_loyalty_program_v166' and not tgisinternal) outcome_trigger,
    exists(select 1 from pg_trigger where tgname='bookings_loyalty_program_v166' and not tgisinternal) booking_trigger,
    case
      when settings is null and rules is null and accounts is null and visits is null and rewards is null and history is null
        and set_program is null and adjust_progress is null and redeem_reward is null and workspace is null and client_contract is null then 'absent'
      when settings is not null and rules is not null and accounts is not null and visits is not null and rewards is not null and history is not null
        and set_program is not null and adjust_progress is not null and redeem_reward is not null and workspace is not null and client_contract is not null
        and exists(select 1 from pg_trigger where tgname='booking_outcomes_loyalty_program_v166' and not tgisinternal)
        and exists(select 1 from pg_trigger where tgname='bookings_loyalty_program_v166' and not tgisinternal)
        and obj_description(set_program,'pg_proc')='minuta:v166:loyalty-program:settings'
        and obj_description(workspace,'pg_proc')='minuta:v166:loyalty-program:workspace'
        and obj_description(client_contract,'pg_proc')='minuta:v166:loyalty-program:client-contract' then 'exact'
      when settings is not null and rules is not null and accounts is not null and visits is not null and rewards is not null and history is not null
        and not exists(select 1 from pg_trigger where tgname in ('booking_outcomes_loyalty_program_v166','bookings_loyalty_program_v166') and not tgisinternal)
        and obj_description(settings,'pg_class')='minuta:v166:operational-rollback:data-preserved' then 'disabled'
      else 'partial'
    end classification
  from objects
)
select json_build_object(
  'classification',classification,
  'structuralExact',classification in ('absent','exact','disabled'),
  'outcomeTrigger',outcome_trigger,
  'bookingTrigger',booking_trigger,
  'authenticatedSetExecute',case when set_program is null then false else has_function_privilege('authenticated',set_program,'execute') end,
  'authenticatedAdjustExecute',case when adjust_progress is null then false else has_function_privilege('authenticated',adjust_progress,'execute') end,
  'authenticatedRedeemExecute',case when redeem_reward is null then false else has_function_privilege('authenticated',redeem_reward,'execute') end,
  'authenticatedWorkspaceExecute',case when workspace is null then false else has_function_privilege('authenticated',workspace,'execute') end,
  'anonClientExecute',case when client_contract is null then false else has_function_privilege('anon',client_contract,'execute') end,
  'authenticatedClientExecute',case when client_contract is null then false else has_function_privilege('authenticated',client_contract,'execute') end,
  'authenticatedDirectSettings',case when settings is null then false else has_table_privilege('authenticated',settings,'select,insert,update,delete') end,
  'anonDirectRewards',case when rewards is null then false else has_table_privilege('anon',rewards,'select,insert,update,delete') end
) from facts;
