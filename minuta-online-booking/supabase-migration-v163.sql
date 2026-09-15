-- v163: truthful finance-screen read model and atomic categorized manual expenses.
-- This migration extends the existing v129/v132/v133/v136/v147 ledger. It does
-- not create a competing money journal and it does not infer missing payments.
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
     or to_regclass('public.financial_suppliers') is null
     or to_regclass('public.financial_expense_sources') is null
     or to_regclass('public.financial_debt_settlement_sources') is null
     or to_regclass('public.financial_payroll_payment_sources') is null
     or to_regclass('public.commercial_sales') is null
     or to_regclass('public.commercial_sale_lines') is null
     or to_regclass('public.commercial_sale_refunds') is null
     or to_regclass('public.organization_recurring_expenses') is null
     or to_regclass('public.recurring_expense_occurrences') is null
     or to_regprocedure('public.require_minuta_financial_manager_v129(uuid)') is null
     or to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') is null
     or to_regprocedure('public.create_minuta_financial_supplier_v132(uuid,uuid,text)') is null
     or to_regprocedure('public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamp with time zone,uuid)') is null
     or to_regprocedure('public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid)') is null
     or to_regprocedure('public.reverse_minuta_supplier_expense_payment_v132(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.reverse_minuta_supplier_expense_accrual_v132(uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.get_minuta_money_dashboard_v147(uuid,date,date)') is null
     or to_regprocedure('public.get_minuta_commerce_workspace_v151(uuid)') is null
     or to_regprocedure('public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid)') is null
     or obj_description(to_regprocedure(
       'public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)')::oid,'pg_proc')
       is distinct from 'minuta_refund_safety_v148_proportional_rounding' then
    raise exception using errcode='55000',message='v163_requires_current_financial_ledger_through_v151';
  end if;
end
$guard$;

create table public.organization_finance_categories_v163 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  system_key text check(system_key is null or system_key in(
    'materials','rent','salary','advertising','taxes','equipment','other'
  )),
  name text not null check(char_length(btrim(name)) between 2 and 80),
  active boolean not null default true,
  sort_order smallint not null default 100 check(sort_order between 0 and 1000),
  request_id uuid,
  request_fingerprint text check(request_fingerprint is null or request_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,system_key),
  unique(organization_id,request_id),
  check((request_id is null)=(request_fingerprint is null)),
  check((system_key is null)=(request_id is not null))
);

create unique index organization_finance_categories_name_v163_uidx
  on public.organization_finance_categories_v163(organization_id,lower(btrim(name)));
create index organization_finance_categories_scope_v163_idx
  on public.organization_finance_categories_v163(organization_id,active,sort_order,name,id);

create table public.organization_finance_category_events_v163 (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category_id uuid not null,
  event_type text not null check(event_type in('created','updated')),
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  previous_value jsonb,
  new_value jsonb not null check(jsonb_typeof(new_value)='object'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id,request_id),
  foreign key(category_id,organization_id)
    references public.organization_finance_categories_v163(id,organization_id) on delete restrict
);

create index organization_finance_category_events_scope_v163_idx
  on public.organization_finance_category_events_v163(organization_id,created_at desc,id desc);

create table public.financial_manual_expenses_v163 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  category_id uuid not null,
  category_name_snapshot text not null check(char_length(btrim(category_name_snapshot)) between 2 and 80),
  title text not null check(char_length(btrim(title)) between 2 and 160),
  source_label text not null check(char_length(btrim(source_label)) between 2 and 160),
  amount_minor bigint not null check(amount_minor>0 and amount_minor<=100000000000000),
  currency text not null default 'RUB' check(currency='RUB'),
  occurred_at timestamptz not null,
  performer_id uuid references auth.users(id) on delete set null,
  expense_source_id uuid not null,
  payment_transaction_id uuid not null,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  unique(organization_id,expense_source_id),
  unique(organization_id,payment_transaction_id),
  foreign key(category_id,organization_id)
    references public.organization_finance_categories_v163(id,organization_id) on delete restrict,
  foreign key(expense_source_id,organization_id)
    references public.financial_expense_sources(id,organization_id) on delete restrict,
  foreign key(payment_transaction_id,organization_id)
    references public.financial_transactions(id,organization_id) on delete restrict,
  foreign key(organization_id,performer_id)
    references public.organization_memberships(organization_id,user_id) on delete restrict
);

