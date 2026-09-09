\set ON_ERROR_STOP on

-- D07 evidence: auto_accrual_exactly_once, typed_bonus_and_deduction,
-- advance_offset, partial_payment_zero_debt, exact_replay, payload_conflict,
-- concurrent_payment, tenant_acl, balanced_append_only, safe_reversal and
-- history_preserved. The whole fixture is transaction-scoped and rolled back.

begin;

do $guard$
begin
  if to_regprocedure('public.set_minuta_payroll_ledger_enabled_v136(uuid,boolean)') is null
     or to_regprocedure('public.record_minuta_payroll_adjustment_v136(uuid,uuid,uuid,text,bigint,text,uuid)') is null
     or to_regprocedure('public.accrue_minuta_payroll_period_v136(uuid,uuid,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.pay_minuta_payroll_debt_v136(uuid,uuid,uuid,uuid,bigint,uuid)') is null
     or to_regprocedure('public.create_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.offset_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,uuid)') is null
     or to_regprocedure('public.reverse_minuta_payroll_transaction_v136(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.get_minuta_payroll_ledger_workspace_v136(uuid,date,date)') is null then
    raise exception using errcode='P0001',message='v136_payroll_integration_requires_v136';
  end if;
end
$guard$;

select set_config('minuta.v136.owner',coalesce((
  select membership.user_id::text
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id
  join public.performer_profiles profile on profile.id=membership.user_id
  where membership.role='owner' and membership.active and organization.status='active'
  order by membership.organization_id,membership.user_id limit 1
),''),true);
select set_config('minuta.v136.org',coalesce((
  select membership.organization_id::text
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id
  where membership.role='owner' and membership.active and organization.status='active'
    and membership.user_id=nullif(current_setting('minuta.v136.owner',true),'')::uuid
  order by membership.organization_id limit 1
),''),true);

do $fixture_guard$
begin
  if nullif(current_setting('minuta.v136.owner',true),'') is null
     or nullif(current_setting('minuta.v136.org',true),'') is null then
    raise exception using errcode='P0001',message='v136_payroll_integration_requires_owner_fixture';
  end if;
end
$fixture_guard$;

select set_config('request.jwt.claim.sub',current_setting('minuta.v136.owner'),true);
insert into public.organization_payroll_settings(organization_id,enabled,enabled_at,enabled_by)
values(
  current_setting('minuta.v136.org')::uuid,true,now(),
  current_setting('minuta.v136.owner')::uuid
)
on conflict(organization_id) do update set
  enabled=true,
  enabled_at=coalesce(public.organization_payroll_settings.enabled_at,excluded.enabled_at),
  enabled_by=coalesce(public.organization_payroll_settings.enabled_by,excluded.enabled_by);
set local role authenticated;
select set_config('minuta.v136.finance',public.set_minuta_finance_enabled_v133(
  current_setting('minuta.v136.org')::uuid,true
)::text,true);
select set_config('minuta.v136.cash',(public.create_minuta_financial_account_v129(
  current_setting('minuta.v136.org')::uuid,
  '00000000-0000-4000-8000-000000136001','D07 v136 test cash','cash'
)->>'id'),true);
select public.set_minuta_payroll_ledger_enabled_v136(current_setting('minuta.v136.org')::uuid,true);
reset role;

insert into public.payroll_periods(
  id,organization_id,name,starts_on,ends_on,status,total_payroll_rub,
  calculated_at,calculated_by,source_fingerprint
) values(
  '00000000-0000-4000-8000-000000136010',current_setting('minuta.v136.org')::uuid,
  'D07 v136 isolated payroll','1901-02-01','1901-02-01','draft',0,
  now(),current_setting('minuta.v136.owner')::uuid,md5('empty')
);

set local role authenticated;
select set_config('minuta.v136.bonus',public.record_minuta_payroll_adjustment_v136(
  current_setting('minuta.v136.org')::uuid,'00000000-0000-4000-8000-000000136010',
  current_setting('minuta.v136.owner')::uuid,'bonus',120000,'D07 verified bonus',
  '00000000-0000-4000-8000-000000136011'
)::text,true);
select set_config('minuta.v136.deduction',public.record_minuta_payroll_adjustment_v136(
  current_setting('minuta.v136.org')::uuid,'00000000-0000-4000-8000-000000136010',
  current_setting('minuta.v136.owner')::uuid,'deduction',20000,'D07 verified deduction',
  '00000000-0000-4000-8000-000000136012'
)::text,true);

