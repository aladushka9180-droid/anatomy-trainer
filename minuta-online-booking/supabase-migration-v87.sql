begin;

set local search_path = public, extensions, pg_catalog;

-- v87 connects the provider-neutral v47 ledger to YooKassa without putting
-- merchant credentials in PostgreSQL. Every tenant must opt in explicitly.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.services') is null
     or to_regclass('public.payments') is null
     or to_regclass('public.payment_events') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='organization_id'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='payment_due_at'
     ) then
    raise exception using errcode='P0001',message='v87_missing_payment_prerequisites';
  end if;
end $$;

create table if not exists public.organization_payment_provider_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  provider text not null default 'yookassa' check(provider='yookassa'),
  environment text not null default 'test' check(environment in ('test','production')),
  fiscalization_enabled boolean not null default false,
  taxation text check(taxation is null or taxation in ('osn','usn_income','usn_income_outcome','esn','patent')),
  vat_code integer check(vat_code is null or vat_code between 1 and 12),
  payment_mode text check(payment_mode is null or payment_mode in (
    'full_prepayment','partial_prepayment','advance','full_payment','partial_payment','credit','credit_payment'
  )),
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(not fiscalization_enabled or (taxation is not null and vat_code is not null and payment_mode is not null))
);

create table if not exists public.payment_provider_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  provider text not null default 'yookassa' check(provider='yookassa'),
  environment text not null check(environment in ('test','production')),
  idempotency_key uuid not null,
  provider_payment_id text check(provider_payment_id is null or char_length(provider_payment_id) between 1 and 200),
  amount_minor bigint not null check(amount_minor>0),
  currency text not null default 'RUB' check(currency='RUB'),
  status text not null default 'creating' check(status in ('creating','pending','succeeded','canceled','failed')),
  captured_amount_minor bigint not null default 0 check(captured_amount_minor>=0 and captured_amount_minor<=amount_minor),
  refunded_amount_minor bigint not null default 0 check(refunded_amount_minor>=0 and refunded_amount_minor<=captured_amount_minor),
  confirmation_url text check(confirmation_url is null or (char_length(confirmation_url)<=1000 and confirmation_url~*'^https://')),
  provider_created_at timestamptz,
  expires_at timestamptz,
  last_provider_status text check(last_provider_status is null or char_length(last_provider_status) between 1 and 40),
  last_error_code text check(last_error_code is null or char_length(last_error_code) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,idempotency_key),
  unique(provider,provider_payment_id),
  unique(id,organization_id)
);

create unique index if not exists payment_provider_attempts_one_open_booking_idx
  on public.payment_provider_attempts(booking_id)
  where status in ('creating','pending');
create index if not exists payment_provider_attempts_scope_created_idx
  on public.payment_provider_attempts(organization_id,created_at desc,id);
create index if not exists payment_provider_attempts_reconcile_idx
  on public.payment_provider_attempts(updated_at,id)
  where status in ('creating','pending');

create table if not exists public.payment_provider_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  attempt_id uuid not null,
  request_id uuid not null,
  provider text not null default 'yookassa' check(provider='yookassa'),
  provider_refund_id text check(provider_refund_id is null or char_length(provider_refund_id) between 1 and 200),
  amount_minor bigint not null check(amount_minor>=100),
  currency text not null default 'RUB' check(currency='RUB'),
  status text not null default 'creating' check(status in ('creating','pending','succeeded','canceled','failed')),
  reason text not null check(char_length(btrim(reason)) between 8 and 500),
  requested_by uuid not null references auth.users(id) on delete restrict,
  provider_created_at timestamptz,
  last_error_code text check(last_error_code is null or char_length(last_error_code) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(attempt_id,organization_id)
    references public.payment_provider_attempts(id,organization_id) on delete restrict,
  unique(organization_id,request_id),
  unique(provider,provider_refund_id),
  unique(id,organization_id)
);

create index if not exists payment_provider_refunds_attempt_idx
  on public.payment_provider_refunds(attempt_id,created_at,id);
create index if not exists payment_provider_refunds_reconcile_idx
  on public.payment_provider_refunds(updated_at,id)
  where status in ('creating','pending');

create table if not exists public.payment_provider_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  attempt_id uuid,
  refund_id uuid,
  provider text not null default 'yookassa' check(provider='yookassa'),
  event_key text not null check(char_length(event_key) between 1 and 300),
  event_type text not null check(char_length(event_type) between 1 and 100),
  provider_object_id text not null check(char_length(provider_object_id) between 1 and 200),
  provider_status text not null check(char_length(provider_status) between 1 and 40),
  amount_minor bigint not null check(amount_minor>0),
  currency text not null default 'RUB' check(currency='RUB'),
  payload_sha256 text not null check(payload_sha256~'^[0-9a-f]{64}$'),
  processing_status text not null check(processing_status in ('processed','rejected')),
  error_code text check(error_code is null or char_length(error_code) between 1 and 100),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  foreign key(attempt_id,organization_id)
    references public.payment_provider_attempts(id,organization_id) on delete restrict,
  foreign key(refund_id,organization_id)
    references public.payment_provider_refunds(id,organization_id) on delete restrict,
  unique(provider,event_key),
  check((attempt_id is not null)::integer+(refund_id is not null)::integer=1)
);

create index if not exists payment_provider_events_scope_idx
  on public.payment_provider_events(organization_id,received_at desc,id desc);

create table if not exists public.payment_provider_reconciliations (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  object_kind text not null check(object_kind in ('payment','refund')),
  attempt_id uuid,
  refund_id uuid,
  provider text not null default 'yookassa' check(provider='yookassa'),
  provider_object_id text check(provider_object_id is null or char_length(provider_object_id) between 1 and 200),
  provider_status text check(provider_status is null or char_length(provider_status) between 1 and 40),
  amount_minor bigint check(amount_minor is null or amount_minor>0),
  currency text check(currency is null or currency='RUB'),
  source text not null check(source in ('create','webhook','refund','scheduled','manual')),
  outcome text not null check(outcome in ('matched','updated','pending','failed')),
  payload_sha256 text check(payload_sha256 is null or payload_sha256~'^[0-9a-f]{64}$'),
  error_code text check(error_code is null or char_length(error_code) between 1 and 100),
  checked_at timestamptz not null default now(),
  foreign key(attempt_id,organization_id)
    references public.payment_provider_attempts(id,organization_id) on delete restrict,
  foreign key(refund_id,organization_id)
    references public.payment_provider_refunds(id,organization_id) on delete restrict,
  unique(organization_id,object_kind,request_id),
  check((object_kind='payment' and attempt_id is not null and refund_id is null)
     or (object_kind='refund' and refund_id is not null))
);