create index financial_manual_expenses_scope_v163_idx
  on public.financial_manual_expenses_v163(organization_id,occurred_at desc,id desc);
create index financial_manual_expenses_performer_v163_idx
  on public.financial_manual_expenses_v163(organization_id,performer_id,occurred_at desc,id desc);

create or replace function public.protect_minuta_finance_screen_history_v163()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000',message='finance_screen_history_is_append_only';
end
$$;

revoke all on function public.protect_minuta_finance_screen_history_v163()
  from public,anon,authenticated,service_role;

create trigger organization_finance_category_events_immutable_v163
before update or delete on public.organization_finance_category_events_v163
for each row execute function public.protect_minuta_finance_screen_history_v163();

create trigger financial_manual_expenses_immutable_v163
before update or delete on public.financial_manual_expenses_v163
for each row execute function public.protect_minuta_finance_screen_history_v163();

create or replace function public.seed_minuta_finance_categories_v163(
  p_organization uuid,p_actor uuid
)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_count integer;
begin
  insert into public.organization_finance_categories_v163(
    organization_id,system_key,name,sort_order,created_by
  ) values
    (p_organization,'materials','Материалы',10,p_actor),
    (p_organization,'rent','Аренда',20,p_actor),
    (p_organization,'salary','Зарплата',30,p_actor),
    (p_organization,'advertising','Реклама',40,p_actor),
    (p_organization,'taxes','Налоги',50,p_actor),
    (p_organization,'equipment','Оборудование',60,p_actor),
    (p_organization,'other','Прочее',70,p_actor)
  on conflict(organization_id,system_key) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end
$$;

revoke all on function public.seed_minuta_finance_categories_v163(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.ensure_minuta_finance_categories_v163()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.enabled then
    perform public.seed_minuta_finance_categories_v163(new.organization_id,new.enabled_by);
  end if;
  return new;
end
$$;

revoke all on function public.ensure_minuta_finance_categories_v163()
  from public,anon,authenticated,service_role;

create trigger organization_finance_categories_seed_v163
after insert or update of enabled on public.organization_finance_settings
for each row execute function public.ensure_minuta_finance_categories_v163();

-- Migration application never backfills organization data. Existing enabled
-- organizations initialize the dictionary through this explicit idempotent RPC.
create or replace function public.initialize_minuta_finance_screen_v163(p_organization uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid; v_created integer;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':finance-categories-v163',163));
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings
      where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  v_created:=public.seed_minuta_finance_categories_v163(p_organization,v_actor);
  return jsonb_build_object('organization_id',p_organization,'created_count',v_created,
    'category_count',(select count(*) from public.organization_finance_categories_v163
      where organization_id=p_organization),'replayed',v_created=0);
end
$$;

