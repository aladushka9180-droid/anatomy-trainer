-- v133: default-off customer debt settlement, channel commission and reconciliation for D06.
-- This migration records only explicit staff evidence. It does not infer or execute provider payments.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.financial_suppliers') is null
     or to_regclass('public.financial_expense_sources') is null
     or to_regprocedure('public.set_minuta_finance_enabled_v132(uuid,boolean)') is null
     or to_regprocedure('public.minuta_financial_booking_source_v129(uuid,uuid)') is null
     or to_regprocedure('public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text)') is null then
    raise exception using errcode='55000',message='v133_requires_v129_and_v132_financial_ledger';
  end if;
end
$guard$;

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
  add constraint financial_accounts_account_type_v133_check check(account_type in(
    'cash','bank','receivable','service_revenue','operating_expense','supplier_payable',
    'payment_channel_commission'
  )),
  add constraint financial_accounts_system_key_v133_check check(system_key is null or system_key in(
    'receivable','service_revenue','operating_expense','supplier_payable','payment_channel_commission'
  )),
  add constraint financial_accounts_system_mapping_v133_check check(
    (system_key is null and account_type in('cash','bank') and account_class='asset')
    or (system_key='receivable' and account_type='receivable' and account_class='asset')
    or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')
    or (system_key='operating_expense' and account_type='operating_expense' and account_class='expense')
    or (system_key='supplier_payable' and account_type='supplier_payable' and account_class='liability')
    or (system_key='payment_channel_commission' and account_type='payment_channel_commission'
      and account_class='expense')
  ),
  add constraint financial_accounts_system_request_v133_check check(
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
  add constraint financial_transactions_operation_v133_check check(operation_type in(
    'visit_service','supplier_expense_accrual','supplier_expense_payment','customer_debt_settlement','reversal'
  )),
  add constraint financial_transactions_source_v133_check check(source_type in(
    'booking_outcome','financial_expense_source','financial_debt_settlement_source','financial_transaction'
  )),
  add constraint financial_transactions_shape_v133_check check(
    (operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
    or (operation_type in('supplier_expense_accrual','supplier_expense_payment')
      and source_type='financial_expense_source' and reversal_of is null)
    or (operation_type='customer_debt_settlement'
      and source_type='financial_debt_settlement_source' and reversal_of is null)
    or (operation_type='reversal' and source_type='financial_transaction'
      and reversal_of is not null and source_id=reversal_of)
  );

create table if not exists public.financial_debt_settlement_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  visit_transaction_id uuid not null,
  destination_account_id uuid not null,
  channel text not null check(channel in('cash','bank_transfer')),
  evidence_reference_hash text,
  gross_minor bigint not null check(gross_minor>0 and gross_minor<=100000000000000),
  commission_minor bigint not null check(commission_minor>=0 and commission_minor<gross_minor),
  net_minor bigint not null check(net_minor=gross_minor-commission_minor and net_minor>0),
  currency text not null default 'RUB' check(currency='RUB'),
  occurred_at timestamptz not null,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(visit_transaction_id,organization_id)
    references public.financial_transactions(id,organization_id) on delete restrict,
  foreign key(destination_account_id,organization_id)
    references public.financial_accounts(id,organization_id) on delete restrict,
  check((channel='cash' and evidence_reference_hash is null and commission_minor=0)
    or (channel='bank_transfer' and evidence_reference_hash~'^[0-9a-f]{64}$'))
);

create unique index if not exists financial_debt_settlement_reference_v133_uidx
  on public.financial_debt_settlement_sources(organization_id,channel,evidence_reference_hash)
  where evidence_reference_hash is not null;
create index if not exists financial_debt_settlement_visit_v133_idx
  on public.financial_debt_settlement_sources(organization_id,visit_transaction_id,occurred_at,id);

create or replace function public.protect_minuta_financial_debt_source_v133()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000',message='financial_debt_settlement_source_is_immutable';
end
$$;
revoke all on function public.protect_minuta_financial_debt_source_v133()
  from public,anon,authenticated,service_role;

drop trigger if exists financial_debt_settlement_sources_immutable_v133
  on public.financial_debt_settlement_sources;
create trigger financial_debt_settlement_sources_immutable_v133
before update or delete on public.financial_debt_settlement_sources
for each row execute function public.protect_minuta_financial_debt_source_v133();

create or replace function public.guard_minuta_visit_reversal_v133()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.operation_type='reversal' and new.source_type='financial_transaction'
     and exists(select 1 from public.financial_transactions original
       where original.id=new.reversal_of and original.organization_id=new.organization_id
         and original.operation_type='visit_service')
     and exists(
       select 1 from public.financial_debt_settlement_sources source
       join public.financial_transactions settlement
         on settlement.organization_id=source.organization_id
        and settlement.operation_type='customer_debt_settlement'
        and settlement.source_id=source.id
       where source.organization_id=new.organization_id
         and source.visit_transaction_id=new.reversal_of
         and not exists(select 1 from public.financial_transactions reversal
           where reversal.organization_id=new.organization_id and reversal.reversal_of=settlement.id)
     ) then
    raise exception using errcode='55000',message='customer_debt_settlement_must_be_reversed_first';
  end if;
  return new;
end
$$;
revoke all on function public.guard_minuta_visit_reversal_v133()
  from public,anon,authenticated,service_role;

drop trigger if exists financial_visit_reversal_guard_v133 on public.financial_transactions;
create trigger financial_visit_reversal_guard_v133
before insert on public.financial_transactions
for each row execute function public.guard_minuta_visit_reversal_v133();

create or replace function public.ensure_minuta_commission_account_v133()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.enabled then
    insert into public.financial_accounts(
      organization_id,name,account_class,account_type,system_key,created_by
    ) values(
      new.organization_id,'Комиссии платёжных каналов','expense',
      'payment_channel_commission','payment_channel_commission',new.enabled_by
    ) on conflict(organization_id,system_key) do nothing;
  end if;
  return new;
end
$$;
revoke all on function public.ensure_minuta_commission_account_v133()
  from public,anon,authenticated,service_role;

drop trigger if exists organization_finance_commission_account_v133 on public.organization_finance_settings;
create trigger organization_finance_commission_account_v133
after insert or update of enabled on public.organization_finance_settings
for each row execute function public.ensure_minuta_commission_account_v133();

insert into public.financial_accounts(
  organization_id,name,account_class,account_type,system_key,created_by
)
select setting.organization_id,'Комиссии платёжных каналов','expense',
  'payment_channel_commission','payment_channel_commission',setting.enabled_by
from public.organization_finance_settings setting
where setting.enabled
on conflict(organization_id,system_key) do nothing;

create or replace function public.set_minuta_finance_enabled_v133(
  p_organization uuid,p_enabled boolean
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_result jsonb; v_commission uuid;
begin
  v_result:=public.set_minuta_finance_enabled_v132(p_organization,p_enabled);
  if p_enabled then
    select account.id into v_commission from public.financial_accounts account
      where account.organization_id=p_organization
        and account.system_key='payment_channel_commission'
        and account.account_class='expense'
        and account.account_type='payment_channel_commission' and account.active;
    if v_commission is null then
      raise exception using errcode='55000',message='financial_commission_account_missing';
    end if;
  end if;
  return v_result||jsonb_build_object('payment_channel_commission_account_id',v_commission);
end
$$;

create or replace function public.settle_minuta_customer_debt_v133(
  p_organization uuid,p_visit_transaction uuid,p_destination_account uuid,
  p_channel text,p_evidence_reference_hash text,p_commission_minor bigint,
  p_occurred_at timestamptz,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_visit public.financial_transactions%rowtype;
  v_destination public.financial_accounts%rowtype;
  v_source public.financial_debt_settlement_sources%rowtype;
  v_existing public.financial_transactions%rowtype;
  v_receivable uuid;
  v_commission_account uuid;
  v_original_debt bigint;
  v_settled bigint;
  v_outstanding bigint;
  v_request_fingerprint text;
  v_source_fingerprint text;
  v_transaction uuid;
  v_booking_source record;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  p_channel:=btrim(coalesce(p_channel,''));
  p_evidence_reference_hash:=nullif(lower(btrim(coalesce(p_evidence_reference_hash,''))), '');
  if p_visit_transaction is null or p_destination_account is null or p_request_id is null
     or p_occurred_at is null or p_commission_minor is null
     or p_channel not in('cash','bank_transfer')
     or (p_channel='cash' and (p_evidence_reference_hash is not null or p_commission_minor<>0))
     or (p_channel='bank_transfer' and (p_evidence_reference_hash is null
       or p_evidence_reference_hash!~'^[0-9a-f]{64}$'))
     or p_commission_minor<0 then
    raise exception using errcode='22023',message='invalid_customer_debt_settlement';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization::text||':visit-transaction:'||p_visit_transaction::text,133));

  select * into v_source from public.financial_debt_settlement_sources source
    where source.organization_id=p_organization and source.request_id=p_request_id for update;
  perform 1 from public.organization_finance_settings setting
    where setting.organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select setting.enabled from public.organization_finance_settings setting
      where setting.organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_source.id is not null then
    v_source_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
      'financial_debt_settlement_source_v133',p_organization,p_visit_transaction,
      p_destination_account,p_channel,p_evidence_reference_hash,v_source.gross_minor,
      p_commission_minor,p_occurred_at
    ));
    v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
      p_organization,p_request_id,'customer_debt_settlement',v_source_fingerprint
    ));
    if v_source.request_fingerprint<>v_request_fingerprint
       or v_source.source_fingerprint<>v_source_fingerprint then
      raise exception using errcode='23505',message='customer_debt_settlement_idempotency_conflict';
    end if;
    select * into v_existing from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization
        and transaction_row.request_id=p_request_id for update;
    if v_existing.id is null or v_existing.operation_type<>'customer_debt_settlement'
       or v_existing.source_id<>v_source.id then
      raise exception using errcode='55000',message='customer_debt_settlement_replay_incomplete';
    end if;
    return jsonb_build_object('id',v_source.id,'transaction_id',v_existing.id,
      'organization_id',p_organization,'gross_minor',v_source.gross_minor,
      'commission_minor',v_source.commission_minor,'net_minor',v_source.net_minor,
      'currency','RUB','reversed',exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=v_existing.id),
      'replayed',true);
  end if;
  select * into v_visit from public.financial_transactions transaction_row
    where transaction_row.id=p_visit_transaction and transaction_row.organization_id=p_organization for update;
  select * into v_destination from public.financial_accounts account
    where account.id=p_destination_account and account.organization_id=p_organization for update;
  select account.id into v_receivable from public.financial_accounts account
    where account.organization_id=p_organization and account.system_key='receivable'
      and account.account_class='asset' and account.account_type='receivable' and account.active for update;
  select account.id into v_commission_account from public.financial_accounts account
    where account.organization_id=p_organization and account.system_key='payment_channel_commission'
      and account.account_class='expense' and account.account_type='payment_channel_commission'
      and account.active for update;
  if v_visit.id is null or v_visit.operation_type<>'visit_service'
     or v_visit.source_type<>'booking_outcome' then
    raise exception using errcode='P0002',message='financial_visit_transaction_not_found';
  end if;
  if exists(select 1 from public.financial_transactions reversal
      where reversal.organization_id=p_organization and reversal.reversal_of=v_visit.id) then
    raise exception using errcode='55000',message='financial_visit_transaction_reversed';
  end if;
  if p_occurred_at<v_visit.occurred_at or p_occurred_at>now()+interval '5 minutes' then
    raise exception using errcode='22023',message='invalid_customer_debt_settlement_time';
  end if;
  select * into v_booking_source
    from public.minuta_financial_booking_source_v129(p_organization,v_visit.source_id);
  if v_booking_source.source_fingerprint is null
     or v_booking_source.source_fingerprint<>v_visit.source_fingerprint
     or v_booking_source.blocked_reason is not null then
    raise exception using errcode='55000',message='financial_visit_source_drift';
  end if;
  if v_destination.id is null or not v_destination.active or v_destination.system_key is not null
     or (p_channel='cash' and v_destination.account_type<>'cash')
     or (p_channel='bank_transfer' and v_destination.account_type<>'bank') then
    raise exception using errcode='22023',message='customer_debt_destination_account_mismatch';
  end if;
  if v_receivable is null or v_commission_account is null then
    raise exception using errcode='55000',message='financial_debt_system_accounts_missing';
  end if;

  select coalesce(sum(case posting.side when 'debit' then posting.amount_minor else -posting.amount_minor end),0)::bigint
  into v_original_debt from public.financial_postings posting
  where posting.transaction_id=v_visit.id and posting.account_id=v_receivable;
  select coalesce(sum(source.gross_minor),0)::bigint into v_settled
  from public.financial_debt_settlement_sources source
  join public.financial_transactions settlement
    on settlement.organization_id=source.organization_id
   and settlement.operation_type='customer_debt_settlement'
   and settlement.source_type='financial_debt_settlement_source'
   and settlement.source_id=source.id
  where source.organization_id=p_organization and source.visit_transaction_id=v_visit.id
    and not exists(select 1 from public.financial_transactions reversal
      where reversal.organization_id=p_organization and reversal.reversal_of=settlement.id);
  v_outstanding:=v_original_debt-v_settled;

  v_source_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'financial_debt_settlement_source_v133',p_organization,p_visit_transaction,
    p_destination_account,p_channel,p_evidence_reference_hash,
    coalesce(v_source.gross_minor,v_outstanding),
    p_commission_minor,p_occurred_at
  ));
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'customer_debt_settlement',v_source_fingerprint
  ));
  if v_outstanding<=0 then
    raise exception using errcode='23505',message='customer_debt_already_settled';
  end if;
  if p_commission_minor>=v_outstanding then
    raise exception using errcode='22023',message='invalid_customer_debt_commission';
  end if;
  if exists(select 1 from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization and transaction_row.request_id=p_request_id) then
    raise exception using errcode='23505',message='customer_debt_settlement_idempotency_conflict';
  end if;
  if p_evidence_reference_hash is not null and exists(
    select 1 from public.financial_debt_settlement_sources source
    where source.organization_id=p_organization and source.channel=p_channel
      and source.evidence_reference_hash=p_evidence_reference_hash
  ) then
    raise exception using errcode='23505',message='customer_debt_reference_conflict';
  end if;

  insert into public.financial_debt_settlement_sources(
    organization_id,visit_transaction_id,destination_account_id,channel,evidence_reference_hash,
    gross_minor,commission_minor,net_minor,occurred_at,request_id,request_fingerprint,
    source_fingerprint,created_by
  ) values(
    p_organization,p_visit_transaction,p_destination_account,p_channel,p_evidence_reference_hash,
    v_outstanding,p_commission_minor,v_outstanding-p_commission_minor,p_occurred_at,p_request_id,
    v_request_fingerprint,v_source_fingerprint,v_actor
  ) returning * into v_source;
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'customer_debt_settlement',
    'financial_debt_settlement_source',v_source.id,v_source.source_fingerprint,p_occurred_at,
    jsonb_build_object('schema','minuta-financial-explanation-v1',
      'source_kind','financial_debt_settlement_source','source_id',v_source.id,
      'visit_transaction_id',p_visit_transaction,'booking_id',v_visit.source_id,
      'destination_account_id',p_destination_account,'channel',p_channel,
      'evidence_reference_hash',p_evidence_reference_hash,'evidence_kind','staff_recorded_debt_settlement',
      'gross_minor',v_source.gross_minor,'commission_minor',v_source.commission_minor,
      'net_minor',v_source.net_minor,'currency','RUB'),v_actor
  ) returning id into v_transaction;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,p_destination_account,'debit',v_source.net_minor);
  if v_source.commission_minor>0 then
    insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
    values(p_organization,v_transaction,v_commission_account,'debit',v_source.commission_minor);
  end if;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,v_receivable,'credit',v_source.gross_minor);
  return jsonb_build_object('id',v_source.id,'transaction_id',v_transaction,
    'organization_id',p_organization,'gross_minor',v_source.gross_minor,
    'commission_minor',v_source.commission_minor,'net_minor',v_source.net_minor,
    'currency','RUB','reversed',false,'replayed',false);
