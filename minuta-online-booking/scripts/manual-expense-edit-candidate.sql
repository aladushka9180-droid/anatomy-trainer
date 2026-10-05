-- Candidate only. The release owner assigns the migration version and applies
-- this only after the required isolated restore, rollback and explicit SQL gates.
-- No existing financial fact is updated or deleted. Corrections restate its
-- declared business date; created_at retains the date of the correction.
begin;
do $guard$ begin
  if to_regprocedure('public.record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)') is null
     or to_regprocedure('public.require_minuta_financial_manager_v129(uuid)') is null
     or to_regprocedure('public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamptz,uuid)') is null then
    raise exception 'manual_expense_edit_requires_current_v163';
  end if;
end $guard$;
do $read_guard$ begin
  if not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.minuta_finance_event_rows_v163(uuid,timestamptz,timestamptz,uuid)')
      and md5(replace(prosrc,E'\r\n',E'\n'))='f3a1722dab47096327201a2d25986beb') then
    raise exception 'manual_expense_edit_requires_known_v163_date_basis';
  end if;
end $read_guard$;

create table public.financial_manual_expense_edits_v1 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  original_expense_id uuid not null,
  replacement_expense_id uuid not null,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id,original_expense_id), unique(organization_id,request_id),
  foreign key(original_expense_id,organization_id) references public.financial_manual_expenses_v163(id,organization_id) on delete restrict,
  foreign key(replacement_expense_id,organization_id) references public.financial_manual_expenses_v163(id,organization_id) on delete restrict,
  check(original_expense_id <> replacement_expense_id)
);
create trigger financial_manual_expense_edits_immutable_v1
before update or delete on public.financial_manual_expense_edits_v1
for each row execute function public.protect_minuta_finance_screen_history_v163();
alter table public.financial_manual_expense_edits_v1 enable row level security;
alter table public.financial_manual_expense_edits_v1 force row level security;
revoke all on public.financial_manual_expense_edits_v1 from public,anon,authenticated,service_role;
grant select on public.financial_manual_expense_edits_v1 to authenticated;
create policy financial_manual_expense_edits_read_v1 on public.financial_manual_expense_edits_v1
for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));

-- Private helper: the public edit RPC validates the expense, holds the same
-- financial-ledger lock as v129/v132, and inserts both reversals atomically.
create function public.reverse_manual_expense_for_edit_v1(p_org uuid,p_transaction uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path to '' as $$
declare v_original public.financial_transactions%rowtype; v_id uuid;
begin
  select * into strict v_original from public.financial_transactions
    where organization_id=p_org and id=p_transaction for update;
  if v_original.operation_type not in('supplier_expense_payment','supplier_expense_accrual')
     or exists(select 1 from public.financial_transactions where organization_id=p_org and reversal_of=p_transaction) then
    raise exception using errcode='23505',message='manual_expense_edit_conflict';
  end if;
  insert into public.financial_transactions(organization_id,request_id,request_fingerprint,
    operation_type,source_type,source_id,source_fingerprint,reversal_of,occurred_at,explanation,created_by)
  values(p_org,p_request,public.minuta_financial_sha256_v129(jsonb_build_array('manual-expense-edit-reversal-v1',p_org,p_transaction,p_request)),
    'reversal','financial_transaction',p_transaction,
    public.minuta_financial_sha256_v129(jsonb_build_array('manual-expense-edit-reversal-v1',p_transaction,v_original.source_fingerprint)),
    p_transaction,v_original.occurred_at,jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_transaction','source_id',p_transaction,'evidence_kind','explicit_reversal',
      'original_operation_type',v_original.operation_type,'reason_code','manual_expense_edit'),auth.uid())
  returning id into v_id;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  select p_org,v_id,account_id,case side when 'debit' then 'credit' else 'debit' end,amount_minor
    from public.financial_postings where transaction_id=p_transaction order by id;
  return v_id;
end $$;
revoke all on function public.reverse_manual_expense_for_edit_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_minuta_manual_expense_edit_capabilities_v1(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  return jsonb_build_object('schema','minuta-manual-expense-edit-v1','can_edit',
    coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false));