create or replace function public.create_minuta_finance_category_v163(
  p_organization uuid,p_request_id uuid,p_name text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_fingerprint text;
  v_category public.organization_finance_categories_v163%rowtype;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_request_id is null or char_length(v_name) not between 2 and 80 then
    raise exception using errcode='22023',message='invalid_finance_category';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'finance_category_v163',p_organization,lower(v_name)
  ));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':finance-category:'||p_request_id::text,163));
  select * into v_category from public.organization_finance_categories_v163 category
    where category.organization_id=p_organization and category.request_id=p_request_id for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings
      where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_category.id is not null then
    if v_category.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='finance_category_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_category.id,'organization_id',p_organization,
      'name',v_category.name,'active',v_category.active,'replayed',true);
  end if;
  if exists(select 1 from public.organization_finance_categories_v163 category
      where category.organization_id=p_organization and lower(btrim(category.name))=lower(v_name)) then
    raise exception using errcode='23505',message='finance_category_name_conflict';
  end if;
  insert into public.organization_finance_categories_v163(
    organization_id,name,request_id,request_fingerprint,created_by
  ) values(p_organization,v_name,p_request_id,v_fingerprint,v_actor)
  returning * into v_category;
  insert into public.organization_finance_category_events_v163(
    organization_id,category_id,event_type,request_id,request_fingerprint,new_value,actor_id
  ) values(p_organization,v_category.id,'created',p_request_id,v_fingerprint,
    jsonb_build_object('name',v_category.name,'active',v_category.active),v_actor);
  return jsonb_build_object('id',v_category.id,'organization_id',p_organization,
    'name',v_category.name,'active',v_category.active,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='finance_category_idempotency_or_name_conflict';
end
$$;

create or replace function public.update_minuta_finance_category_v163(
  p_organization uuid,p_category uuid,p_name text,p_active boolean,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_name text:=btrim(coalesce(p_name,''));
  v_fingerprint text;
  v_category public.organization_finance_categories_v163%rowtype;
  v_event public.organization_finance_category_events_v163%rowtype;
  v_previous jsonb;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_category is null or p_request_id is null or p_active is null
     or char_length(v_name) not between 2 and 80 then
    raise exception using errcode='22023',message='invalid_finance_category_update';
  end if;
  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    'finance_category_update_v163',p_organization,p_category,lower(v_name),p_active
  ));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':finance-category:'||p_request_id::text,163));
  select * into v_event from public.organization_finance_category_events_v163 event_row
    where event_row.organization_id=p_organization and event_row.request_id=p_request_id for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings
      where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_event.id is not null then
    if v_event.request_fingerprint<>v_fingerprint or v_event.category_id<>p_category then
      raise exception using errcode='23505',message='finance_category_update_idempotency_conflict';
    end if;
    return jsonb_build_object('id',p_category,'organization_id',p_organization,
      'name',v_event.new_value->>'name','active',(v_event.new_value->>'active')::boolean,'replayed',true);
  end if;
  select * into v_category from public.organization_finance_categories_v163 category
    where category.id=p_category and category.organization_id=p_organization for update;
  if v_category.id is null then
    raise exception using errcode='P0002',message='finance_category_not_found';
  end if;
  if exists(select 1 from public.organization_finance_categories_v163 category
      where category.organization_id=p_organization and category.id<>p_category
        and lower(btrim(category.name))=lower(v_name)) then
    raise exception using errcode='23505',message='finance_category_name_conflict';
  end if;
  v_previous:=jsonb_build_object('name',v_category.name,'active',v_category.active);
  update public.organization_finance_categories_v163
  set name=v_name,active=p_active,updated_at=now()
  where id=p_category and organization_id=p_organization
  returning * into v_category;
  insert into public.organization_finance_category_events_v163(
    organization_id,category_id,event_type,request_id,request_fingerprint,
    previous_value,new_value,actor_id
  ) values(p_organization,p_category,'updated',p_request_id,v_fingerprint,v_previous,
    jsonb_build_object('name',v_category.name,'active',v_category.active),v_actor);
  return jsonb_build_object('id',v_category.id,'organization_id',p_organization,
    'name',v_category.name,'active',v_category.active,'replayed',false);
exception when unique_violation then
  raise exception using errcode='23505',message='finance_category_update_idempotency_or_name_conflict';
end
$$;

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

