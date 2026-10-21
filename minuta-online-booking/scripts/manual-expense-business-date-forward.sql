-- Manual expense business date: additive follow-on after v163.
-- Never rewrites existing ledger rows. Production requires its separate backup/release gate.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
do $guard$
begin
  if to_regprocedure('public.record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)') is null
     or to_regprocedure('public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)') is null then
    raise exception using errcode='55000',message='manual_expense_business_date_requires_v163';
  end if;
end
$guard$;

create or replace function public.pay_minuta_supplier_expense_on_v163(
  p_organization uuid,p_source uuid,p_cash_or_bank_account uuid,p_request_id uuid,
  p_occurred_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path to '' as $$
declare
  v_actor uuid;
  v_source public.financial_expense_sources%rowtype;
  v_account public.financial_accounts%rowtype;
  v_payable uuid;
  v_accrual uuid;
  v_existing public.financial_transactions%rowtype;
  v_request_fingerprint text;
  v_transaction uuid;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_source is null or p_cash_or_bank_account is null or p_request_id is null
     or p_occurred_at is null or not isfinite(p_occurred_at) then
    raise exception using errcode='22023',message='invalid_supplier_expense_payment';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':expense-source:'||p_source::text,132));
  select * into v_source from public.financial_expense_sources source
    where source.id=p_source and source.organization_id=p_organization for update;
  if v_source.id is null then raise exception using errcode='P0002',message='financial_expense_source_not_found'; end if;
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'supplier_expense_payment',p_source,
    v_source.source_fingerprint,p_cash_or_bank_account,v_source.amount_minor,p_occurred_at
  ));
  select * into v_existing from public.financial_transactions transaction_row
    where transaction_row.organization_id=p_organization and transaction_row.request_id=p_request_id for update;
  select * into v_account from public.financial_accounts account
    where account.id=p_cash_or_bank_account and account.organization_id=p_organization for update;
  select account.id into v_payable from public.financial_accounts account
    where account.organization_id=p_organization and account.system_key='supplier_payable'
      and account.account_type='supplier_payable' and account.account_class='liability' and account.active
    for update;
  perform 1 from public.organization_finance_settings setting
    where setting.organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select setting.enabled from public.organization_finance_settings setting
      where setting.organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_existing.id is not null then
    if v_existing.operation_type<>'supplier_expense_payment'
       or v_existing.source_type<>'financial_expense_source' or v_existing.source_id<>p_source
       or v_existing.request_fingerprint<>v_request_fingerprint
       or v_existing.source_fingerprint<>v_source.source_fingerprint then
      raise exception using errcode='23505',message='supplier_expense_payment_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'source_id',p_source,
      'organization_id',p_organization,'amount_minor',v_source.amount_minor,
      'currency','RUB','replayed',true);
  end if;
  if v_account.id is null or v_account.system_key is not null
     or v_account.account_class<>'asset' or v_account.account_type not in('cash','bank') then
    raise exception using errcode='22023',message='cash_or_bank_account_required';
  end if;
  if not v_account.active then
    raise exception using errcode='55000',message='payment_account_inactive';
  end if;
  if v_payable is null then raise exception using errcode='55000',message='supplier_payable_account_missing'; end if;
  select transaction_row.id into v_accrual from public.financial_transactions transaction_row
    where transaction_row.organization_id=p_organization
      and transaction_row.operation_type='supplier_expense_accrual'
      and transaction_row.source_type='financial_expense_source' and transaction_row.source_id=p_source
    order by transaction_row.created_at,transaction_row.id limit 1 for update;
  if v_accrual is null then raise exception using errcode='55000',message='supplier_expense_accrual_missing'; end if;
  if exists(select 1 from public.financial_transactions reversal
      where reversal.organization_id=p_organization and reversal.reversal_of=v_accrual) then
    raise exception using errcode='55000',message='supplier_expense_accrual_reversed';
  end if;
  if exists(select 1 from public.financial_transactions payment
      where payment.organization_id=p_organization
        and payment.operation_type='supplier_expense_payment'
        and payment.source_type='financial_expense_source' and payment.source_id=p_source
        and not exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=payment.id)) then
    raise exception using errcode='23505',message='expense_already_paid';
  end if;

  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'supplier_expense_payment',
    'financial_expense_source',p_source,v_source.source_fingerprint,p_occurred_at,
    jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_expense_source','source_id',p_source,
      'supplier_id',v_source.supplier_id,'evidence_kind','supplier_expense_paid',
      'accrual_transaction_id',v_accrual,'destination_account_id',p_cash_or_bank_account,
      'amount_minor',v_source.amount_minor,'currency','RUB'),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values
    (p_organization,v_transaction,v_payable,'debit',v_source.amount_minor),
    (p_organization,v_transaction,p_cash_or_bank_account,'credit',v_source.amount_minor);
  return jsonb_build_object('id',v_transaction,'source_id',p_source,
    'organization_id',p_organization,'amount_minor',v_source.amount_minor,
    'currency','RUB','replayed',false);
end
$$;

