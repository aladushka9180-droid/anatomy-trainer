-- v136: default-off payroll accrual, debt, payment and advance ledger for D07.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.payroll_periods') is null
     or to_regclass('public.payroll_items') is null
     or to_regclass('public.payroll_adjustments') is null
     or to_regclass('public.organization_payroll_settings') is null
     or to_regclass('public.financial_accounts') is null
     or to_regclass('public.financial_transactions') is null
     or to_regclass('public.financial_postings') is null
     or to_regprocedure('public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text,uuid)') is null
     or to_regprocedure('public.get_minuta_financial_reconciliation_v133(uuid,integer)') is null then
    raise exception 'v136_payroll_ledger_prerequisites_missing';
  end if;
end
$guard$;

-- Extend the v133 financial discriminators without weakening its mappings.
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
  add constraint financial_accounts_account_type_v136_check check(account_type in(
    'cash','bank','receivable','service_revenue','operating_expense','supplier_payable',
    'payment_channel_commission','payroll_expense','payroll_payable','employee_advance'
  )),
  add constraint financial_accounts_system_key_v136_check check(system_key is null or system_key in(
    'receivable','service_revenue','operating_expense','supplier_payable','payment_channel_commission',
    'payroll_expense','payroll_payable','employee_advance'
  )),
  add constraint financial_accounts_system_mapping_v136_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
    or (system_key='operating_expense' and account_type='operating_expense' and account_class='expense')
    or (system_key='supplier_payable' and account_type='supplier_payable' and account_class='liability')
    or (system_key='payment_channel_commission' and account_type='payment_channel_commission' and account_class='expense')
    or (system_key='payroll_expense' and account_type='payroll_expense' and account_class='expense')
    or (system_key='payroll_payable' and account_type='payroll_payable' and account_class='liability')
    or (system_key='employee_advance' and account_type='employee_advance' and account_class='asset')
  ),
  add constraint financial_accounts_system_request_v136_check check(
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
  add constraint financial_transactions_operation_v136_check check(operation_type in(
    'visit_service','supplier_expense_accrual','supplier_expense_payment','customer_debt_settlement',
    'payroll_accrual','payroll_payment','payroll_advance','payroll_advance_offset','reversal'
  )),
  add constraint financial_transactions_source_v136_check check(source_type in(
    'booking_outcome','financial_expense_source','financial_debt_settlement_source',
    'financial_payroll_accrual_source','financial_payroll_payment_source',
    'financial_payroll_advance_source','financial_payroll_advance_offset','financial_transaction'
  )),
  add constraint financial_transactions_shape_v136_check check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type in('supplier_expense_accrual','supplier_expense_payment')
      and source_type='financial_expense_source' and reversal_of is null)
    or (operation_type='customer_debt_settlement'
      and source_type='financial_debt_settlement_source' and reversal_of is null)
    or (operation_type='payroll_accrual'
      and source_type='financial_payroll_accrual_source' and reversal_of is null)
    or (operation_type='payroll_payment'
      and source_type='financial_payroll_payment_source' and reversal_of is null)
    or (operation_type='payroll_advance'
      and source_type='financial_payroll_advance_source' and reversal_of is null)
    or (operation_type='payroll_advance_offset'
      and source_type='financial_payroll_advance_offset' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction'
      and reversal_of is not null and source_id=reversal_of)
  );

create table if not exists public.organization_payroll_ledger_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(not enabled or enabled_at is not null)
);

create table if not exists public.financial_payroll_adjustment_sources (
  id uuid primary key references public.payroll_adjustments(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  period_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  adjustment_kind text not null check(adjustment_kind in('bonus','deduction')),
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=1000000000 and amount_minor%100=0),
  reason text not null check(char_length(btrim(reason)) between 3 and 500),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(period_id,organization_id) references public.payroll_periods(id,organization_id) on delete restrict
);

create table if not exists public.financial_payroll_accrual_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  period_id uuid not null,
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000000),
  breakdown jsonb not null check(jsonb_typeof(breakdown)='array'),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(period_id,organization_id) references public.payroll_periods(id,organization_id) on delete restrict
);
create index if not exists financial_payroll_accrual_period_v136_idx
  on public.financial_payroll_accrual_sources(organization_id,period_id,created_at desc,id);

create table if not exists public.financial_payroll_payment_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  accrual_source_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  cash_or_bank_account_id uuid not null,
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000000),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(accrual_source_id,organization_id)
    references public.financial_payroll_accrual_sources(id,organization_id) on delete restrict,
  foreign key(cash_or_bank_account_id,organization_id)
    references public.financial_accounts(id,organization_id) on delete restrict
);
create index if not exists financial_payroll_payment_accrual_v136_idx
  on public.financial_payroll_payment_sources(organization_id,accrual_source_id,performer_id,created_at,id);

create table if not exists public.financial_payroll_advance_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  cash_or_bank_account_id uuid not null,
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000000),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(cash_or_bank_account_id,organization_id)
    references public.financial_accounts(id,organization_id) on delete restrict
);
create index if not exists financial_payroll_advance_performer_v136_idx
  on public.financial_payroll_advance_sources(organization_id,performer_id,occurred_at desc,id);

create table if not exists public.financial_payroll_advance_offsets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  advance_source_id uuid not null,
  accrual_source_id uuid not null,
  performer_id uuid not null references public.performer_profiles(id) on delete restrict,
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000000),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  occurred_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(advance_source_id,organization_id)
    references public.financial_payroll_advance_sources(id,organization_id) on delete restrict,
  foreign key(accrual_source_id,organization_id)
    references public.financial_payroll_accrual_sources(id,organization_id) on delete restrict
);
create index if not exists financial_payroll_offset_accrual_v136_idx
  on public.financial_payroll_advance_offsets(organization_id,accrual_source_id,performer_id,created_at,id);
create index if not exists financial_payroll_offset_advance_v136_idx
  on public.financial_payroll_advance_offsets(organization_id,advance_source_id,created_at,id);

create or replace function public.protect_minuta_payroll_ledger_source_v136()
returns trigger language plpgsql set search_path to '' as $$
begin
  raise exception using errcode='55000',message='payroll_financial_source_immutable';
end
$$;
revoke all on function public.protect_minuta_payroll_ledger_source_v136()
  from public,anon,authenticated,service_role;

do $triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'financial_payroll_adjustment_sources','financial_payroll_accrual_sources',
    'financial_payroll_payment_sources','financial_payroll_advance_sources',
    'financial_payroll_advance_offsets'
  ] loop
    execute format('drop trigger if exists financial_payroll_source_immutable_v136 on public.%I',v_table);
    execute format('create trigger financial_payroll_source_immutable_v136 before update or delete on public.%I for each row execute function public.protect_minuta_payroll_ledger_source_v136()',v_table);
  end loop;
end
$triggers$;

create or replace function public.require_minuta_payroll_ledger_manager_v136(
  p_organization uuid,p_owner_only boolean default false
)
returns uuid language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid; v_role text;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  v_role:=public.get_minuta_payroll_role(p_organization);
  if v_role not in('owner','admin') or (p_owner_only and v_role<>'owner') then
    raise exception using errcode='42501',message=case when p_owner_only then 'payroll_owner_required' else 'payroll_manager_role_required' end;
  end if;
  return v_actor;