create index if not exists payment_provider_reconciliations_scope_idx
  on public.payment_provider_reconciliations(organization_id,checked_at desc,id desc);

create table if not exists public.payment_provider_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(action in ('settings_changed','refund_requested')),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_provider_audit_scope_idx
  on public.payment_provider_audit_log(organization_id,created_at desc,id desc);

insert into public.organization_payment_provider_settings(organization_id)
select organization.id from public.organizations organization
on conflict(organization_id) do nothing;

create or replace function public.ensure_minuta_payment_provider_settings()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.organization_payment_provider_settings(organization_id)
  values(new.id) on conflict(organization_id) do nothing;
  return new;
end $$;
revoke all on function public.ensure_minuta_payment_provider_settings()
  from public,anon,authenticated,service_role;
drop trigger if exists organizations_payment_provider_settings on public.organizations;
create trigger organizations_payment_provider_settings after insert on public.organizations
for each row execute function public.ensure_minuta_payment_provider_settings();

create or replace function public.touch_minuta_payment_provider_row()
returns trigger language plpgsql security invoker set search_path to '' as $$
begin
  new.updated_at:=now();
  return new;
end $$;
revoke all on function public.touch_minuta_payment_provider_row()
  from public,anon,authenticated,service_role;

drop trigger if exists payment_provider_settings_touch on public.organization_payment_provider_settings;
create trigger payment_provider_settings_touch before update on public.organization_payment_provider_settings
for each row execute function public.touch_minuta_payment_provider_row();
drop trigger if exists payment_provider_attempts_touch on public.payment_provider_attempts;
create trigger payment_provider_attempts_touch before update on public.payment_provider_attempts
for each row execute function public.touch_minuta_payment_provider_row();
drop trigger if exists payment_provider_refunds_touch on public.payment_provider_refunds;
create trigger payment_provider_refunds_touch before update on public.payment_provider_refunds
for each row execute function public.touch_minuta_payment_provider_row();

alter table public.organization_payment_provider_settings enable row level security;
alter table public.payment_provider_attempts enable row level security;
alter table public.payment_provider_refunds enable row level security;
alter table public.payment_provider_events enable row level security;
alter table public.payment_provider_reconciliations enable row level security;
alter table public.payment_provider_audit_log enable row level security;

drop policy if exists payment_provider_settings_manager_read on public.organization_payment_provider_settings;
create policy payment_provider_settings_manager_read on public.organization_payment_provider_settings
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists payment_provider_attempts_manager_read on public.payment_provider_attempts;
create policy payment_provider_attempts_manager_read on public.payment_provider_attempts
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists payment_provider_refunds_manager_read on public.payment_provider_refunds;
create policy payment_provider_refunds_manager_read on public.payment_provider_refunds
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists payment_provider_events_manager_read on public.payment_provider_events;
create policy payment_provider_events_manager_read on public.payment_provider_events
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists payment_provider_reconciliations_manager_read on public.payment_provider_reconciliations;
create policy payment_provider_reconciliations_manager_read on public.payment_provider_reconciliations
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists payment_provider_audit_manager_read on public.payment_provider_audit_log;
create policy payment_provider_audit_manager_read on public.payment_provider_audit_log
  for select to authenticated using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on table public.organization_payment_provider_settings,public.payment_provider_attempts,
  public.payment_provider_refunds,public.payment_provider_events,public.payment_provider_reconciliations,
  public.payment_provider_audit_log from public,anon,authenticated,service_role;
grant select on table public.organization_payment_provider_settings,public.payment_provider_attempts,
  public.payment_provider_refunds,public.payment_provider_events,public.payment_provider_reconciliations,
  public.payment_provider_audit_log to authenticated;

create or replace function public.require_minuta_payment_role(p_organization uuid,p_actor uuid, p_roles text[])
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if p_actor is null or p_roles is null then
    raise exception using errcode='42501',message='payment_authentication_required';
  end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=p_actor and membership.active;
  if v_role is null or not(v_role=any(p_roles)) then
    raise exception using errcode='42501',message='payment_access_denied';
  end if;
  return v_role;
end $$;
revoke all on function public.require_minuta_payment_role(uuid,uuid,text[])
  from public,anon,authenticated,service_role;

