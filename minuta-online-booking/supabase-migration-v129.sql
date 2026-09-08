-- v129: default-off, organization-scoped double-entry foundation for D06.
-- This slice records only an explicitly completed manual visit. It does not
-- infer bank settlement, provider payment, inventory cost or payroll payment.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.payment_provider_attempts') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v129_requires_v87_and_v123_financial_prerequisites';
  end if;
end
$guard$;

create table if not exists public.organization_finance_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check((enabled and enabled_at is not null) or not enabled)
);

create table if not exists public.financial_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check(char_length(btrim(name)) between 2 and 120),
  account_class text not null check(account_class in('asset','liability','income','expense')),
  account_type text not null check(account_type in('cash','bank','receivable','service_revenue')),
  currency text not null default 'RUB' check(currency='RUB'),
  system_key text check(system_key is null or system_key in('receivable','service_revenue')),
  active boolean not null default true,
  creation_request_id uuid,
  request_fingerprint text check(request_fingerprint is null or request_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,system_key),
  unique(organization_id,creation_request_id),
  check((system_key is null and account_type in('cash','bank') and account_class='asset')
     or (system_key='receivable' and account_type='receivable' and account_class='asset')
     or (system_key='service_revenue' and account_type='service_revenue' and account_class='income')),
  check((creation_request_id is null)=(request_fingerprint is null)),
  check((system_key is null)=(creation_request_id is not null))
);

create index if not exists financial_accounts_scope_idx
  on public.financial_accounts(organization_id,active,account_type,name,id);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  operation_type text not null check(operation_type in('visit_service','reversal')),
  source_type text not null check(source_type in('booking_outcome','financial_transaction')),
  source_id uuid not null,
  source_fingerprint text not null check(source_fingerprint~'^[0-9a-f]{64}$'),
  reversal_of uuid,
  occurred_at timestamptz not null,
  explanation jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  unique(organization_id,reversal_of),
  foreign key(reversal_of,organization_id)
    references public.financial_transactions(id,organization_id) on delete restrict,
  check(jsonb_typeof(explanation)='object'),
  check((operation_type='visit_service' and source_type='booking_outcome' and reversal_of is null)
     or (operation_type='reversal' and source_type='financial_transaction'
       and reversal_of is not null and source_id=reversal_of))
);

create index if not exists financial_transactions_scope_idx
  on public.financial_transactions(organization_id,occurred_at desc,created_at desc,id);
create index if not exists financial_transactions_source_idx
  on public.financial_transactions(organization_id,source_type,source_id,created_at desc,id);

create table if not exists public.financial_postings (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  transaction_id uuid not null,
  account_id uuid not null,
  side text not null check(side in('debit','credit')),
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000000),
  created_at timestamptz not null default now(),
  foreign key(transaction_id,organization_id)
    references public.financial_transactions(id,organization_id) on delete restrict,
  foreign key(account_id,organization_id)
    references public.financial_accounts(id,organization_id) on delete restrict,
  unique(transaction_id,account_id,side)
);

create index if not exists financial_postings_scope_idx
  on public.financial_postings(organization_id,account_id,created_at desc,id desc);

create or replace function public.protect_minuta_financial_ledger_v129()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000',message='financial_ledger_is_append_only';
end
$$;

drop trigger if exists financial_transactions_immutable_v129 on public.financial_transactions;
create trigger financial_transactions_immutable_v129
before update or delete on public.financial_transactions
for each row execute function public.protect_minuta_financial_ledger_v129();
drop trigger if exists financial_postings_immutable_v129 on public.financial_postings;
create trigger financial_postings_immutable_v129
before update or delete on public.financial_postings
for each row execute function public.protect_minuta_financial_ledger_v129();

create or replace function public.assert_minuta_financial_transaction_balanced_v129()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_transaction uuid:=coalesce(new.id,old.id);
  v_count integer;
  v_debit numeric;
  v_credit numeric;
begin
  select count(*),coalesce(sum(amount_minor) filter(where side='debit'),0),
    coalesce(sum(amount_minor) filter(where side='credit'),0)
  into v_count,v_debit,v_credit
  from public.financial_postings where transaction_id=v_transaction;
  if v_count<2 or v_debit<>v_credit then
    raise exception using errcode='23514',message='financial_transaction_not_balanced';
  end if;
  return null;
end
$$;

