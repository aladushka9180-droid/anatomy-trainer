begin;

set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.organization_benefit_settings') is null
     or to_regprocedure('public.get_minuta_benefit_workspace(uuid)') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('public.client_accounts') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='organization_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='client_account_id') then
    raise exception using errcode='P0001',message='v81_requires_v73_benefits_and_multitenant_bookings';
  end if;
end $$;

create table if not exists public.organization_loyalty_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  max_redeem_percent_bps integer not null default 3000 check(max_redeem_percent_bps between 0 and 10000),
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check(char_length(name) between 2 and 120),
  earn_rate_bps integer not null check(earn_rate_bps between 1 and 10000),
  min_paid_amount_rub integer not null default 0 check(min_paid_amount_rub between 0 and 10000000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id)
);
create unique index if not exists loyalty_rules_one_active_idx on public.loyalty_rules(organization_id) where active;

create table if not exists public.client_loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  balance_points integer not null default 0 check(balance_points between -10000000 and 10000000),
  lifetime_earned integer not null default 0 check(lifetime_earned between 0 and 100000000),
  lifetime_spent integer not null default 0 check(lifetime_spent between 0 and 100000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,client_account_id)
);

create table if not exists public.loyalty_visit_awards (
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null,
  rule_id uuid not null,
  paid_amount_rub integer not null check(paid_amount_rub between 1 and 10000000),
  awarded_points integer not null check(awarded_points between 1 and 10000000),
  active boolean not null default true,
  awarded_at timestamptz not null default now(),
  reversed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key(account_id,organization_id) references public.client_loyalty_accounts(id,organization_id) on delete restrict,
  foreign key(rule_id,organization_id) references public.loyalty_rules(id,organization_id) on delete restrict,
  unique(booking_id,organization_id)
);

create table if not exists public.loyalty_ledger (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  event_type text not null check(event_type in ('visit_earned','visit_reversed','manual_adjustment','redemption')),
  points_delta integer not null check(points_delta<>0 and points_delta between -10000000 and 10000000),
  balance_after integer not null check(balance_after between -10000000 and 10000000),
  booking_id uuid references public.bookings(id) on delete restrict,
  request_id uuid,
  reason text check(reason is null or char_length(reason) between 8 and 500),
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(account_id,organization_id) references public.client_loyalty_accounts(id,organization_id) on delete restrict
);
create index if not exists loyalty_ledger_scope_idx on public.loyalty_ledger(organization_id,account_id,id desc);
create unique index if not exists loyalty_ledger_request_idx on public.loyalty_ledger(organization_id,request_id) where request_id is not null;

create table if not exists public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  points integer not null check(points between 1 and 10000000),
  request_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(account_id,organization_id) references public.client_loyalty_accounts(id,organization_id) on delete restrict,
  unique(organization_id,booking_id),
  unique(organization_id,request_id)
);

create table if not exists public.loyalty_promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  code text not null check(code=upper(trim(code)) and code~'^[A-ZА-ЯЁ0-9_-]{3,32}$'),
  kind text not null check(kind in ('percent','fixed')),
  value integer not null check(value>0 and value<=10000000),
  valid_from date not null,
  valid_until date not null check(valid_until>=valid_from),
  total_limit integer check(total_limit between 1 and 1000000),
  per_client_limit integer check(per_client_limit between 1 and 10000),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,code),
  check((kind='percent' and value<=10000) or kind='fixed')
);

create table if not exists public.loyalty_promo_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  promotion_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  request_id uuid not null,
  original_amount_rub integer not null check(original_amount_rub between 1 and 10000000),
  discount_rub integer not null check(discount_rub between 1 and original_amount_rub),
  final_amount_rub integer not null check(final_amount_rub=original_amount_rub-discount_rub),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(promotion_id,organization_id) references public.loyalty_promotions(id,organization_id) on delete restrict,
  unique(organization_id,booking_id),
  unique(organization_id,request_id)
);
create index if not exists loyalty_promo_usage_idx on public.loyalty_promo_redemptions(organization_id,promotion_id,client_account_id);