end
$$;
revoke all on function public.require_minuta_payroll_ledger_manager_v136(uuid,boolean)
  from public,anon,authenticated,service_role;

create or replace function public.assert_minuta_payroll_ledger_enabled_v136(p_organization uuid)
returns void language plpgsql volatile security definer set search_path to '' as $$
begin
  if not coalesce((select setting.enabled from public.organization_payroll_ledger_settings setting
      where setting.organization_id=p_organization),false) then
    raise exception using errcode='55000',message='payroll_ledger_disabled';
  end if;
  if not coalesce((select setting.enabled from public.organization_finance_settings setting
      where setting.organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if not coalesce((select setting.enabled from public.organization_payroll_settings setting
      where setting.organization_id=p_organization),false) then
    raise exception using errcode='55000',message='payroll_disabled';
  end if;
end
$$;
revoke all on function public.assert_minuta_payroll_ledger_enabled_v136(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.set_minuta_payroll_ledger_enabled_v136(
  p_organization uuid,p_enabled boolean
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_expense uuid; v_payable uuid; v_advance uuid;
begin
  if p_enabled is null then raise exception using errcode='22023',message='invalid_payroll_ledger_setting'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform 1 from public.organization_payroll_ledger_settings where organization_id=p_organization for update;
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,true);
  if p_enabled then
    if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
      raise exception using errcode='55000',message='finance_disabled';
    end if;
    if not coalesce((select enabled from public.organization_payroll_settings where organization_id=p_organization),false) then
      raise exception using errcode='55000',message='payroll_disabled';
    end if;
    if exists(
      select 1 from public.payroll_periods period
      where period.organization_id=p_organization and period.status in('approved','paid')
        and not exists(
          select 1 from public.financial_payroll_accrual_sources source
          join public.financial_transactions transaction_row
            on transaction_row.organization_id=p_organization
           and transaction_row.operation_type='payroll_accrual'
           and transaction_row.source_type='financial_payroll_accrual_source'
           and transaction_row.source_id=source.id
          where source.organization_id=p_organization and source.period_id=period.id
            and not exists(select 1 from public.financial_transactions reversal
              where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
        )
    ) then
      raise exception using errcode='55000',message='payroll_ledger_historical_reconciliation_required';
    end if;
    insert into public.financial_accounts(organization_id,name,account_class,account_type,system_key,created_by)
    values
      (p_organization,'Расходы на зарплату','expense','payroll_expense','payroll_expense',v_actor),
      (p_organization,'Задолженность по зарплате','liability','payroll_payable','payroll_payable',v_actor),
      (p_organization,'Авансы сотрудникам','asset','employee_advance','employee_advance',v_actor)
    on conflict(organization_id,system_key) do nothing;
  end if;
  insert into public.organization_payroll_ledger_settings(organization_id,enabled,enabled_at,enabled_by,updated_at)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then v_actor end,now())
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_payroll_ledger_settings.enabled_at,excluded.enabled_at)
      else public.organization_payroll_ledger_settings.enabled_at end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_payroll_ledger_settings.enabled_by,excluded.enabled_by)
      else public.organization_payroll_ledger_settings.enabled_by end,
    updated_at=excluded.updated_at;
  select id into v_expense from public.financial_accounts where organization_id=p_organization and system_key='payroll_expense' and active;
  select id into v_payable from public.financial_accounts where organization_id=p_organization and system_key='payroll_payable' and active;
  select id into v_advance from public.financial_accounts where organization_id=p_organization and system_key='employee_advance' and active;
  if p_enabled and (v_expense is null or v_payable is null or v_advance is null) then
    raise exception using errcode='55000',message='payroll_system_accounts_missing';
  end if;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_ledger_enabled_changed',p_organization,
    jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled,
    'payroll_expense_account_id',v_expense,'payroll_payable_account_id',v_payable,
    'employee_advance_account_id',v_advance);
end
$$;