create or replace function public.assert_minuta_financial_postings_balanced_v129()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
  v_transaction uuid:=coalesce(new.transaction_id,old.transaction_id);
  v_old_transaction uuid:=case when tg_op='UPDATE' then old.transaction_id else null end;
  v_count integer;
  v_debit numeric;
  v_credit numeric;
begin
  select count(*),coalesce(sum(amount_minor) filter(where side='debit'),0),
    coalesce(sum(amount_minor) filter(where side='credit'),0)
  into v_count,v_debit,v_credit
  from public.financial_postings where transaction_id=v_transaction;
  if v_count<2 or v_debit<>v_credit then
    raise exception using errcode='23514',message='financial_transaction_not_balanced';
  end if;
  if v_old_transaction is not null and v_old_transaction<>v_transaction then
    select count(*),coalesce(sum(amount_minor) filter(where side='debit'),0),
      coalesce(sum(amount_minor) filter(where side='credit'),0)
    into v_count,v_debit,v_credit
    from public.financial_postings where transaction_id=v_old_transaction;
    if v_count<2 or v_debit<>v_credit then
      raise exception using errcode='23514',message='financial_transaction_not_balanced';
    end if;
  end if;
  return null;
end
$$;

drop trigger if exists financial_transactions_balanced_v129 on public.financial_transactions;
create constraint trigger financial_transactions_balanced_v129
after insert or update on public.financial_transactions
deferrable initially deferred for each row
execute function public.assert_minuta_financial_transaction_balanced_v129();
drop trigger if exists financial_postings_balanced_v129 on public.financial_postings;
create constraint trigger financial_postings_balanced_v129
after insert or update or delete on public.financial_postings
deferrable initially deferred for each row
execute function public.assert_minuta_financial_postings_balanced_v129();

create or replace function public.minuta_financial_sha256_v129(p_value jsonb)
returns text language sql immutable security definer set search_path to '' as $$
  select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;

create or replace function public.require_minuta_financial_manager_v129(p_organization uuid)
returns uuid language plpgsql volatile security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_allowed boolean:=false;
begin
  if v_actor is not null then
    select membership.active and membership.role in('owner','admin') and organization.status='active'
    into v_allowed
    from public.organization_memberships membership
    join public.organizations organization on organization.id=membership.organization_id
    where membership.organization_id=p_organization and membership.user_id=v_actor
    for update of membership;
  end if;
  if not coalesce(v_allowed,false) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  return v_actor;
end
$$;

create or replace function public.minuta_financial_booking_source_v129(
  p_organization uuid,p_booking uuid
)
returns table(
  booking_id uuid,source_fingerprint text,service_value_minor bigint,received_minor bigint,
  debt_minor bigint,payment_method text,completion_source text,source_updated_at timestamptz,
  blocked_reason text
)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_booking record;
  v_service_minor bigint;
  v_received_minor bigint;
  v_provider_payment boolean:=false;
  v_fingerprint text;
  v_blocked text;
begin
  select booking.id,booking.organization_id,booking.status,booking.payment_status,
    booking.deposit_amount_rub,outcome.visit_status,outcome.payment_method,outcome.amount_rub,
    outcome.calculated_amount_rub,outcome.completion_source,outcome.updated_at
  into v_booking
  from public.bookings booking
  join public.booking_outcomes outcome on outcome.booking_id=booking.id
  where booking.id=p_booking and booking.organization_id=p_organization;

  if not found then
    return query select p_booking,null::text,null::bigint,null::bigint,null::bigint,
      null::text,null::text,null::timestamptz,'booking_or_outcome_not_found'::text;
    return;
  end if;

  v_service_minor:=case when v_booking.calculated_amount_rub is null then null
    else v_booking.calculated_amount_rub::bigint*100 end;
  v_received_minor:=coalesce(v_booking.amount_rub,0)::bigint*100;
  v_provider_payment:=v_booking.payment_status is distinct from 'not_required'
    or coalesce(v_booking.deposit_amount_rub,0)>0
    or exists(select 1 from public.payments payment
      where payment.booking_id=p_booking and payment.status in('paid','refunded'))
    or exists(select 1 from public.payment_provider_attempts attempt
      where attempt.organization_id=p_organization and attempt.booking_id=p_booking
        and attempt.captured_amount_minor>0);
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_booking,v_booking.status,v_booking.payment_status,v_booking.deposit_amount_rub,
    v_booking.visit_status,v_booking.payment_method,v_booking.amount_rub,
    v_booking.calculated_amount_rub,v_booking.completion_source,v_booking.updated_at
  ));

  v_blocked:=case
    when v_booking.status='cancelled' then 'booking_cancelled'
    when v_booking.visit_status<>'completed' then 'visit_not_completed'
    when v_booking.completion_source<>'manual' then 'manual_completion_required'
    when v_booking.payment_method='card' then 'card_requires_provider_adapter'
    when v_booking.payment_method not in('cash','transfer','unpaid') then 'unsupported_payment_method'
    when v_provider_payment then 'provider_payment_requires_adapter'
    when v_service_minor is null or v_service_minor<=0 then 'service_value_unavailable'
    when v_received_minor<0 then 'invalid_received_amount'
    when v_booking.payment_method='unpaid' and v_received_minor<>0 then 'unpaid_amount_mismatch'
    when v_booking.payment_method<>'unpaid' and v_received_minor<=0 then 'received_amount_required'
    when v_received_minor>v_service_minor then 'overpayment_requires_advance_account'
    else null end;

  return query select p_booking,v_fingerprint,v_service_minor,v_received_minor,
    greatest(coalesce(v_service_minor,0)-v_received_minor,0),v_booking.payment_method,
    v_booking.completion_source,v_booking.updated_at,v_blocked;