end
$$;

create or replace function public.reverse_minuta_customer_debt_settlement_v133(
  p_organization uuid,p_transaction uuid,p_request_id uuid,p_reason_code text
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
     or p_reason_code not in('payment_corrected','duplicate_entry','account_correction') then
    raise exception using errcode='22023',message='invalid_customer_debt_reversal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization::text||':transaction:'||p_transaction::text,129));
  select * into v_original from public.financial_transactions transaction_row
    where transaction_row.id=p_transaction and transaction_row.organization_id=p_organization for update;
  if v_original.id is null or v_original.operation_type<>'customer_debt_settlement' then
    raise exception using errcode='P0002',message='customer_debt_settlement_not_reversible';
  end if;
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'reversal',p_transaction,p_reason_code,v_original.source_fingerprint
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
    if v_existing.request_fingerprint<>v_request_fingerprint then
      raise exception using errcode='23505',message='customer_debt_reversal_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'request_id',p_request_id,'reversal_of',p_transaction,'replayed',true);
  end if;
  if exists(select 1 from public.financial_transactions reversal
      where reversal.organization_id=p_organization and reversal.reversal_of=p_transaction) then
    raise exception using errcode='23505',message='customer_debt_settlement_already_reversed';
  end if;
  v_source_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'reversal',p_transaction,v_original.source_fingerprint,p_reason_code
  ));
  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,reversal_of,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'reversal','financial_transaction',p_transaction,
    v_source_fingerprint,p_transaction,now(),jsonb_build_object(
      'schema','minuta-financial-explanation-v1','source_kind','financial_transaction',
      'source_id',p_transaction,'evidence_kind','explicit_reversal','reason_code',p_reason_code,
      'original_operation_type','customer_debt_settlement'),v_actor
  ) returning id into v_reversal;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  select p_organization,v_reversal,posting.account_id,
    case posting.side when 'debit' then 'credit' else 'debit' end,posting.amount_minor
  from public.financial_postings posting where posting.transaction_id=p_transaction;
  return jsonb_build_object('id',v_reversal,'organization_id',p_organization,
    'request_id',p_request_id,'reversal_of',p_transaction,'replayed',false);