create or replace function public.record_minuta_payroll_adjustment_v136(
  p_organization uuid,p_period uuid,p_performer uuid,p_kind text,p_amount_minor bigint,
  p_reason text,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_reason text:=btrim(coalesce(p_reason,'')); v_fingerprint text;
  v_existing public.financial_payroll_adjustment_sources%rowtype; v_id uuid; v_total bigint;
  v_amount_rub integer;
begin
  if p_period is null or p_performer is null or p_request_id is null
     or p_kind not in('bonus','deduction') or p_amount_minor is null
     or p_amount_minor<=0 or p_amount_minor>1000000000 or p_amount_minor%100<>0
     or char_length(v_reason) not between 3 and 500 then
    raise exception using errcode='22023',message='invalid_payroll_adjustment_v136';
  end if;
  v_amount_rub:=(p_amount_minor/100)::integer;
  if v_amount_rub>10000000 then raise exception using errcode='22023',message='invalid_payroll_adjustment_v136'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,false);
  perform public.assert_minuta_payroll_ledger_enabled_v136(p_organization);
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'payroll_adjustment_v136',p_organization,p_period,p_performer,p_kind,p_amount_minor,v_reason,v_actor
  ));
  select * into v_existing from public.financial_payroll_adjustment_sources source
    where source.organization_id=p_organization and source.request_id=p_request_id for update;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='payroll_adjustment_request_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'period_id',v_existing.period_id,'performer_id',v_existing.performer_id,
      'kind',v_existing.adjustment_kind,'amount_minor',v_existing.amount_minor,
      'request_id',v_existing.request_id,'replayed',true);
  end if;
  if not exists(select 1 from public.payroll_periods
      where id=p_period and organization_id=p_organization and status='draft' for update) then
    raise exception using errcode='55000',message='payroll_period_not_draft';
  end if;
  if not exists(select 1 from public.organization_memberships
      where organization_id=p_organization and user_id=p_performer and active) then
    raise exception using errcode='23503',message='payroll_performer_not_in_organization';
  end if;
  v_id:=gen_random_uuid();
  insert into public.payroll_adjustments(
    id,period_id,organization_id,performer_id,amount_rub,reason,created_by,request_id
  ) values(
    v_id,p_period,p_organization,p_performer,
    case when p_kind='bonus' then v_amount_rub else -v_amount_rub end,
    v_reason,v_actor,p_request_id
  );
  insert into public.financial_payroll_adjustment_sources(
    id,organization_id,period_id,performer_id,adjustment_kind,amount_minor,reason,
    request_id,request_fingerprint,created_by
  ) values(
    v_id,p_organization,p_period,p_performer,p_kind,p_amount_minor,v_reason,
    p_request_id,v_fingerprint,v_actor
  );
  select coalesce((select sum(payroll_rub) from public.payroll_items where period_id=p_period),0)
    +coalesce((select sum(amount_rub) from public.payroll_adjustments where period_id=p_period),0)
    into v_total;
  update public.payroll_periods set total_payroll_rub=v_total where id=p_period;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_adjustment_added',v_id,
    jsonb_build_object('period_id',p_period,'performer_id',p_performer,'kind',p_kind,
      'amount_minor',p_amount_minor,'reason',v_reason,'request_id',p_request_id));
  return jsonb_build_object('id',v_id,'organization_id',p_organization,'period_id',p_period,
    'performer_id',p_performer,'kind',p_kind,'amount_minor',p_amount_minor,
    'request_id',p_request_id,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='payroll_adjustment_request_conflict';
end
$$;

create or replace function public.minuta_payroll_accrual_debt_v136(
  p_organization uuid,p_accrual uuid,p_performer uuid
)
returns table(original_minor bigint,settled_minor bigint,debt_minor bigint)
language sql stable security definer set search_path to '' as $$
  with original as (
    select coalesce(max((entry->>'amount_minor')::bigint),0) amount_minor
    from public.financial_payroll_accrual_sources source
    cross join lateral jsonb_array_elements(source.breakdown) entry
    where source.organization_id=p_organization and source.id=p_accrual
      and entry->>'performer_id'=p_performer::text
  ), settled as (
    select coalesce(sum(row.amount_minor),0) amount_minor from (
      select payment.amount_minor
      from public.financial_payroll_payment_sources payment
      join public.financial_transactions transaction_row
        on transaction_row.organization_id=p_organization
       and transaction_row.operation_type='payroll_payment'
       and transaction_row.source_type='financial_payroll_payment_source'
       and transaction_row.source_id=payment.id
      where payment.organization_id=p_organization and payment.accrual_source_id=p_accrual
        and payment.performer_id=p_performer
        and not exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
      union all
      select offset_row.amount_minor
      from public.financial_payroll_advance_offsets offset_row
      join public.financial_transactions transaction_row
        on transaction_row.organization_id=p_organization
       and transaction_row.operation_type='payroll_advance_offset'
       and transaction_row.source_type='financial_payroll_advance_offset'
       and transaction_row.source_id=offset_row.id
      where offset_row.organization_id=p_organization and offset_row.accrual_source_id=p_accrual
        and offset_row.performer_id=p_performer
        and not exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
    ) row
  )
  select original.amount_minor,settled.amount_minor,
    greatest(original.amount_minor-settled.amount_minor,0)
  from original cross join settled
$$;
revoke all on function public.minuta_payroll_accrual_debt_v136(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.minuta_payroll_advance_remaining_v136(
  p_organization uuid,p_advance uuid
)
returns bigint language sql stable security definer set search_path to '' as $$
  select greatest(source.amount_minor-coalesce((
    select sum(offset_row.amount_minor)
    from public.financial_payroll_advance_offsets offset_row
    join public.financial_transactions transaction_row
      on transaction_row.organization_id=p_organization
     and transaction_row.operation_type='payroll_advance_offset'
     and transaction_row.source_type='financial_payroll_advance_offset'
     and transaction_row.source_id=offset_row.id
    where offset_row.organization_id=p_organization and offset_row.advance_source_id=p_advance
      and not exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
  ),0),0)
  from public.financial_payroll_advance_sources source
  where source.organization_id=p_organization and source.id=p_advance
$$;
revoke all on function public.minuta_payroll_advance_remaining_v136(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.accrue_minuta_payroll_period_v136(
  p_organization uuid,p_period uuid,p_occurred_at timestamptz,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_period public.payroll_periods%rowtype; v_existing public.financial_payroll_accrual_sources%rowtype;
  v_breakdown jsonb; v_amount bigint; v_request_fingerprint text; v_source_fingerprint text;
  v_source uuid; v_transaction uuid; v_expense uuid; v_payable uuid;
begin
  if p_period is null or p_occurred_at is null or p_request_id is null then
    raise exception using errcode='22023',message='invalid_payroll_accrual';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,false);
  perform public.assert_minuta_payroll_ledger_enabled_v136(p_organization);
  select * into v_period from public.payroll_periods period
    where period.id=p_period and period.organization_id=p_organization for update;
  if v_period.id is null then raise exception using errcode='P0002',message='payroll_period_not_found'; end if;

  with performers as (
    select item.performer_id from public.payroll_items item where item.period_id=p_period
    union
    select adjustment.performer_id from public.payroll_adjustments adjustment where adjustment.period_id=p_period
  ), totals as (
    select performer.performer_id,
      coalesce((select sum(item.payroll_rub::bigint*100) from public.payroll_items item
        where item.period_id=p_period and item.performer_id=performer.performer_id),0) item_minor,
      coalesce((select sum(greatest(adjustment.amount_rub,0)::bigint*100) from public.payroll_adjustments adjustment
        where adjustment.period_id=p_period and adjustment.performer_id=performer.performer_id),0) bonus_minor,
      coalesce((select sum(abs(least(adjustment.amount_rub,0))::bigint*100) from public.payroll_adjustments adjustment
        where adjustment.period_id=p_period and adjustment.performer_id=performer.performer_id),0) deduction_minor
    from performers performer
  )
  select jsonb_agg(jsonb_build_object(
      'performer_id',performer_id,'item_minor',item_minor,'bonus_minor',bonus_minor,
      'deduction_minor',deduction_minor,'amount_minor',item_minor+bonus_minor-deduction_minor
    ) order by performer_id),sum(item_minor+bonus_minor-deduction_minor)
  into v_breakdown,v_amount from totals;
  if v_breakdown is null or v_amount is null or v_amount<=0
     or exists(select 1 from jsonb_array_elements(v_breakdown) entry where (entry->>'amount_minor')::bigint<=0) then
    raise exception using errcode='55000',message='payroll_accrual_nonpositive';
  end if;
  v_source_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'financial_payroll_accrual_source_v136',p_organization,p_period,v_period.source_fingerprint,
    v_period.calculation_version,v_breakdown,v_amount,p_occurred_at
  ));
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'payroll_accrual',p_period,v_source_fingerprint,v_actor
  ));
  select * into v_existing from public.financial_payroll_accrual_sources source
    where source.organization_id=p_organization and source.request_id=p_request_id for update;
  if found then
    if v_existing.request_fingerprint<>v_request_fingerprint then
      raise exception using errcode='23505',message='payroll_accrual_request_conflict';
    end if;
    select id into v_transaction from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_accrual'
        and transaction_row.source_type='financial_payroll_accrual_source' and transaction_row.source_id=v_existing.id;
    if v_transaction is null then raise exception using errcode='55000',message='payroll_accrual_replay_incomplete'; end if;
    return jsonb_build_object('id',v_existing.id,'transaction_id',v_transaction,
      'organization_id',p_organization,'period_id',p_period,'amount_minor',v_existing.amount_minor,
      'breakdown',v_existing.breakdown,'request_id',p_request_id,'replayed',true);
  end if;
  if v_period.status<>'approved' then raise exception using errcode='55000',message='payroll_period_not_approved'; end if;
  if exists(
    select 1 from public.financial_payroll_accrual_sources source
    join public.financial_transactions transaction_row
      on transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_accrual'
     and transaction_row.source_type='financial_payroll_accrual_source' and transaction_row.source_id=source.id
    where source.organization_id=p_organization and source.period_id=p_period
      and not exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
  ) then
    raise exception using errcode='23505',message='payroll_period_already_accrued';
  end if;
  select id into v_expense from public.financial_accounts where organization_id=p_organization
    and system_key='payroll_expense' and account_type='payroll_expense' and account_class='expense' and active for update;
  select id into v_payable from public.financial_accounts where organization_id=p_organization
    and system_key='payroll_payable' and account_type='payroll_payable' and account_class='liability' and active for update;
  if v_expense is null or v_payable is null then raise exception using errcode='55000',message='payroll_system_accounts_missing'; end if;
  insert into public.financial_payroll_accrual_sources(
    organization_id,period_id,amount_minor,breakdown,request_id,request_fingerprint,
    source_fingerprint,occurred_at,created_by
  ) values(
    p_organization,p_period,v_amount,v_breakdown,p_request_id,v_request_fingerprint,
    v_source_fingerprint,p_occurred_at,v_actor
  ) returning id into v_source;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'payroll_accrual','financial_payroll_accrual_source',v_source,
    v_source_fingerprint,p_occurred_at,jsonb_build_object(
      'schema','minuta-financial-explanation-v1','source_kind','financial_payroll_accrual_source',
      'source_id',v_source,'period_id',p_period,'amount_minor',v_amount,'breakdown',v_breakdown
    ),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,v_expense,'debit',v_amount),
        (p_organization,v_transaction,v_payable,'credit',v_amount);
  perform public.write_minuta_payroll_audit(p_organization,'payroll_period_accrued',v_source,
    jsonb_build_object('period_id',p_period,'transaction_id',v_transaction,'amount_minor',v_amount));
  return jsonb_build_object('id',v_source,'transaction_id',v_transaction,
    'organization_id',p_organization,'period_id',p_period,'amount_minor',v_amount,
    'breakdown',v_breakdown,'request_id',p_request_id,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='payroll_accrual_request_conflict';
end
$$;

create or replace function public.refresh_minuta_payroll_period_paid_v136(
  p_organization uuid,p_accrual uuid,p_actor uuid
)
returns void language plpgsql security definer set search_path to '' as $$
declare v_period uuid; v_status text; v_debt bigint;
begin
  select source.period_id into v_period from public.financial_payroll_accrual_sources source
    where source.organization_id=p_organization and source.id=p_accrual;
  if v_period is null then return; end if;
  select period.status into v_status from public.payroll_periods period
    where period.organization_id=p_organization and period.id=v_period for update;
  select coalesce(sum(debt.debt_minor),0) into v_debt
  from public.financial_payroll_accrual_sources source
  cross join lateral jsonb_array_elements(source.breakdown) entry
  cross join lateral public.minuta_payroll_accrual_debt_v136(
    p_organization,source.id,(entry->>'performer_id')::uuid
  ) debt
  join public.financial_transactions transaction_row
    on transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_accrual'
   and transaction_row.source_type='financial_payroll_accrual_source' and transaction_row.source_id=source.id
  where source.organization_id=p_organization and source.period_id=v_period
    and not exists(select 1 from public.financial_transactions reversal
      where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id);
  perform set_config('minuta.payroll_v136_internal','on',true);
  if v_debt=0 and v_status='approved' then
    update public.payroll_periods set status='paid',paid_at=now(),paid_by=p_actor where id=v_period;
  elsif v_debt>0 and v_status='paid' then
    update public.payroll_periods set status='approved',paid_at=null,paid_by=null where id=v_period;
  end if;
  perform set_config('minuta.payroll_v136_internal','off',true);
end
$$;
revoke all on function public.refresh_minuta_payroll_period_paid_v136(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.pay_minuta_payroll_debt_v136(
  p_organization uuid,p_accrual_source uuid,p_performer uuid,p_cash_or_bank_account uuid,
  p_amount_minor bigint,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_accrual public.financial_payroll_accrual_sources%rowtype;
  v_existing public.financial_payroll_payment_sources%rowtype; v_account public.financial_accounts%rowtype;
  v_performer uuid; v_debt bigint; v_fingerprint text; v_source uuid; v_transaction uuid; v_payable uuid;
begin
  if p_accrual_source is null or p_performer is null or p_cash_or_bank_account is null or p_request_id is null
     or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>100000000000000 then
    raise exception using errcode='22023',message='invalid_payroll_payment';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,false);
  perform public.assert_minuta_payroll_ledger_enabled_v136(p_organization);
  select * into v_accrual from public.financial_payroll_accrual_sources source
    where source.organization_id=p_organization and source.id=p_accrual_source for update;
  if v_accrual.id is null then raise exception using errcode='P0002',message='payroll_accrual_not_found'; end if;
  v_performer:=p_performer;
  if not exists(select 1 from jsonb_array_elements(v_accrual.breakdown) entry
      where entry->>'performer_id'=p_performer::text) then
    raise exception using errcode='22023',message='payroll_payment_performer_mismatch';
  end if;
  select debt_minor into v_debt from public.minuta_payroll_accrual_debt_v136(
    p_organization,p_accrual_source,v_performer
  );
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'financial_payroll_payment_source_v136',p_organization,p_accrual_source,v_performer,
    p_cash_or_bank_account,p_amount_minor,v_actor
  ));
  select * into v_existing from public.financial_payroll_payment_sources source
    where source.organization_id=p_organization and source.request_id=p_request_id for update;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='payroll_payment_request_conflict';
    end if;
    select id into v_transaction from public.financial_transactions where organization_id=p_organization
      and operation_type='payroll_payment' and source_type='financial_payroll_payment_source'
      and source_id=v_existing.id;
    if v_transaction is null then raise exception using errcode='55000',message='payroll_payment_replay_incomplete'; end if;
    select debt_minor into v_debt from public.minuta_payroll_accrual_debt_v136(
      p_organization,p_accrual_source,v_existing.performer_id
    );
    return jsonb_build_object('id',v_transaction,'source_id',v_existing.id,'organization_id',p_organization,
      'accrual_source_id',p_accrual_source,'performer_id',v_existing.performer_id,
      'amount_minor',v_existing.amount_minor,'debt_after_minor',v_debt,
      'request_id',p_request_id,'replayed',true);
  end if;
  if exists(select 1 from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_accrual'
        and transaction_row.source_type='financial_payroll_accrual_source'
        and transaction_row.source_id=p_accrual_source
        and exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)) then
    raise exception using errcode='55000',message='payroll_accrual_reversed';
  end if;
  if p_amount_minor>v_debt then raise exception using errcode='22023',message='payroll_payment_exceeds_debt'; end if;
  select * into v_account from public.financial_accounts where organization_id=p_organization
    and id=p_cash_or_bank_account for update;
  if v_account.id is null or not v_account.active or v_account.system_key is not null
     or v_account.account_class<>'asset' or v_account.account_type not in('cash','bank') then
    raise exception using errcode='22023',message='cash_or_bank_account_required';
  end if;
  select id into v_payable from public.financial_accounts where organization_id=p_organization
    and system_key='payroll_payable' and account_type='payroll_payable' and account_class='liability' and active for update;
  if v_payable is null then raise exception using errcode='55000',message='payroll_system_accounts_missing'; end if;
  insert into public.financial_payroll_payment_sources(
    organization_id,accrual_source_id,performer_id,cash_or_bank_account_id,amount_minor,
    request_id,request_fingerprint,occurred_at,created_by
  ) values(
    p_organization,p_accrual_source,v_performer,p_cash_or_bank_account,p_amount_minor,
    p_request_id,v_fingerprint,now(),v_actor
  ) returning id into v_source;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_fingerprint,'payroll_payment','financial_payroll_payment_source',v_source,
    v_fingerprint,now(),jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_payroll_payment_source','source_id',v_source,
      'accrual_source_id',p_accrual_source,'performer_id',v_performer,
      'amount_minor',p_amount_minor,'destination_account_id',p_cash_or_bank_account),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,v_payable,'debit',p_amount_minor),
        (p_organization,v_transaction,p_cash_or_bank_account,'credit',p_amount_minor);
  perform public.refresh_minuta_payroll_period_paid_v136(p_organization,p_accrual_source,v_actor);
  select debt_minor into v_debt from public.minuta_payroll_accrual_debt_v136(
    p_organization,p_accrual_source,v_performer
  );
  return jsonb_build_object('id',v_transaction,'source_id',v_source,'organization_id',p_organization,
    'accrual_source_id',p_accrual_source,'performer_id',v_performer,'amount_minor',p_amount_minor,
    'debt_after_minor',v_debt,'request_id',p_request_id,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='payroll_payment_request_conflict';
end
$$;

create or replace function public.create_minuta_payroll_advance_v136(
  p_organization uuid,p_performer uuid,p_cash_or_bank_account uuid,p_amount_minor bigint,
  p_occurred_at timestamptz,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_existing public.financial_payroll_advance_sources%rowtype;
  v_account public.financial_accounts%rowtype; v_advance_account uuid;
  v_fingerprint text; v_source uuid; v_transaction uuid;
begin
  if p_performer is null or p_cash_or_bank_account is null or p_request_id is null or p_occurred_at is null
     or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>100000000000000 then
    raise exception using errcode='22023',message='invalid_payroll_advance';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,false);
  perform public.assert_minuta_payroll_ledger_enabled_v136(p_organization);
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'financial_payroll_advance_source_v136',p_organization,p_performer,p_cash_or_bank_account,
    p_amount_minor,p_occurred_at,v_actor
  ));
  select * into v_existing from public.financial_payroll_advance_sources source
    where source.organization_id=p_organization and source.request_id=p_request_id for update;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='payroll_advance_request_conflict';
    end if;
    select id into v_transaction from public.financial_transactions where organization_id=p_organization
      and operation_type='payroll_advance' and source_type='financial_payroll_advance_source'
      and source_id=v_existing.id;
    if v_transaction is null then raise exception using errcode='55000',message='payroll_advance_replay_incomplete'; end if;
    return jsonb_build_object('id',v_transaction,'source_id',v_existing.id,'organization_id',p_organization,
      'performer_id',v_existing.performer_id,'amount_minor',v_existing.amount_minor,
      'remaining_minor',public.minuta_payroll_advance_remaining_v136(p_organization,v_existing.id),
      'request_id',p_request_id,'replayed',true);
  end if;
  if not exists(select 1 from public.organization_memberships where organization_id=p_organization
      and user_id=p_performer and active) then
    raise exception using errcode='23503',message='payroll_performer_not_in_organization';
  end if;
  select * into v_account from public.financial_accounts where organization_id=p_organization
    and id=p_cash_or_bank_account for update;
  if v_account.id is null or not v_account.active or v_account.system_key is not null
     or v_account.account_class<>'asset' or v_account.account_type not in('cash','bank') then
    raise exception using errcode='22023',message='cash_or_bank_account_required';
  end if;
  select id into v_advance_account from public.financial_accounts where organization_id=p_organization
    and system_key='employee_advance' and account_type='employee_advance' and account_class='asset' and active for update;
  if v_advance_account is null then raise exception using errcode='55000',message='payroll_system_accounts_missing'; end if;
  insert into public.financial_payroll_advance_sources(
    organization_id,performer_id,cash_or_bank_account_id,amount_minor,request_id,
    request_fingerprint,occurred_at,created_by
  ) values(
    p_organization,p_performer,p_cash_or_bank_account,p_amount_minor,p_request_id,
    v_fingerprint,p_occurred_at,v_actor
  ) returning id into v_source;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_fingerprint,'payroll_advance','financial_payroll_advance_source',v_source,
    v_fingerprint,p_occurred_at,jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_payroll_advance_source','source_id',v_source,
      'performer_id',p_performer,'amount_minor',p_amount_minor,
      'destination_account_id',p_cash_or_bank_account),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,v_advance_account,'debit',p_amount_minor),
        (p_organization,v_transaction,p_cash_or_bank_account,'credit',p_amount_minor);
  return jsonb_build_object('id',v_transaction,'source_id',v_source,'organization_id',p_organization,
    'performer_id',p_performer,'amount_minor',p_amount_minor,'remaining_minor',p_amount_minor,
    'request_id',p_request_id,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='payroll_advance_request_conflict';
end
$$;

create or replace function public.offset_minuta_payroll_advance_v136(
  p_organization uuid,p_advance_source uuid,p_accrual_source uuid,p_amount_minor bigint,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_advance public.financial_payroll_advance_sources%rowtype;
  v_accrual public.financial_payroll_accrual_sources%rowtype;
  v_existing public.financial_payroll_advance_offsets%rowtype;
  v_debt bigint; v_remaining bigint; v_fingerprint text; v_source uuid; v_transaction uuid;
  v_payable uuid; v_advance_account uuid;
begin
  if p_advance_source is null or p_accrual_source is null or p_request_id is null
     or p_amount_minor is null or p_amount_minor<=0 or p_amount_minor>100000000000000 then
    raise exception using errcode='22023',message='invalid_payroll_advance_offset';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,false);
  perform public.assert_minuta_payroll_ledger_enabled_v136(p_organization);
  select * into v_advance from public.financial_payroll_advance_sources source
    where source.organization_id=p_organization and source.id=p_advance_source for update;
  select * into v_accrual from public.financial_payroll_accrual_sources source
    where source.organization_id=p_organization and source.id=p_accrual_source for update;
  if v_advance.id is null then raise exception using errcode='P0002',message='payroll_advance_not_found'; end if;
  if v_accrual.id is null then raise exception using errcode='P0002',message='payroll_accrual_not_found'; end if;
  if not exists(select 1 from jsonb_array_elements(v_accrual.breakdown) entry
      where entry->>'performer_id'=v_advance.performer_id::text) then
    raise exception using errcode='22023',message='payroll_advance_performer_mismatch';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'financial_payroll_advance_offset_v136',p_organization,p_advance_source,p_accrual_source,
    v_advance.performer_id,p_amount_minor,v_actor
  ));
  select * into v_existing from public.financial_payroll_advance_offsets source
    where source.organization_id=p_organization and source.request_id=p_request_id for update;
  if found then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='payroll_advance_offset_request_conflict';
    end if;
    select id into v_transaction from public.financial_transactions where organization_id=p_organization
      and operation_type='payroll_advance_offset' and source_type='financial_payroll_advance_offset'
      and source_id=v_existing.id;
    if v_transaction is null then raise exception using errcode='55000',message='payroll_advance_offset_replay_incomplete'; end if;
    select debt_minor into v_debt from public.minuta_payroll_accrual_debt_v136(
      p_organization,p_accrual_source,v_existing.performer_id
    );
    v_remaining:=public.minuta_payroll_advance_remaining_v136(p_organization,p_advance_source);
    return jsonb_build_object('id',v_transaction,'source_id',v_existing.id,'organization_id',p_organization,
      'advance_source_id',p_advance_source,'accrual_source_id',p_accrual_source,
      'performer_id',v_existing.performer_id,'amount_minor',v_existing.amount_minor,
      'debt_after_minor',v_debt,'advance_remaining_minor',v_remaining,
      'request_id',p_request_id,'replayed',true);
  end if;
  if exists(select 1 from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization and transaction_row.source_id in(p_advance_source,p_accrual_source)
        and transaction_row.operation_type in('payroll_advance','payroll_accrual')
        and exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)) then
    raise exception using errcode='55000',message='payroll_offset_source_reversed';
  end if;
  select debt_minor into v_debt from public.minuta_payroll_accrual_debt_v136(
    p_organization,p_accrual_source,v_advance.performer_id
  );
  v_remaining:=public.minuta_payroll_advance_remaining_v136(p_organization,p_advance_source);
  if p_amount_minor>v_debt then raise exception using errcode='22023',message='payroll_offset_exceeds_debt'; end if;
  if p_amount_minor>v_remaining then raise exception using errcode='22023',message='payroll_offset_exceeds_advance'; end if;
  select id into v_payable from public.financial_accounts where organization_id=p_organization
    and system_key='payroll_payable' and active for update;
  select id into v_advance_account from public.financial_accounts where organization_id=p_organization
    and system_key='employee_advance' and active for update;
  if v_payable is null or v_advance_account is null then
    raise exception using errcode='55000',message='payroll_system_accounts_missing';
  end if;
  insert into public.financial_payroll_advance_offsets(
    organization_id,advance_source_id,accrual_source_id,performer_id,amount_minor,
    request_id,request_fingerprint,created_by
  ) values(
    p_organization,p_advance_source,p_accrual_source,v_advance.performer_id,p_amount_minor,
    p_request_id,v_fingerprint,v_actor
  ) returning id into v_source;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_fingerprint,'payroll_advance_offset','financial_payroll_advance_offset',v_source,
    v_fingerprint,now(),jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_payroll_advance_offset','source_id',v_source,
      'advance_source_id',p_advance_source,'accrual_source_id',p_accrual_source,
      'performer_id',v_advance.performer_id,'amount_minor',p_amount_minor),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,v_payable,'debit',p_amount_minor),
        (p_organization,v_transaction,v_advance_account,'credit',p_amount_minor);
  perform public.refresh_minuta_payroll_period_paid_v136(p_organization,p_accrual_source,v_actor);
  select debt_minor into v_debt from public.minuta_payroll_accrual_debt_v136(
    p_organization,p_accrual_source,v_advance.performer_id
  );
  v_remaining:=public.minuta_payroll_advance_remaining_v136(p_organization,p_advance_source);
  return jsonb_build_object('id',v_transaction,'source_id',v_source,'organization_id',p_organization,
    'advance_source_id',p_advance_source,'accrual_source_id',p_accrual_source,
    'performer_id',v_advance.performer_id,'amount_minor',p_amount_minor,
    'debt_after_minor',v_debt,'advance_remaining_minor',v_remaining,
    'request_id',p_request_id,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='payroll_advance_offset_request_conflict';
end
$$;

create or replace function public.reverse_minuta_payroll_transaction_v136(
  p_organization uuid,p_transaction uuid,p_request_id uuid,p_reason text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid; v_reason text:=btrim(coalesce(p_reason,''));
  v_original public.financial_transactions%rowtype; v_existing public.financial_transactions%rowtype;
  v_fingerprint text; v_reversal uuid; v_accrual uuid; v_period uuid;
begin
  if p_transaction is null or p_request_id is null or char_length(v_reason) not between 3 and 500 then
    raise exception using errcode='22023',message='invalid_payroll_reversal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':transaction:'||p_transaction::text,129));
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,false);
  perform public.assert_minuta_payroll_ledger_enabled_v136(p_organization);
  select * into v_original from public.financial_transactions transaction_row
    where transaction_row.organization_id=p_organization and transaction_row.id=p_transaction for update;
  if v_original.id is null or v_original.operation_type not in(
      'payroll_accrual','payroll_payment','payroll_advance','payroll_advance_offset'
    ) then
    raise exception using errcode='P0002',message='payroll_transaction_not_reversible';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'payroll_reversal',p_transaction,v_original.operation_type,
    v_original.source_fingerprint,v_reason,v_actor
  ));
  select * into v_existing from public.financial_transactions transaction_row
    where transaction_row.organization_id=p_organization and transaction_row.request_id=p_request_id for update;
  if found then
    if v_existing.operation_type<>'reversal' or v_existing.reversal_of<>p_transaction
       or v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='payroll_reversal_request_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'request_id',p_request_id,'reversal_of',p_transaction,'replayed',true);
  end if;
  if exists(select 1 from public.financial_transactions reversal
      where reversal.organization_id=p_organization and reversal.reversal_of=p_transaction) then
    raise exception using errcode='23505',message='payroll_transaction_already_reversed';
  end if;
  if v_original.operation_type='payroll_accrual' and exists(
    select 1 from public.financial_transactions child
    left join public.financial_payroll_payment_sources payment
      on child.operation_type='payroll_payment' and child.source_id=payment.id
    left join public.financial_payroll_advance_offsets offset_row
      on child.operation_type='payroll_advance_offset' and child.source_id=offset_row.id
    where child.organization_id=p_organization
      and ((payment.accrual_source_id=v_original.source_id) or (offset_row.accrual_source_id=v_original.source_id))
      and not exists(select 1 from public.financial_transactions child_reversal
        where child_reversal.organization_id=p_organization and child_reversal.reversal_of=child.id)
  ) then
    raise exception using errcode='55000',message='payroll_settlements_must_be_reversed_first';
  end if;
  if v_original.operation_type='payroll_advance' and exists(
    select 1 from public.financial_payroll_advance_offsets offset_row
    join public.financial_transactions child
      on child.organization_id=p_organization and child.operation_type='payroll_advance_offset'
     and child.source_type='financial_payroll_advance_offset' and child.source_id=offset_row.id
    where offset_row.organization_id=p_organization and offset_row.advance_source_id=v_original.source_id
      and not exists(select 1 from public.financial_transactions child_reversal
        where child_reversal.organization_id=p_organization and child_reversal.reversal_of=child.id)
  ) then
    raise exception using errcode='55000',message='payroll_advance_offsets_must_be_reversed_first';
  end if;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,reversal_of,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_fingerprint,'reversal','financial_transaction',p_transaction,
    public.minuta_financial_sha256_v129(jsonb_build_array(
      'payroll_reversal_v136',p_transaction,v_original.source_fingerprint,v_reason
    )),p_transaction,now(),jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_transaction','source_id',p_transaction,
      'evidence_kind','explicit_reversal','original_operation_type',v_original.operation_type,
      'reason',v_reason),v_actor
  ) returning id into v_reversal;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  select p_organization,v_reversal,posting.account_id,
    case posting.side when 'debit' then 'credit' else 'debit' end,posting.amount_minor
  from public.financial_postings posting where posting.transaction_id=p_transaction order by posting.id;
  if v_original.operation_type='payroll_payment' then
    select source.accrual_source_id into v_accrual from public.financial_payroll_payment_sources source
      where source.organization_id=p_organization and source.id=v_original.source_id;
    perform public.refresh_minuta_payroll_period_paid_v136(p_organization,v_accrual,v_actor);
  elsif v_original.operation_type='payroll_advance_offset' then
    select source.accrual_source_id into v_accrual from public.financial_payroll_advance_offsets source
      where source.organization_id=p_organization and source.id=v_original.source_id;
    perform public.refresh_minuta_payroll_period_paid_v136(p_organization,v_accrual,v_actor);
  elsif v_original.operation_type='payroll_accrual' then
    select source.period_id into v_period from public.financial_payroll_accrual_sources source
      where source.organization_id=p_organization and source.id=v_original.source_id;
    perform set_config('minuta.payroll_v136_internal','on',true);
    update public.payroll_periods set status='draft',approved_at=null,approved_by=null
      where organization_id=p_organization and id=v_period and status='approved';
    perform set_config('minuta.payroll_v136_internal','off',true);
  end if;
  perform public.write_minuta_payroll_audit(p_organization,'payroll_financial_transaction_reversed',v_reversal,
    jsonb_build_object('reversal_of',p_transaction,'original_operation_type',v_original.operation_type,'reason',v_reason));
  return jsonb_build_object('id',v_reversal,'organization_id',p_organization,
    'request_id',p_request_id,'reversal_of',p_transaction,'replayed',false);
