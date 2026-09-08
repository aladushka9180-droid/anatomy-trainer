\set ON_ERROR_STOP on

begin;
set local lock_timeout='10s';
set local statement_timeout='2min';

do $$
begin
  if to_regprocedure('public.post_minuta_visit_finance_v129(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text)') is null then
    raise exception 'v129_test_requires_v129';
  end if;
end
$$;

select set_config('minuta.v129_owner',membership.user_id::text,true),
  set_config('minuta.v129_org',membership.organization_id::text,true),
  set_config('minuta.v129_booking',booking.id::text,true)
from public.organization_memberships membership
join public.bookings booking on booking.organization_id=membership.organization_id
where membership.active and membership.role in('owner','admin') and booking.status<>'cancelled'
  and not exists(select 1 from public.payments payment where payment.booking_id=booking.id)
  and not exists(select 1 from public.payment_provider_attempts attempt where attempt.booking_id=booking.id)
order by booking.created_at desc limit 1;

do $$
begin
  if nullif(current_setting('minuta.v129_owner',true),'') is null
     or nullif(current_setting('minuta.v129_booking',true),'') is null then
    raise exception 'v129_test_requires_unpaid_organization_booking_fixture';
  end if;
end
$$;

update public.bookings set status='confirmed',payment_status='not_required',deposit_amount_rub=0
where id=current_setting('minuta.v129_booking')::uuid;
insert into public.booking_outcomes(
  booking_id,performer_id,visit_status,payment_method,amount_rub,
  calculated_amount_rub,completion_source,updated_at
)
select booking.id,booking.performer_id,'completed','cash',600,1000,'manual',clock_timestamp()
from public.bookings booking where booking.id=current_setting('minuta.v129_booking')::uuid
on conflict(booking_id) do update set visit_status='completed',payment_method='cash',amount_rub=600,
  calculated_amount_rub=1000,completion_source='manual',updated_at=excluded.updated_at;

select set_config('request.jwt.claim.sub',current_setting('minuta.v129_owner'),true);
set local role authenticated;
select public.set_minuta_finance_enabled_v129(current_setting('minuta.v129_org')::uuid,true);
select set_config('minuta.v129_account_first',public.create_minuta_financial_account_v129(
  current_setting('minuta.v129_org')::uuid,'00000000-0000-4000-8000-000000129001',
  'V129 test cash','cash'
)::text,true);
select set_config('minuta.v129_account_second',public.create_minuta_financial_account_v129(
  current_setting('minuta.v129_org')::uuid,'00000000-0000-4000-8000-000000129001',
  'V129 test cash','cash'
)::text,true);
reset role;

do $$
begin
  if (current_setting('minuta.v129_account_first')::jsonb->>'id') is distinct from
      (current_setting('minuta.v129_account_second')::jsonb->>'id')
     or (current_setting('minuta.v129_account_second')::jsonb->>'replayed')::boolean is not true then
    raise exception 'v129_account_exact_retry_failed';
  end if;
end
$$;
select set_config('minuta.v129_account',current_setting('minuta.v129_account_first')::jsonb->>'id',true);

set local role authenticated;
do $$
begin
  begin
    perform public.create_minuta_financial_account_v129(
      current_setting('minuta.v129_org')::uuid,'00000000-0000-4000-8000-000000129001',
      'Changed replay','cash');
    raise exception 'v129_account_changed_retry_was_allowed';
  exception when unique_violation then
    if sqlerrm<>'financial_account_idempotency_conflict' then raise; end if;
  end;
end
$$;

select set_config('minuta.v129_post_first',public.post_minuta_visit_finance_v129(
  current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_booking')::uuid,
  current_setting('minuta.v129_account')::uuid,'00000000-0000-4000-8000-000000129002'
)::text,true);
select set_config('minuta.v129_post_second',public.post_minuta_visit_finance_v129(
  current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_booking')::uuid,
  current_setting('minuta.v129_account')::uuid,'00000000-0000-4000-8000-000000129002'
)::text,true);
reset role;