create or replace function public.set_minuta_yookassa_settings(
  p_organization uuid,p_enabled boolean,p_environment text,
  p_fiscalization_enabled boolean default false,p_taxation text default null,
  p_vat_code integer default null,p_payment_mode text default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_before jsonb; v_after jsonb;
begin
  v_role:=public.require_minuta_payment_role(p_organization,auth.uid(),array['owner']);
  if p_enabled is null or p_environment not in ('test','production')
     or p_fiscalization_enabled is null
     or (p_fiscalization_enabled and (
       p_taxation not in ('osn','usn_income','usn_income_outcome','esn','patent')
       or p_vat_code not between 1 and 12
       or p_payment_mode not in ('full_prepayment','partial_prepayment','advance','full_payment','partial_payment','credit','credit_payment')
     )) then
    raise exception using errcode='22023',message='invalid_yookassa_settings';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,8700));
  select to_jsonb(setting)-'enabled_by' into v_before
  from public.organization_payment_provider_settings setting where setting.organization_id=p_organization for update;
  if coalesce(v_before->>'environment','test')<>p_environment and exists(
    select 1 from public.payment_provider_attempts attempt
    where attempt.organization_id=p_organization and attempt.status in ('creating','pending')
  ) then
    raise exception using errcode='55000',message='payment_environment_has_open_attempts';
  end if;
  insert into public.organization_payment_provider_settings(
    organization_id,enabled,environment,fiscalization_enabled,taxation,vat_code,payment_mode,enabled_at,enabled_by
  ) values(
    p_organization,p_enabled,p_environment,p_fiscalization_enabled,
    case when p_fiscalization_enabled then p_taxation end,
    case when p_fiscalization_enabled then p_vat_code end,
    case when p_fiscalization_enabled then p_payment_mode end,
    case when p_enabled then now() end,case when p_enabled then auth.uid() end
  ) on conflict(organization_id) do update set
    enabled=excluded.enabled,environment=excluded.environment,
    fiscalization_enabled=excluded.fiscalization_enabled,taxation=excluded.taxation,
    vat_code=excluded.vat_code,payment_mode=excluded.payment_mode,
    enabled_at=case when excluded.enabled then coalesce(public.organization_payment_provider_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then auth.uid() else public.organization_payment_provider_settings.enabled_by end;
  select to_jsonb(setting)-'enabled_by' into v_after
  from public.organization_payment_provider_settings setting where setting.organization_id=p_organization;
  insert into public.payment_provider_audit_log(organization_id,actor_id,action,details)
  values(p_organization,auth.uid(),'settings_changed',jsonb_build_object('before',coalesce(v_before,'{}'::jsonb),'after',v_after));
  return v_after;
end $$;

create or replace function public.get_minuta_payment_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_setting public.organization_payment_provider_settings%rowtype;
begin
  v_role:=public.require_minuta_payment_role(p_organization,auth.uid(),array['owner','admin']);
  select * into v_setting from public.organization_payment_provider_settings setting
  where setting.organization_id=p_organization;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'settings',jsonb_build_object(
      'enabled',coalesce(v_setting.enabled,false),'provider','yookassa',
      'environment',coalesce(v_setting.environment,'test'),
      'fiscalization_enabled',coalesce(v_setting.fiscalization_enabled,false),
      'taxation',v_setting.taxation,'vat_code',v_setting.vat_code,'payment_mode',v_setting.payment_mode
    ),
    'recent_attempts',coalesce((select jsonb_agg(row.payload order by row.created_at desc,row.id desc)
      from (select attempt.created_at,attempt.id,jsonb_build_object(
          'id',attempt.id,'booking_id',attempt.booking_id,'amount_minor',attempt.amount_minor,
          'currency',attempt.currency,'status',attempt.status,'captured_amount_minor',attempt.captured_amount_minor,
          'refunded_amount_minor',attempt.refunded_amount_minor,'environment',attempt.environment,
          'created_at',attempt.created_at,'updated_at',attempt.updated_at,'last_error_code',attempt.last_error_code
        ) payload from public.payment_provider_attempts attempt
        where attempt.organization_id=p_organization order by attempt.created_at desc,attempt.id desc limit 50) row),'[]'::jsonb),
    'recent_refunds',coalesce((select jsonb_agg(row.payload order by row.created_at desc,row.id desc)
      from (select refund.created_at,refund.id,jsonb_build_object(
          'id',refund.id,'attempt_id',refund.attempt_id,'amount_minor',refund.amount_minor,
          'currency',refund.currency,'status',refund.status,'reason',refund.reason,
          'created_at',refund.created_at,'updated_at',refund.updated_at,'last_error_code',refund.last_error_code
        ) payload from public.payment_provider_refunds refund
        where refund.organization_id=p_organization order by refund.created_at desc,refund.id desc limit 50) row),'[]'::jsonb),
    'recent_reconciliations',coalesce((select jsonb_agg(row.payload order by row.checked_at desc,row.id desc)
      from (select reconciliation.checked_at,reconciliation.id,jsonb_build_object(
          'object_kind',reconciliation.object_kind,'attempt_id',reconciliation.attempt_id,
          'refund_id',reconciliation.refund_id,'provider_status',reconciliation.provider_status,
          'amount_minor',reconciliation.amount_minor,'currency',reconciliation.currency,
          'source',reconciliation.source,'outcome',reconciliation.outcome,
          'error_code',reconciliation.error_code,'checked_at',reconciliation.checked_at
        ) payload from public.payment_provider_reconciliations reconciliation
        where reconciliation.organization_id=p_organization
        order by reconciliation.checked_at desc,reconciliation.id desc limit 50) row),'[]'::jsonb)
  );
end $$;