end
$$;

-- Derived paid status can only be changed by the v136 settlement/reversal path.
create or replace function public.enforce_minuta_payroll_period_immutability()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_internal boolean:=coalesce(current_setting('minuta.payroll_v136_internal',true),'off')='on';
begin
  if tg_op='DELETE' then
    if old.status<>'draft' then raise exception using errcode='55000',message='payroll_period_immutable'; end if;
    return old;
  end if;
  if old.status='paid' then
    if v_internal and new.status='approved'
       and (to_jsonb(new)-array['status','paid_at','paid_by','updated_at'])
         is not distinct from (to_jsonb(old)-array['status','paid_at','paid_by','updated_at']) then
      return new;
    end if;
    raise exception using errcode='55000',message='payroll_period_immutable';
  end if;
  if old.status='approved' then
    if v_internal and new.status='draft'
       and (to_jsonb(new)-array['status','approved_at','approved_by','updated_at'])
         is not distinct from (to_jsonb(old)-array['status','approved_at','approved_by','updated_at']) then
      return new;
    end if;
    if new.status='paid' and not v_internal then
      raise exception using errcode='55000',message='payroll_paid_status_managed_by_ledger';
    end if;
    if new.status<>'paid' or
       (to_jsonb(new)-array['status','paid_at','paid_by','updated_at'])
         is distinct from (to_jsonb(old)-array['status','paid_at','paid_by','updated_at']) then
      raise exception using errcode='55000',message='payroll_period_immutable';
    end if;
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
        plan.active is distinct from true or plan.organization_id is distinct from snapshot.organization_id
        or plan.performer_id is distinct from snapshot.performer_id or plan.name is distinct from snapshot.plan_name
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
  elsif v_current='approved' and p_status='paid' then
    raise exception using errcode='55000',message='payroll_paid_status_managed_by_ledger';
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