-- Exact replay must return the same immutable adjustment source.
select set_config('minuta.v136.bonus_replay',public.record_minuta_payroll_adjustment_v136(
  current_setting('minuta.v136.org')::uuid,'00000000-0000-4000-8000-000000136010',
  current_setting('minuta.v136.owner')::uuid,'bonus',120000,'D07 verified bonus',
  '00000000-0000-4000-8000-000000136011'
)::text,true);

do $exact_replay$
declare v_message text;
begin
  if (current_setting('minuta.v136.bonus')::jsonb-'replayed')
       is distinct from (current_setting('minuta.v136.bonus_replay')::jsonb-'replayed')
     or current_setting('minuta.v136.bonus_replay')::jsonb->>'replayed'<>'true' then
    raise exception using errcode='P0001',message='v136_exact_replay_failed';
  end if;
  if not exists(select 1 from public.financial_payroll_adjustment_sources
      where organization_id=current_setting('minuta.v136.org')::uuid
        and period_id='00000000-0000-4000-8000-000000136010'
        and performer_id=current_setting('minuta.v136.owner')::uuid
        and adjustment_kind='bonus' and amount_minor=120000)
     or not exists(select 1 from public.financial_payroll_adjustment_sources
      where organization_id=current_setting('minuta.v136.org')::uuid
        and period_id='00000000-0000-4000-8000-000000136010'
        and performer_id=current_setting('minuta.v136.owner')::uuid
        and adjustment_kind='deduction' and amount_minor=20000) then
    raise exception using errcode='P0001',message='v136_typed_bonus_and_deduction_failed';
  end if;
  begin
    perform public.record_minuta_payroll_adjustment_v136(
      current_setting('minuta.v136.org')::uuid,'00000000-0000-4000-8000-000000136010',
      current_setting('minuta.v136.owner')::uuid,'bonus',130000,'D07 changed bonus',
      '00000000-0000-4000-8000-000000136011');
    raise exception using errcode='P0001',message='v136_payload_conflict_was_allowed';
  exception when unique_violation then
    get stacked diagnostics v_message=message_text;
    if v_message<>'payroll_adjustment_request_conflict' then raise; end if;
  end;
end
$exact_replay$;

select public.set_minuta_payroll_period_status(
  current_setting('minuta.v136.org')::uuid,'00000000-0000-4000-8000-000000136010','approved'
);

select set_config('minuta.v136.advance',public.create_minuta_payroll_advance_v136(
  current_setting('minuta.v136.org')::uuid,current_setting('minuta.v136.owner')::uuid,
  current_setting('minuta.v136.cash')::uuid,30000,'1901-01-31 12:00:00+00',
  '00000000-0000-4000-8000-000000136013'
)::text,true);
reset role;
select set_config('minuta.v136.accrual_request',(
  select md5('payroll-accrual-v136:'||period.id::text||':'||period.calculation_version::text)::uuid::text
  from public.payroll_periods period where period.id='00000000-0000-4000-8000-000000136010'
),true);
select set_config('minuta.v136.accrual',(
  select jsonb_build_object(
    'id',source.id,'transaction_id',transaction_row.id,'organization_id',source.organization_id,
    'period_id',source.period_id,'amount_minor',source.amount_minor,'breakdown',source.breakdown,
    'request_id',source.request_id,'replayed',false
  )::text
  from public.financial_payroll_accrual_sources source
  join public.financial_transactions transaction_row
    on transaction_row.organization_id=source.organization_id
   and transaction_row.operation_type='payroll_accrual'
   and transaction_row.source_type='financial_payroll_accrual_source'
   and transaction_row.source_id=source.id
  where source.organization_id=current_setting('minuta.v136.org')::uuid
    and source.period_id='00000000-0000-4000-8000-000000136010'
),true);
set local role authenticated;
select set_config('minuta.v136.accrual_replay',public.accrue_minuta_payroll_period_v136(
  current_setting('minuta.v136.org')::uuid,'00000000-0000-4000-8000-000000136010',
  (select approved_at from public.payroll_periods where id='00000000-0000-4000-8000-000000136010'),
  current_setting('minuta.v136.accrual_request')::uuid
)::text,true);

do $auto_accrual_exactly_once$
begin
  if (current_setting('minuta.v136.accrual')::jsonb-'replayed')
       is distinct from (current_setting('minuta.v136.accrual_replay')::jsonb-'replayed')
     or current_setting('minuta.v136.accrual_replay')::jsonb->>'replayed'<>'true'
     or (select count(*) from public.financial_payroll_accrual_sources
         where organization_id=current_setting('minuta.v136.org')::uuid
           and period_id='00000000-0000-4000-8000-000000136010')<>1 then
    raise exception using errcode='P0001',message='v136_auto_accrual_exactly_once_failed';
  end if;