select set_config('minuta.v129_transaction',current_setting('minuta.v129_post_first')::jsonb->>'id',true);
do $$
declare v_debit bigint;v_credit bigint;
begin
  select coalesce(sum(amount_minor) filter(where side='debit'),0),
    coalesce(sum(amount_minor) filter(where side='credit'),0)
  into v_debit,v_credit from public.financial_postings
  where transaction_id=current_setting('minuta.v129_transaction')::uuid;
  if (current_setting('minuta.v129_post_first')::jsonb->>'id') is distinct from
      (current_setting('minuta.v129_post_second')::jsonb->>'id')
     or (current_setting('minuta.v129_post_second')::jsonb->>'replayed')::boolean is not true
     or v_debit<>100000 or v_credit<>100000
     or (select count(*) from public.financial_postings
       where transaction_id=current_setting('minuta.v129_transaction')::uuid)<>3
     or (select explanation ?& array['source_id','evidence_kind','service_value_minor','received_minor','debt_minor']
       from public.financial_transactions where id=current_setting('minuta.v129_transaction')::uuid) is not true then
    raise exception 'v129_posting_or_exact_retry_failed';
  end if;
end
$$;

-- A changed source under the same request id is a conflict, never a replay.
update public.booking_outcomes set amount_rub=500,updated_at=clock_timestamp()
where booking_id=current_setting('minuta.v129_booking')::uuid;
set local role authenticated;
do $$
begin
  begin
    perform public.post_minuta_visit_finance_v129(
      current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_booking')::uuid,
      current_setting('minuta.v129_account')::uuid,'00000000-0000-4000-8000-000000129002');
    raise exception 'v129_changed_transaction_retry_was_allowed';
  exception when unique_violation then
    if sqlerrm<>'financial_transaction_idempotency_conflict' then raise; end if;
  end;
end
$$;
reset role;
update public.booking_outcomes set amount_rub=600,updated_at=(
  select occurred_at from public.financial_transactions where id=current_setting('minuta.v129_transaction')::uuid
) where booking_id=current_setting('minuta.v129_booking')::uuid;

-- Direct DML is denied even to an authorized manager; mutations go through RPC.
set local role authenticated;
do $$
begin
  begin
    insert into public.financial_transactions(
      organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
      source_fingerprint,occurred_at,explanation
    ) values(current_setting('minuta.v129_org')::uuid,gen_random_uuid(),repeat('a',64),
      'visit_service','booking_outcome',current_setting('minuta.v129_booking')::uuid,
      repeat('b',64),now(),'{}'::jsonb);
    raise exception 'v129_direct_insert_was_allowed';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

-- Existing journal rows are immutable.
do $$
begin
  begin
    update public.financial_transactions set occurred_at=occurred_at
    where id=current_setting('minuta.v129_transaction')::uuid;
    raise exception 'v129_update_was_allowed';
  exception when sqlstate '55000' then
    if sqlerrm<>'financial_ledger_is_append_only' then raise; end if;
  end;
end
$$;

set local role authenticated;
select set_config('minuta.v129_reverse_first',public.reverse_minuta_financial_transaction_v129(
  current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_transaction')::uuid,
  '00000000-0000-4000-8000-000000129003','source_corrected'
)::text,true);
select set_config('minuta.v129_reverse_second',public.reverse_minuta_financial_transaction_v129(
  current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_transaction')::uuid,
  '00000000-0000-4000-8000-000000129003','source_corrected'
)::text,true);
reset role;