create or replace function public.auto_accrue_minuta_payroll_period_v136()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_request uuid;
begin
  if old.status='draft' and new.status='approved'
     and coalesce((select enabled from public.organization_payroll_ledger_settings
       where organization_id=new.organization_id),false) then
    v_request:=md5('payroll-accrual-v136:'||new.id::text||':'||new.calculation_version::text)::uuid;
    perform public.accrue_minuta_payroll_period_v136(
      new.organization_id,new.id,coalesce(new.approved_at,now()),v_request
    );
  end if;
  return new;
end
$$;
revoke all on function public.auto_accrue_minuta_payroll_period_v136()
  from public,anon,authenticated,service_role;
drop trigger if exists payroll_period_auto_accrual_v136 on public.payroll_periods;
create trigger payroll_period_auto_accrual_v136
after update of status on public.payroll_periods
for each row when(old.status is distinct from new.status)
execute function public.auto_accrue_minuta_payroll_period_v136();

create or replace function public.get_minuta_payroll_ledger_workspace_v136(
  p_organization uuid,p_start date,p_end date
)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid; v_role text; v_base jsonb;
begin
  v_actor:=public.require_minuta_payroll_ledger_manager_v136(p_organization,false);
  v_role:=public.get_minuta_payroll_role(p_organization);
  v_base:=public.get_minuta_payroll_workspace(p_organization,p_start,p_end);
  return v_base||jsonb_build_object(
    'ledger_version',136,
    'ledger_enabled',coalesce((select enabled from public.organization_payroll_ledger_settings
      where organization_id=p_organization),false),
    'ledger_accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',account.id,'name',account.name,'account_type',account.account_type,
      'account_class',account.account_class,'system_key',account.system_key,'active',account.active
    ) order by account.system_key) from public.financial_accounts account
      where account.organization_id=p_organization and account.system_key in(
        'payroll_expense','payroll_payable','employee_advance'
      )),'[]'::jsonb),
    'payment_accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',account.id,'name',account.name,'account_type',account.account_type,
      'currency',account.currency,'active',account.active
    ) order by account.account_type,account.name,account.id)
      from public.financial_accounts account
      where account.organization_id=p_organization and account.active
        and account.system_key is null and account.account_class='asset'
        and account.account_type in('cash','bank')),'[]'::jsonb),
    'typed_adjustments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',source.id,'period_id',source.period_id,'performer_id',source.performer_id,
      'kind',source.adjustment_kind,'amount_minor',source.amount_minor,'reason',source.reason,
      'request_id',source.request_id,'created_at',source.created_at
    ) order by source.created_at,source.id) from public.financial_payroll_adjustment_sources source
      join public.payroll_periods period on period.id=source.period_id
      where source.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start),'[]'::jsonb),
    'accruals',coalesce((select jsonb_agg(jsonb_build_object(
      'id',source.id,'period_id',source.period_id,'amount_minor',source.amount_minor,
      'breakdown',source.breakdown,'request_id',source.request_id,'occurred_at',source.occurred_at,
      'transaction_id',transaction_row.id,
      'reversed',exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
    ) order by source.occurred_at desc,source.id) from public.financial_payroll_accrual_sources source
      join public.payroll_periods period on period.id=source.period_id
      left join public.financial_transactions transaction_row
        on transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_accrual'
       and transaction_row.source_type='financial_payroll_accrual_source' and transaction_row.source_id=source.id
      where source.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',source.id,'accrual_source_id',source.accrual_source_id,'performer_id',source.performer_id,
      'cash_or_bank_account_id',source.cash_or_bank_account_id,'amount_minor',source.amount_minor,
      'request_id',source.request_id,'occurred_at',source.occurred_at,'transaction_id',transaction_row.id,
      'reversed',exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
    ) order by source.occurred_at desc,source.id) from public.financial_payroll_payment_sources source
      join public.financial_payroll_accrual_sources accrual on accrual.id=source.accrual_source_id
      join public.payroll_periods period on period.id=accrual.period_id
      left join public.financial_transactions transaction_row
        on transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_payment'
       and transaction_row.source_type='financial_payroll_payment_source' and transaction_row.source_id=source.id
      where source.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start),'[]'::jsonb),
    'advances',coalesce((select jsonb_agg(jsonb_build_object(
      'id',source.id,'performer_id',source.performer_id,'cash_or_bank_account_id',source.cash_or_bank_account_id,
      'amount_minor',source.amount_minor,'remaining_minor',public.minuta_payroll_advance_remaining_v136(p_organization,source.id),
      'request_id',source.request_id,'occurred_at',source.occurred_at,'transaction_id',transaction_row.id,
      'reversed',exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
    ) order by source.occurred_at desc,source.id) from public.financial_payroll_advance_sources source
      left join public.financial_transactions transaction_row
        on transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_advance'
       and transaction_row.source_type='financial_payroll_advance_source' and transaction_row.source_id=source.id
      where source.organization_id=p_organization and source.occurred_at::date between p_start and p_end),'[]'::jsonb),
    'advance_offsets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',source.id,'advance_source_id',source.advance_source_id,'accrual_source_id',source.accrual_source_id,
      'performer_id',source.performer_id,'amount_minor',source.amount_minor,'request_id',source.request_id,
      'occurred_at',source.occurred_at,'transaction_id',transaction_row.id,
      'reversed',exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
    ) order by source.occurred_at desc,source.id) from public.financial_payroll_advance_offsets source
      join public.financial_payroll_accrual_sources accrual on accrual.id=source.accrual_source_id
      join public.payroll_periods period on period.id=accrual.period_id
      left join public.financial_transactions transaction_row
        on transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_advance_offset'
       and transaction_row.source_type='financial_payroll_advance_offset' and transaction_row.source_id=source.id
      where source.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start),'[]'::jsonb),
    'debts',coalesce((select jsonb_agg(jsonb_build_object(
      'accrual_source_id',source.id,'period_id',source.period_id,
      'performer_id',(entry->>'performer_id')::uuid,
      'original_minor',debt.original_minor,'settled_minor',debt.settled_minor,'debt_minor',debt.debt_minor
    ) order by source.occurred_at desc,entry->>'performer_id')
      from public.financial_payroll_accrual_sources source
      join public.payroll_periods period on period.id=source.period_id
      cross join lateral jsonb_array_elements(source.breakdown) entry
      cross join lateral public.minuta_payroll_accrual_debt_v136(
        p_organization,source.id,(entry->>'performer_id')::uuid
      ) debt
      join public.financial_transactions transaction_row
        on transaction_row.organization_id=p_organization and transaction_row.operation_type='payroll_accrual'
       and transaction_row.source_type='financial_payroll_accrual_source' and transaction_row.source_id=source.id
      where source.organization_id=p_organization and period.starts_on<=p_end and period.ends_on>=p_start
        and not exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)),'[]'::jsonb)
  );