end
$$;

create or replace function public.set_minuta_finance_enabled_v129(
  p_organization uuid,p_enabled boolean
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_enabled is null then raise exception using errcode='22023',message='invalid_finance_setting'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform 1 from public.organization_finance_settings where organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  insert into public.organization_finance_settings(organization_id,enabled,enabled_at,enabled_by,updated_at)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then v_actor end,now())
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_finance_settings.enabled_at,excluded.enabled_at) end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_finance_settings.enabled_by,excluded.enabled_by) end,
    updated_at=excluded.updated_at;
  if p_enabled then
    insert into public.financial_accounts(organization_id,name,account_class,account_type,system_key,created_by)
    values
      (p_organization,'Дебиторская задолженность','asset','receivable','receivable',v_actor),
      (p_organization,'Выручка от услуг','income','service_revenue','service_revenue',v_actor)
    on conflict(organization_id,system_key) do nothing;
  end if;
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end
$$;

create or replace function public.create_minuta_financial_account_v129(
  p_organization uuid,p_request_id uuid,p_name text,p_account_type text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_fingerprint text;
  v_account public.financial_accounts%rowtype;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_request_id is null or char_length(v_name) not between 2 and 120
     or p_account_type not in('cash','bank') then
    raise exception using errcode='22023',message='invalid_financial_account';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,v_name,p_account_type,'RUB'
  ));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  select * into v_account from public.financial_accounts
  where organization_id=p_organization and creation_request_id=p_request_id for update;
  perform 1 from public.organization_finance_settings where organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_account.id is not null then
    if v_account.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='financial_account_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_account.id,'organization_id',p_organization,
      'name',v_account.name,'account_type',v_account.account_type,'currency',v_account.currency,'replayed',true);
  end if;
  insert into public.financial_accounts(
    organization_id,name,account_class,account_type,creation_request_id,request_fingerprint,created_by
  ) values(p_organization,v_name,'asset',p_account_type,p_request_id,v_fingerprint,v_actor)
  returning * into v_account;
  return jsonb_build_object('id',v_account.id,'organization_id',p_organization,
    'name',v_account.name,'account_type',v_account.account_type,'currency',v_account.currency,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='financial_account_idempotency_conflict';
end
$$;

create or replace function public.post_minuta_visit_finance_v129(
  p_organization uuid,p_booking uuid,p_destination_account uuid,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_source record;
  v_destination public.financial_accounts%rowtype;
  v_receivable uuid;
  v_revenue uuid;
  v_request_fingerprint text;
  v_existing public.financial_transactions%rowtype;
  v_transaction uuid;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_booking is null or p_request_id is null then
    raise exception using errcode='22023',message='invalid_financial_visit_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':booking:'||p_booking::text,129));
  perform 1 from public.bookings where id=p_booking and organization_id=p_organization for update;
  select * into v_source from public.minuta_financial_booking_source_v129(p_organization,p_booking);
  if v_source.blocked_reason is not null then
    raise exception using errcode='55000',message=v_source.blocked_reason;
  end if;

  if v_source.received_minor>0 then
    if p_destination_account is null then
      raise exception using errcode='22023',message='destination_account_required';
    end if;
    select * into v_destination from public.financial_accounts
    where id=p_destination_account and organization_id=p_organization and active for update;
    if not found or (v_source.payment_method='cash' and v_destination.account_type<>'cash')
       or (v_source.payment_method='transfer' and v_destination.account_type<>'bank') then
      raise exception using errcode='22023',message='destination_account_type_mismatch';
    end if;
  elsif p_destination_account is not null then
    raise exception using errcode='22023',message='unpaid_visit_must_not_select_cash_account';
  end if;

  select id into v_receivable from public.financial_accounts
    where organization_id=p_organization and system_key='receivable' and active;
  select id into v_revenue from public.financial_accounts
    where organization_id=p_organization and system_key='service_revenue' and active;
  if v_receivable is null or v_revenue is null then
    raise exception using errcode='55000',message='financial_system_accounts_missing';
  end if;

  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'visit_service',p_booking,v_source.source_fingerprint,p_destination_account
  ));
  select * into v_existing from public.financial_transactions
  where organization_id=p_organization and request_id=p_request_id for update;
  perform 1 from public.organization_finance_settings where organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_request_fingerprint then
      raise exception using errcode='23505',message='financial_transaction_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'request_id',p_request_id,'source_fingerprint',v_existing.source_fingerprint,'replayed',true);
  end if;
  if exists(
    select 1 from public.financial_transactions txn
    where txn.organization_id=p_organization
      and txn.operation_type='visit_service'
      and txn.source_type='booking_outcome' and txn.source_id=p_booking
      and not exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=txn.id)
  ) then
    raise exception using errcode='23505',message='financial_visit_already_posted';
  end if;

  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'visit_service','booking_outcome',p_booking,
    v_source.source_fingerprint,v_source.source_updated_at,
    jsonb_build_object(
      'schema','minuta-financial-explanation-v1','source_kind','booking_outcome',
      'source_id',p_booking,'source_updated_at',v_source.source_updated_at,
      'evidence_kind','staff_recorded','visit_status','completed',
      'completion_source','manual','payment_method',v_source.payment_method,
      'service_value_minor',v_source.service_value_minor,'received_minor',v_source.received_minor,
      'debt_minor',v_source.debt_minor,'currency','RUB'
    ),v_actor
  ) returning id into v_transaction;
  if v_source.received_minor>0 then
    insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
    values(p_organization,v_transaction,p_destination_account,'debit',v_source.received_minor);
  end if;
  if v_source.debt_minor>0 then
    insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
    values(p_organization,v_transaction,v_receivable,'debit',v_source.debt_minor);
  end if;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,v_revenue,'credit',v_source.service_value_minor);

  return jsonb_build_object('id',v_transaction,'organization_id',p_organization,
    'request_id',p_request_id,'source_fingerprint',v_source.source_fingerprint,
    'service_value_minor',v_source.service_value_minor,'received_minor',v_source.received_minor,
    'debt_minor',v_source.debt_minor,'currency','RUB','replayed',false);