create or replace function public.reverse_minuta_manual_expense_v163(
  p_organization uuid,p_expense uuid,p_request_id uuid,p_reason_code text
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid;
  v_expense public.financial_manual_expenses_v163%rowtype;
  v_accrual_transaction uuid;
  v_payment_reversal jsonb;
  v_accrual_reversal jsonb;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_expense is null or p_request_id is null
     or coalesce(p_reason_code,'')!~'^[a-z][a-z0-9_]{1,63}$' then
    raise exception using errcode='22023',message='invalid_manual_expense_reversal';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':manual-expense-reversal:'||p_request_id::text,163));
  select * into v_expense from public.financial_manual_expenses_v163 expense
    where expense.id=p_expense and expense.organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if v_expense.id is null then
    raise exception using errcode='P0002',message='manual_expense_not_found';
  end if;
  select transaction_row.id into v_accrual_transaction
  from public.financial_transactions transaction_row
  where transaction_row.organization_id=p_organization
    and transaction_row.operation_type='supplier_expense_accrual'
    and transaction_row.source_type='financial_expense_source'
    and transaction_row.source_id=v_expense.expense_source_id
  order by transaction_row.created_at,transaction_row.id limit 1 for update;
  if v_accrual_transaction is null then
    raise exception using errcode='55000',message='manual_expense_accrual_missing';
  end if;
  v_payment_reversal:=public.reverse_minuta_supplier_expense_payment_v132(
    p_organization,v_expense.payment_transaction_id,
    md5(p_request_id::text||':payment-reversal-v163')::uuid,p_reason_code
  );
  v_accrual_reversal:=public.reverse_minuta_supplier_expense_accrual_v132(
    p_organization,v_accrual_transaction,
    md5(p_request_id::text||':accrual-reversal-v163')::uuid,p_reason_code
  );
  return jsonb_build_object('id',p_expense,'organization_id',p_organization,
    'payment_reversal_id',v_payment_reversal->>'id',
    'accrual_reversal_id',v_accrual_reversal->>'id',
    'replayed',coalesce((v_payment_reversal->>'replayed')::boolean,false)
      and coalesce((v_accrual_reversal->>'replayed')::boolean,false));
end
$$;

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