-- A manage token may learn only whether this one booking can be paid and where
-- an already prepared confirmation lives. Provider settings and credentials
-- are intentionally not exposed to the browser.
create or replace function public.get_yookassa_payment_capability(p_manage_token uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype;
  v_setting public.organization_payment_provider_settings%rowtype;
  v_attempt public.payment_provider_attempts%rowtype;
  v_enabled boolean;
  v_eligible boolean;
  v_fallback_url text;
begin
  if p_manage_token is null then return null; end if;
  select booking.* into v_booking
  from public.bookings booking where booking.manage_token=p_manage_token;
  if not found then return null; end if;
  select setting.* into v_setting
  from public.organization_payment_provider_settings setting
  where setting.organization_id=v_booking.organization_id;
  v_enabled:=coalesce(v_setting.enabled,false);
  v_eligible:=v_booking.status<>'cancelled'
    and coalesce(v_booking.deposit_amount_rub,0)>0
    and v_booking.payment_status='pending'
    and (v_booking.payment_due_at is null or v_booking.payment_due_at>now());
  v_fallback_url:=case when coalesce(v_booking.payment_url,'')~*'^https://' then v_booking.payment_url end;
  if v_enabled then
    select attempt.* into v_attempt
    from public.payment_provider_attempts attempt
    where attempt.booking_id=v_booking.id and attempt.status in ('creating','pending')
    order by attempt.created_at desc limit 1;
  end if;
  return jsonb_build_object(
    'available',v_eligible and (v_enabled or v_fallback_url is not null),
    'can_create',v_eligible and v_enabled,
    'mode',case when v_enabled then 'yookassa' else 'legacy_link' end,
    'payment_url',case when v_enabled then v_attempt.confirmation_url else v_fallback_url end,
    'fallback_url',v_fallback_url,
    'payment_status',v_booking.payment_status,
    'deposit_amount_rub',v_booking.deposit_amount_rub,
    'payment_due_at',v_booking.payment_due_at,
    'reason',case
      when v_booking.status='cancelled' then 'booking_cancelled'
      when coalesce(v_booking.deposit_amount_rub,0)<=0 then 'deposit_not_required'
      when v_booking.payment_status is distinct from 'pending' then 'payment_not_pending'
      when v_booking.payment_due_at is not null and v_booking.payment_due_at<=now() then 'payment_expired'
      when not v_enabled and v_fallback_url is null then 'payment_provider_disabled'
      else null end
  );
end $$;

create or replace function public.prepare_yookassa_payment(p_manage_token uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype; v_setting public.organization_payment_provider_settings%rowtype;
  v_attempt public.payment_provider_attempts%rowtype; v_service_name text; v_amount bigint;
begin
  if p_manage_token is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='invalid_payment_request';
  end if;
  select booking.* into v_booking from public.bookings booking where booking.manage_token=p_manage_token;
  if not found then raise exception using errcode='P0002',message='booking_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.id::text,8701));
  select booking.* into v_booking from public.bookings booking
  where booking.manage_token=p_manage_token for update;
  if not found then raise exception using errcode='P0002',message='booking_unavailable'; end if;
  select * into v_setting from public.organization_payment_provider_settings setting
  where setting.organization_id=v_booking.organization_id;
  if v_booking.status='cancelled' or v_booking.deposit_amount_rub<=0 then
    raise exception using errcode='P0001',message='booking_payment_not_available';
  end if;
  if v_booking.payment_status is distinct from 'pending' then
    raise exception using errcode='P0001',message='booking_payment_not_pending';
  end if;
  if v_booking.payment_due_at is not null and v_booking.payment_due_at<=now() then
    raise exception using errcode='P0001',message='booking_payment_expired';
  end if;
  if not coalesce(v_setting.enabled,false) then
    return jsonb_build_object(
      'mode','legacy_link','enabled',false,'booking_id',v_booking.id,
      'fallback_url',case when coalesce(v_booking.payment_url,'')~*'^https://' then v_booking.payment_url else null end
    );
  end if;
  v_amount:=v_booking.deposit_amount_rub::bigint*100;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text||':'||p_idempotency_key::text,8702));
  select * into v_attempt from public.payment_provider_attempts attempt
  where attempt.organization_id=v_booking.organization_id and attempt.idempotency_key=p_idempotency_key for update;
  if found then
    if v_attempt.booking_id<>v_booking.id or v_attempt.amount_minor<>v_amount then
      raise exception using errcode='23505',message='payment_idempotency_conflict';
    end if;
  else
    -- A browser may lose its local request id after navigation or a crash. Reuse
    -- the one open provider operation for this exact booking instead of creating
    -- a second YooKassa payment with a fresh idempotence key.
    select * into v_attempt from public.payment_provider_attempts attempt
    where attempt.booking_id=v_booking.id and attempt.amount_minor=v_amount
      and attempt.environment=v_setting.environment and attempt.status in ('creating','pending')
    order by attempt.created_at desc limit 1 for update;
  end if;
  if v_attempt.id is null then
    if exists(select 1 from public.payment_provider_attempts attempt
      where attempt.booking_id=v_booking.id and attempt.status='succeeded'
        and attempt.captured_amount_minor>attempt.refunded_amount_minor) then
      raise exception using errcode='P0001',message='booking_already_paid';
    end if;
    insert into public.payment_provider_attempts(
      organization_id,booking_id,environment,idempotency_key,amount_minor
    ) values(v_booking.organization_id,v_booking.id,v_setting.environment,p_idempotency_key,v_amount)
    returning * into v_attempt;
  end if;
  select service.name into v_service_name from public.services service where service.id=v_booking.service_id;
  return jsonb_build_object(
    'mode','yookassa','enabled',true,'attempt_id',v_attempt.id,'organization_id',v_booking.organization_id,
    'booking_id',v_booking.id,'booking_code',v_booking.booking_code,'environment',v_attempt.environment,
    'idempotency_key',v_attempt.idempotency_key,'amount_minor',v_attempt.amount_minor,
    'currency',v_attempt.currency,'status',v_attempt.status,
    'provider_payment_id',v_attempt.provider_payment_id,'confirmation_url',v_attempt.confirmation_url,
    'client_phone',v_booking.client_phone,'service_name',coalesce(v_service_name,'Услуга'),
    'fiscalization_enabled',v_setting.fiscalization_enabled,'taxation',v_setting.taxation,
    'vat_code',v_setting.vat_code,'payment_mode',v_setting.payment_mode
  );
exception when unique_violation then
  raise exception using errcode='P0001',message='payment_attempt_in_progress';
end $$;

create or replace function public.refresh_minuta_yookassa_booking(p_booking uuid)
returns text language plpgsql security definer set search_path to '' as $$
declare v_deposit bigint; v_booking_status text; v_captured bigint; v_refunded bigint; v_status text;
begin
  select booking.deposit_amount_rub::bigint*100,booking.status into v_deposit,v_booking_status
  from public.bookings booking where booking.id=p_booking for update;
  if not found then raise exception using errcode='P0002',message='booking_unavailable'; end if;
  select coalesce(sum(attempt.captured_amount_minor),0),coalesce(sum(attempt.refunded_amount_minor),0)
  into v_captured,v_refunded from public.payment_provider_attempts attempt
  where attempt.booking_id=p_booking and attempt.status='succeeded';
  v_status:=case when v_deposit<=0 then 'not_required'
    when v_captured=0 then 'pending'
    when v_refunded>=v_captured then 'refunded'
    when v_captured>=v_deposit then 'paid'
    else 'pending' end;
  update public.bookings set payment_status=v_status,
    refund_status=case when v_booking_status='cancelled' and v_captured>0
      then case when v_refunded>=v_captured then 'refunded' else 'pending' end
      else refund_status end
  where id=p_booking;
  return v_status;