end
$$;

create or replace function public.reverse_minuta_financial_transaction_v129(
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
     or p_reason_code not in('source_corrected','duplicate_entry','account_correction') then
    raise exception using errcode='22023',message='invalid_financial_reversal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':transaction:'||p_transaction::text,129));
  select * into v_original from public.financial_transactions
  where id=p_transaction and organization_id=p_organization for update;
  if not found or v_original.operation_type<>'visit_service' then
    raise exception using errcode='P0002',message='financial_transaction_not_reversible';
  end if;
  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'reversal',p_transaction,p_reason_code,v_original.source_fingerprint
  ));
  select * into v_existing from public.financial_transactions
  where organization_id=p_organization and request_id=p_request_id for update;
  perform 1 from public.organization_finance_settings where organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_request_fingerprint then
      raise exception using errcode='23505',message='financial_transaction_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'request_id',p_request_id,'reversal_of',p_transaction,'replayed',true);
  end if;
  if exists(select 1 from public.financial_transactions
    where organization_id=p_organization and reversal_of=p_transaction) then
    raise exception using errcode='23505',message='financial_transaction_already_reversed';
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
      'source_id',p_transaction,'evidence_kind','explicit_reversal','reason_code',p_reason_code
    ),v_actor
  ) returning id into v_reversal;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  select p_organization,v_reversal,posting.account_id,
    case posting.side when 'debit' then 'credit' else 'debit' end,posting.amount_minor
  from public.financial_postings posting where posting.transaction_id=p_transaction;
  return jsonb_build_object('id',v_reversal,'organization_id',p_organization,
    'request_id',p_request_id,'reversal_of',p_transaction,'replayed',false);
