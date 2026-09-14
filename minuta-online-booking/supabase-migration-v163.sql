-- v163: PrimeTime Pro Money screen expense metadata and safe single-step expense writes.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.financial_expense_sources') is null
     or to_regclass('public.financial_transactions') is null
     or to_regprocedure('public.create_minuta_financial_supplier_v132(uuid,uuid,text)') is null
     or to_regprocedure('public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text)') is null then
    raise exception using errcode='55000',message='v163_requires_v132_financial_expenses';
  end if;
end
$guard$;

create table if not exists public.financial_expense_metadata (
  source_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category_version smallint not null default 1 check(category_version=1),
  category_key text not null check(category_key in('materials','rent','salary','advertising','taxes','equipment','other')),
  description text not null check(char_length(btrim(description)) between 2 and 160),
  occurred_on date not null,
  payment_account_id uuid not null,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(source_id,organization_id),
  unique(organization_id,request_id),
  foreign key(source_id,organization_id) references public.financial_expense_sources(id,organization_id) on delete restrict,
  foreign key(payment_account_id,organization_id) references public.financial_accounts(id,organization_id) on delete restrict
);

create index if not exists financial_expense_metadata_scope_v163_idx
  on public.financial_expense_metadata(organization_id,occurred_on desc,source_id);

drop trigger if exists financial_expense_metadata_immutable_v163 on public.financial_expense_metadata;
create trigger financial_expense_metadata_immutable_v163
before update or delete on public.financial_expense_metadata
for each row execute function public.protect_minuta_financial_ledger_v129();

create or replace function public.record_minuta_expense_v163(
  p_organization uuid,p_category_key text,p_category_version smallint,p_description text,
  p_amount_minor bigint,p_occurred_on date,p_payment_account uuid,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_timezone text; v_description text:=btrim(coalesce(p_description,''));
  v_fingerprint text; v_existing public.financial_expense_metadata%rowtype;
  v_expense_account uuid; v_supplier jsonb; v_accrual jsonb; v_payment jsonb;
  v_supplier_name text;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_request_id is null or p_category_version<>1
     or p_category_key not in('materials','rent','salary','advertising','taxes','equipment','other')
     or char_length(v_description) not between 2 and 160 or p_amount_minor is null
     or p_amount_minor<=0 or p_amount_minor>100000000000000
     or p_occurred_on is null or p_payment_account is null then
    raise exception using errcode='22023',message='invalid_finance_expense';
  end if;
  select location.timezone into v_timezone from public.locations location
    where location.organization_id=p_organization and location.active
    order by location.is_primary desc,location.created_at,location.id limit 1;
  if v_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=v_timezone) then
    raise exception using errcode='22023',message='finance_timezone_unavailable';
  end if;
  if p_occurred_on<pg_catalog.timezone(v_timezone,clock_timestamp())::date-3661
     or p_occurred_on>pg_catalog.timezone(v_timezone,clock_timestamp())::date+366 then
    raise exception using errcode='22023',message='finance_expense_date_out_of_range';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'minuta-finance-expense-v163',p_organization,p_category_version,p_category_key,
    v_description,p_amount_minor,p_occurred_on,p_payment_account,v_timezone
  ));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':finance-expense-v163:'||p_request_id::text,163));
  select * into v_existing from public.financial_expense_metadata metadata
    where metadata.organization_id=p_organization and metadata.request_id=p_request_id for update;
  if v_existing.source_id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='finance_expense_idempotency_conflict';
    end if;
    return jsonb_build_object('organization_id',p_organization,'expense_id',v_existing.source_id,
      'request_id',p_request_id,'category_key',v_existing.category_key,'category_version',v_existing.category_version,'replayed',true);
  end if;
  select account.id into v_expense_account from public.financial_accounts account
    where account.organization_id=p_organization and account.system_key='operating_expense'
      and account.account_class='expense' and account.account_type='operating_expense' and account.active;
  if v_expense_account is null then raise exception using errcode='55000',message='operating_expense_account_missing'; end if;
  v_supplier_name:=case p_category_key when 'materials' then 'Материалы' when 'rent' then 'Аренда'
    when 'salary' then 'Зарплата' when 'advertising' then 'Реклама' when 'taxes' then 'Налоги'
    when 'equipment' then 'Оборудование' else 'Другое' end;
  v_supplier:=public.create_minuta_financial_supplier_v132(
    p_organization,md5(p_organization::text||':finance-expense-category-v1:'||p_category_key)::uuid,v_supplier_name
  );
  v_accrual:=public.accrue_minuta_supplier_expense_v132(
    p_organization,(v_supplier->>'id')::uuid,v_expense_account,p_amount_minor,
    ((p_occurred_on+time '12:00') at time zone v_timezone),md5(p_request_id::text||':accrual')::uuid
  );
  v_payment:=public.pay_minuta_supplier_expense_v132(
    p_organization,(v_accrual->>'id')::uuid,p_payment_account,md5(p_request_id::text||':payment')::uuid
  );
  insert into public.financial_expense_metadata(
    source_id,organization_id,category_version,category_key,description,occurred_on,
    payment_account_id,request_id,request_fingerprint,created_by
  ) values(
    (v_accrual->>'id')::uuid,p_organization,p_category_version,p_category_key,v_description,p_occurred_on,
    p_payment_account,p_request_id,v_fingerprint,v_actor
  );
  return jsonb_build_object('organization_id',p_organization,'expense_id',(v_accrual->>'id')::uuid,
    'accrual_transaction_id',(v_accrual->>'transaction_id')::uuid,'payment_transaction_id',(v_payment->>'id')::uuid,
    'request_id',p_request_id,'category_key',p_category_key,'category_version',p_category_version,'replayed',false);