end
$$;

create or replace function public.reverse_minuta_visit_finance_v133(
  p_organization uuid,p_transaction uuid,p_request_id uuid,p_reason_code text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  if exists(
    select 1 from public.financial_debt_settlement_sources source
    join public.financial_transactions settlement
      on settlement.organization_id=source.organization_id
     and settlement.operation_type='customer_debt_settlement'
     and settlement.source_id=source.id
    where source.organization_id=p_organization and source.visit_transaction_id=p_transaction
      and not exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=settlement.id)
  ) then
    raise exception using errcode='55000',message='customer_debt_settlement_must_be_reversed_first';
  end if;
  return public.reverse_minuta_financial_transaction_v129(
    p_organization,p_transaction,p_request_id,p_reason_code
  );
end
$$;

create or replace function public.get_minuta_financial_reconciliation_v133(
  p_organization uuid,p_limit integer default 100
)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_debit bigint;
  v_credit bigint;
  v_posting_unresolved integer;
  v_source_unresolved integer;
  v_unposted integer;
begin
  if p_limit is null or p_limit<1 or p_limit>500 then
    raise exception using errcode='22023',message='invalid_financial_reconciliation_limit';
  end if;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  select coalesce(sum(posting.amount_minor) filter(where posting.side='debit'),0)::bigint,
    coalesce(sum(posting.amount_minor) filter(where posting.side='credit'),0)::bigint
  into v_debit,v_credit from public.financial_postings posting
  where posting.organization_id=p_organization;
  select count(*)::integer into v_posting_unresolved from (
    select transaction_row.id
    from public.financial_transactions transaction_row
    left join public.financial_postings posting on posting.transaction_id=transaction_row.id
    where transaction_row.organization_id=p_organization
    group by transaction_row.id
    having count(posting.id)<2
      or coalesce(sum(posting.amount_minor) filter(where posting.side='debit'),0)
        <>coalesce(sum(posting.amount_minor) filter(where posting.side='credit'),0)
  ) unresolved;
  select coalesce(sum(case
    when transaction_row.operation_type='visit_service'
      and not exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
      and (
      booking_now.source_fingerprint is null
      or booking_now.source_fingerprint<>transaction_row.source_fingerprint
      or booking_now.blocked_reason is not null) then 1
    when transaction_row.source_type='financial_expense_source' and (
      expense_source.id is null or expense_source.source_fingerprint<>transaction_row.source_fingerprint) then 1
    when transaction_row.source_type='financial_debt_settlement_source' and (
      debt_source.id is null or debt_source.source_fingerprint<>transaction_row.source_fingerprint) then 1
    when transaction_row.operation_type='reversal' and original.id is null then 1
    else 0 end),0)::integer into v_source_unresolved
  from public.financial_transactions transaction_row
  left join lateral public.minuta_financial_booking_source_v129(
    p_organization,transaction_row.source_id
  ) booking_now on transaction_row.operation_type='visit_service'
  left join public.financial_expense_sources expense_source
    on transaction_row.source_type='financial_expense_source'
   and expense_source.organization_id=p_organization and expense_source.id=transaction_row.source_id
  left join public.financial_debt_settlement_sources debt_source
    on transaction_row.source_type='financial_debt_settlement_source'
   and debt_source.organization_id=p_organization and debt_source.id=transaction_row.source_id
  left join public.financial_transactions original
    on transaction_row.operation_type='reversal' and original.organization_id=p_organization
   and original.id=transaction_row.reversal_of
  where transaction_row.organization_id=p_organization;
  select count(*)::integer into v_unposted
  from public.bookings booking
  join public.booking_outcomes outcome on outcome.booking_id=booking.id
  join lateral public.minuta_financial_booking_source_v129(p_organization,booking.id) source_now on true
  where booking.organization_id=p_organization and source_now.blocked_reason is null
    and not exists(select 1 from public.financial_transactions visit
      where visit.organization_id=p_organization and visit.operation_type='visit_service'
        and visit.source_type='booking_outcome' and visit.source_id=booking.id
        and not exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=visit.id));
  return jsonb_build_object(
    'schema','minuta-financial-reconciliation-v1','organization_id',p_organization,
    'generated_at',now(),'ledger_state',case when v_posting_unresolved=0 and v_source_unresolved=0 and v_unposted=0
      and v_debit=v_credit then 'matched' else 'drift' end,
    'unresolved_count',v_posting_unresolved+v_source_unresolved+v_unposted,
    'posting_unresolved_count',v_posting_unresolved,'source_unresolved_count',v_source_unresolved,
    'unposted_count',v_unposted,
    'debit_total_minor',v_debit,'credit_total_minor',v_credit,
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',account.id,'name',account.name,'account_class',account.account_class,
      'account_type',account.account_type,'system_key',account.system_key,'active',account.active,
      'debit_minor',coalesce(balance.debit_minor,0),'credit_minor',coalesce(balance.credit_minor,0),
      'natural_balance_minor',case when account.account_class in('asset','expense')
        then coalesce(balance.debit_minor,0)-coalesce(balance.credit_minor,0)
        else coalesce(balance.credit_minor,0)-coalesce(balance.debit_minor,0) end
    ) order by account.system_key nulls last,account.name,account.id)
      from public.financial_accounts account
      left join lateral(select
        coalesce(sum(posting.amount_minor) filter(where posting.side='debit'),0)::bigint debit_minor,
        coalesce(sum(posting.amount_minor) filter(where posting.side='credit'),0)::bigint credit_minor
        from public.financial_postings posting where posting.account_id=account.id) balance on true
      where account.organization_id=p_organization),'[]'::jsonb),
    'unposted_visits',coalesce((select jsonb_agg(row.payload order by row.source_updated_at,row.booking_id)
      from (select booking.id booking_id,source_now.source_updated_at,jsonb_build_object(
        'booking_id',booking.id,'source_fingerprint',source_now.source_fingerprint,
        'service_value_minor',source_now.service_value_minor,'received_minor',source_now.received_minor,
        'debt_minor',source_now.debt_minor,'payment_method',source_now.payment_method,
        'source_updated_at',source_now.source_updated_at,'source_state','unposted'
      ) payload
      from public.bookings booking
      join public.booking_outcomes outcome on outcome.booking_id=booking.id
      join lateral public.minuta_financial_booking_source_v129(p_organization,booking.id) source_now on true
      where booking.organization_id=p_organization and source_now.blocked_reason is null
        and not exists(select 1 from public.financial_transactions visit
          where visit.organization_id=p_organization and visit.operation_type='visit_service'
            and visit.source_type='booking_outcome' and visit.source_id=booking.id
            and not exists(select 1 from public.financial_transactions reversal
              where reversal.organization_id=p_organization and reversal.reversal_of=visit.id))
      order by source_now.source_updated_at,booking.id limit p_limit) row),'[]'::jsonb),
    'debts',coalesce((select jsonb_agg(jsonb_build_object(
      'visit_transaction_id',visit.id,'booking_id',visit.source_id,'source_state',
        case when source_now.source_fingerprint is null then 'source_missing'
          when source_now.blocked_reason is not null then 'blocked'
          when source_now.source_fingerprint<>visit.source_fingerprint then 'drift' else 'matched' end,
      'source_blocked_reason',source_now.blocked_reason,
      'original_minor',debt.original_minor,'settled_minor',coalesce(settlement.settled_minor,0),
      'outstanding_minor',case when exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=visit.id) then 0
        else greatest(debt.original_minor-coalesce(settlement.settled_minor,0),0) end,
      'reversed',exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=visit.id)
    ) order by visit.occurred_at desc,visit.id desc)
      from public.financial_transactions visit
      join lateral(select coalesce(sum(case posting.side when 'debit' then posting.amount_minor
        else -posting.amount_minor end),0)::bigint original_minor
        from public.financial_postings posting join public.financial_accounts account on account.id=posting.account_id
        where posting.transaction_id=visit.id and account.system_key='receivable') debt on debt.original_minor>0
      left join lateral(select coalesce(sum(source.gross_minor),0)::bigint settled_minor
        from public.financial_debt_settlement_sources source
        join public.financial_transactions settlement on settlement.source_id=source.id
          and settlement.organization_id=source.organization_id
          and settlement.operation_type='customer_debt_settlement'
        where source.organization_id=p_organization and source.visit_transaction_id=visit.id
          and not exists(select 1 from public.financial_transactions reversal
            where reversal.organization_id=p_organization and reversal.reversal_of=settlement.id)) settlement on true
      left join lateral public.minuta_financial_booking_source_v129(p_organization,visit.source_id) source_now on true
      where visit.organization_id=p_organization and visit.operation_type='visit_service'),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(row.payload order by row.occurred_at desc,row.id desc)
      from (select transaction_row.occurred_at,transaction_row.id,jsonb_build_object(
        'id',transaction_row.id,'operation_type',transaction_row.operation_type,
        'source_type',transaction_row.source_type,'source_id',transaction_row.source_id,
        'reversal_of',transaction_row.reversal_of,'occurred_at',transaction_row.occurred_at,
        'explanation',transaction_row.explanation,
        'source_state',case
          when transaction_row.operation_type='visit_service' then case
            when booking_now.source_fingerprint is null then 'source_missing'
            when booking_now.blocked_reason is not null then 'blocked'
            when booking_now.source_fingerprint<>transaction_row.source_fingerprint then 'drift' else 'matched' end
          when transaction_row.source_type='financial_expense_source' then case
            when expense_source.id is null then 'source_missing'
            when expense_source.source_fingerprint<>transaction_row.source_fingerprint then 'drift' else 'matched' end
          when transaction_row.source_type='financial_debt_settlement_source' then case
            when debt_source.id is null then 'source_missing'
            when debt_source.source_fingerprint<>transaction_row.source_fingerprint then 'drift' else 'matched' end
          when transaction_row.operation_type='reversal' then case when original.id is null then 'source_missing' else 'matched' end
          else 'source_missing' end,
        'source_blocked_reason',case when transaction_row.operation_type='visit_service'
          then booking_now.blocked_reason else null end,
        'posting_state',case when posting_state.posting_count=0 then 'missing'
          when posting_state.posting_count<2 or posting_state.debit_minor<>posting_state.credit_minor then 'drift'
          else 'matched' end,
        'postings',coalesce(posting_state.postings,'[]'::jsonb)
      ) payload
      from public.financial_transactions transaction_row
      left join lateral public.minuta_financial_booking_source_v129(
        p_organization,transaction_row.source_id
      ) booking_now on transaction_row.operation_type='visit_service'
      left join public.financial_expense_sources expense_source
        on transaction_row.source_type='financial_expense_source'
       and expense_source.organization_id=p_organization and expense_source.id=transaction_row.source_id
      left join public.financial_debt_settlement_sources debt_source
        on transaction_row.source_type='financial_debt_settlement_source'
       and debt_source.organization_id=p_organization and debt_source.id=transaction_row.source_id
      left join public.financial_transactions original
        on transaction_row.operation_type='reversal' and original.organization_id=p_organization
       and original.id=transaction_row.reversal_of
      left join lateral(select count(posting.id)::integer posting_count,
        coalesce(sum(posting.amount_minor) filter(where posting.side='debit'),0)::bigint debit_minor,
        coalesce(sum(posting.amount_minor) filter(where posting.side='credit'),0)::bigint credit_minor,
        jsonb_agg(jsonb_build_object('account_id',posting.account_id,'side',posting.side,
          'amount_minor',posting.amount_minor) order by posting.id) postings
        from public.financial_postings posting where posting.transaction_id=transaction_row.id) posting_state on true
      where transaction_row.organization_id=p_organization
      order by transaction_row.occurred_at desc,transaction_row.id desc limit p_limit) row),'[]'::jsonb)
  );
