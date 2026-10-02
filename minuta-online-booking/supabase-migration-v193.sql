-- v193: atomic correction of manual expense history. Additive; no ledger updates.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.financial_manual_expenses_v163') is null
     or to_regprocedure('public.record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)') is null
     or to_regprocedure('public.reverse_minuta_manual_expense_v163(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.reverse_minuta_supplier_expense_v132(uuid,uuid,uuid,text,text)') is null
     or to_regprocedure('public.get_minuta_finance_screen_v163(uuid,date,date,uuid,integer,timestamptz,text)') is null
     or not exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.financial_manual_expenses_v163'::regclass
       and tgname='financial_manual_expenses_immutable_v163' and tgenabled='O') then
    raise exception using errcode='55000',message='v193_requires_immutable_manual_expense_v163';
  end if;
end
$guard$;

create table public.financial_manual_expense_edits_v193 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  old_expense_id uuid not null,
  new_expense_id uuid not null,
  payment_reversal_id uuid not null,
  accrual_reversal_id uuid not null,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id,old_expense_id),
  unique(organization_id,new_expense_id),
  unique(organization_id,request_id),
  check(old_expense_id<>new_expense_id),
  foreign key(old_expense_id,organization_id) references public.financial_manual_expenses_v163(id,organization_id) on delete restrict,
  foreign key(new_expense_id,organization_id) references public.financial_manual_expenses_v163(id,organization_id) on delete restrict,
  foreign key(payment_reversal_id,organization_id) references public.financial_transactions(id,organization_id) on delete restrict,
  foreign key(accrual_reversal_id,organization_id) references public.financial_transactions(id,organization_id) on delete restrict
);

create trigger financial_manual_expense_edits_immutable_v193
before update or delete on public.financial_manual_expense_edits_v193
for each row execute function public.protect_minuta_finance_screen_history_v163();

-- Private helpers retain v132/v163 validation, locks and immutable posting logic.
-- Only dated payment/reversal and namespaced v193 fingerprints differ.
create function public.pay_minuta_manual_expense_dated_v193(
  p_organization uuid,p_source uuid,p_cash_or_bank_account uuid,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
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
  if p_source is null or p_cash_or_bank_account is null or p_request_id is null then
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
    v_source.source_fingerprint,p_cash_or_bank_account,v_source.amount_minor
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
    'financial_expense_source',p_source,v_source.source_fingerprint,v_source.occurred_at,
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

create function public.record_minuta_manual_expense_dated_v193(
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
    'manual_expense_dated_v193',p_organization,p_category,v_source_label,v_title,
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
    md5(p_request_id::text||':accrual-v193')::uuid
  );
  v_payment:=public.pay_minuta_manual_expense_dated_v193(
    p_organization,(v_accrual->>'id')::uuid,p_payment_account,
    md5(p_request_id::text||':payment-v193')::uuid
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

create function public.reverse_minuta_manual_expense_transaction_dated_v193(
  p_organization uuid,p_transaction uuid,p_request_id uuid,p_reason text,p_expected_operation text,p_effective_at timestamptz
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_original public.financial_transactions%rowtype;
  v_existing public.financial_transactions%rowtype;
  v_request_fingerprint text;
  v_source_fingerprint text;
  v_reversal uuid;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_transaction is null or p_request_id is null
     or p_expected_operation not in('supplier_expense_accrual','supplier_expense_payment')
     or coalesce(p_reason,'')!~'^[a-z][a-z0-9_]{1,63}$' then
    raise exception using errcode='22023',message='invalid_supplier_expense_reversal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':transaction:'||p_transaction::text,129));
  select * into v_original from public.financial_transactions transaction_row
    where transaction_row.id=p_transaction and transaction_row.organization_id=p_organization for update;
  if v_original.id is null or v_original.operation_type<>p_expected_operation
     or v_original.source_type<>'financial_expense_source' then
    raise exception using errcode='P0002',message='supplier_expense_transaction_not_reversible';
  end if;
  if p_effective_at is null or not exists(select 1 from public.financial_manual_expenses_v163 expense
      where expense.organization_id=p_organization and expense.expense_source_id=v_original.source_id
        and expense.occurred_at=p_effective_at) then
    raise exception using errcode='22023',message='invalid_manual_expense_edit_reversal_date';
  end if;
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'reversal',p_transaction,p_reason,
    p_expected_operation,v_original.source_fingerprint,p_effective_at
  ));
  select * into v_existing from public.financial_transactions transaction_row
    where transaction_row.organization_id=p_organization and transaction_row.request_id=p_request_id for update;
  perform 1 from public.organization_finance_settings setting
    where setting.organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select setting.enabled from public.organization_finance_settings setting
      where setting.organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_existing.id is not null then
    if v_existing.operation_type<>'reversal' or v_existing.reversal_of<>p_transaction
       or v_existing.request_fingerprint<>v_request_fingerprint then
      raise exception using errcode='23505',message='supplier_expense_reversal_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'request_id',p_request_id,'reversal_of',p_transaction,'replayed',true);
  end if;
  if exists(select 1 from public.financial_transactions reversal
      where reversal.organization_id=p_organization and reversal.reversal_of=p_transaction) then
    raise exception using errcode='23505',message='supplier_expense_transaction_already_reversed';
  end if;
  if p_expected_operation='supplier_expense_accrual' and exists(
    select 1 from public.financial_transactions payment
    where payment.organization_id=p_organization
      and payment.operation_type='supplier_expense_payment'
      and payment.source_type='financial_expense_source'
      and payment.source_id=v_original.source_id
      and not exists(select 1 from public.financial_transactions payment_reversal
        where payment_reversal.organization_id=p_organization and payment_reversal.reversal_of=payment.id)
  ) then
    raise exception using errcode='55000',message='financial_expense_payment_must_be_reversed_first';
  end if;
  v_source_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'reversal',p_transaction,v_original.source_fingerprint,p_reason,p_expected_operation,p_effective_at
  ));
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,reversal_of,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'reversal','financial_transaction',p_transaction,
    v_source_fingerprint,p_transaction,p_effective_at,jsonb_build_object(
      'schema','minuta-financial-explanation-v1','source_kind','financial_transaction',
      'source_id',p_transaction,'evidence_kind','explicit_reversal',
      'original_operation_type',p_expected_operation,'reason_code',p_reason
    ),v_actor
  ) returning id into v_reversal;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  select p_organization,v_reversal,posting.account_id,
    case posting.side when 'debit' then 'credit' else 'debit' end,posting.amount_minor
  from public.financial_postings posting
  where posting.transaction_id=p_transaction
  order by posting.id;
  return jsonb_build_object('id',v_reversal,'organization_id',p_organization,
    'request_id',p_request_id,'reversal_of',p_transaction,'replayed',false);