revoke all on function public.minuta_finance_event_rows_v163(uuid,timestamptz,timestamptz,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.get_minuta_finance_screen_v163(
  p_organization uuid,p_start date,p_end date,p_performer uuid default null,
  p_limit integer default 30,p_before_occurred_at timestamptz default null,
  p_before_key text default null
)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_timezone text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_bucket_grain text;
  v_result jsonb;
begin
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>3661
     or p_limit is null or p_limit<1 or p_limit>100
     or ((p_before_occurred_at is null)<>(p_before_key is null))
     or (p_before_key is not null and char_length(p_before_key)>80) then
    raise exception using errcode='22023',message='invalid_finance_screen_request';
  end if;
  if p_performer is not null and not exists(
    select 1 from public.organization_memberships membership
    where membership.organization_id=p_organization and membership.user_id=p_performer and membership.active
  ) then
    raise exception using errcode='42501',message='finance_performer_not_in_organization';
  end if;
  select location.timezone into v_timezone
  from public.locations location
  where location.organization_id=p_organization and location.active
  order by location.is_primary desc,location.id limit 1;
  v_timezone:=coalesce(v_timezone,'Europe/Samara');
  if not exists(select 1 from pg_catalog.pg_timezone_names timezone_row
      where timezone_row.name=v_timezone) then
    raise exception using errcode='22023',message='invalid_organization_timezone';
  end if;
  v_period_start:=p_start::timestamp at time zone v_timezone;
  v_period_end:=(p_end+1)::timestamp at time zone v_timezone;
  v_bucket_grain:=case when p_end-p_start<=45 then 'day' else 'week' end;

  with completed_visits as (
    select booking.id,booking.performer_id,booking.booking_date,booking.booking_time,
      outcome.payment_method,outcome.amount_rub,outcome.calculated_amount_rub,
      outcome.completion_source,outcome.updated_at,
      (outcome.completion_source='manual'
        and outcome.payment_method in('cash','transfer','unpaid')
        and outcome.amount_rub is not null
        and ((outcome.payment_method='unpaid' and outcome.amount_rub=0)
          or (outcome.payment_method<>'unpaid' and outcome.amount_rub>0))
        and outcome.calculated_amount_rub>0
        and outcome.amount_rub<=outcome.calculated_amount_rub
        and booking.payment_status='not_required'
        and coalesce(booking.deposit_amount_rub,0)=0
        and not exists(select 1 from public.payments payment
          where payment.booking_id=booking.id and payment.status in('paid','refunded'))
        and not exists(select 1 from public.payment_provider_attempts attempt
          where attempt.organization_id=p_organization and attempt.booking_id=booking.id
            and attempt.captured_amount_minor>0)
      ) payment_marked,
      exists(select 1 from public.financial_transactions transaction_row
        where transaction_row.organization_id=p_organization
          and transaction_row.operation_type='visit_service'
          and transaction_row.source_type='booking_outcome'
          and transaction_row.source_id=booking.id
          and not exists(select 1 from public.financial_transactions reversal
            where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id)
      ) ledger_posted
    from public.bookings booking
    join public.booking_outcomes outcome on outcome.booking_id=booking.id
    where booking.organization_id=p_organization and booking.status<>'cancelled'
      and outcome.visit_status='completed' and booking.booking_date between p_start and p_end
      and (p_performer is null or booking.performer_id=p_performer)
  ), unposted_outcome_events as (
    select booking.id::text||':outcome-income' event_key,null::uuid transaction_id,
      'booking_outcome_payment'::text operation_type,'income'::text event_kind,
      ((booking.booking_date+booking.booking_time) at time zone v_timezone) occurred_at,
      (outcome.amount_rub::bigint*100)::bigint flow_minor,
      service.name::text label,null::uuid category_id,null::text category_name,
      booking.performer_id,booking.performer_id entered_by_id,
      'unposted_visit_payment'::text source_kind
    from public.bookings booking
    join public.booking_outcomes outcome on outcome.booking_id=booking.id
    join public.services service on service.id=booking.service_id
    where booking.organization_id=p_organization and booking.status<>'cancelled'
      and outcome.visit_status='completed' and outcome.completion_source='manual'
      and outcome.payment_method in('cash','transfer') and outcome.amount_rub>0
      and outcome.calculated_amount_rub>0 and outcome.amount_rub<=outcome.calculated_amount_rub
      and booking.payment_status='not_required' and coalesce(booking.deposit_amount_rub,0)=0
      and ((booking.booking_date+booking.booking_time) at time zone v_timezone)>=v_period_start
      and ((booking.booking_date+booking.booking_time) at time zone v_timezone)<v_period_end
      and (p_performer is null or booking.performer_id=p_performer)
      and not exists(select 1 from public.payments payment
        where payment.booking_id=booking.id and payment.status in('paid','refunded'))
      and not exists(select 1 from public.payment_provider_attempts attempt
        where attempt.organization_id=p_organization and attempt.booking_id=booking.id
          and attempt.captured_amount_minor>0)
      and not exists(select 1 from public.financial_transactions transaction_row
        where transaction_row.organization_id=p_organization
          and transaction_row.operation_type='visit_service'
          and transaction_row.source_type='booking_outcome'
          and transaction_row.source_id=booking.id
          and not exists(select 1 from public.financial_transactions reversal
            where reversal.organization_id=p_organization and reversal.reversal_of=transaction_row.id))
  ), events as (
    select * from public.minuta_finance_event_rows_v163(
      p_organization,v_period_start,v_period_end,p_performer
    )
    union all
    select * from unposted_outcome_events
  ), unposted_outcome_debts as (
    select greatest((visit.calculated_amount_rub-visit.amount_rub)::bigint*100,0)::bigint outstanding_minor
    from completed_visits visit
    where visit.payment_marked and not visit.ledger_posted
      and visit.calculated_amount_rub is not null
  ), active_visit_ledger as (
    select visit.id,visit.source_id booking_id,visit.occurred_at,
      coalesce((visit.explanation->>'service_value_minor')::bigint,0) service_value_minor,
      coalesce((select sum(case posting.side when 'debit' then posting.amount_minor else -posting.amount_minor end)
        from public.financial_postings posting
        join public.financial_accounts account on account.id=posting.account_id
        where posting.transaction_id=visit.id and account.system_key='receivable'),0)::bigint original_debt_minor
    from public.financial_transactions visit
    join public.bookings booking on booking.id=visit.source_id and booking.organization_id=p_organization
    where visit.organization_id=p_organization and visit.operation_type='visit_service'
      and visit.source_type='booking_outcome'
      and ((booking.booking_date+booking.booking_time) at time zone v_timezone)>=v_period_start
      and ((booking.booking_date+booking.booking_time) at time zone v_timezone)<v_period_end
      and (p_performer is null or booking.performer_id=p_performer)
      and not exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=visit.id)
  ), visit_debts as (
    select visit.id,greatest(visit.original_debt_minor-coalesce((select sum(source.gross_minor)
      from public.financial_debt_settlement_sources source
      join public.financial_transactions settlement
        on settlement.organization_id=source.organization_id
       and settlement.operation_type='customer_debt_settlement'
       and settlement.source_type='financial_debt_settlement_source'
       and settlement.source_id=source.id
      where source.organization_id=p_organization and source.visit_transaction_id=visit.id
        and not exists(select 1 from public.financial_transactions reversal
          where reversal.organization_id=p_organization and reversal.reversal_of=settlement.id)
    ),0),0)::bigint outstanding_minor
    from active_visit_ledger visit
  ), buckets as (
    select bucket_value::date bucket_start
    from generate_series(
      case when v_bucket_grain='day' then p_start::timestamp
        else date_trunc('week',p_start::timestamp) end,
      p_end::timestamp,
      case when v_bucket_grain='day' then interval '1 day' else interval '1 week' end
    ) bucket_value
  ), event_buckets as (
    select case when v_bucket_grain='day'
        then (event.occurred_at at time zone v_timezone)::date
        else date_trunc('week',event.occurred_at at time zone v_timezone)::date end bucket_start,
      coalesce(sum(event.flow_minor) filter(where event.event_kind in('income','refund')
        or (event.event_kind='correction' and event.source_kind in(
          'visit_payment','unposted_visit_payment','debt_payment','sale','sale_refund'))),0)::bigint received_minor,
      coalesce(sum(-event.flow_minor) filter(where event.event_kind='expense'
        or (event.event_kind='correction' and event.source_kind in(
          'manual_expense','supplier_expense','recurring_expense','payroll_payment','payment_commission'))),0)::bigint expense_minor
    from events event group by 1
  ), category_totals as (
    select event.category_id,event.category_name,
      sum(-event.flow_minor)::bigint amount_minor
    from events event
    where event.event_kind='expense' or (event.event_kind='correction' and event.source_kind in(
      'manual_expense','supplier_expense','recurring_expense','payroll_payment','payment_commission'))
    group by event.category_id,event.category_name
    having sum(-event.flow_minor)<>0
  ), page_candidates as (
    select event.* from events event
    where p_before_occurred_at is null
       or (event.occurred_at,event.event_key)<(p_before_occurred_at,p_before_key)
    order by event.occurred_at desc,event.event_key desc
    limit p_limit+1
  ), page_rows as (
    select * from page_candidates order by occurred_at desc,event_key desc limit p_limit
  ), page_tail as (
    select occurred_at,event_key from page_rows order by occurred_at,event_key limit 1
  )
  select jsonb_build_object(
    'schema','minuta-finance-screen-v1','ledger_version',163,
    'organization_id',p_organization,'currency','RUB','timezone',v_timezone,
    'finance_enabled',coalesce((select enabled from public.organization_finance_settings
      where organization_id=p_organization),false),
    'period',jsonb_build_object('start',p_start,'end',p_end,'bucket_grain',v_bucket_grain),
    'selected_performer_id',p_performer,
    'summary',jsonb_build_object(
      'received_minor',coalesce((select sum(event.flow_minor) from events event
        where event.event_kind in('income','refund') or (event.event_kind='correction'
          and event.source_kind in('visit_payment','unposted_visit_payment','debt_payment','sale','sale_refund'))),0),
      'expense_minor',coalesce((select sum(-event.flow_minor) from events event
        where event.event_kind='expense' or (event.event_kind='correction'
          and event.source_kind in('manual_expense','supplier_expense','recurring_expense','payroll_payment','payment_commission'))),0),
      'net_minor',coalesce((select sum(event.flow_minor) from events event),0),
      'services_minor',coalesce((select sum(visit.calculated_amount_rub::bigint*100)
        from completed_visits visit where visit.calculated_amount_rub is not null),0),
      'debt_minor',coalesce((select sum(debt.outstanding_minor) from visit_debts debt),0)
        +coalesce((select sum(debt.outstanding_minor) from unposted_outcome_debts debt),0)
    ),
    'confidence',jsonb_build_object(
      'completed_visits',(select count(*) from completed_visits),
      'payment_marked_visits',(select count(*) from completed_visits visit
        where visit.payment_marked),
      'ledger_posted_visits',(select count(*) from completed_visits visit where visit.ledger_posted),
      'unposted_payment_visits',(select count(*) from completed_visits visit
        where visit.payment_marked and not visit.ledger_posted),
      'unknown_payment_visits',(select count(*) from completed_visits visit
        where not visit.payment_marked),
      'service_value_known_visits',(select count(*) from completed_visits visit
        where visit.calculated_amount_rub is not null),
      'is_complete',not exists(select 1 from completed_visits visit
        where not visit.ledger_posted or not visit.payment_marked
          or visit.calculated_amount_rub is null),
      'result_reliable',coalesce((select enabled from public.organization_finance_settings
        where organization_id=p_organization),false)
        and not exists(select 1 from completed_visits visit
          where not visit.ledger_posted or not visit.payment_marked
            or visit.calculated_amount_rub is null)
    ),
    'expense_readiness',jsonb_build_object(
      'finance_enabled',coalesce((select enabled from public.organization_finance_settings
        where organization_id=p_organization),false),
      'has_payment_account',exists(select 1 from public.financial_accounts account
        where account.organization_id=p_organization and account.active
          and account.system_key is null and account.account_type in('cash','bank')),
      'active_category_count',(select count(*) from public.organization_finance_categories_v163 category
        where category.organization_id=p_organization and category.active),
      'can_record',coalesce((select enabled from public.organization_finance_settings
        where organization_id=p_organization),false)
        and exists(select 1 from public.financial_accounts account
          where account.organization_id=p_organization and account.active
            and account.system_key is null and account.account_type in('cash','bank'))
        and exists(select 1 from public.organization_finance_categories_v163 category
          where category.organization_id=p_organization and category.active)
    ),
    'performers',coalesce((select jsonb_agg(jsonb_build_object(
      'id',membership.user_id,'name',coalesce(profile.display_name,'Сотрудник'),
      'role',membership.role) order by coalesce(profile.display_name,'Сотрудник'),membership.user_id)
      from public.organization_memberships membership
      left join public.performer_profiles profile on profile.id=membership.user_id
      where membership.organization_id=p_organization and membership.active),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',account.id,'name',account.name,'account_type',account.account_type)
      order by account.account_type,account.name,account.id)
      from public.financial_accounts account where account.organization_id=p_organization
        and account.active and account.system_key is null and account.account_type in('cash','bank')),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(jsonb_build_object(
      'id',category.id,'system_key',category.system_key,'name',category.name,'active',category.active)
      order by category.active desc,category.sort_order,category.name,category.id)
      from public.organization_finance_categories_v163 category
      where category.organization_id=p_organization),'[]'::jsonb),
    'series',coalesce((select jsonb_agg(jsonb_build_object(
      'bucket_start',bucket.bucket_start,
      'received_minor',coalesce(event_bucket.received_minor,0),
      'expense_minor',coalesce(event_bucket.expense_minor,0)) order by bucket.bucket_start)
      from buckets bucket left join event_buckets event_bucket using(bucket_start)),'[]'::jsonb),
    'expense_structure',coalesce((select jsonb_agg(jsonb_build_object(
      'category_id',category.category_id,'name',category.category_name,
      'amount_minor',category.amount_minor) order by category.amount_minor desc,category.category_name)
      from category_totals category),'[]'::jsonb),
    'operations',coalesce((select jsonb_agg(jsonb_build_object(
      'event_key',event.event_key,'transaction_id',event.transaction_id,
      'operation_type',event.operation_type,'kind',event.event_kind,
      'occurred_at',event.occurred_at,'amount_minor',event.flow_minor,
      'label',event.label,'category_id',event.category_id,'category_name',event.category_name,
      'performer_id',event.performer_id,
      'performer_name',coalesce(performer.display_name,'Сотрудник'),
      'entered_by_id',event.entered_by_id,
      'entered_by_name',coalesce(actor.display_name,'Сотрудник'),
      'source_kind',event.source_kind
    ) order by event.occurred_at desc,event.event_key desc)
      from page_rows event
      left join public.performer_profiles performer on performer.id=event.performer_id
      left join public.performer_profiles actor on actor.id=event.entered_by_id),'[]'::jsonb),
    'has_more',(select count(*)>p_limit from page_candidates),
    'next_cursor',case when (select count(*)>p_limit from page_candidates) then
      (select jsonb_build_object('occurred_at',tail.occurred_at,'event_key',tail.event_key)
        from page_tail tail) else null end
  ) into v_result;
  return v_result;
