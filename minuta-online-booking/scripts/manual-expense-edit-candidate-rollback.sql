-- Roll back only an unused candidate; populated correction history is retained.
begin;
do $$ begin
  if exists(select 1 from public.financial_manual_expense_edits_v1) then
    raise exception 'manual_expense_edit_rollback_requires_preserved_history';
  end if;
end $$;
do $read_guard$ begin
  if not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.minuta_finance_event_rows_v163(uuid,timestamptz,timestamptz,uuid)')
      and md5(replace(prosrc,E'\r\n',E'\n'))='c7d238048db453603816d036e6f1b74c') then
    raise exception 'manual_expense_edit_rollback_requires_known_read_contract';
  end if;
end $read_guard$;
create or replace function public.minuta_finance_event_rows_v163(
  p_organization uuid,p_period_start timestamptz,p_period_end timestamptz,p_performer uuid
)
returns table(
  event_key text,transaction_id uuid,operation_type text,event_kind text,
  occurred_at timestamptz,flow_minor bigint,label text,category_id uuid,
  category_name text,performer_id uuid,entered_by_id uuid,source_kind text
)
language sql stable security definer set search_path to '' as $$
  with organization_context as (
    select coalesce((select location.timezone
      from public.locations location
      where location.organization_id=p_organization and location.active
      order by location.is_primary desc,location.id limit 1),'Europe/Samara') timezone
  ), transaction_events as (
    select event_transaction.id transaction_id,event_transaction.operation_type event_operation_type,
      event_transaction.occurred_at event_occurred_at,event_transaction.created_by,
      coalesce(original.id,event_transaction.id) base_transaction_id,
      coalesce(original.operation_type,event_transaction.operation_type) base_operation_type,
      case when event_transaction.operation_type='reversal' then -1::bigint else 1::bigint end reversal_sign
    from public.financial_transactions event_transaction
    left join public.financial_transactions original
      on event_transaction.operation_type='reversal'
     and original.id=event_transaction.reversal_of
     and original.organization_id=event_transaction.organization_id
    where event_transaction.organization_id=p_organization
  ), event_context as (
    select event.*,base.source_type,base.source_id,base.explanation,
      case when event.base_operation_type='visit_service' and visit_booking.id is not null
        then (visit_booking.booking_date+visit_booking.booking_time)
          at time zone organization_context.timezone
        when event.event_operation_type<>'reversal'
          and event.base_operation_type='supplier_expense_payment'
        then expense_source.occurred_at else event.event_occurred_at end occurred_at,
      coalesce(visit_booking.performer_id,debt_booking.performer_id,sale.seller_id,
        payroll.performer_id,manual.performer_id) performer_id,
      service.name service_name,line.item_name sale_item_name,
      expense_source.supplier_id,supplier.name supplier_name,
      manual.id manual_expense_id,manual.title manual_title,
      manual.category_id manual_category_id,manual.category_name_snapshot manual_category_name,
      recurring.name recurring_name,debt.gross_minor debt_gross_minor,
      debt.commission_minor debt_commission_minor,
      coalesce(salary_category.id,other_category.id) salary_category_id,
      coalesce(salary_category.name,'Зарплата') salary_category_name,
      other_category.id other_category_id,coalesce(other_category.name,'Прочее') other_category_name,
      coalesce(cash_delta.amount_minor,0)::bigint cash_delta_minor
    from transaction_events event
    join public.financial_transactions base on base.id=event.base_transaction_id
    cross join organization_context
    left join public.bookings visit_booking
      on base.source_type='booking_outcome' and visit_booking.id=base.source_id
    left join public.services service on service.id=visit_booking.service_id
    left join public.financial_debt_settlement_sources debt
      on base.source_type='financial_debt_settlement_source'
     and debt.id=base.source_id and debt.organization_id=p_organization
    left join public.financial_transactions debt_visit
      on debt_visit.id=debt.visit_transaction_id and debt_visit.organization_id=p_organization
    left join public.bookings debt_booking on debt_booking.id=debt_visit.source_id
    left join public.commercial_sales sale on
      (base.source_type='commercial_sale' and sale.id=base.source_id)
      or (base.source_type='commercial_sale_refund' and sale.id=(
        select refund.sale_id from public.commercial_sale_refunds refund
        where refund.id=base.source_id and refund.organization_id=p_organization
      ))
    left join public.commercial_sale_lines line on line.sale_id=sale.id
    left join public.financial_expense_sources expense_source
      on base.source_type='financial_expense_source'
     and expense_source.id=base.source_id and expense_source.organization_id=p_organization
    left join public.financial_suppliers supplier
      on supplier.id=expense_source.supplier_id and supplier.organization_id=p_organization
    left join public.financial_manual_expenses_v163 manual
      on manual.expense_source_id=expense_source.id and manual.organization_id=p_organization
    left join public.recurring_expense_occurrences occurrence
      on occurrence.expense_source_id=expense_source.id and occurrence.organization_id=p_organization
    left join public.organization_recurring_expenses recurring
      on recurring.id=occurrence.rule_id and recurring.organization_id=p_organization
    left join public.financial_payroll_payment_sources payroll
      on base.source_type='financial_payroll_payment_source'
     and payroll.id=base.source_id and payroll.organization_id=p_organization
    left join public.organization_finance_categories_v163 salary_category
      on salary_category.organization_id=p_organization and salary_category.system_key='salary'
    left join public.organization_finance_categories_v163 other_category
      on other_category.organization_id=p_organization and other_category.system_key='other'
    left join lateral(
      select coalesce(sum(case posting.side when 'debit' then posting.amount_minor
        else -posting.amount_minor end),0)::bigint amount_minor
      from public.financial_postings posting
      join public.financial_accounts account
        on account.id=posting.account_id and account.organization_id=posting.organization_id
      where posting.transaction_id=event.transaction_id
        and account.account_class='asset' and account.account_type in('cash','bank')
    ) cash_delta on true
  ), filtered as (
    select * from event_context event
    where event.occurred_at>=p_period_start and event.occurred_at<p_period_end
      and (p_performer is null or event.performer_id=p_performer)
  )
  select event.transaction_id::text||':income',event.transaction_id,
    event.base_operation_type,
    case when event.event_operation_type='reversal' then 'correction'
      when event.base_operation_type='commercial_refund' then 'refund' else 'income' end,
    event.occurred_at,
    case when event.base_operation_type='customer_debt_settlement'
      then event.reversal_sign*coalesce(event.debt_gross_minor,0)
      else event.cash_delta_minor end,
    case event.base_operation_type
      when 'visit_service' then coalesce(event.service_name,'Оплата визита')
      when 'customer_debt_settlement' then 'Погашение долга: '||coalesce(event.service_name,'визит')
      when 'commercial_sale' then coalesce(event.sale_item_name,'Продажа')
      when 'commercial_refund' then 'Возврат: '||coalesce(event.sale_item_name,'продажа')
      else 'Денежная операция' end,
    null::uuid,null::text,event.performer_id,event.created_by,
    case event.base_operation_type when 'visit_service' then 'visit_payment'
      when 'customer_debt_settlement' then 'debt_payment'
      when 'commercial_sale' then 'sale' else 'sale_refund' end
  from filtered event
  where event.base_operation_type in(
      'visit_service','customer_debt_settlement','commercial_sale','commercial_refund')
    and (case when event.base_operation_type='customer_debt_settlement'
      then event.reversal_sign*coalesce(event.debt_gross_minor,0)
      else event.cash_delta_minor end)<>0
  union all
  select event.transaction_id::text||':expense',event.transaction_id,
    event.base_operation_type,
    case when event.event_operation_type='reversal' then 'correction' else 'expense' end,
    event.occurred_at,event.cash_delta_minor,
    case event.base_operation_type
      when 'supplier_expense_payment' then coalesce(event.manual_title,event.recurring_name,event.supplier_name,'Расход')
      else 'Зарплата' end,
    case when event.base_operation_type='payroll_payment' then event.salary_category_id
      else coalesce(event.manual_category_id,event.other_category_id) end,
    case when event.base_operation_type='payroll_payment' then event.salary_category_name
      else coalesce(event.manual_category_name,event.other_category_name) end,
    event.performer_id,event.created_by,
    case when event.manual_expense_id is not null then 'manual_expense'
      when event.base_operation_type='payroll_payment' then 'payroll_payment'
      when event.recurring_name is not null then 'recurring_expense' else 'supplier_expense' end
  from filtered event
  where event.base_operation_type in('supplier_expense_payment','payroll_payment')
    and event.cash_delta_minor<>0
  union all
  select event.transaction_id::text||':commission',event.transaction_id,
    event.base_operation_type,
    case when event.event_operation_type='reversal' then 'correction' else 'expense' end,
    event.occurred_at,-event.reversal_sign*event.debt_commission_minor,
    'Комиссия за оплату',event.other_category_id,event.other_category_name,
    event.performer_id,event.created_by,'payment_commission'
  from filtered event
  where event.base_operation_type='customer_debt_settlement'
    and coalesce(event.debt_commission_minor,0)>0
$$;
revoke all on function public.minuta_finance_event_rows_v163(uuid,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
drop function public.edit_minuta_manual_expense_v1(uuid,uuid,uuid,uuid,bigint,date,text,uuid);
drop function public.get_minuta_manual_expense_edit_capabilities_v1(uuid);
drop function public.reverse_manual_expense_for_edit_v1(uuid,uuid,uuid);
drop table public.financial_manual_expense_edits_v1;
commit;