end
$$;

create or replace function public.get_minuta_financial_workspace_v129(p_organization uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid;
begin
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,
    'settings',coalesce((select jsonb_build_object('enabled',setting.enabled,'updated_at',setting.updated_at)
      from public.organization_finance_settings setting where setting.organization_id=p_organization),
      jsonb_build_object('enabled',false)),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',account.id,'name',account.name,'account_class',account.account_class,
      'account_type',account.account_type,'currency',account.currency,'system_key',account.system_key,
      'active',account.active,'created_at',account.created_at
    ) order by account.system_key nulls last,account.name,account.id)
      from public.financial_accounts account where account.organization_id=p_organization),'[]'::jsonb),
    'transactions',coalesce((select jsonb_agg(row.payload order by row.occurred_at desc,row.id desc)
      from (select txn.occurred_at,txn.id,jsonb_build_object(
        'id',txn.id,'request_id',txn.request_id,'operation_type',txn.operation_type,
        'source_type',txn.source_type,'source_id',txn.source_id,
        'source_fingerprint',txn.source_fingerprint,'reversal_of',txn.reversal_of,
        'occurred_at',txn.occurred_at,'explanation',txn.explanation,
        'reversed',exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=txn.id),
        'postings',coalesce((select jsonb_agg(jsonb_build_object(
          'account_id',posting.account_id,'side',posting.side,'amount_minor',posting.amount_minor
        ) order by posting.id) from public.financial_postings posting
          where posting.transaction_id=txn.id),'[]'::jsonb),
        'source_state',case when txn.operation_type='reversal' then 'reversal'
          when source_now.source_fingerprint is null then 'missing'
          when source_now.source_fingerprint=txn.source_fingerprint then 'matched'
          else 'drift' end,
        'source_blocked_reason',source_now.blocked_reason
      ) payload from public.financial_transactions txn
      left join lateral public.minuta_financial_booking_source_v129(
        p_organization,txn.source_id
      ) source_now on txn.operation_type='visit_service'
      where txn.organization_id=p_organization
      order by txn.occurred_at desc,txn.id desc limit 100) row),'[]'::jsonb)
  );
end
$$;

alter table public.organization_finance_settings enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.financial_postings enable row level security;

drop policy if exists organization_finance_settings_manager_read_v129 on public.organization_finance_settings;
create policy organization_finance_settings_manager_read_v129 on public.organization_finance_settings
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists financial_accounts_manager_read_v129 on public.financial_accounts;
create policy financial_accounts_manager_read_v129 on public.financial_accounts
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists financial_transactions_manager_read_v129 on public.financial_transactions;
create policy financial_transactions_manager_read_v129 on public.financial_transactions
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists financial_postings_manager_read_v129 on public.financial_postings;
create policy financial_postings_manager_read_v129 on public.financial_postings
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on public.organization_finance_settings,public.financial_accounts,
  public.financial_transactions,public.financial_postings from public,anon,authenticated,service_role;
grant select on public.organization_finance_settings,public.financial_accounts,
  public.financial_transactions,public.financial_postings to authenticated;

revoke all on function public.protect_minuta_financial_ledger_v129() from public,anon,authenticated,service_role;
revoke all on function public.assert_minuta_financial_transaction_balanced_v129() from public,anon,authenticated,service_role;
revoke all on function public.assert_minuta_financial_postings_balanced_v129() from public,anon,authenticated,service_role;
revoke all on function public.minuta_financial_sha256_v129(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.require_minuta_financial_manager_v129(uuid) from public,anon,authenticated,service_role;
revoke all on function public.minuta_financial_booking_source_v129(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_finance_enabled_v129(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.create_minuta_financial_account_v129(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.post_minuta_visit_finance_v129(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_financial_workspace_v129(uuid) from public,anon,authenticated,service_role;

grant execute on function public.set_minuta_finance_enabled_v129(uuid,boolean) to authenticated;
grant execute on function public.create_minuta_financial_account_v129(uuid,uuid,text,text) to authenticated;
grant execute on function public.post_minuta_visit_finance_v129(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.reverse_minuta_financial_transaction_v129(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.get_minuta_financial_workspace_v129(uuid) to authenticated;

commit;
