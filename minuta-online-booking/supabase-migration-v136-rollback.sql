-- Structural rollback for v136. It is intentionally blocked once any v136
-- business evidence exists; operational reversals must preserve that history.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.organization_payroll_ledger_settings') is null
     or to_regclass('public.financial_payroll_accrual_sources') is null
     or to_regprocedure('public.get_minuta_payroll_ledger_workspace_v136(uuid,date,date)') is null then
    raise exception 'v136_payroll_rollback_prerequisites_missing';
  end if;
  if exists(select 1 from public.organization_payroll_ledger_settings where enabled)
     or exists(select 1 from public.financial_payroll_adjustment_sources)
     or exists(select 1 from public.financial_payroll_accrual_sources)
     or exists(select 1 from public.financial_payroll_payment_sources)
     or exists(select 1 from public.financial_payroll_advance_sources)
     or exists(select 1 from public.financial_payroll_advance_offsets)
     or exists(select 1 from public.financial_transactions where operation_type in(
       'payroll_accrual','payroll_payment','payroll_advance','payroll_advance_offset'
     )) then
    raise exception 'v136_payroll_rollback_preserve_business_history';
  end if;
end
$guard$;

revoke all on function public.set_minuta_payroll_ledger_enabled_v136(uuid,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.record_minuta_payroll_adjustment_v136(uuid,uuid,uuid,text,bigint,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.accrue_minuta_payroll_period_v136(uuid,uuid,timestamptz,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.pay_minuta_payroll_debt_v136(uuid,uuid,uuid,uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.create_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,timestamptz,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.offset_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_payroll_transaction_v136(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_payroll_ledger_workspace_v136(uuid,date,date)
  from public,anon,authenticated,service_role;

drop trigger if exists payroll_period_auto_accrual_v136 on public.payroll_periods;
drop function if exists public.auto_accrue_minuta_payroll_period_v136();
drop function if exists public.get_minuta_payroll_ledger_workspace_v136(uuid,date,date);
drop function if exists public.reverse_minuta_payroll_transaction_v136(uuid,uuid,uuid,text);
drop function if exists public.offset_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,uuid);
drop function if exists public.create_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,timestamptz,uuid);
drop function if exists public.pay_minuta_payroll_debt_v136(uuid,uuid,uuid,uuid,bigint,uuid);
drop function if exists public.refresh_minuta_payroll_period_paid_v136(uuid,uuid,uuid);
drop function if exists public.accrue_minuta_payroll_period_v136(uuid,uuid,timestamptz,uuid);
drop function if exists public.minuta_payroll_advance_remaining_v136(uuid,uuid);
drop function if exists public.minuta_payroll_accrual_debt_v136(uuid,uuid,uuid);
drop function if exists public.record_minuta_payroll_adjustment_v136(uuid,uuid,uuid,text,bigint,text,uuid);
drop function if exists public.set_minuta_payroll_ledger_enabled_v136(uuid,boolean);
drop function if exists public.assert_minuta_payroll_ledger_enabled_v136(uuid);
drop function if exists public.require_minuta_payroll_ledger_manager_v136(uuid,boolean);

-- Restore the v72 period guard and public status contract.
create or replace function public.enforce_minuta_payroll_period_immutability()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_op='DELETE' then
    if old.status<>'draft' then raise exception using errcode='55000',message='payroll_period_immutable'; end if;
    return old;
  end if;
  if old.status='paid' then
    raise exception using errcode='55000',message='payroll_period_immutable';
  end if;
  if old.status='approved' and (
    new.status<>'paid' or
    (to_jsonb(new)-array['status','paid_at','paid_by','updated_at'])
      is distinct from (to_jsonb(old)-array['status','paid_at','paid_by','updated_at'])
  ) then
    raise exception using errcode='55000',message='payroll_period_immutable';
  end if;
  if old.status='draft' and new.status not in('draft','approved') then
    raise exception using errcode='55000',message='invalid_payroll_status_transition';
  end if;
  return new;
end
$$;

create or replace function public.set_minuta_payroll_period_status(
  p_organization uuid,p_period uuid,p_status text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_current text; v_start date; v_end date; v_location uuid; v_calculated timestamptz;
  v_stored_fingerprint text; v_current_fingerprint text;
begin
  v_role:=public.get_minuta_payroll_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  select status,starts_on,ends_on,location_id,calculated_at,source_fingerprint
  into v_current,v_start,v_end,v_location,v_calculated,v_stored_fingerprint from public.payroll_periods
  where id=p_period and organization_id=p_organization for update;
  if v_current is null then raise exception using errcode='P0002',message='payroll_period_not_found'; end if;
  if (v_current='draft' and p_status='approved') then
    if v_calculated is null then raise exception using errcode='55000',message='payroll_period_not_calculated'; end if;
    select md5(coalesce(string_agg(booking_id::text||':'||amount_rub::text||':'||rate_bps::text||':'||payroll_rub::text,
      '|' order by booking_id),'empty')) into v_current_fingerprint
    from public.payroll_items where period_id=p_period;
    if v_current_fingerprint is distinct from v_stored_fingerprint then
      raise exception using errcode='55000',message='payroll_source_changed_recalculate_required';
    end if;
    if exists(
      select 1 from public.booking_outcomes outcome
      join public.bookings booking on booking.id=outcome.booking_id
      where booking.organization_id=p_organization and booking.booking_date between v_start and v_end
        and (v_location is null or booking.location_id=v_location)
        and outcome.visit_status='completed' and outcome.amount_rub is not null and outcome.amount_rub>=0
        and not exists(select 1 from public.payroll_items item where item.period_id=p_period
          and item.booking_id=booking.id and item.amount_rub=outcome.amount_rub
          and item.performer_id=booking.performer_id and item.booking_date=booking.booking_date)
    ) or exists(
      select 1 from public.payroll_items item
      where item.period_id=p_period and not exists(
        select 1 from public.booking_outcomes outcome join public.bookings booking on booking.id=outcome.booking_id
        where outcome.booking_id=item.booking_id and outcome.visit_status='completed'
          and outcome.amount_rub=item.amount_rub and booking.organization_id=p_organization
          and booking.booking_date between v_start and v_end
          and (v_location is null or booking.location_id=v_location)
          and booking.performer_id=item.performer_id and booking.booking_date=item.booking_date
      )
    ) or exists(
      select 1 from public.payroll_period_plan_snapshots snapshot
      join public.payroll_plans plan on plan.id=snapshot.source_plan_id
      where snapshot.period_id=p_period and (
        plan.active is distinct from true
        or plan.organization_id is distinct from snapshot.organization_id
        or plan.performer_id is distinct from snapshot.performer_id
        or plan.name is distinct from snapshot.plan_name
        or plan.effective_from is distinct from snapshot.effective_from
        or plan.effective_to is distinct from snapshot.effective_to
        or plan.base_rate_bps is distinct from snapshot.base_rate_bps
        or coalesce((select jsonb_agg(jsonb_build_object('threshold_rub',tier.threshold_rub,'rate_bps',tier.rate_bps)
             order by tier.threshold_rub) from public.payroll_plan_tiers tier where tier.plan_id=plan.id),'[]'::jsonb)
           is distinct from snapshot.tiers
      )
    ) then
      raise exception using errcode='55000',message='payroll_source_changed_recalculate_required';
    end if;
    update public.payroll_periods set status='approved',approved_at=now(),approved_by=auth.uid() where id=p_period;
  elsif (v_current='approved' and p_status='paid') then
    update public.payroll_periods set status='paid',paid_at=now(),paid_by=auth.uid() where id=p_period;
  elsif v_current=p_status then
    null;
  else
    raise exception using errcode='55000',message='invalid_payroll_status_transition';
  end if;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_period_status_changed',p_period,
    jsonb_build_object('from',v_current,'to',p_status));
  return jsonb_build_object('id',p_period,'organization_id',p_organization,'status',p_status);
end
$$;

grant execute on function public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function public.set_minuta_payroll_period_status(uuid,uuid,text) to authenticated;

revoke all on public.organization_payroll_ledger_settings,public.financial_payroll_adjustment_sources,
  public.financial_payroll_accrual_sources,public.financial_payroll_payment_sources,
  public.financial_payroll_advance_sources,public.financial_payroll_advance_offsets
  from public,anon,authenticated,service_role;

drop table public.financial_payroll_advance_offsets;
drop table public.financial_payroll_payment_sources;
drop table public.financial_payroll_advance_sources;
drop table public.financial_payroll_accrual_sources;
drop table public.financial_payroll_adjustment_sources;
drop function if exists public.protect_minuta_payroll_ledger_source_v136();

delete from public.organization_payroll_ledger_settings;
drop table public.organization_payroll_ledger_settings;
delete from public.financial_accounts where system_key in('payroll_expense','payroll_payable','employee_advance');

do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname from pg_constraint constraint_row
    where constraint_row.conrelid='public.financial_accounts'::regclass
      and constraint_row.contype='c'
      and (pg_get_constraintdef(constraint_row.oid) like '%account_type%'
        or pg_get_constraintdef(constraint_row.oid) like '%system_key%')
  loop
    execute format('alter table public.financial_accounts drop constraint %I',v_constraint.conname);
  end loop;
end
$constraints$;

alter table public.financial_accounts
  add constraint financial_accounts_account_type_v133_check check(account_type in(
    'cash','bank','receivable','service_revenue','operating_expense','supplier_payable',
    'payment_channel_commission'
  )),
  add constraint financial_accounts_system_key_v133_check check(system_key is null or system_key in(
    'receivable','service_revenue','operating_expense','supplier_payable','payment_channel_commission'
  )),
  add constraint financial_accounts_system_mapping_v133_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
    or (system_key='operating_expense' and account_type='operating_expense' and account_class='expense')
    or (system_key='supplier_payable' and account_type='supplier_payable' and account_class='liability')
    or (system_key='payment_channel_commission' and account_type='payment_channel_commission' and account_class='expense')
  ),
  add constraint financial_accounts_system_request_v133_check check(
    (system_key is null)=(creation_request_id is not null)
  );

do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname from pg_constraint constraint_row
    where constraint_row.conrelid='public.financial_transactions'::regclass
      and constraint_row.contype='c'
      and (pg_get_constraintdef(constraint_row.oid) like '%operation_type%'
        or pg_get_constraintdef(constraint_row.oid) like '%source_type%')
  loop
    execute format('alter table public.financial_transactions drop constraint %I',v_constraint.conname);
  end loop;
end
$constraints$;

alter table public.financial_transactions
  add constraint financial_transactions_operation_v133_check check(operation_type in(
    'visit_service','supplier_expense_accrual','supplier_expense_payment','customer_debt_settlement','reversal'
  )),
  add constraint financial_transactions_source_v133_check check(source_type in(
    'booking_outcome','financial_expense_source','financial_debt_settlement_source','financial_transaction'
  )),
  add constraint financial_transactions_shape_v133_check check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type in('supplier_expense_accrual','supplier_expense_payment')
      and source_type='financial_expense_source' and reversal_of is null)
    or (operation_type='customer_debt_settlement'
      and source_type='financial_debt_settlement_source' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction'
      and reversal_of is not null and source_id=reversal_of)
  );

notify pgrst,'reload schema';
commit;