do $$
declare v_debit bigint;v_credit bigint;
begin
  select coalesce(sum(case when posting.side='debit' then posting.amount_minor else -posting.amount_minor end),0),
    coalesce(sum(case when posting.side='credit' then posting.amount_minor else -posting.amount_minor end),0)
  into v_debit,v_credit
  from public.financial_postings posting
  join public.financial_transactions transaction_row on transaction_row.id=posting.transaction_id
  where transaction_row.id=current_setting('minuta.v129_transaction')::uuid
     or transaction_row.reversal_of=current_setting('minuta.v129_transaction')::uuid;
  if (current_setting('minuta.v129_reverse_first')::jsonb->>'id') is distinct from
      (current_setting('minuta.v129_reverse_second')::jsonb->>'id')
     or v_debit<>0 or v_credit<>0 then
    raise exception 'v129_reversal_failed';
  end if;
end
$$;

-- Source guards are fail-closed.
update public.booking_outcomes set completion_source='auto',updated_at=clock_timestamp()
where booking_id=current_setting('minuta.v129_booking')::uuid;
set local role authenticated;
do $$
begin
  begin
    perform public.post_minuta_visit_finance_v129(
      current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_booking')::uuid,
      current_setting('minuta.v129_account')::uuid,'00000000-0000-4000-8000-000000129004');
    raise exception 'v129_auto_source_was_allowed';
  exception when sqlstate '55000' then
    if sqlerrm<>'manual_completion_required' then raise; end if;
  end;
end
$$;
reset role;

update public.booking_outcomes set completion_source='manual',payment_method='card',updated_at=clock_timestamp()
where booking_id=current_setting('minuta.v129_booking')::uuid;
set local role authenticated;
do $$
begin
  begin
    perform public.post_minuta_visit_finance_v129(
      current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_booking')::uuid,
      current_setting('minuta.v129_account')::uuid,'00000000-0000-4000-8000-000000129005');
    raise exception 'v129_card_source_was_allowed';
  exception when sqlstate '55000' then
    if sqlerrm<>'card_requires_provider_adapter' then raise; end if;
  end;
end
$$;
reset role;

update public.booking_outcomes set payment_method='cash',amount_rub=1001,calculated_amount_rub=1000,
  updated_at=clock_timestamp() where booking_id=current_setting('minuta.v129_booking')::uuid;
set local role authenticated;
do $$
begin
  begin
    perform public.post_minuta_visit_finance_v129(
      current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_booking')::uuid,
      current_setting('minuta.v129_account')::uuid,'00000000-0000-4000-8000-000000129006');
    raise exception 'v129_overpayment_was_allowed';
  exception when sqlstate '55000' then
    if sqlerrm<>'overpayment_requires_advance_account' then raise; end if;
  end;
end
$$;
reset role;

update public.booking_outcomes set amount_rub=600,updated_at=clock_timestamp()
where booking_id=current_setting('minuta.v129_booking')::uuid;
update public.bookings set payment_status='paid'
where id=current_setting('minuta.v129_booking')::uuid;
set local role authenticated;
do $$
begin
  begin
    perform public.post_minuta_visit_finance_v129(
      current_setting('minuta.v129_org')::uuid,current_setting('minuta.v129_booking')::uuid,
      current_setting('minuta.v129_account')::uuid,'00000000-0000-4000-8000-000000129007');
    raise exception 'v129_provider_paid_source_was_allowed';
  exception when sqlstate '55000' then
    if sqlerrm<>'provider_payment_requires_adapter' then raise; end if;
  end;
end
$$;
reset role;

-- A foreign authenticated actor sees no rows and cannot call the workspace.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000129999',true);
set local role authenticated;
do $$
begin
  if exists(select 1 from public.financial_transactions
    where organization_id=current_setting('minuta.v129_org')::uuid) then
    raise exception 'v129_rls_tenant_leak';
  end if;
  begin
    perform public.get_minuta_financial_workspace_v129(current_setting('minuta.v129_org')::uuid);
    raise exception 'v129_foreign_workspace_was_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'financial_manager_role_required' then raise; end if;
  end;
end
$$;
reset role;

set constraints all immediate;
rollback;
