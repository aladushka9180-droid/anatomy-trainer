begin;

do $$
begin
  if exists(select 1 from public.organization_payroll_settings where enabled) then
    raise exception using errcode='P0001',message='disable_payroll_before_rollback';
  end if;
  if exists(select 1 from public.payroll_plans)
     or exists(select 1 from public.payroll_periods)
     or exists(select 1 from public.payroll_period_plan_snapshots)
     or exists(select 1 from public.payroll_items)
     or exists(select 1 from public.payroll_adjustments)
     or exists(select 1 from public.payroll_audit_log) then
    raise exception using errcode='P0001',message='export_and_remove_all_payroll_data_before_rollback';
  end if;
end;
$$;

drop function if exists public.get_minuta_payroll_workspace(uuid,date,date);
drop function if exists public.set_minuta_payroll_period_status(uuid,uuid,text);
drop function if exists public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text);
drop function if exists public.calculate_minuta_payroll_period(uuid,uuid,uuid,date,date,text);
drop function if exists public.upsert_minuta_payroll_plan(uuid,uuid,uuid,text,date,date,integer,jsonb);
drop function if exists public.set_minuta_payroll_enabled(uuid,boolean);

drop trigger if exists payroll_periods_immutable on public.payroll_periods;
drop trigger if exists payroll_snapshots_draft_only on public.payroll_period_plan_snapshots;
drop trigger if exists payroll_adjustments_draft_only on public.payroll_adjustments;
drop trigger if exists payroll_items_draft_only on public.payroll_items;
drop trigger if exists payroll_periods_touch_updated_at on public.payroll_periods;
drop trigger if exists payroll_plans_touch_updated_at on public.payroll_plans;
drop trigger if exists organization_payroll_settings_touch_updated_at on public.organization_payroll_settings;
drop function if exists public.enforce_minuta_payroll_period_immutability();
drop function if exists public.enforce_minuta_payroll_draft_children();
drop function if exists public.write_minuta_payroll_audit(uuid,text,uuid,jsonb);
drop function if exists public.get_minuta_payroll_role(uuid);

drop table if exists public.payroll_audit_log;
drop table if exists public.payroll_adjustments;
drop table if exists public.payroll_items;
drop table if exists public.payroll_period_plan_snapshots;
drop table if exists public.payroll_periods;
drop table if exists public.payroll_plan_tiers;
drop table if exists public.payroll_plans;
drop table if exists public.organization_payroll_settings;

commit;