end
$$;

create function public.get_minuta_manual_expense_edit_status_v193(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin'])
     or not exists(select 1 from public.organizations where id=p_organization and status='active') then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  return jsonb_build_object('schema','manual-expense-edit-v1','version',193);
end
$$;

create function public.get_minuta_manual_expense_for_edit_v193(p_organization uuid,p_expense uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_expense public.financial_manual_expenses_v163%rowtype;
  v_accrual uuid;
  v_account uuid;
  v_count integer;
  v_timezone text;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin'])
     or not exists(select 1 from public.organizations where id=p_organization and status='active') then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  select * into v_expense from public.financial_manual_expenses_v163 where id=p_expense and organization_id=p_organization;
  if v_expense.id is null then raise exception using errcode='P0002',message='manual_expense_not_found'; end if;
  select id into v_accrual from public.financial_transactions where organization_id=p_organization
    and operation_type='supplier_expense_accrual' and source_type='financial_expense_source'
    and source_id=v_expense.expense_source_id;
  if v_accrual is null then raise exception using errcode='55000',message='manual_expense_accrual_missing'; end if;
  if exists(select 1 from public.financial_manual_expense_edits_v193 where organization_id=p_organization and old_expense_id=p_expense)
     or exists(select 1 from public.financial_transactions where organization_id=p_organization
       and reversal_of in(v_expense.payment_transaction_id,v_accrual)) then
    raise exception using errcode='55000',message='manual_expense_already_corrected';
  end if;
  select count(*),(array_agg(account.id order by account.id))[1] into v_count,v_account
    from public.financial_postings posting join public.financial_accounts account
      on account.id=posting.account_id and account.organization_id=posting.organization_id
    where posting.organization_id=p_organization and posting.transaction_id=v_expense.payment_transaction_id
      and posting.side='credit' and posting.amount_minor=v_expense.amount_minor
      and account.system_key is null and account.account_class='asset' and account.account_type in('cash','bank');
  if v_count<>1 then raise exception using errcode='55000',message='manual_expense_payment_account_missing'; end if;
  select timezone into v_timezone from public.locations where organization_id=p_organization and active
    order by is_primary desc,id limit 1;
  v_timezone:=coalesce(v_timezone,'Europe/Samara');
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=v_timezone) then
    raise exception using errcode='22023',message='invalid_organization_timezone';
  end if;
  return jsonb_build_object('id',v_expense.id,'category_id',v_expense.category_id,
    'source_label',v_expense.source_label,'title',v_expense.title,'amount_minor',v_expense.amount_minor,
    'payment_account_id',v_account,'occurred_on',(v_expense.occurred_at at time zone v_timezone)::date,
    'performer_id',v_expense.performer_id);
end
$$;

create function public.edit_minuta_manual_expense_v193(
  p_organization uuid,p_expense uuid,p_category uuid,p_source_label text,p_title text,
  p_amount_minor bigint,p_payment_account uuid,p_occurred_on date,p_performer uuid,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_expense public.financial_manual_expenses_v163%rowtype;
  v_existing public.financial_manual_expense_edits_v193%rowtype;
  v_fingerprint text;
  v_accrual uuid;
  v_payment_reversal jsonb;
  v_accrual_reversal jsonb;
  v_replacement jsonb;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_expense is null or p_request_id is null or p_category is null or p_payment_account is null
     or p_occurred_on is null or p_occurred_on<date '2000-01-01'
     or char_length(btrim(coalesce(p_source_label,''))) not between 2 and 160
     or char_length(btrim(coalesce(p_title,''))) not between 2 and 160
     or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>100000000000000 then
    raise exception using errcode='22023',message='invalid_manual_expense_edit';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array('manual_expense_edit_v193',
    p_organization,p_expense,p_category,btrim(p_source_label),btrim(p_title),p_amount_minor,'RUB',
    p_payment_account,p_occurred_on,p_performer));
  -- Same order as all original financial writers; the lock spans both reversals,
  -- replacement and immutable link. There are no independently committed phases.
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  perform 1 from public.organization_finance_settings where organization_id=p_organization for update;
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  select * into v_existing from public.financial_manual_expense_edits_v193
    where organization_id=p_organization and request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='manual_expense_edit_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.new_expense_id,'organization_id',p_organization,
      'old_expense_id',v_existing.old_expense_id,'new_expense_id',v_existing.new_expense_id,
      'payment_reversal_id',v_existing.payment_reversal_id,'accrual_reversal_id',v_existing.accrual_reversal_id,'replayed',true);
  end if;
  select * into v_expense from public.financial_manual_expenses_v163
    where id=p_expense and organization_id=p_organization for update;
  if v_expense.id is null then raise exception using errcode='P0002',message='manual_expense_not_found'; end if;
  select id into v_accrual from public.financial_transactions where organization_id=p_organization
    and operation_type='supplier_expense_accrual' and source_type='financial_expense_source'
    and source_id=v_expense.expense_source_id for update;
  if v_accrual is null then raise exception using errcode='55000',message='manual_expense_accrual_missing'; end if;
  if exists(select 1 from public.financial_manual_expense_edits_v193 where organization_id=p_organization and old_expense_id=p_expense)
     or exists(select 1 from public.financial_transactions where organization_id=p_organization
       and reversal_of in(v_expense.payment_transaction_id,v_accrual)) then
    raise exception using errcode='55000',message='manual_expense_already_corrected';
  end if;
  v_payment_reversal:=public.reverse_minuta_manual_expense_transaction_dated_v193(
    p_organization,v_expense.payment_transaction_id,md5(p_request_id::text||':payment-reversal-v193')::uuid,
    'manual_expense_edit','supplier_expense_payment',v_expense.occurred_at);
  v_accrual_reversal:=public.reverse_minuta_manual_expense_transaction_dated_v193(
    p_organization,v_accrual,md5(p_request_id::text||':accrual-reversal-v193')::uuid,
    'manual_expense_edit','supplier_expense_accrual',v_expense.occurred_at);
  v_replacement:=public.record_minuta_manual_expense_dated_v193(p_organization,p_category,p_source_label,p_title,
    p_amount_minor,p_payment_account,p_occurred_on,p_performer,md5(p_request_id::text||':replacement-v193')::uuid);
  insert into public.financial_manual_expense_edits_v193(organization_id,old_expense_id,new_expense_id,
    payment_reversal_id,accrual_reversal_id,request_id,request_fingerprint,created_by)
    values(p_organization,p_expense,(v_replacement->>'id')::uuid,(v_payment_reversal->>'id')::uuid,
      (v_accrual_reversal->>'id')::uuid,p_request_id,v_fingerprint,v_actor) returning * into v_existing;
  return jsonb_build_object('id',v_existing.new_expense_id,'organization_id',p_organization,
    'old_expense_id',p_expense,'new_expense_id',v_existing.new_expense_id,
    'payment_reversal_id',v_existing.payment_reversal_id,'accrual_reversal_id',v_existing.accrual_reversal_id,'replayed',false);