end $$;
revoke all on function public.get_minuta_manual_expense_edit_capabilities_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_manual_expense_edit_capabilities_v1(uuid) to authenticated;

create function public.edit_minuta_manual_expense_v1(
  p_organization uuid,p_expense uuid,p_category uuid,p_payment_account uuid,
  p_amount_minor bigint,p_occurred_on date,p_note text,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_old public.financial_manual_expenses_v163%rowtype;
  v_category public.organization_finance_categories_v163%rowtype;
  v_event public.financial_manual_expense_edits_v1%rowtype;
  v_source public.financial_expense_sources%rowtype;
  v_fingerprint text; v_note text:=btrim(coalesce(p_note,'')); v_title text; v_zone text;
  v_when timestamptz; v_accrual uuid; v_operating uuid; v_payable uuid;
  v_supplier jsonb; v_new_accrual jsonb; v_payment uuid; v_new uuid; v_new_request uuid;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_expense is null or p_category is null or p_payment_account is null or p_request_id is null
     or p_occurred_on is null or p_occurred_on<date '2000-01-01' or char_length(v_note)>160
     or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>100000000000000 then
    raise exception using errcode='22023',message='invalid_manual_expense';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array('manual-expense-edit-v1',
    p_organization,p_expense,p_category,p_payment_account,p_amount_minor,p_occurred_on,v_note));
  select * into v_event from public.financial_manual_expense_edits_v1
    where organization_id=p_organization and request_id=p_request_id;
  if v_event.id is not null then
    if v_event.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='manual_expense_edit_request_conflict';
    end if;
    return jsonb_build_object('id',v_event.replacement_expense_id,'original_id',p_expense,'replayed',true);
  end if;
  select * into v_old from public.financial_manual_expenses_v163
    where organization_id=p_organization and id=p_expense for update;
  if v_old.id is null then raise exception using errcode='P0002',message='manual_expense_not_found'; end if;
  if exists(select 1 from public.financial_manual_expense_edits_v1
      where organization_id=p_organization and original_expense_id=p_expense)
     or exists(select 1 from public.financial_transactions where organization_id=p_organization and reversal_of=v_old.payment_transaction_id) then
    raise exception using errcode='23505',message='manual_expense_edit_conflict';
  end if;
  select * into v_category from public.organization_finance_categories_v163
    where organization_id=p_organization and id=p_category and active for update;
  if v_category.id is null then raise exception using errcode='P0002',message='active_finance_category_not_found'; end if;
  if not exists(select 1 from public.financial_accounts where organization_id=p_organization
      and id=p_payment_account and active and system_key is null and account_class='asset' and account_type in('cash','bank')) then
    raise exception using errcode='22023',message='cash_or_bank_account_required';
  end if;
  select timezone into v_zone from public.locations where organization_id=p_organization and active
    order by is_primary desc,id limit 1;
  v_zone:=coalesce(v_zone,'Europe/Samara');
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_zone) then raise exception 'invalid_organization_timezone'; end if;
  if p_occurred_on>timezone(v_zone,now())::date then raise exception using errcode='22023',message='manual_expense_future_date'; end if;
  v_when:=(p_occurred_on::timestamp+interval '12 hours') at time zone v_zone;
  v_title:=left(v_category.name||case when v_note='' then '' else ': '||v_note end,160);
  select * into strict v_source from public.financial_expense_sources
    where organization_id=p_organization and id=v_old.expense_source_id for update;
  select id into v_accrual from public.financial_transactions where organization_id=p_organization
    and operation_type='supplier_expense_accrual' and source_id=v_old.expense_source_id
    and source_type='financial_expense_source' order by created_at,id limit 1 for update;
  if v_accrual is null then raise exception 'manual_expense_accrual_missing'; end if;
  select id into v_operating from public.financial_accounts where organization_id=p_organization
    and system_key='operating_expense' and account_class='expense' and active for update;
  select id into v_payable from public.financial_accounts where organization_id=p_organization
    and system_key='supplier_payable' and account_class='liability' and active for update;
  if v_operating is null or v_payable is null then raise exception 'manual_expense_accounts_missing'; end if;
  perform public.reverse_manual_expense_for_edit_v1(p_organization,v_old.payment_transaction_id,md5(p_request_id::text||':edit-payment-reversal-v1')::uuid);
  perform public.reverse_manual_expense_for_edit_v1(p_organization,v_accrual,md5(p_request_id::text||':edit-accrual-reversal-v1')::uuid);
  v_new_request:=md5(p_request_id::text||':edit-replacement-v1')::uuid;
  v_supplier:=public.create_minuta_financial_supplier_v132(p_organization,
    md5(p_organization::text||':manual-expense-supplier:'||v_category.name)::uuid,v_category.name);
  v_new_accrual:=public.accrue_minuta_supplier_expense_v132(p_organization,(v_supplier->>'id')::uuid,
    v_operating,p_amount_minor,v_when,md5(p_request_id::text||':edit-new-accrual-v1')::uuid);
  select * into strict v_source from public.financial_expense_sources
    where organization_id=p_organization and id=(v_new_accrual->>'id')::uuid;
  insert into public.financial_transactions(organization_id,request_id,request_fingerprint,
    operation_type,source_type,source_id,source_fingerprint,occurred_at,explanation,created_by)
  values(p_organization,md5(p_request_id::text||':edit-new-payment-v1')::uuid,
    public.minuta_financial_sha256_v129(jsonb_build_array('manual-expense-edit-payment-v1',p_request_id,p_payment_account,p_amount_minor)),
    'supplier_expense_payment','financial_expense_source',v_source.id,v_source.source_fingerprint,v_when,
    jsonb_build_object('schema','minuta-financial-explanation-v1','source_kind','supplier_expense_payment',
      'source_id',v_source.id,'evidence_kind','explicit_manual_expense_edit','original_expense_id',p_expense,
      'manual_expense_note',v_note),v_actor)
  returning id into v_payment;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
    values(p_organization,v_payment,v_payable,'debit',p_amount_minor),(p_organization,v_payment,p_payment_account,'credit',p_amount_minor);
  insert into public.financial_manual_expenses_v163(organization_id,category_id,category_name_snapshot,
    title,source_label,amount_minor,occurred_at,performer_id,expense_source_id,payment_transaction_id,request_id,request_fingerprint,created_by)
  values(p_organization,p_category,v_category.name,v_title,v_category.name,p_amount_minor,v_when,v_old.performer_id,
    v_source.id,v_payment,v_new_request,public.minuta_financial_sha256_v129(jsonb_build_array('manual-expense-edit-replacement-v1',v_fingerprint)),v_actor)
  returning id into v_new;
  insert into public.financial_manual_expense_edits_v1(organization_id,original_expense_id,replacement_expense_id,
    request_id,request_fingerprint,created_by) values(p_organization,p_expense,v_new,p_request_id,v_fingerprint,v_actor);
  return jsonb_build_object('id',v_new,'original_id',p_expense,'replayed',false);
end $$;
revoke all on function public.edit_minuta_manual_expense_v1(uuid,uuid,uuid,uuid,bigint,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.edit_minuta_manual_expense_v1(uuid,uuid,uuid,uuid,bigint,date,text,uuid) to authenticated;
alter table public.financial_manual_expense_edits_v1 owner to postgres;
alter function public.reverse_manual_expense_for_edit_v1(uuid,uuid,uuid) owner to postgres;
alter function public.get_minuta_manual_expense_edit_capabilities_v1(uuid) owner to postgres;
alter function public.edit_minuta_manual_expense_v1(uuid,uuid,uuid,uuid,bigint,date,text,uuid) owner to postgres;
-- For corrected manual expenses only, both original and correcting events use
-- the ledger operation date. Other v163 event sources retain their date rules.
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
        when event.base_operation_type='supplier_expense_payment' and exists(
          select 1 from public.financial_manual_expense_edits_v1 correction
          where correction.organization_id=p_organization
            and manual.id in(correction.original_expense_id,correction.replacement_expense_id))
        then event.event_occurred_at
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
commit;
