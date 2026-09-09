-- v132: default-off supplier expense accrual and full settlement for D06.
-- Apply only through the backed-up isolated-test/rollback/reapply release gate.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.organization_finance_settings') is null
     or to_regclass('public.financial_accounts') is null
     or to_regclass('public.financial_transactions') is null
     or to_regclass('public.financial_postings') is null
     or to_regprocedure('public.set_minuta_finance_enabled_v129(uuid,boolean)') is null
     or to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') is null
     or to_regprocedure('public.require_minuta_financial_manager_v129(uuid)') is null
     or to_regprocedure('public.protect_minuta_financial_ledger_v129()') is null then
    raise exception using errcode='55000',message='v132_requires_v129_financial_ledger';
  end if;
end
$guard$;

-- Expand only the v129 account discriminators.  Constraint discovery makes the
-- migration safe across PostgreSQL-generated names and exact reapplication.
do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
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
  add constraint financial_accounts_account_type_v132_check check(account_type in(
    'cash','bank','receivable','service_revenue','operating_expense','supplier_payable'
  )),
  add constraint financial_accounts_system_key_v132_check check(system_key is null or system_key in(
    'receivable','service_revenue','operating_expense','supplier_payable'
  )),
  add constraint financial_accounts_system_mapping_v132_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
    or (system_key='operating_expense' and account_type='operating_expense' and account_class='expense')
    or (system_key='supplier_payable' and account_type='supplier_payable' and account_class='liability')
  ),
  add constraint financial_accounts_system_request_v132_check check(
    (system_key is null)=(creation_request_id is not null)
  );

-- Add explicit expense operation/source kinds without weakening the v129
-- reversal relationship.
do $constraints$
declare v_constraint record;
begin
  for v_constraint in
    select constraint_row.conname
    from pg_constraint constraint_row
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
  add constraint financial_transactions_operation_v132_check check(operation_type in(
    'visit_service','supplier_expense_accrual','supplier_expense_payment','reversal'
  )),
  add constraint financial_transactions_source_v132_check check(source_type in(
    'booking_outcome','financial_expense_source','financial_transaction'
  )),
  add constraint financial_transactions_shape_v132_check check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type in('supplier_expense_accrual','supplier_expense_payment')
      and source_type='financial_expense_source' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction'
      and reversal_of is not null and source_id=reversal_of)
  );

create table if not exists public.financial_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  name text not null check(char_length(btrim(name)) between 2 and 160),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id)
);

create index if not exists financial_suppliers_scope_v132_idx
  on public.financial_suppliers(organization_id,created_at desc,id);

create table if not exists public.financial_expense_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  supplier_id uuid not null,
  expense_account_id uuid not null,
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000000),
  currency text not null default 'RUB' check(currency='RUB'),
  occurred_at timestamptz not null,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(supplier_id,organization_id)
    references public.financial_suppliers(id,organization_id) on delete restrict,
  foreign key(expense_account_id,organization_id)
    references public.financial_accounts(id,organization_id) on delete restrict
);

create index if not exists financial_expense_sources_scope_v132_idx
  on public.financial_expense_sources(organization_id,occurred_at desc,id);
create index if not exists financial_expense_sources_supplier_v132_idx
  on public.financial_expense_sources(organization_id,supplier_id,occurred_at desc,id);

drop trigger if exists financial_suppliers_immutable_v132 on public.financial_suppliers;
create trigger financial_suppliers_immutable_v132
before update or delete on public.financial_suppliers
for each row execute function public.protect_minuta_financial_ledger_v129();

create or replace function public.protect_minuta_financial_expense_source_v132()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000',message='financial_expense_source_is_immutable';
end
$$;
revoke all on function public.protect_minuta_financial_expense_source_v132()
  from public,anon,authenticated,service_role;

drop trigger if exists financial_expense_sources_immutable_v132 on public.financial_expense_sources;
create trigger financial_expense_sources_immutable_v132
before update or delete on public.financial_expense_sources
for each row execute function public.protect_minuta_financial_expense_source_v132();

create or replace function public.ensure_minuta_expense_system_accounts_v132()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.enabled then
    insert into public.financial_accounts(
      organization_id,name,account_class,account_type,system_key,created_by
    ) values
      (new.organization_id,'Операционные расходы','expense','operating_expense','operating_expense',new.enabled_by),
      (new.organization_id,'Задолженность поставщикам','liability','supplier_payable','supplier_payable',new.enabled_by)
    on conflict(organization_id,system_key) do nothing;
  end if;
  return new;
end
$$;
revoke all on function public.ensure_minuta_expense_system_accounts_v132()
  from public,anon,authenticated,service_role;

drop trigger if exists organization_finance_system_accounts_v132 on public.organization_finance_settings;
create trigger organization_finance_system_accounts_v132
after insert or update of enabled on public.organization_finance_settings
for each row execute function public.ensure_minuta_expense_system_accounts_v132();