alter table public.organization_loyalty_settings enable row level security;
alter table public.loyalty_rules enable row level security;
alter table public.client_loyalty_accounts enable row level security;
alter table public.loyalty_visit_awards enable row level security;
alter table public.loyalty_ledger enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.loyalty_promotions enable row level security;
alter table public.loyalty_promo_redemptions enable row level security;

do $$ declare v_table text;
begin
  foreach v_table in array array['organization_loyalty_settings','loyalty_rules','client_loyalty_accounts','loyalty_visit_awards','loyalty_ledger','loyalty_redemptions','loyalty_promotions','loyalty_promo_redemptions'] loop
    execute format('drop policy if exists loyalty_manager_read on public.%I',v_table);
    execute format('create policy loyalty_manager_read on public.%I for select to authenticated using (public.has_organization_role(organization_id,array[''owner'',''admin'']))',v_table);
  end loop;
end $$;

revoke all on public.organization_loyalty_settings,public.loyalty_rules,public.client_loyalty_accounts,
  public.loyalty_visit_awards,public.loyalty_ledger,public.loyalty_redemptions,
  public.loyalty_promotions,public.loyalty_promo_redemptions from public,anon,authenticated;
grant select on public.organization_loyalty_settings,public.loyalty_rules,public.client_loyalty_accounts,
  public.loyalty_visit_awards,public.loyalty_ledger,public.loyalty_redemptions,
  public.loyalty_promotions,public.loyalty_promo_redemptions to authenticated;
grant all on public.organization_loyalty_settings,public.loyalty_rules,public.client_loyalty_accounts,
  public.loyalty_visit_awards,public.loyalty_ledger,public.loyalty_redemptions,
  public.loyalty_promotions,public.loyalty_promo_redemptions to service_role;

create or replace function public.get_minuta_loyalty_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role not in ('owner','admin') then raise exception using errcode='42501',message='loyalty_management_denied'; end if;
  return v_role;
end $$;
revoke all on function public.get_minuta_loyalty_role(uuid) from public,anon,authenticated,service_role;

create or replace function public.protect_minuta_loyalty_history()
returns trigger language plpgsql set search_path to '' as $$
begin raise exception using errcode='55000',message='loyalty_history_immutable'; end $$;
drop trigger if exists loyalty_ledger_immutable on public.loyalty_ledger;
create trigger loyalty_ledger_immutable before update or delete on public.loyalty_ledger for each row execute function public.protect_minuta_loyalty_history();
drop trigger if exists loyalty_redemptions_immutable on public.loyalty_redemptions;
create trigger loyalty_redemptions_immutable before update or delete on public.loyalty_redemptions for each row execute function public.protect_minuta_loyalty_history();
drop trigger if exists loyalty_promo_redemptions_immutable on public.loyalty_promo_redemptions;
create trigger loyalty_promo_redemptions_immutable before update or delete on public.loyalty_promo_redemptions for each row execute function public.protect_minuta_loyalty_history();