end $$;
revoke all on function public.refresh_minuta_yookassa_booking(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.sync_minuta_yookassa_legacy_payment(p_attempt uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_attempt public.payment_provider_attempts%rowtype; v_performer uuid; v_booking_status text; v_status text;
begin
  select * into v_attempt from public.payment_provider_attempts where id=p_attempt for update;
  if not found or v_attempt.provider_payment_id is null then return; end if;
  select booking.performer_id,booking.status into v_performer,v_booking_status
  from public.bookings booking where booking.id=v_attempt.booking_id;
  v_status:=case when v_attempt.status='succeeded' and v_attempt.refunded_amount_minor>=v_attempt.captured_amount_minor then 'refunded'
    when v_attempt.status='succeeded' then 'paid'
    when v_attempt.status='canceled' then 'cancelled'
    when v_attempt.status='failed' then 'failed' else 'pending' end;
  if v_booking_status='cancelled' and not exists(select 1 from public.payments payment
    where payment.provider='yookassa' and payment.provider_operation_id=v_attempt.provider_payment_id) then
    return;
  end if;
  insert into public.payments(
    booking_id,performer_id,provider,provider_operation_id,amount_minor,currency,status,provider_created_at,last_event_at
  ) values(
    v_attempt.booking_id,v_performer,'yookassa',v_attempt.provider_payment_id,v_attempt.amount_minor,
    v_attempt.currency,v_status,v_attempt.provider_created_at,now()
  ) on conflict(provider,provider_operation_id) do update set
    status=excluded.status,last_event_at=excluded.last_event_at;
end $$;
revoke all on function public.sync_minuta_yookassa_legacy_payment(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.complete_yookassa_payment_creation(
  p_attempt uuid,p_provider_payment_id text,p_provider_status text,p_amount_minor bigint,p_currency text,
  p_confirmation_url text,p_provider_created_at timestamptz,p_expires_at timestamptz,p_provider_test boolean
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_attempt public.payment_provider_attempts%rowtype; v_status text; v_booking uuid;
begin
  if char_length(coalesce(p_provider_payment_id,'')) not between 1 and 200
     or p_provider_status not in ('pending','waiting_for_capture','succeeded','canceled')
     or p_currency<>'RUB' or coalesce(p_amount_minor,0)<=0
     or (p_confirmation_url is not null and (char_length(p_confirmation_url)>1000 or p_confirmation_url!~*'^https://')) then
    raise exception using errcode='22023',message='invalid_yookassa_payment_response';
  end if;
  select attempt.booking_id into v_booking from public.payment_provider_attempts attempt where attempt.id=p_attempt;
  if v_booking is null then raise exception using errcode='P0002',message='payment_attempt_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking::text,8701));
  select * into v_attempt from public.payment_provider_attempts where id=p_attempt for update;
  if not found then raise exception using errcode='P0002',message='payment_attempt_unavailable'; end if;
  if v_attempt.amount_minor<>p_amount_minor or v_attempt.currency<>p_currency
     or (v_attempt.environment='test') is distinct from p_provider_test
     or (v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id<>p_provider_payment_id) then
    raise exception using errcode='P0001',message='yookassa_payment_response_mismatch';
  end if;
  v_status:=case
    when v_attempt.status in ('succeeded','canceled') then v_attempt.status
    when p_provider_status='succeeded' then 'succeeded'
    when p_provider_status='canceled' then 'canceled'
    else 'pending' end;
  update public.payment_provider_attempts set provider_payment_id=p_provider_payment_id,status=v_status,
    captured_amount_minor=case when v_status='succeeded' then amount_minor else captured_amount_minor end,
    confirmation_url=coalesce(p_confirmation_url,confirmation_url),provider_created_at=p_provider_created_at,
    expires_at=p_expires_at,
    last_provider_status=case when v_attempt.status in ('succeeded','canceled') then last_provider_status else p_provider_status end,
    last_error_code=null
  where id=p_attempt returning * into v_attempt;
  if p_confirmation_url is not null then
    update public.bookings set payment_url=p_confirmation_url where id=v_attempt.booking_id and status<>'cancelled';
  end if;
  perform public.sync_minuta_yookassa_legacy_payment(p_attempt);
  perform public.refresh_minuta_yookassa_booking(v_attempt.booking_id);
  return jsonb_build_object('attempt_id',p_attempt,'status',v_status,'idempotent',false);
exception when unique_violation then
  raise exception using errcode='P0001',message='provider_payment_id_conflict';
end $$;

create or replace function public.fail_yookassa_payment_attempt(p_attempt uuid,p_error_code text,p_definitive boolean)
returns text language plpgsql security definer set search_path to '' as $$
declare v_status text;
begin
  if char_length(coalesce(p_error_code,'')) not between 1 and 100 or p_definitive is null then
    raise exception using errcode='22023',message='invalid_payment_failure';
  end if;
  update public.payment_provider_attempts set
    status=case when p_definitive and status='creating' then 'failed' else status end,
    last_error_code=p_error_code
  where id=p_attempt returning status into v_status;
  if v_status is null then raise exception using errcode='P0002',message='payment_attempt_unavailable'; end if;
  return v_status;
end $$;

create or replace function public.prepare_yookassa_refund(
  p_organization uuid,p_attempt uuid,p_amount_minor bigint,p_request_id uuid,p_reason text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_attempt public.payment_provider_attempts%rowtype;
  v_refund public.payment_provider_refunds%rowtype; v_reserved bigint; v_setting public.organization_payment_provider_settings%rowtype;
  v_phone text; v_service_name text; v_booking uuid;
begin
  v_role:=public.require_minuta_payment_role(p_organization,p_actor,array['owner','admin']);
  if p_request_id is null or coalesce(p_amount_minor,0)<100 or char_length(btrim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception using errcode='22023',message='invalid_refund_request';
  end if;
  select attempt.booking_id into v_booking from public.payment_provider_attempts attempt
  where attempt.id=p_attempt and attempt.organization_id=p_organization;
  if v_booking is null then raise exception using errcode='P0001',message='payment_not_refundable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking::text,8701));
  perform pg_advisory_xact_lock(hashtextextended(p_attempt::text,8703));
  select * into v_attempt from public.payment_provider_attempts attempt
  where attempt.id=p_attempt and attempt.organization_id=p_organization for update;
  if not found or v_attempt.status<>'succeeded' or v_attempt.provider_payment_id is null then
    raise exception using errcode='P0001',message='payment_not_refundable';
  end if;
  select * into v_setting from public.organization_payment_provider_settings setting
  where setting.organization_id=p_organization and setting.enabled;
  if not found then raise exception using errcode='P0001',message='yookassa_not_enabled'; end if;
  select * into v_refund from public.payment_provider_refunds refund
  where refund.organization_id=p_organization and refund.request_id=p_request_id for update;
  if found then
    if v_refund.attempt_id<>p_attempt or v_refund.amount_minor<>p_amount_minor then
      raise exception using errcode='23505',message='refund_idempotency_conflict';
    end if;
  else
    select * into v_refund from public.payment_provider_refunds refund
    where refund.attempt_id=p_attempt and refund.status in ('creating','pending')
    order by refund.created_at desc limit 1 for update;
    if found and v_refund.amount_minor<>p_amount_minor then
      raise exception using errcode='55000',message='refund_in_progress';
    end if;
  end if;
  if v_refund.id is null then
    select coalesce(sum(refund.amount_minor),0) into v_reserved
    from public.payment_provider_refunds refund
    where refund.attempt_id=p_attempt and refund.status='succeeded';
    if v_reserved+p_amount_minor>v_attempt.captured_amount_minor then
      raise exception using errcode='P0001',message='refund_amount_exceeds_available';
    end if;
    if v_attempt.captured_amount_minor-(v_reserved+p_amount_minor) between 1 and 99 then
      raise exception using errcode='P0001',message='refund_remainder_below_minimum';
    end if;
    insert into public.payment_provider_refunds(
      organization_id,attempt_id,request_id,amount_minor,reason,requested_by
    ) values(p_organization,p_attempt,p_request_id,p_amount_minor,btrim(p_reason),p_actor)
    returning * into v_refund;
    insert into public.payment_provider_audit_log(organization_id,actor_id,action,subject_id,details)
    values(p_organization,p_actor,'refund_requested',v_refund.id,
      jsonb_build_object('attempt_id',p_attempt,'amount_minor',p_amount_minor));
  end if;
  select booking.client_phone,service.name into v_phone,v_service_name
  from public.bookings booking join public.services service on service.id=booking.service_id
  where booking.id=v_attempt.booking_id;
  return jsonb_build_object(
    'refund_id',v_refund.id,'organization_id',p_organization,'attempt_id',p_attempt,
    'request_id',v_refund.request_id,'status',v_refund.status,'amount_minor',v_refund.amount_minor,
    'currency',v_refund.currency,'provider_payment_id',v_attempt.provider_payment_id,
    'provider_refund_id',v_refund.provider_refund_id,
    'environment',v_attempt.environment,'client_phone',v_phone,'service_name',coalesce(v_service_name,'Услуга'),
    'fiscalization_enabled',v_setting.fiscalization_enabled,'taxation',v_setting.taxation,
    'vat_code',v_setting.vat_code,'payment_mode',v_setting.payment_mode
  );
end $$;

create or replace function public.complete_yookassa_refund(
  p_refund uuid,p_provider_refund_id text,p_provider_status text,p_amount_minor bigint,p_currency text,
  p_provider_payment_id text,p_provider_created_at timestamptz
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_refund public.payment_provider_refunds%rowtype; v_attempt public.payment_provider_attempts%rowtype;
  v_status text; v_total bigint; v_attempt_id uuid; v_booking uuid;
begin
  if char_length(coalesce(p_provider_refund_id,'')) not between 1 and 200
     or p_provider_status not in ('pending','succeeded','canceled') or p_currency<>'RUB' then
    raise exception using errcode='22023',message='invalid_yookassa_refund_response';
  end if;
  select refund.attempt_id into v_attempt_id from public.payment_provider_refunds refund where refund.id=p_refund;
  select attempt.booking_id into v_booking from public.payment_provider_attempts attempt where attempt.id=v_attempt_id;
  if v_booking is null then raise exception using errcode='P0002',message='refund_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking::text,8701));
  select * into v_refund from public.payment_provider_refunds where id=p_refund for update;
  if not found then raise exception using errcode='P0002',message='refund_unavailable'; end if;
  select * into v_attempt from public.payment_provider_attempts where id=v_refund.attempt_id for update;
  if v_refund.amount_minor<>p_amount_minor or v_refund.currency<>p_currency
     or v_attempt.provider_payment_id<>p_provider_payment_id
     or (v_refund.provider_refund_id is not null and v_refund.provider_refund_id<>p_provider_refund_id) then
    raise exception using errcode='P0001',message='yookassa_refund_response_mismatch';
  end if;
  v_status:=case
    when v_refund.status in ('succeeded','canceled') then v_refund.status
    when p_provider_status='succeeded' then 'succeeded'
    when p_provider_status='canceled' then 'canceled'
    else 'pending' end;
  update public.payment_provider_refunds set provider_refund_id=p_provider_refund_id,status=v_status,
    provider_created_at=p_provider_created_at,last_error_code=null where id=p_refund;
  select coalesce(sum(refund.amount_minor),0) into v_total from public.payment_provider_refunds refund
  where refund.attempt_id=v_attempt.id and refund.status='succeeded';
  update public.payment_provider_attempts set refunded_amount_minor=least(captured_amount_minor,v_total)
  where id=v_attempt.id;
  perform public.sync_minuta_yookassa_legacy_payment(v_attempt.id);
  perform public.refresh_minuta_yookassa_booking(v_attempt.booking_id);
  return jsonb_build_object('refund_id',p_refund,'status',v_status);
exception when unique_violation then
  raise exception using errcode='P0001',message='provider_refund_id_conflict';
end $$;

create or replace function public.fail_yookassa_refund(p_refund uuid,p_error_code text,p_definitive boolean)
returns text language plpgsql security definer set search_path to '' as $$
declare v_status text;
begin
  if char_length(coalesce(p_error_code,'')) not between 1 and 100 or p_definitive is null then
    raise exception using errcode='22023',message='invalid_refund_failure';
  end if;
  update public.payment_provider_refunds set
    status=case when p_definitive and status='creating' then 'failed' else status end,
    last_error_code=p_error_code
  where id=p_refund returning status into v_status;
  if v_status is null then raise exception using errcode='P0002',message='refund_unavailable'; end if;
  return v_status;
end $$;

create or replace function public.process_yookassa_payment_event(
  p_attempt uuid,p_event_key text,p_event_type text,p_provider_payment_id text,p_provider_status text,
  p_amount_minor bigint,p_currency text,p_payload_sha256 text,p_provider_created_at timestamptz,p_provider_test boolean
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_attempt public.payment_provider_attempts%rowtype; v_event bigint; v_status text; v_booking uuid;
begin
  if char_length(coalesce(p_event_key,'')) not between 1 and 300
     or p_event_type not in ('payment.waiting_for_capture','payment.succeeded','payment.canceled')
     or char_length(coalesce(p_provider_payment_id,'')) not between 1 and 200
     or p_provider_status not in ('waiting_for_capture','succeeded','canceled')
     or p_currency<>'RUB' or p_payload_sha256!~'^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid_yookassa_payment_event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('yookassa:'||p_event_key,8704));
  select attempt.booking_id into v_booking from public.payment_provider_attempts attempt where attempt.id=p_attempt;
  if v_booking is null then raise exception using errcode='P0001',message='yookassa_payment_event_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking::text,8701));
  select * into v_attempt from public.payment_provider_attempts where id=p_attempt for update;
  if not found or v_attempt.amount_minor<>p_amount_minor or v_attempt.currency<>p_currency
     or (v_attempt.environment='test') is distinct from p_provider_test
     or (v_attempt.provider_payment_id is not null and v_attempt.provider_payment_id<>p_provider_payment_id) then
    raise exception using errcode='P0001',message='yookassa_payment_event_mismatch';
  end if;
  if (v_attempt.status='succeeded' and p_provider_status<>'succeeded')
     or (v_attempt.status='canceled' and p_provider_status<>'canceled') then
    raise exception using errcode='P0001',message='yookassa_terminal_state_conflict';
  end if;
  insert into public.payment_provider_events(
    organization_id,attempt_id,provider,event_key,event_type,provider_object_id,provider_status,
    amount_minor,currency,payload_sha256,processing_status,processed_at
  ) values(
    v_attempt.organization_id,v_attempt.id,'yookassa',p_event_key,p_event_type,p_provider_payment_id,p_provider_status,
    p_amount_minor,p_currency,p_payload_sha256,'processed',now()
  ) on conflict(provider,event_key) do nothing returning id into v_event;
  if v_event is null then return jsonb_build_object('accepted',true,'duplicate',true); end if;
  v_status:=case p_provider_status when 'succeeded' then 'succeeded' when 'canceled' then 'canceled' else 'pending' end;
  update public.payment_provider_attempts set provider_payment_id=p_provider_payment_id,status=v_status,
    captured_amount_minor=case when v_status='succeeded' then amount_minor else captured_amount_minor end,
    provider_created_at=coalesce(provider_created_at,p_provider_created_at),
    last_provider_status=p_provider_status,last_error_code=null where id=v_attempt.id;
  perform public.sync_minuta_yookassa_legacy_payment(v_attempt.id);
  perform public.refresh_minuta_yookassa_booking(v_attempt.booking_id);
  insert into public.payment_provider_reconciliations(
    organization_id,request_id,object_kind,attempt_id,provider_object_id,provider_status,
    amount_minor,currency,source,outcome,payload_sha256
  ) values(v_attempt.organization_id,gen_random_uuid(),'payment',v_attempt.id,p_provider_payment_id,p_provider_status,
    p_amount_minor,p_currency,'webhook','updated',p_payload_sha256);
  return jsonb_build_object('accepted',true,'duplicate',false,'status',v_status);
end $$;

create or replace function public.process_yookassa_refund_event(
  p_refund uuid,p_event_key text,p_event_type text,p_provider_refund_id text,p_provider_payment_id text,
  p_provider_status text,p_amount_minor bigint,p_currency text,p_payload_sha256 text,p_provider_created_at timestamptz
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_refund public.payment_provider_refunds%rowtype; v_attempt public.payment_provider_attempts%rowtype;
  v_event bigint; v_total bigint; v_attempt_id uuid; v_booking uuid;
begin
  if char_length(coalesce(p_event_key,'')) not between 1 and 300 or p_event_type<>'refund.succeeded'
     or p_provider_status<>'succeeded' or p_currency<>'RUB' or p_payload_sha256!~'^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='invalid_yookassa_refund_event';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('yookassa:'||p_event_key,8705));
  select refund.attempt_id into v_attempt_id from public.payment_provider_refunds refund where refund.id=p_refund;
  select attempt.booking_id into v_booking from public.payment_provider_attempts attempt where attempt.id=v_attempt_id;
  if v_booking is null then raise exception using errcode='P0001',message='yookassa_refund_event_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking::text,8701));
  select * into v_refund from public.payment_provider_refunds where id=p_refund for update;
  if not found or v_refund.amount_minor<>p_amount_minor or v_refund.currency<>p_currency
     or (v_refund.provider_refund_id is not null and v_refund.provider_refund_id<>p_provider_refund_id) then
    raise exception using errcode='P0001',message='yookassa_refund_event_mismatch';
  end if;
  select * into v_attempt from public.payment_provider_attempts where id=v_refund.attempt_id for update;
  if v_attempt.provider_payment_id<>p_provider_payment_id then
    raise exception using errcode='P0001',message='yookassa_refund_payment_mismatch';
  end if;
  insert into public.payment_provider_events(
    organization_id,refund_id,provider,event_key,event_type,provider_object_id,provider_status,
    amount_minor,currency,payload_sha256,processing_status,processed_at
  ) values(
    v_refund.organization_id,v_refund.id,'yookassa',p_event_key,p_event_type,p_provider_refund_id,p_provider_status,
    p_amount_minor,p_currency,p_payload_sha256,'processed',now()
  ) on conflict(provider,event_key) do nothing returning id into v_event;
  if v_event is null then return jsonb_build_object('accepted',true,'duplicate',true); end if;
  update public.payment_provider_refunds set provider_refund_id=p_provider_refund_id,status='succeeded',
    provider_created_at=coalesce(provider_created_at,p_provider_created_at),last_error_code=null where id=v_refund.id;
  select coalesce(sum(refund.amount_minor),0) into v_total from public.payment_provider_refunds refund
  where refund.attempt_id=v_attempt.id and refund.status='succeeded';
  update public.payment_provider_attempts set refunded_amount_minor=least(captured_amount_minor,v_total)
  where id=v_attempt.id;
  perform public.sync_minuta_yookassa_legacy_payment(v_attempt.id);
  perform public.refresh_minuta_yookassa_booking(v_attempt.booking_id);
  insert into public.payment_provider_reconciliations(
    organization_id,request_id,object_kind,attempt_id,refund_id,provider_object_id,provider_status,
    amount_minor,currency,source,outcome,payload_sha256
  ) values(v_refund.organization_id,gen_random_uuid(),'refund',v_attempt.id,v_refund.id,p_provider_refund_id,p_provider_status,
    p_amount_minor,p_currency,'webhook','updated',p_payload_sha256);
  return jsonb_build_object('accepted',true,'duplicate',false,'status','succeeded');
end $$;

create or replace function public.record_yookassa_reconciliation(
  p_request_id uuid,p_object_kind text,p_local_id uuid,p_provider_object_id text,p_provider_status text,
  p_amount_minor bigint,p_currency text,p_source text,p_outcome text,p_payload_sha256 text default null,
  p_error_code text default null
) returns bigint language plpgsql security definer set search_path to '' as $$
declare v_organization uuid; v_attempt uuid; v_refund uuid; v_id bigint;
begin
  if p_request_id is null or p_object_kind not in ('payment','refund')
     or p_source not in ('create','webhook','refund','scheduled','manual')
     or p_outcome not in ('matched','updated','pending','failed') then
    raise exception using errcode='22023',message='invalid_reconciliation';
  end if;
  if p_object_kind='payment' then
    select attempt.organization_id,attempt.id into v_organization,v_attempt
    from public.payment_provider_attempts attempt where attempt.id=p_local_id;
  else
    select refund.organization_id,refund.attempt_id,refund.id into v_organization,v_attempt,v_refund
    from public.payment_provider_refunds refund where refund.id=p_local_id;
  end if;
  if v_organization is null then raise exception using errcode='P0002',message='reconciliation_object_unavailable'; end if;
  insert into public.payment_provider_reconciliations(
    organization_id,request_id,object_kind,attempt_id,refund_id,provider_object_id,provider_status,
    amount_minor,currency,source,outcome,payload_sha256,error_code
  ) values(v_organization,p_request_id,p_object_kind,v_attempt,v_refund,p_provider_object_id,p_provider_status,
    p_amount_minor,p_currency,p_source,p_outcome,p_payload_sha256,p_error_code)
  on conflict(organization_id,object_kind,request_id) do update set
    provider_object_id=excluded.provider_object_id,provider_status=excluded.provider_status,
    amount_minor=excluded.amount_minor,currency=excluded.currency,source=excluded.source,
    outcome=excluded.outcome,payload_sha256=excluded.payload_sha256,error_code=excluded.error_code,
    checked_at=now()
  where public.payment_provider_reconciliations.object_kind=excluded.object_kind
    and public.payment_provider_reconciliations.attempt_id=excluded.attempt_id
    and public.payment_provider_reconciliations.refund_id is not distinct from excluded.refund_id
  returning id into v_id;
  if v_id is null then raise exception using errcode='23505',message='reconciliation_idempotency_conflict'; end if;
  return v_id;
end $$;

do $$ declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.set_minuta_yookassa_settings(uuid,boolean,text,boolean,text,integer,text)'::regprocedure,
    'public.get_minuta_payment_workspace(uuid)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_signature);
    execute format('grant execute on function %s to authenticated',v_signature);
  end loop;
  v_signature:='public.get_yookassa_payment_capability(uuid)'::regprocedure;
  execute format('revoke all on function %s from public,anon,authenticated,service_role',v_signature);
  execute format('grant execute on function %s to anon,authenticated',v_signature);
  foreach v_signature in array array[
    'public.prepare_yookassa_payment(uuid,uuid)'::regprocedure,
    'public.complete_yookassa_payment_creation(uuid,text,text,bigint,text,text,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure,
    'public.fail_yookassa_payment_attempt(uuid,text,boolean)'::regprocedure,
    'public.prepare_yookassa_refund(uuid,uuid,bigint,uuid,text,uuid)'::regprocedure,
    'public.complete_yookassa_refund(uuid,text,text,bigint,text,text,timestamp with time zone)'::regprocedure,
    'public.fail_yookassa_refund(uuid,text,boolean)'::regprocedure,
    'public.process_yookassa_payment_event(uuid,text,text,text,text,bigint,text,text,timestamp with time zone,boolean)'::regprocedure,
    'public.process_yookassa_refund_event(uuid,text,text,text,text,text,bigint,text,text,timestamp with time zone)'::regprocedure,
    'public.record_yookassa_reconciliation(uuid,text,uuid,text,text,bigint,text,text,text,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',v_signature);
    execute format('grant execute on function %s to service_role',v_signature);
  end loop;
end $$;

commit;