-- Repair an already-enabled non-production/test organization on apply.  The
-- production release remains default-off and therefore creates no source rows.
insert into public.financial_accounts(
  organization_id,name,account_class,account_type,system_key,created_by
)
select setting.organization_id,account.name,account.account_class,account.account_type,account.system_key,setting.enabled_by
from public.organization_finance_settings setting
cross join (values
  ('Операционные расходы','expense','operating_expense','operating_expense'),
  ('Задолженность поставщикам','liability','supplier_payable','supplier_payable')
) account(name,account_class,account_type,system_key)
where setting.enabled
on conflict(organization_id,system_key) do nothing;

create or replace function public.set_minuta_finance_enabled_v132(
  p_organization uuid,p_enabled boolean
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_result jsonb; v_expense uuid; v_payable uuid;
begin
  v_result:=public.set_minuta_finance_enabled_v129(p_organization,p_enabled);
  if p_enabled then
    select account.id into v_expense from public.financial_accounts account
      where account.organization_id=p_organization and account.system_key='operating_expense'
        and account.account_class='expense' and account.account_type='operating_expense' and account.active;
    select account.id into v_payable from public.financial_accounts account
      where account.organization_id=p_organization and account.system_key='supplier_payable'
        and account.account_class='liability' and account.account_type='supplier_payable' and account.active;
    if v_expense is null or v_payable is null then
      raise exception using errcode='55000',message='financial_expense_system_accounts_missing';
    end if;
  end if;
  return v_result||jsonb_build_object(
    'operating_expense_account_id',v_expense,'supplier_payable_account_id',v_payable
  );
end
$$;

create or replace function public.create_minuta_financial_supplier_v132(
  p_organization uuid,p_request_id uuid,p_name text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_fingerprint text;
  v_supplier public.financial_suppliers%rowtype;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_request_id is null or char_length(v_name) not between 2 and 160 then
    raise exception using errcode='22023',message='invalid_financial_supplier';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'financial_supplier_v132',p_organization,p_request_id,v_name
  ));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  select * into v_supplier from public.financial_suppliers supplier
    where supplier.organization_id=p_organization and supplier.request_id=p_request_id for update;
  perform 1 from public.organization_finance_settings setting
    where setting.organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select setting.enabled from public.organization_finance_settings setting
      where setting.organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_supplier.id is not null then
    if v_supplier.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='financial_supplier_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_supplier.id,'organization_id',p_organization,
      'name',v_supplier.name,'replayed',true);
  end if;
  insert into public.financial_suppliers(
    organization_id,request_id,request_fingerprint,name,created_by
  ) values(p_organization,p_request_id,v_fingerprint,v_name,v_actor)
  returning * into v_supplier;
  return jsonb_build_object('id',v_supplier.id,'organization_id',p_organization,
    'name',v_supplier.name,'replayed',false);
end
$$;

create or replace function public.accrue_minuta_supplier_expense_v132(
  p_organization uuid,p_supplier uuid,p_expense_account uuid,p_amount_minor bigint,
  p_occurred_at timestamptz,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_supplier public.financial_suppliers%rowtype;
  v_expense public.financial_accounts%rowtype;
  v_payable uuid;
  v_source public.financial_expense_sources%rowtype;
  v_source_fingerprint text;
  v_request_fingerprint text;
  v_existing public.financial_transactions%rowtype;
  v_transaction uuid;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_supplier is null or p_expense_account is null or p_request_id is null
     or p_occurred_at is null or p_amount_minor is null
     or p_amount_minor<=0 or p_amount_minor>100000000000000 then
    raise exception using errcode='22023',message='invalid_supplier_expense_accrual';
  end if;
  v_source_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'financial_expense_source_v132',p_organization,p_supplier,p_expense_account,p_amount_minor,p_occurred_at
  ));
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'supplier_expense_accrual',v_source_fingerprint
  ));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':supplier:'||p_supplier::text,132));
  select * into v_source from public.financial_expense_sources source
    where source.organization_id=p_organization and source.request_id=p_request_id for update;
  select * into v_supplier from public.financial_suppliers supplier
    where supplier.id=p_supplier and supplier.organization_id=p_organization for update;
  select * into v_expense from public.financial_accounts account
    where account.id=p_expense_account and account.organization_id=p_organization for update;
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
  if v_source.id is not null then
    if v_source.request_fingerprint<>v_request_fingerprint
       or v_source.source_fingerprint<>v_source_fingerprint then
      raise exception using errcode='23505',message='supplier_expense_accrual_idempotency_conflict';
    end if;
    select * into v_existing from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization
        and transaction_row.request_id=p_request_id for update;
    if v_existing.id is null or v_existing.operation_type<>'supplier_expense_accrual'
       or v_existing.source_id<>v_source.id
       or v_existing.request_fingerprint<>v_request_fingerprint
       or v_existing.source_fingerprint<>v_source_fingerprint then
      raise exception using errcode='55000',message='supplier_expense_accrual_replay_incomplete';
    end if;
    return jsonb_build_object('id',v_source.id,'transaction_id',v_existing.id,
      'organization_id',p_organization,'amount_minor',v_source.amount_minor,
      'currency','RUB','replayed',true);
  end if;
  if v_supplier.id is null then
    raise exception using errcode='P0002',message='financial_supplier_not_found';
  end if;
  if v_expense.id is null or not v_expense.active
     or v_expense.system_key<>'operating_expense'
     or v_expense.account_type<>'operating_expense' or v_expense.account_class<>'expense' then
    raise exception using errcode='22023',message='operating_expense_account_required';
  end if;
  if v_payable is null then
    raise exception using errcode='55000',message='supplier_payable_account_missing';
  end if;
  if exists(select 1 from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization and transaction_row.request_id=p_request_id) then
    raise exception using errcode='23505',message='supplier_expense_accrual_idempotency_conflict';
  end if;

  insert into public.financial_expense_sources(
    organization_id,supplier_id,expense_account_id,amount_minor,currency,occurred_at,
    request_id,request_fingerprint,source_fingerprint,created_by
  ) values(
    p_organization,p_supplier,p_expense_account,p_amount_minor,'RUB',p_occurred_at,
    p_request_id,v_request_fingerprint,v_source_fingerprint,v_actor
  ) returning * into v_source;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'supplier_expense_accrual',
    'financial_expense_source',v_source.id,v_source_fingerprint,p_occurred_at,
    jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_expense_source','source_id',v_source.id,
      'supplier_id',p_supplier,'evidence_kind','supplier_expense_accrued',
      'amount_minor',p_amount_minor,'currency','RUB'),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values
    (p_organization,v_transaction,p_expense_account,'debit',p_amount_minor),
    (p_organization,v_transaction,v_payable,'credit',p_amount_minor);
  return jsonb_build_object('id',v_source.id,'transaction_id',v_transaction,
    'organization_id',p_organization,'amount_minor',p_amount_minor,'currency','RUB','replayed',false);