-- The helper is internal to the existing postgres-owned SECURITY DEFINER writer.
-- Public RPC permissions and the four-argument supplier-payment API are unchanged.
revoke all on function public.pay_minuta_supplier_expense_on_v163(uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
alter function public.pay_minuta_supplier_expense_on_v163(uuid,uuid,uuid,uuid,timestamptz) owner to postgres;
comment on function public.pay_minuta_supplier_expense_on_v163(uuid,uuid,uuid,uuid,timestamptz) is 'minuta_manual_expense_business_date_v1';

create or replace function public.record_minuta_manual_expense_v163(
  p_organization uuid,p_category uuid,p_source_label text,p_title text,
  p_amount_minor bigint,p_payment_account uuid,p_occurred_on date,
  p_performer uuid,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_category public.organization_finance_categories_v163%rowtype;
  v_existing public.financial_manual_expenses_v163%rowtype;
  v_source_label text:=btrim(coalesce(p_source_label,''));
  v_title text:=btrim(coalesce(p_title,''));
  v_fingerprint text;
  v_supplier jsonb;
  v_accrual jsonb;
  v_payment jsonb;
  v_expense_account uuid;
  v_supplier_request uuid;
  v_timezone text;
  v_occurred_at timestamptz;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_category is null or p_payment_account is null or p_request_id is null
     or p_occurred_on is null or p_occurred_on<date '2000-01-01'
     or char_length(v_source_label) not between 2 and 160
     or char_length(v_title) not between 2 and 160
     or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>100000000000000 then
    raise exception using errcode='22023',message='invalid_manual_expense';
  end if;
  select location.timezone into v_timezone from public.locations location
  where location.organization_id=p_organization and location.active
  order by location.is_primary desc,location.id limit 1;
  v_timezone:=coalesce(v_timezone,'Europe/Samara');
  if not exists(select 1 from pg_catalog.pg_timezone_names timezone_row
      where timezone_row.name=v_timezone) then
    raise exception using errcode='22023',message='invalid_organization_timezone';
  end if;
  if p_occurred_on>timezone(v_timezone,now())::date then
    raise exception using errcode='22023',message='manual_expense_future_date';
  end if;
  -- UI supplies a business date. Local noon is deterministic and avoids DST
  -- gaps while keeping period boundaries in the organization's timezone.
  v_occurred_at:=(p_occurred_on+time '12:00') at time zone v_timezone;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'manual_expense_v163',p_organization,p_category,v_source_label,v_title,
    p_amount_minor,'RUB',p_payment_account,p_occurred_on,v_timezone,p_performer
  ));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':manual-expense:'||p_request_id::text,163));
  select * into v_existing from public.financial_manual_expenses_v163 expense
    where expense.organization_id=p_organization and expense.request_id=p_request_id for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings
      where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='manual_expense_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'expense_source_id',v_existing.expense_source_id,
      'payment_transaction_id',v_existing.payment_transaction_id,
      'amount_minor',v_existing.amount_minor,'currency','RUB','replayed',true);
  end if;
  select * into v_category from public.organization_finance_categories_v163 category
    where category.id=p_category and category.organization_id=p_organization and category.active for update;
  if v_category.id is null then
    raise exception using errcode='P0002',message='active_finance_category_not_found';
  end if;
  if p_performer is not null and not exists(
    select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.user_id=p_performer and membership.active
  ) then
    raise exception using errcode='42501',message='manual_expense_performer_not_in_organization';
  end if;
  if not exists(select 1 from public.financial_accounts account
      where account.id=p_payment_account and account.organization_id=p_organization
        and account.active and account.system_key is null and account.account_type in('cash','bank')
        and account.account_class='asset') then
    raise exception using errcode='22023',message='cash_or_bank_account_required';
  end if;
  select account.id into v_expense_account from public.financial_accounts account
  where account.organization_id=p_organization and account.system_key='operating_expense'
    and account.account_type='operating_expense' and account.account_class='expense' and account.active
  for update;
  if v_expense_account is null then
    raise exception using errcode='55000',message='operating_expense_account_missing';
  end if;

  v_supplier_request:=md5(p_organization::text||':manual-expense-supplier:'||v_source_label)::uuid;
  v_supplier:=public.create_minuta_financial_supplier_v132(
    p_organization,v_supplier_request,v_source_label
  );
  v_accrual:=public.accrue_minuta_supplier_expense_v132(
    p_organization,(v_supplier->>'id')::uuid,v_expense_account,p_amount_minor,v_occurred_at,
    md5(p_request_id::text||':accrual-v163')::uuid
  );
  v_payment:=public.pay_minuta_supplier_expense_on_v163(
    p_organization,(v_accrual->>'id')::uuid,p_payment_account,
    md5(p_request_id::text||':payment-v163')::uuid,v_occurred_at
  );
  insert into public.financial_manual_expenses_v163(
    organization_id,category_id,category_name_snapshot,title,source_label,amount_minor,
    occurred_at,performer_id,expense_source_id,payment_transaction_id,
    request_id,request_fingerprint,created_by
  ) values(
    p_organization,p_category,v_category.name,v_title,v_source_label,p_amount_minor,
    v_occurred_at,p_performer,(v_accrual->>'id')::uuid,(v_payment->>'id')::uuid,
    p_request_id,v_fingerprint,v_actor
  ) returning * into v_existing;
  return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
    'expense_source_id',v_existing.expense_source_id,
    'payment_transaction_id',v_existing.payment_transaction_id,
    'amount_minor',v_existing.amount_minor,'currency','RUB','replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='manual_expense_idempotency_conflict';
end
$$;

commit;