end
$auto_accrual_exactly_once$;

select set_config('minuta.v136.offset',public.offset_minuta_payroll_advance_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.advance')::jsonb->>'source_id')::uuid,
  (current_setting('minuta.v136.accrual')::jsonb->>'id')::uuid,
  30000,'00000000-0000-4000-8000-000000136015'
)::text,true);
select set_config('minuta.v136.payment_one',public.pay_minuta_payroll_debt_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.accrual')::jsonb->>'id')::uuid,
  current_setting('minuta.v136.owner')::uuid,current_setting('minuta.v136.cash')::uuid,20000,
  '00000000-0000-4000-8000-000000136016'
)::text,true);
select set_config('minuta.v136.payment_two',public.pay_minuta_payroll_debt_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.accrual')::jsonb->>'id')::uuid,
  current_setting('minuta.v136.owner')::uuid,current_setting('minuta.v136.cash')::uuid,50000,
  '00000000-0000-4000-8000-000000136017'
)::text,true);

-- concurrent_payment is enforced by the per-organization/performer advisory
-- lock plus an in-transaction debt recheck. The static contract asserts the
-- lock; this overpay attempt asserts the fail-closed post-lock decision.
do $partial_payment_zero_debt$
declare v_workspace jsonb;
begin
  v_workspace:=public.get_minuta_payroll_ledger_workspace_v136(
    current_setting('minuta.v136.org')::uuid,'1901-01-01','1901-03-01');
  if not (v_workspace->'payment_accounts' @> jsonb_build_array(jsonb_build_object(
      'id',current_setting('minuta.v136.cash')::uuid,'account_type','cash','active',true
    ))) then
    raise exception using errcode='P0001',message='v136_payment_account_missing_from_workspace';
  end if;
  if not (v_workspace->'debts' @> jsonb_build_array(jsonb_build_object(
      'accrual_source_id',(current_setting('minuta.v136.accrual')::jsonb->>'id')::uuid,
      'performer_id',current_setting('minuta.v136.owner')::uuid,'debt_minor',0
    ))) then
    raise exception using errcode='P0001',message='v136_partial_payment_zero_debt_failed';
  end if;
  if (select status from public.payroll_periods
      where id='00000000-0000-4000-8000-000000136010')<>'paid' then
    raise exception using errcode='P0001',message='v136_zero_debt_did_not_mark_period_paid';
  end if;
  begin
    perform public.pay_minuta_payroll_debt_v136(
      current_setting('minuta.v136.org')::uuid,
      (current_setting('minuta.v136.accrual')::jsonb->>'id')::uuid,
      current_setting('minuta.v136.owner')::uuid,current_setting('minuta.v136.cash')::uuid,1,
      '00000000-0000-4000-8000-000000136018');
    raise exception using errcode='P0001',message='v136_concurrent_payment_overpay_was_allowed';
  exception when check_violation or object_not_in_prerequisite_state or invalid_parameter_value then null;
  end;
end
$partial_payment_zero_debt$;

-- Every v136 transaction must remain balanced and append-only.
do $balanced_append_only$
declare v_ids uuid[];
begin
  v_ids:=array[
    (current_setting('minuta.v136.advance')::jsonb->>'id')::uuid,
    (current_setting('minuta.v136.accrual')::jsonb->>'transaction_id')::uuid,
    (current_setting('minuta.v136.offset')::jsonb->>'id')::uuid,
    (current_setting('minuta.v136.payment_one')::jsonb->>'id')::uuid,
    (current_setting('minuta.v136.payment_two')::jsonb->>'id')::uuid
  ];
  if exists(
    select posting.transaction_id
    from public.financial_postings posting
    where posting.transaction_id=any(v_ids)
    group by posting.transaction_id
    having sum(posting.amount_minor) filter(where posting.side='debit')
      <>sum(posting.amount_minor) filter(where posting.side='credit')
  ) then
    raise exception using errcode='P0001',message='v136_balanced_ledger_failed';
  end if;
  begin
    update public.financial_transactions set explanation='{}'::jsonb where id=v_ids[1];
    raise exception using errcode='P0001',message='v136_append_only_update_was_allowed';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$balanced_append_only$;