end
$$;

create or replace function public.pay_minuta_supplier_expense_v132(
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
    'financial_expense_source',p_source,v_source.source_fingerprint,now(),
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

create or replace function public.reverse_minuta_supplier_expense_v132(
  p_organization uuid,p_transaction uuid,p_request_id uuid,p_reason text,p_expected_operation text
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
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'reversal',p_transaction,p_reason,
    p_expected_operation,v_original.source_fingerprint
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
    'reversal',p_transaction,v_original.source_fingerprint,p_reason,p_expected_operation
  ));
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,reversal_of,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'reversal','financial_transaction',p_transaction,
    v_source_fingerprint,p_transaction,now(),jsonb_build_object(
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

create or replace function public.reverse_minuta_supplier_expense_payment_v132(
  p_organization uuid,p_transaction uuid,p_request_id uuid,p_reason text
)
returns jsonb language sql security definer set search_path to '' as $$
  select public.reverse_minuta_supplier_expense_v132(
    p_organization,p_transaction,p_request_id,p_reason,'supplier_expense_payment'
  )
$$;

create or replace function public.reverse_minuta_supplier_expense_accrual_v132(
  p_organization uuid,p_transaction uuid,p_request_id uuid,p_reason text
)
returns jsonb language sql security definer set search_path to '' as $$
  select public.reverse_minuta_supplier_expense_v132(
    p_organization,p_transaction,p_request_id,p_reason,'supplier_expense_accrual'
  )
$$;

alter table public.financial_suppliers enable row level security;
alter table public.financial_expense_sources enable row level security;
drop policy if exists financial_suppliers_manager_read_v132 on public.financial_suppliers;
create policy financial_suppliers_manager_read_v132 on public.financial_suppliers
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists financial_expense_sources_manager_read_v132 on public.financial_expense_sources;
create policy financial_expense_sources_manager_read_v132 on public.financial_expense_sources
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on public.financial_suppliers,public.financial_expense_sources
  from public,anon,authenticated,service_role;
grant select on public.financial_suppliers,public.financial_expense_sources to authenticated;

revoke all on function public.set_minuta_finance_enabled_v132(uuid,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.create_minuta_financial_supplier_v132(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamptz,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_supplier_expense_v132(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

grant execute on function public.set_minuta_finance_enabled_v132(uuid,boolean) to authenticated;
grant execute on function public.create_minuta_financial_supplier_v132(uuid,uuid,text) to authenticated;
grant execute on function public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamptz,uuid) to authenticated;
grant execute on function public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text) to authenticated;

do $verify$
begin
  if to_regclass('public.financial_suppliers') is null
     or to_regclass('public.financial_expense_sources') is null
     or to_regprocedure('public.set_minuta_finance_enabled_v132(uuid,boolean)') is null
     or to_regprocedure('public.create_minuta_financial_supplier_v132(uuid,uuid,text)') is null
     or to_regprocedure('public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text)') is null
     or has_function_privilege('anon','public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)','EXECUTE') then
    raise exception using errcode='55000',message='v132_schema_or_acl_guard_failed';
  end if;
end
$verify$;

notify pgrst,'reload schema';
commit;