end
$$;

alter table public.financial_debt_settlement_sources enable row level security;
drop policy if exists financial_debt_settlement_sources_manager_read_v133
  on public.financial_debt_settlement_sources;
create policy financial_debt_settlement_sources_manager_read_v133
  on public.financial_debt_settlement_sources for select to authenticated
  using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on public.financial_debt_settlement_sources from public,anon,authenticated,service_role;
grant select on public.financial_debt_settlement_sources to authenticated;

revoke all on function public.set_minuta_finance_enabled_v133(uuid,boolean)
  from public,anon,authenticated,service_role;
revoke all on function public.settle_minuta_customer_debt_v133(uuid,uuid,uuid,text,text,bigint,timestamptz,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_customer_debt_settlement_v133(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_visit_finance_v133(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_financial_reconciliation_v133(uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_finance_enabled_v133(uuid,boolean) to authenticated;
grant execute on function public.settle_minuta_customer_debt_v133(uuid,uuid,uuid,text,text,bigint,timestamptz,uuid)
  to authenticated;
grant execute on function public.reverse_minuta_customer_debt_settlement_v133(uuid,uuid,uuid,text)
  to authenticated;
grant execute on function public.reverse_minuta_visit_finance_v133(uuid,uuid,uuid,text)
  to authenticated;
grant execute on function public.get_minuta_financial_reconciliation_v133(uuid,integer)
  to authenticated;

notify pgrst,'reload schema';
commit;