-- Tenant and ACL checks use a non-member JWT and must not expose the fixture.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000136099',true);
do $tenant_acl$
begin
  begin
    perform public.get_minuta_payroll_ledger_workspace_v136(
      current_setting('minuta.v136.org')::uuid,'1901-01-01','1901-03-01');
    raise exception using errcode='P0001',message='v136_tenant_acl_read_was_allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.pay_minuta_payroll_debt_v136(
      current_setting('minuta.v136.org')::uuid,
      (current_setting('minuta.v136.accrual')::jsonb->>'id')::uuid,
      current_setting('minuta.v136.owner')::uuid,current_setting('minuta.v136.cash')::uuid,1,
      '00000000-0000-4000-8000-000000136098');
    raise exception using errcode='P0001',message='v136_tenant_acl_write_was_allowed';
  exception when insufficient_privilege then null;
  end;
end
$tenant_acl$;

select set_config('request.jwt.claim.sub',current_setting('minuta.v136.owner'),true);

-- Safe reversal order: accrual cannot be reversed while payments/offsets are
-- active, and the advance cannot be reversed while its offset is active.
do $safe_reversal_preconditions$
begin
  begin
    perform public.reverse_minuta_payroll_transaction_v136(
      current_setting('minuta.v136.org')::uuid,
      (current_setting('minuta.v136.accrual')::jsonb->>'transaction_id')::uuid,
      '00000000-0000-4000-8000-000000136020','D07 unsafe accrual reversal');
    raise exception using errcode='P0001',message='v136_unsafe_accrual_reversal_was_allowed';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.reverse_minuta_payroll_transaction_v136(
      current_setting('minuta.v136.org')::uuid,
      (current_setting('minuta.v136.advance')::jsonb->>'id')::uuid,
      '00000000-0000-4000-8000-000000136021','D07 unsafe advance reversal');
    raise exception using errcode='P0001',message='v136_unsafe_advance_reversal_was_allowed';
  exception when object_not_in_prerequisite_state then null;
  end;
end
$safe_reversal_preconditions$;

select public.reverse_minuta_payroll_transaction_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.payment_two')::jsonb->>'id')::uuid,
  '00000000-0000-4000-8000-000000136022','D07 reverse second payment');
select public.reverse_minuta_payroll_transaction_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.payment_one')::jsonb->>'id')::uuid,
  '00000000-0000-4000-8000-000000136023','D07 reverse first payment');
do $reopened_after_payment_reversal$
begin
  if (select status from public.payroll_periods
      where id='00000000-0000-4000-8000-000000136010')<>'approved' then
    raise exception using errcode='P0001',message='v136_payment_reversal_did_not_reopen_period';
  end if;
end
$reopened_after_payment_reversal$;
select public.reverse_minuta_payroll_transaction_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.offset')::jsonb->>'id')::uuid,
  '00000000-0000-4000-8000-000000136024','D07 reverse advance offset');
select public.reverse_minuta_payroll_transaction_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.accrual')::jsonb->>'transaction_id')::uuid,
  '00000000-0000-4000-8000-000000136025','D07 reverse accrual');
select public.reverse_minuta_payroll_transaction_v136(
  current_setting('minuta.v136.org')::uuid,
  (current_setting('minuta.v136.advance')::jsonb->>'id')::uuid,
  '00000000-0000-4000-8000-000000136026','D07 reverse advance');

do $history_preserved$
begin
  if (select count(*) from public.financial_payroll_adjustment_sources
      where organization_id=current_setting('minuta.v136.org')::uuid)<2
     or (select count(*) from public.financial_payroll_payment_sources
      where organization_id=current_setting('minuta.v136.org')::uuid)<2
     or (select count(*) from public.financial_payroll_advance_offsets
      where organization_id=current_setting('minuta.v136.org')::uuid)<1
     or (select count(*) from public.financial_transactions
      where organization_id=current_setting('minuta.v136.org')::uuid
        and operation_type='reversal'
        and request_id in(
          '00000000-0000-4000-8000-000000136022','00000000-0000-4000-8000-000000136023',
          '00000000-0000-4000-8000-000000136024','00000000-0000-4000-8000-000000136025',
          '00000000-0000-4000-8000-000000136026'
        ))<>5 then
    raise exception using errcode='P0001',message='v136_history_preserved_failed';
  end if;
end
$history_preserved$;

reset role;
rollback;

do $cleanup_postcondition$
begin
  if exists(select 1 from public.financial_accounts where creation_request_id='00000000-0000-4000-8000-000000136001')
     or exists(select 1 from public.payroll_periods where id='00000000-0000-4000-8000-000000136010') then
    raise exception using errcode='P0001',message='v136_fixture_cleanup_failed';
  end if;
end
$cleanup_postcondition$;