end
$$;

alter table public.organization_finance_categories_v163 enable row level security;
alter table public.organization_finance_categories_v163 force row level security;
alter table public.organization_finance_category_events_v163 enable row level security;
alter table public.organization_finance_category_events_v163 force row level security;
alter table public.financial_manual_expenses_v163 enable row level security;
alter table public.financial_manual_expenses_v163 force row level security;

create policy organization_finance_categories_manager_read_v163
on public.organization_finance_categories_v163 for select to authenticated
using(public.has_organization_role(organization_id,array['owner','admin']));
create policy organization_finance_category_events_manager_read_v163
on public.organization_finance_category_events_v163 for select to authenticated
using(public.has_organization_role(organization_id,array['owner','admin']));
create policy financial_manual_expenses_manager_read_v163
on public.financial_manual_expenses_v163 for select to authenticated
using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on public.organization_finance_categories_v163,
  public.organization_finance_category_events_v163,public.financial_manual_expenses_v163
  from public,anon,authenticated,service_role;
grant select on public.organization_finance_categories_v163,
  public.organization_finance_category_events_v163,public.financial_manual_expenses_v163
  to authenticated;
grant all on public.organization_finance_categories_v163,
  public.organization_finance_category_events_v163,public.financial_manual_expenses_v163
  to postgres,service_role;