end
$$;

alter table public.financial_manual_expense_edits_v193 enable row level security;
alter table public.financial_manual_expense_edits_v193 force row level security;
-- Internal immutable receipts are exposed only by scoped, authorized RPCs.
revoke all on public.financial_manual_expense_edits_v193 from public,anon,authenticated,service_role;

do $acl_and_stamp$
declare r record;
begin
  for r in select oid,proname,oid::regprocedure identity from pg_catalog.pg_proc where pronamespace='public'::regnamespace
    and proname in('pay_minuta_manual_expense_dated_v193','record_minuta_manual_expense_dated_v193',
      'reverse_minuta_manual_expense_transaction_dated_v193','get_minuta_manual_expense_edit_status_v193',
      'get_minuta_manual_expense_for_edit_v193','edit_minuta_manual_expense_v193') loop
    execute format('alter function %s owner to postgres',r.identity);
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.identity);
    if r.proname in('get_minuta_manual_expense_edit_status_v193','get_minuta_manual_expense_for_edit_v193','edit_minuta_manual_expense_v193') then
      execute format('grant execute on function %s to authenticated',r.identity);
    end if;
    execute format('comment on function %s is %L',r.identity,'manual_expense_edit_v193:'||
      (select md5(pg_get_functiondef(oid)||'|'||proowner::text||'|'||coalesce(proacl::text,''))
        from pg_catalog.pg_proc where oid=r.oid));
  end loop;
end
$acl_and_stamp$;
notify pgrst,'reload schema';
commit;
