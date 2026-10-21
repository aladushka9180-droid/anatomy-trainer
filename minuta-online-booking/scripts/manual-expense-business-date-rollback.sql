-- Restore the original v163 writer; preserve all business history.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
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
  v_payment:=public.pay_minuta_supplier_expense_v132(
    p_organization,(v_accrual->>'id')::uuid,p_payment_account,
    md5(p_request_id::text||':payment-v163')::uuid
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

drop function if exists public.pay_minuta_supplier_expense_on_v163(uuid,uuid,uuid,uuid,timestamptz);
commit;