revoke all on function public.create_minuta_finance_category_v163(uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.initialize_minuta_finance_screen_v163(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.update_minuta_finance_category_v163(uuid,uuid,text,boolean,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.reverse_minuta_manual_expense_v163(uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_finance_screen_v163(uuid,date,date,uuid,integer,timestamptz,text)
  from public,anon,authenticated,service_role;

grant execute on function public.create_minuta_finance_category_v163(uuid,uuid,text) to authenticated;
grant execute on function public.initialize_minuta_finance_screen_v163(uuid) to authenticated;
grant execute on function public.update_minuta_finance_category_v163(uuid,uuid,text,boolean,uuid) to authenticated;
grant execute on function public.record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)
  to authenticated;
grant execute on function public.reverse_minuta_manual_expense_v163(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.get_minuta_finance_screen_v163(uuid,date,date,uuid,integer,timestamptz,text)
  to authenticated;

alter function public.protect_minuta_finance_screen_history_v163() owner to postgres;
alter function public.seed_minuta_finance_categories_v163(uuid,uuid) owner to postgres;
alter function public.ensure_minuta_finance_categories_v163() owner to postgres;
alter function public.initialize_minuta_finance_screen_v163(uuid) owner to postgres;
alter function public.create_minuta_finance_category_v163(uuid,uuid,text) owner to postgres;
alter function public.update_minuta_finance_category_v163(uuid,uuid,text,boolean,uuid) owner to postgres;
alter function public.record_minuta_manual_expense_v163(uuid,uuid,text,text,bigint,uuid,date,uuid,uuid)
  owner to postgres;
alter function public.reverse_minuta_manual_expense_v163(uuid,uuid,uuid,text) owner to postgres;
alter function public.minuta_finance_event_rows_v163(uuid,timestamptz,timestamptz,uuid) owner to postgres;
alter function public.get_minuta_finance_screen_v163(uuid,date,date,uuid,integer,timestamptz,text)
  owner to postgres;

comment on function public.get_minuta_finance_screen_v163(uuid,date,date,uuid,integer,timestamptz,text)
  is 'minuta_finance_screen_v163_server_authoritative_cash_and_service_read_model';

commit;
