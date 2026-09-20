begin;
set local search_path=public,extensions,pg_catalog;

-- Production-safe rollback: stop new accrual and external access while keeping
-- every rule, visit, reward and audit event for later recovery or export.
update public.loyalty_program_settings_v166 set enabled=false,updated_at=now() where enabled;

drop trigger if exists booking_outcomes_loyalty_program_v166 on public.booking_outcomes;
drop trigger if exists bookings_loyalty_program_v166 on public.bookings;

revoke all on function public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.redeem_minuta_loyalty_reward_v166(uuid,uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_loyalty_program_workspace_v166(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.get_client_loyalty_program_v166(text,uuid)
  from public,anon,authenticated,service_role;

comment on table public.loyalty_program_settings_v166 is 'minuta:v166:operational-rollback:data-preserved';
notify pgrst,'reload schema';
commit;