end
$$;

alter table public.organization_payroll_ledger_settings enable row level security;
alter table public.financial_payroll_adjustment_sources enable row level security;
alter table public.financial_payroll_accrual_sources enable row level security;
alter table public.financial_payroll_payment_sources enable row level security;
alter table public.financial_payroll_advance_sources enable row level security;
alter table public.financial_payroll_advance_offsets enable row level security;

do $policies$
declare v_table text;
begin
  foreach v_table in array array[
    'organization_payroll_ledger_settings','financial_payroll_adjustment_sources',
    'financial_payroll_accrual_sources','financial_payroll_payment_sources',
    'financial_payroll_advance_sources','financial_payroll_advance_offsets'
  ] loop
    execute format('drop policy if exists financial_payroll_manager_read_v136 on public.%I',v_table);
    execute format(
      'create policy financial_payroll_manager_read_v136 on public.%I for select to authenticated using (public.has_organization_role(organization_id,array[''owner'',''admin'']))',
      v_table
    );
  end loop;
end
$policies$;

revoke all on public.organization_payroll_ledger_settings,public.financial_payroll_adjustment_sources,
  public.financial_payroll_accrual_sources,public.financial_payroll_payment_sources,
  public.financial_payroll_advance_sources,public.financial_payroll_advance_offsets
  from public,anon,authenticated;