create or replace function public.set_minuta_loyalty_enabled(p_organization uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_enabled is null then raise exception using errcode='22023',message='invalid_loyalty_enabled'; end if;
  insert into public.organization_loyalty_settings(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled and not public.organization_loyalty_settings.enabled then now() else public.organization_loyalty_settings.enabled_at end,
    enabled_by=case when excluded.enabled and not public.organization_loyalty_settings.enabled then auth.uid() else public.organization_loyalty_settings.enabled_by end,
    updated_at=now();
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end $$;
revoke all on function public.set_minuta_loyalty_enabled(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_loyalty_enabled(uuid,boolean) to authenticated;

create or replace function public.upsert_minuta_loyalty_rule(p_organization uuid,p_name text,p_earn_rate_bps integer,p_min_paid_amount_rub integer,p_max_redeem_percent_bps integer)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_rule uuid;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  if not coalesce((select enabled from public.organization_loyalty_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='loyalty_disabled'; end if;
  if char_length(trim(coalesce(p_name,''))) not between 2 and 120 or p_earn_rate_bps not between 1 and 10000
     or p_min_paid_amount_rub not between 0 and 10000000 or p_max_redeem_percent_bps not between 0 and 10000 then
    raise exception using errcode='22023',message='invalid_loyalty_rule';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,8100));
  update public.loyalty_rules set active=false,updated_at=now() where organization_id=p_organization and active;
  insert into public.loyalty_rules(organization_id,name,earn_rate_bps,min_paid_amount_rub,created_by)
  values(p_organization,trim(p_name),p_earn_rate_bps,p_min_paid_amount_rub,auth.uid()) returning id into v_rule;
  update public.organization_loyalty_settings set max_redeem_percent_bps=p_max_redeem_percent_bps,updated_at=now() where organization_id=p_organization;
  return jsonb_build_object('organization_id',p_organization,'id',v_rule);
end $$;
revoke all on function public.upsert_minuta_loyalty_rule(uuid,text,integer,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_loyalty_rule(uuid,text,integer,integer,integer) to authenticated;

create or replace function public.reconcile_minuta_loyalty_visit()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_booking public.bookings%rowtype; v_rule public.loyalty_rules%rowtype; v_award public.loyalty_visit_awards%rowtype;
  v_account uuid; v_desired integer:=0; v_delta integer:=0; v_balance integer; v_qualifies boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.booking_id::text,8101));
  select * into v_booking from public.bookings where id=new.booking_id;
  if v_booking.id is null or v_booking.organization_id is null or v_booking.client_account_id is null then return new; end if;
  select * into v_award from public.loyalty_visit_awards where booking_id=new.booking_id for update;
  v_qualifies:=new.visit_status='completed' and new.payment_method<>'unpaid' and coalesce(new.amount_rub,0)>0 and v_booking.status<>'cancelled';
  if v_award.booking_id is not null then
    select * into v_rule from public.loyalty_rules where id=v_award.rule_id;
    v_account:=v_award.account_id;
    if v_qualifies then v_desired:=greatest(1,floor(new.amount_rub*v_rule.earn_rate_bps/10000.0)::integer); end if;
  elsif v_qualifies and coalesce((select enabled from public.organization_loyalty_settings where organization_id=v_booking.organization_id),false)
    and v_booking.booking_date+v_booking.booking_time>=timezone('Europe/Samara',(select enabled_at from public.organization_loyalty_settings where organization_id=v_booking.organization_id)) then
    select * into v_rule from public.loyalty_rules where organization_id=v_booking.organization_id and active;
    if v_rule.id is not null and new.amount_rub>=v_rule.min_paid_amount_rub then
      v_desired:=greatest(1,floor(new.amount_rub*v_rule.earn_rate_bps/10000.0)::integer);
      insert into public.client_loyalty_accounts(organization_id,client_account_id) values(v_booking.organization_id,v_booking.client_account_id)
      on conflict(organization_id,client_account_id) do nothing;
      select id into v_account from public.client_loyalty_accounts where organization_id=v_booking.organization_id and client_account_id=v_booking.client_account_id for update;
    end if;
  end if;
  if v_award.booking_id is null and v_desired>0 then
    insert into public.loyalty_visit_awards(booking_id,organization_id,account_id,rule_id,paid_amount_rub,awarded_points)
    values(new.booking_id,v_booking.organization_id,v_account,v_rule.id,new.amount_rub,v_desired);
    update public.client_loyalty_accounts set balance_points=balance_points+v_desired,lifetime_earned=lifetime_earned+v_desired,updated_at=now() where id=v_account returning balance_points into v_balance;
    insert into public.loyalty_ledger(organization_id,account_id,client_account_id,event_type,points_delta,balance_after,booking_id,details,actor_id)
    values(v_booking.organization_id,v_account,v_booking.client_account_id,'visit_earned',v_desired,v_balance,new.booking_id,jsonb_build_object('paid_amount_rub',new.amount_rub,'earn_rate_bps',v_rule.earn_rate_bps,'rule_id',v_rule.id),auth.uid());
  elsif v_award.booking_id is not null then
    v_delta:=v_desired-case when v_award.active then v_award.awarded_points else 0 end;
    if v_delta<>0 then
      update public.client_loyalty_accounts set balance_points=balance_points+v_delta,
        lifetime_earned=lifetime_earned+greatest(v_delta,0),updated_at=now() where id=v_account returning balance_points into v_balance;
      update public.loyalty_visit_awards set awarded_points=case when v_desired>0 then v_desired else awarded_points end,
        paid_amount_rub=case when v_desired>0 then new.amount_rub else paid_amount_rub end,active=v_desired>0,
        reversed_at=case when v_desired=0 then now() else null end,updated_at=now() where booking_id=new.booking_id;
      insert into public.loyalty_ledger(organization_id,account_id,client_account_id,event_type,points_delta,balance_after,booking_id,details,actor_id)
      values(v_booking.organization_id,v_account,v_booking.client_account_id,case when v_delta>0 then 'visit_earned' else 'visit_reversed' end,v_delta,v_balance,new.booking_id,jsonb_build_object('paid_amount_rub',new.amount_rub,'rule_id',v_rule.id),auth.uid());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists booking_outcomes_loyalty_reconcile on public.booking_outcomes;
create trigger booking_outcomes_loyalty_reconcile after insert or update of visit_status,payment_method,amount_rub on public.booking_outcomes for each row execute function public.reconcile_minuta_loyalty_visit();

create or replace function public.adjust_minuta_loyalty_balance(p_organization uuid,p_client_account uuid,p_points_delta integer,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_account uuid; v_balance integer; v_existing record;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  if not coalesce((select enabled from public.organization_loyalty_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='loyalty_disabled'; end if;
  if p_request_id is null or p_points_delta=0 or p_points_delta not between -1000000 and 1000000 or char_length(trim(coalesce(p_reason,''))) not between 8 and 500 then raise exception using errcode='22023',message='invalid_loyalty_adjustment'; end if;
  if not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then raise exception using errcode='42501',message='loyalty_client_not_in_organization'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,8102));
  select ledger.account_id,ledger.client_account_id,ledger.points_delta,ledger.reason,ledger.balance_after into v_existing from public.loyalty_ledger ledger where ledger.organization_id=p_organization and ledger.request_id=p_request_id;
  if found then
    if v_existing.client_account_id<>p_client_account or v_existing.points_delta<>p_points_delta or v_existing.reason<>trim(p_reason) then raise exception using errcode='23505',message='loyalty_request_conflict'; end if;
    return jsonb_build_object('organization_id',p_organization,'account_id',v_existing.account_id,'balance_points',v_existing.balance_after);
  end if;
  insert into public.client_loyalty_accounts(organization_id,client_account_id) values(p_organization,p_client_account) on conflict(organization_id,client_account_id) do nothing;
  select id,balance_points into v_account,v_balance from public.client_loyalty_accounts where organization_id=p_organization and client_account_id=p_client_account for update;
  if v_balance+p_points_delta<0 then raise exception using errcode='55000',message='insufficient_loyalty_balance'; end if;
  update public.client_loyalty_accounts set balance_points=balance_points+p_points_delta,lifetime_earned=lifetime_earned+greatest(p_points_delta,0),
    lifetime_spent=lifetime_spent+greatest(-p_points_delta,0),updated_at=now() where id=v_account returning balance_points into v_balance;
  insert into public.loyalty_ledger(organization_id,account_id,client_account_id,event_type,points_delta,balance_after,request_id,reason,actor_id)
  values(p_organization,v_account,p_client_account,'manual_adjustment',p_points_delta,v_balance,p_request_id,trim(p_reason),auth.uid());
  return jsonb_build_object('organization_id',p_organization,'account_id',v_account,'balance_points',v_balance);
end $$;
revoke all on function public.adjust_minuta_loyalty_balance(uuid,uuid,integer,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.adjust_minuta_loyalty_balance(uuid,uuid,integer,text,uuid) to authenticated;

create or replace function public.redeem_minuta_loyalty(p_organization uuid,p_booking uuid,p_points integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_booking public.bookings%rowtype; v_account uuid; v_balance integer; v_paid integer; v_limit integer; v_existing public.loyalty_redemptions%rowtype;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  if not coalesce((select enabled from public.organization_loyalty_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='loyalty_disabled'; end if;
  if p_request_id is null or p_points not between 1 and 10000000 then raise exception using errcode='22023',message='invalid_loyalty_redemption'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_booking::text,8103));
  select * into v_existing from public.loyalty_redemptions where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.booking_id<>p_booking or v_existing.points<>p_points then raise exception using errcode='23505',message='loyalty_request_conflict'; end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'points',v_existing.points);
  end if;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization and client_account_id is not null and status<>'cancelled' for update;
  select outcome.amount_rub into v_paid from public.booking_outcomes outcome where outcome.booking_id=p_booking and outcome.visit_status='completed' and outcome.payment_method<>'unpaid' and outcome.amount_rub>0;
  if v_booking.id is null or v_paid is null then raise exception using errcode='55000',message='loyalty_booking_not_paid'; end if;
  select id,balance_points into v_account,v_balance from public.client_loyalty_accounts where organization_id=p_organization and client_account_id=v_booking.client_account_id for update;
  if v_account is null or v_balance<p_points then raise exception using errcode='55000',message='insufficient_loyalty_balance'; end if;
  v_limit:=floor(v_paid*(select max_redeem_percent_bps from public.organization_loyalty_settings where organization_id=p_organization)/10000.0)::integer;
  if p_points>v_limit then raise exception using errcode='55000',message='loyalty_redemption_limit_exceeded'; end if;
  if exists(select 1 from public.loyalty_redemptions where organization_id=p_organization and booking_id=p_booking) then raise exception using errcode='23505',message='loyalty_booking_already_redeemed'; end if;
  insert into public.loyalty_redemptions(organization_id,account_id,booking_id,points,request_id,actor_id)
  values(p_organization,v_account,p_booking,p_points,p_request_id,auth.uid()) returning * into v_existing;
  update public.client_loyalty_accounts set balance_points=balance_points-p_points,lifetime_spent=lifetime_spent+p_points,updated_at=now() where id=v_account returning balance_points into v_balance;
  insert into public.loyalty_ledger(organization_id,account_id,client_account_id,event_type,points_delta,balance_after,booking_id,request_id,reason,actor_id)
  values(p_organization,v_account,v_booking.client_account_id,'redemption',-p_points,v_balance,p_booking,p_request_id,'Списание на завершённый оплаченный визит',auth.uid());
  return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'points',p_points,'balance_points',v_balance);
end $$;
revoke all on function public.redeem_minuta_loyalty(uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.redeem_minuta_loyalty(uuid,uuid,integer,uuid) to authenticated;

create or replace function public.upsert_minuta_promotion(p_organization uuid,p_code text,p_kind text,p_value integer,p_valid_from date,p_valid_until date,p_total_limit integer,p_per_client_limit integer)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_code text; v_id uuid;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization); v_code:=upper(trim(coalesce(p_code,'')));
  if not coalesce((select enabled from public.organization_loyalty_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='loyalty_disabled'; end if;
  if v_code!~'^[A-ZА-ЯЁ0-9_-]{3,32}$' or p_kind not in ('percent','fixed') or p_value<=0 or p_value>10000000
     or (p_kind='percent' and p_value>10000) or p_valid_from is null or p_valid_until is null or p_valid_until<p_valid_from
     or coalesce(p_total_limit,1) not between 1 and 1000000 or coalesce(p_per_client_limit,1) not between 1 and 10000 then raise exception using errcode='22023',message='invalid_promotion'; end if;
  insert into public.loyalty_promotions(organization_id,code,kind,value,valid_from,valid_until,total_limit,per_client_limit,created_by)
  values(p_organization,v_code,p_kind,p_value,p_valid_from,p_valid_until,p_total_limit,p_per_client_limit,auth.uid())
  on conflict(organization_id,code) do update set kind=excluded.kind,value=excluded.value,valid_from=excluded.valid_from,valid_until=excluded.valid_until,
    total_limit=excluded.total_limit,per_client_limit=excluded.per_client_limit,updated_at=now() returning id into v_id;
  return jsonb_build_object('organization_id',p_organization,'id',v_id,'code',v_code);
end $$;
revoke all on function public.upsert_minuta_promotion(uuid,text,text,integer,date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_promotion(uuid,text,text,integer,date,date,integer,integer) to authenticated;

create or replace function public.set_minuta_promotion_active(p_organization uuid,p_promotion uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  if p_active is null then raise exception using errcode='22023',message='invalid_promotion_status'; end if;
  update public.loyalty_promotions set active=p_active,updated_at=now() where id=p_promotion and organization_id=p_organization;
  if not found then raise exception using errcode='P0002',message='promotion_not_found'; end if;
  return jsonb_build_object('organization_id',p_organization,'id',p_promotion,'active',p_active);
end $$;
revoke all on function public.set_minuta_promotion_active(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_promotion_active(uuid,uuid,boolean) to authenticated;

create or replace function public.redeem_minuta_promotion(p_organization uuid,p_code text,p_booking uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_promo public.loyalty_promotions%rowtype; v_booking public.bookings%rowtype; v_existing public.loyalty_promo_redemptions%rowtype;
  v_amount integer; v_discount integer; v_total integer; v_client integer;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  if not coalesce((select enabled from public.organization_loyalty_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='loyalty_disabled'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='promotion_request_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||upper(trim(coalesce(p_code,''))),8104));
  select * into v_existing from public.loyalty_promo_redemptions where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.booking_id<>p_booking or not exists(select 1 from public.loyalty_promotions promotion where promotion.id=v_existing.promotion_id and promotion.organization_id=p_organization and promotion.code=upper(trim(coalesce(p_code,'')))) then raise exception using errcode='23505',message='loyalty_request_conflict'; end if;
    return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'discount_rub',v_existing.discount_rub,'final_amount_rub',v_existing.final_amount_rub);
  end if;
  select * into v_promo from public.loyalty_promotions where organization_id=p_organization and code=upper(trim(coalesce(p_code,''))) for update;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization and client_account_id is not null and status<>'cancelled' for update;
  if v_promo.id is null or v_booking.id is null or not v_promo.active or current_date not between v_promo.valid_from and v_promo.valid_until then raise exception using errcode='55000',message='promo_not_available'; end if;
  select count(*) into v_total from public.loyalty_promo_redemptions where organization_id=p_organization and promotion_id=v_promo.id;
  select count(*) into v_client from public.loyalty_promo_redemptions where organization_id=p_organization and promotion_id=v_promo.id and client_account_id=v_booking.client_account_id;
  if v_promo.total_limit is not null and v_total>=v_promo.total_limit then raise exception using errcode='55000',message='promo_total_limit_reached'; end if;
  if v_promo.per_client_limit is not null and v_client>=v_promo.per_client_limit then raise exception using errcode='55000',message='promo_client_limit_reached'; end if;
  if exists(select 1 from public.loyalty_promo_redemptions where organization_id=p_organization and booking_id=p_booking) then raise exception using errcode='23505',message='promo_already_applied'; end if;
  select coalesce(nullif(outcome.amount_rub,0),nullif(v_booking.total_price_rub,0),service.price_rub) into v_amount
  from public.services service left join public.booking_outcomes outcome on outcome.booking_id=v_booking.id where service.id=v_booking.service_id;
  if coalesce(v_amount,0)<=0 then raise exception using errcode='55000',message='promo_booking_amount_unavailable'; end if;
  v_discount:=least(v_amount,case when v_promo.kind='percent' then floor(v_amount*v_promo.value/10000.0)::integer else v_promo.value end);
  if v_discount<=0 then raise exception using errcode='55000',message='promo_discount_zero'; end if;
  insert into public.loyalty_promo_redemptions(organization_id,promotion_id,booking_id,client_account_id,request_id,original_amount_rub,discount_rub,final_amount_rub,actor_id)
  values(p_organization,v_promo.id,p_booking,v_booking.client_account_id,p_request_id,v_amount,v_discount,v_amount-v_discount,auth.uid()) returning * into v_existing;
  return jsonb_build_object('organization_id',p_organization,'id',v_existing.id,'promotion_id',v_promo.id,'discount_rub',v_discount,'final_amount_rub',v_amount-v_discount);
end $$;
revoke all on function public.redeem_minuta_promotion(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.redeem_minuta_promotion(uuid,text,uuid,uuid) to authenticated;

create or replace function public.get_minuta_loyalty_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_loyalty_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_loyalty_settings where organization_id=p_organization),false),
    'max_redeem_percent_bps',coalesce((select max_redeem_percent_bps from public.organization_loyalty_settings where organization_id=p_organization),3000),
    'rule',coalesce((select jsonb_build_object('id',rule.id,'name',rule.name,'earn_rate_bps',rule.earn_rate_bps,'min_paid_amount_rub',rule.min_paid_amount_rub) from public.loyalty_rules rule where rule.organization_id=p_organization and rule.active),'{}'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',client.id,'client_name',client.client_name,'client_phone',client.client_phone) order by client.client_name,client.id)
      from (select distinct on (booking.client_account_id) booking.client_account_id id,booking.client_name,booking.client_phone from public.bookings booking
        where booking.organization_id=p_organization and booking.client_account_id is not null order by booking.client_account_id,booking.created_at desc) client),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',booking.id,'client_account_id',booking.client_account_id,'client_name',booking.client_name,'service_name',service.name,
      'booking_date',booking.booking_date,'booking_time',booking.booking_time,'visit_status',coalesce(outcome.visit_status,'scheduled'),'payment_method',coalesce(outcome.payment_method,'unpaid'),'amount_rub',coalesce(outcome.amount_rub,booking.total_price_rub,service.price_rub)) order by booking.booking_date desc,booking.booking_time desc)
      from public.bookings booking join public.services service on service.id=booking.service_id left join public.booking_outcomes outcome on outcome.booking_id=booking.id
      where booking.organization_id=p_organization and booking.client_account_id is not null and booking.status<>'cancelled' and booking.booking_date>=current_date-180),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',account.id,'client_account_id',account.client_account_id,'balance_points',account.balance_points,'lifetime_earned',account.lifetime_earned,'lifetime_spent',account.lifetime_spent) order by account.updated_at desc,account.id)
      from public.client_loyalty_accounts account where account.organization_id=p_organization),'[]'::jsonb),
    'promotions',coalesce((select jsonb_agg(jsonb_build_object('id',promo.id,'code',promo.code,'kind',promo.kind,'value',promo.value,'valid_from',promo.valid_from,'valid_until',promo.valid_until,
      'total_limit',promo.total_limit,'per_client_limit',promo.per_client_limit,'active',promo.active,'usage_count',(select count(*) from public.loyalty_promo_redemptions redemption where redemption.promotion_id=promo.id)) order by promo.created_at desc)
      from public.loyalty_promotions promo where promo.organization_id=p_organization),'[]'::jsonb),
    'promo_redemptions',coalesce((select jsonb_agg(jsonb_build_object('id',redemption.id,'promotion_id',redemption.promotion_id,'booking_id',redemption.booking_id,'client_account_id',redemption.client_account_id,'discount_rub',redemption.discount_rub,'final_amount_rub',redemption.final_amount_rub,'created_at',redemption.created_at) order by redemption.created_at desc)
      from public.loyalty_promo_redemptions redemption where redemption.organization_id=p_organization),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'client_account_id',entry.client_account_id,'event_type',entry.event_type,'points_delta',entry.points_delta,'balance_after',entry.balance_after,'booking_id',entry.booking_id,'reason',entry.reason,'created_at',entry.created_at) order by entry.id desc)
      from (select * from public.loyalty_ledger where organization_id=p_organization order by id desc limit 100) entry),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_minuta_loyalty_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_loyalty_workspace(uuid) to authenticated;

commit;