end $$;

create or replace function public.reverse_minuta_expense_v163(
  p_organization uuid,p_expense uuid,p_request_id uuid,p_reason text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_metadata public.financial_expense_metadata%rowtype; v_accrual uuid; v_payment uuid;
  v_payment_reversal jsonb; v_accrual_reversal jsonb;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_expense is null or p_request_id is null or coalesce(p_reason,'')!~'^[a-z][a-z0-9_]{1,63}$' then
    raise exception using errcode='22023',message='invalid_finance_expense_reversal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  select * into v_metadata from public.financial_expense_metadata metadata
    where metadata.source_id=p_expense and metadata.organization_id=p_organization;
  if v_metadata.source_id is null then raise exception using errcode='P0002',message='finance_expense_not_found'; end if;
  select transaction_row.id into v_accrual from public.financial_transactions transaction_row
    where transaction_row.organization_id=p_organization and transaction_row.source_id=p_expense
      and transaction_row.operation_type='supplier_expense_accrual' order by transaction_row.created_at,transaction_row.id limit 1;
  select transaction_row.id into v_payment from public.financial_transactions transaction_row
    where transaction_row.organization_id=p_organization and transaction_row.source_id=p_expense
      and transaction_row.operation_type='supplier_expense_payment' order by transaction_row.created_at,transaction_row.id limit 1;
  if v_accrual is null or v_payment is null then raise exception using errcode='55000',message='finance_expense_transactions_incomplete'; end if;
  v_payment_reversal:=public.reverse_minuta_supplier_expense_payment_v132(
    p_organization,v_payment,md5(p_request_id::text||':payment')::uuid,p_reason
  );
  v_accrual_reversal:=public.reverse_minuta_supplier_expense_accrual_v132(
    p_organization,v_accrual,md5(p_request_id::text||':accrual')::uuid,p_reason
  );
  return jsonb_build_object('organization_id',p_organization,'expense_id',p_expense,
    'request_id',p_request_id,'reversed',true,'replayed',
    coalesce((v_payment_reversal->>'replayed')::boolean,false) and coalesce((v_accrual_reversal->>'replayed')::boolean,false));
end $$;

create or replace function public.get_minuta_finance_expenses_v163(
  p_organization uuid,p_start date,p_end date
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_actor uuid; v_timezone text;
begin
  v_actor:=auth.uid();
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>3661 then
    raise exception using errcode='22023',message='invalid_money_period';
  end if;
  select location.timezone into v_timezone from public.locations location
    where location.organization_id=p_organization and location.active
    order by location.is_primary desc,location.created_at,location.id limit 1;
  if v_timezone is null or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=v_timezone) then
    raise exception using errcode='22023',message='finance_timezone_unavailable';
  end if;
  return jsonb_build_object(
    'organization_id',p_organization,'start',p_start,'end',p_end,'timezone',v_timezone,'category_version',1,
    'finance_enabled',coalesce((select setting.enabled from public.organization_finance_settings setting where setting.organization_id=p_organization),false),
    'expense_minor',coalesce((select sum(metadata_amount.amount_minor) from (
      select source.amount_minor from public.financial_expense_metadata metadata
      join public.financial_expense_sources source on source.id=metadata.source_id and source.organization_id=metadata.organization_id
      join public.financial_transactions accrual on accrual.organization_id=metadata.organization_id and accrual.source_id=metadata.source_id and accrual.operation_type='supplier_expense_accrual'
      where metadata.organization_id=p_organization and metadata.occurred_on between p_start and p_end
        and not exists(select 1 from public.financial_transactions reversal where reversal.organization_id=p_organization and reversal.reversal_of=accrual.id)
    ) metadata_amount),0),
    'daily_expenses',coalesce((select jsonb_agg(jsonb_build_object('date',daily.occurred_on,'amount_minor',daily.amount_minor) order by daily.occurred_on) from (
      select metadata.occurred_on,sum(source.amount_minor)::bigint amount_minor
      from public.financial_expense_metadata metadata
      join public.financial_expense_sources source on source.id=metadata.source_id and source.organization_id=metadata.organization_id
      join public.financial_transactions accrual on accrual.organization_id=metadata.organization_id and accrual.source_id=metadata.source_id and accrual.operation_type='supplier_expense_accrual'
      where metadata.organization_id=p_organization and metadata.occurred_on between p_start and p_end
        and not exists(select 1 from public.financial_transactions reversal where reversal.organization_id=p_organization and reversal.reversal_of=accrual.id)
      group by metadata.occurred_on
    ) daily),'[]'::jsonb),
    'expense_structure',coalesce((select jsonb_agg(jsonb_build_object('category_key',structure.category_key,'amount_minor',structure.amount_minor) order by structure.amount_minor desc,structure.category_key) from (
      select metadata.category_key,sum(source.amount_minor)::bigint amount_minor
      from public.financial_expense_metadata metadata
      join public.financial_expense_sources source on source.id=metadata.source_id and source.organization_id=metadata.organization_id
      join public.financial_transactions accrual on accrual.organization_id=metadata.organization_id and accrual.source_id=metadata.source_id and accrual.operation_type='supplier_expense_accrual'
      where metadata.organization_id=p_organization and metadata.occurred_on between p_start and p_end
        and not exists(select 1 from public.financial_transactions reversal where reversal.organization_id=p_organization and reversal.reversal_of=accrual.id)
      group by metadata.category_key
    ) structure),'[]'::jsonb),
    'operations',coalesce((select jsonb_agg(jsonb_build_object(
      'expense_id',operation.source_id,'category_key',operation.category_key,'category_version',operation.category_version,
      'description',operation.description,'occurred_on',operation.occurred_on,'amount_minor',operation.amount_minor,'reversed',operation.reversed
    ) order by operation.occurred_on desc,operation.source_id desc) from (
      select metadata.source_id,metadata.category_key,metadata.category_version,metadata.description,metadata.occurred_on,
        source.amount_minor,exists(select 1 from public.financial_transactions reversal where reversal.organization_id=p_organization and reversal.reversal_of=accrual.id) reversed
      from public.financial_expense_metadata metadata
      join public.financial_expense_sources source on source.id=metadata.source_id and source.organization_id=metadata.organization_id
      join public.financial_transactions accrual on accrual.organization_id=metadata.organization_id and accrual.source_id=metadata.source_id and accrual.operation_type='supplier_expense_accrual'
      where metadata.organization_id=p_organization and metadata.occurred_on between p_start and p_end
      order by metadata.occurred_on desc,metadata.source_id desc limit 30
    ) operation),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',account.id,'name',account.name,'account_type',account.account_type) order by account.account_type,account.name,account.id)
      from public.financial_accounts account where account.organization_id=p_organization and account.active and account.system_key is null and account.account_type in('cash','bank')),'[]'::jsonb)
  );
end $$;

alter table public.financial_expense_metadata enable row level security;
drop policy if exists financial_expense_metadata_manager_read_v163 on public.financial_expense_metadata;
create policy financial_expense_metadata_manager_read_v163 on public.financial_expense_metadata
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on public.financial_expense_metadata from public,anon,authenticated,service_role;
grant select on public.financial_expense_metadata to authenticated;
revoke all on function public.record_minuta_expense_v163(uuid,text,smallint,text,bigint,date,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_expense_v163(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_finance_expenses_v163(uuid,date,date) from public,anon,authenticated,service_role;
grant execute on function public.record_minuta_expense_v163(uuid,text,smallint,text,bigint,date,uuid,uuid) to authenticated;
grant execute on function public.reverse_minuta_expense_v163(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.get_minuta_finance_expenses_v163(uuid,date,date) to authenticated;

commit;