grant select on public.organization_payroll_ledger_settings,public.financial_payroll_adjustment_sources,
  public.financial_payroll_accrual_sources,public.financial_payroll_payment_sources,
  public.financial_payroll_advance_sources,public.financial_payroll_advance_offsets
  to authenticated;
grant all on public.organization_payroll_ledger_settings,public.financial_payroll_adjustment_sources,
  public.financial_payroll_accrual_sources,public.financial_payroll_payment_sources,
  public.financial_payroll_advance_sources,public.financial_payroll_advance_offsets
  to service_role;

-- The v72 overload has no request id. Keep the function for schema rollback,
-- but remove every browser/server execution path while v136 is installed.
revoke all on function public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text)
  from public,anon,authenticated,service_role;

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

grant execute on function public.set_minuta_payroll_ledger_enabled_v136(uuid,boolean) to authenticated;
grant execute on function public.record_minuta_payroll_adjustment_v136(uuid,uuid,uuid,text,bigint,text,uuid) to authenticated;
grant execute on function public.accrue_minuta_payroll_period_v136(uuid,uuid,timestamptz,uuid) to authenticated;
grant execute on function public.pay_minuta_payroll_debt_v136(uuid,uuid,uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.create_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,timestamptz,uuid) to authenticated;
grant execute on function public.offset_minuta_payroll_advance_v136(uuid,uuid,uuid,bigint,uuid) to authenticated;
grant execute on function public.reverse_minuta_payroll_transaction_v136(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.get_minuta_payroll_ledger_workspace_v136(uuid,date,date) to authenticated;

notify pgrst,'reload schema';
commit;
