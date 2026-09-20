begin;
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.client_accounts') is null
     or to_regclass('public.bookings') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regprocedure('public.resolve_client_identity_session_v155(text)') is null
     or to_regprocedure('public.resolve_client_session(text)') is null then
    raise exception using errcode='55000',message='v166_loyalty_prerequisites_missing';
  end if;
  if to_regclass('public.loyalty_program_settings_v166') is not null
     or to_regclass('public.loyalty_program_rules_v166') is not null
     or to_regclass('public.loyalty_program_accounts_v166') is not null
     or to_regclass('public.loyalty_program_visits_v166') is not null
     or to_regclass('public.loyalty_program_rewards_v166') is not null
     or to_regclass('public.loyalty_program_history_v166') is not null then
    raise exception using errcode='55000',message='v166_loyalty_already_present';
  end if;
end
$guard$;

create table public.loyalty_program_settings_v166(
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.loyalty_program_rules_v166(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  version integer not null check(version between 1 and 2147483647),
  goal_visits integer not null check(goal_visits between 2 and 100),
  reward_kind text not null check(reward_kind in ('percent','fixed','text')),
  reward_value integer,
  reward_title text not null check(char_length(btrim(reward_title)) between 2 and 120),
  reward_terms text not null default '' check(char_length(reward_terms)<=500),
  validity_days integer check(validity_days between 1 and 730),
  starts_at timestamptz not null default now(),
  active boolean not null default true,
  request_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check((reward_kind='percent' and reward_value between 1 and 10000)
     or (reward_kind='fixed' and reward_value between 1 and 10000000)
     or (reward_kind='text' and reward_value is null)),
  unique(id,organization_id),
  unique(organization_id,version),
  unique(organization_id,request_id)
);
create unique index loyalty_program_rules_active_v166_idx
  on public.loyalty_program_rules_v166(organization_id) where active;

create table public.loyalty_program_accounts_v166(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  current_rule_id uuid not null,
  cycle_number integer not null default 1 check(cycle_number between 1 and 2147483647),
  -- Can be negative after a later correction of an already consumed cycle.
  -- Public progress is clamped to zero; this debt only delays the next reward.
  manual_progress integer not null default 0 check(manual_progress between -1000000 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(current_rule_id,organization_id) references public.loyalty_program_rules_v166(id,organization_id) on delete restrict,
  unique(id,organization_id),
  unique(organization_id,client_account_id)
);

create table public.loyalty_program_visits_v166(
  booking_id uuid primary key references public.bookings(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  rule_id uuid not null,
  cycle_number integer not null check(cycle_number between 1 and 2147483647),
  credited_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversal_reason text check(reversal_reason is null or char_length(reversal_reason) between 3 and 500),
  foreign key(account_id,organization_id) references public.loyalty_program_accounts_v166(id,organization_id) on delete restrict,
  foreign key(rule_id,organization_id) references public.loyalty_program_rules_v166(id,organization_id) on delete restrict,
  unique(booking_id,organization_id)
);
create index loyalty_program_visits_progress_v166_idx
  on public.loyalty_program_visits_v166(organization_id,account_id,cycle_number)
  where reversed_at is null;

create table public.loyalty_program_rewards_v166(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  account_id uuid not null,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  rule_id uuid not null,
  cycle_number integer not null check(cycle_number between 1 and 2147483647),
  reward_kind text not null check(reward_kind in ('percent','fixed','text')),
  reward_value integer,
  reward_title text not null check(char_length(btrim(reward_title)) between 2 and 120),
  reward_terms text not null default '' check(char_length(reward_terms)<=500),
  status text not null default 'pending' check(status in ('pending','redeemed','expired','voided')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_booking_id uuid references public.bookings(id) on delete restrict,
  redemption_request_id uuid,
  redemption_reason text check(redemption_reason is null or char_length(redemption_reason) between 3 and 500),
  updated_at timestamptz not null default now(),
  foreign key(account_id,organization_id) references public.loyalty_program_accounts_v166(id,organization_id) on delete restrict,
  foreign key(rule_id,organization_id) references public.loyalty_program_rules_v166(id,organization_id) on delete restrict,
  check((reward_kind='percent' and reward_value between 1 and 10000)
     or (reward_kind='fixed' and reward_value between 1 and 10000000)
     or (reward_kind='text' and reward_value is null)),
  unique(organization_id,account_id,cycle_number),
  unique(organization_id,redemption_request_id)
);
create index loyalty_program_rewards_client_v166_idx
  on public.loyalty_program_rewards_v166(organization_id,client_account_id,issued_at desc);

create table public.loyalty_program_history_v166(
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_account_id uuid references public.client_accounts(id) on delete restrict,
  account_id uuid,
  rule_id uuid,
  booking_id uuid references public.bookings(id) on delete restrict,
  reward_id uuid references public.loyalty_program_rewards_v166(id) on delete restrict,
  event_type text not null check(event_type in (
    'program_enabled','program_disabled','rule_changed','visit_counted','visit_reversed',
    'reward_issued','reward_redeemed','reward_expired','reward_voided','manual_adjustment'
  )),
  progress_delta integer not null default 0 check(progress_delta between -100 and 100),
  progress_after integer check(progress_after between 0 and 100),
  reason text check(reason is null or char_length(reason) between 3 and 500),
  request_id uuid,
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(account_id,organization_id) references public.loyalty_program_accounts_v166(id,organization_id) on delete restrict,
  foreign key(rule_id,organization_id) references public.loyalty_program_rules_v166(id,organization_id) on delete restrict,
  unique(organization_id,request_id)
);
create index loyalty_program_history_scope_v166_idx
  on public.loyalty_program_history_v166(organization_id,id desc);

alter table public.loyalty_program_settings_v166 enable row level security;
alter table public.loyalty_program_rules_v166 enable row level security;
alter table public.loyalty_program_accounts_v166 enable row level security;
alter table public.loyalty_program_visits_v166 enable row level security;
alter table public.loyalty_program_rewards_v166 enable row level security;
alter table public.loyalty_program_history_v166 enable row level security;

revoke all on table public.loyalty_program_settings_v166,public.loyalty_program_rules_v166,
  public.loyalty_program_accounts_v166,public.loyalty_program_visits_v166,
  public.loyalty_program_rewards_v166,public.loyalty_program_history_v166
  from public,anon,authenticated,service_role;
grant all on table public.loyalty_program_settings_v166,public.loyalty_program_rules_v166,
  public.loyalty_program_accounts_v166,public.loyalty_program_visits_v166,
  public.loyalty_program_rewards_v166,public.loyalty_program_history_v166 to service_role;

create or replace function public.get_minuta_loyalty_program_role_v166(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role not in ('owner','admin') then
    raise exception using errcode='42501',message='loyalty_program_management_denied';
  end if;
  return v_role;
end $$;
revoke all on function public.get_minuta_loyalty_program_role_v166(uuid) from public,anon,authenticated,service_role;

create or replace function public.protect_minuta_loyalty_program_history_v166()
returns trigger language plpgsql set search_path to '' as $$
begin raise exception using errcode='55000',message='loyalty_program_history_immutable'; end $$;
create trigger loyalty_program_history_immutable_v166
before update or delete on public.loyalty_program_history_v166
for each row execute function public.protect_minuta_loyalty_program_history_v166();
revoke all on function public.protect_minuta_loyalty_program_history_v166() from public,anon,authenticated,service_role;

create or replace function public.expire_minuta_loyalty_rewards_v166(p_organization uuid,p_client_account uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_count integer;
begin
  with expired as (
    update public.loyalty_program_rewards_v166 reward
    set status='expired',updated_at=now()
    where reward.organization_id=p_organization and reward.status='pending'
      and reward.expires_at is not null and reward.expires_at<=now()
      and (p_client_account is null or reward.client_account_id=p_client_account)
    returning reward.*
  ), logged as (
    insert into public.loyalty_program_history_v166(
      organization_id,client_account_id,account_id,rule_id,reward_id,event_type,details
    ) select organization_id,client_account_id,account_id,rule_id,id,'reward_expired',
      jsonb_build_object('expires_at',expires_at) from expired
    returning 1
  ) select count(*) into v_count from logged;
  return coalesce(v_count,0);
end $$;
revoke all on function public.expire_minuta_loyalty_rewards_v166(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.set_minuta_loyalty_program_v166(
  p_organization uuid,p_enabled boolean,p_goal_visits integer,p_reward_kind text,
  p_reward_value integer,p_reward_title text,p_reward_terms text,p_validity_days integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_existing public.loyalty_program_history_v166%rowtype;
  v_rule public.loyalty_program_rules_v166%rowtype; v_version integer;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_request_id is null or p_enabled is null then
    raise exception using errcode='22023',message='invalid_loyalty_program_request';
  end if;
  if p_enabled and (
    p_goal_visits not between 2 and 100
    or p_reward_kind not in ('percent','fixed','text')
    or char_length(btrim(coalesce(p_reward_title,''))) not between 2 and 120
    or char_length(coalesce(p_reward_terms,''))>500
    or (p_validity_days is not null and p_validity_days not between 1 and 730)
    or (p_reward_kind='percent' and p_reward_value not between 1 and 10000)
    or (p_reward_kind='fixed' and p_reward_value not between 1 and 10000000)
    or (p_reward_kind='text' and p_reward_value is not null)
  ) then raise exception using errcode='22023',message='invalid_loyalty_program_rule'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,16600));
  select * into v_existing from public.loyalty_program_history_v166
  where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.details->>'enabled' is distinct from p_enabled::text
       or (p_enabled and (
         (v_existing.details->>'goal_visits')::integer is distinct from p_goal_visits
         or v_existing.details->>'reward_kind' is distinct from p_reward_kind
         or nullif(v_existing.details->>'reward_value','')::integer is distinct from p_reward_value
         or v_existing.details->>'reward_title' is distinct from btrim(p_reward_title)
         or v_existing.details->>'reward_terms' is distinct from btrim(coalesce(p_reward_terms,''))
         or nullif(v_existing.details->>'validity_days','')::integer is distinct from p_validity_days
       )) then raise exception using errcode='23505',message='loyalty_program_request_conflict'; end if;
    return v_existing.details||jsonb_build_object('recovered',true);
  end if;

  insert into public.loyalty_program_settings_v166(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set
    enabled=excluded.enabled,
    enabled_at=case when excluded.enabled and not public.loyalty_program_settings_v166.enabled then now()
      else public.loyalty_program_settings_v166.enabled_at end,
    enabled_by=case when excluded.enabled and not public.loyalty_program_settings_v166.enabled then auth.uid()
      else public.loyalty_program_settings_v166.enabled_by end,
    updated_at=now();

  if p_enabled then
    select * into v_rule from public.loyalty_program_rules_v166
    where organization_id=p_organization and active for update;
    if v_rule.id is null
       or v_rule.goal_visits<>p_goal_visits or v_rule.reward_kind<>p_reward_kind
       or v_rule.reward_value is distinct from p_reward_value
       or v_rule.reward_title<>btrim(p_reward_title)
       or v_rule.reward_terms<>btrim(coalesce(p_reward_terms,''))
       or v_rule.validity_days is distinct from p_validity_days then
      update public.loyalty_program_rules_v166 set active=false where organization_id=p_organization and active;
      select coalesce(max(version),0)+1 into v_version from public.loyalty_program_rules_v166 where organization_id=p_organization;
      insert into public.loyalty_program_rules_v166(
        organization_id,version,goal_visits,reward_kind,reward_value,reward_title,reward_terms,
        validity_days,request_id,created_by
      ) values(
        p_organization,v_version,p_goal_visits,p_reward_kind,p_reward_value,btrim(p_reward_title),
        btrim(coalesce(p_reward_terms,'')),p_validity_days,p_request_id,auth.uid()
      ) returning * into v_rule;
    end if;
  else
    select * into v_rule from public.loyalty_program_rules_v166
    where organization_id=p_organization order by version desc limit 1;
  end if;

  insert into public.loyalty_program_history_v166(
    organization_id,rule_id,event_type,request_id,details,actor_id
  ) values(
    p_organization,v_rule.id,case when p_enabled then
      case when v_rule.request_id=p_request_id and v_rule.version>1 then 'rule_changed' else 'program_enabled' end
      else 'program_disabled' end,p_request_id,
    jsonb_build_object(
      'organization_id',p_organization,'enabled',p_enabled,'rule_id',v_rule.id,
      'goal_visits',case when p_enabled then p_goal_visits end,
      'reward_kind',case when p_enabled then p_reward_kind end,
      'reward_value',case when p_enabled then p_reward_value end,
      'reward_title',case when p_enabled then btrim(p_reward_title) end,
      'reward_terms',case when p_enabled then btrim(coalesce(p_reward_terms,'')) end,
      'validity_days',case when p_enabled then p_validity_days end,
      'existing_cycles_keep_rules',true,'recovered',false
    ),auth.uid()
  );
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled,'rule_id',v_rule.id,
    'existing_cycles_keep_rules',true,'recovered',false);
end $$;
revoke all on function public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid)
  to authenticated;

create or replace function public.reconcile_minuta_loyalty_booking_v166(p_booking uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype; v_outcome public.booking_outcomes%rowtype;
  v_visit public.loyalty_program_visits_v166%rowtype;
  v_rule public.loyalty_program_rules_v166%rowtype;
  v_account public.loyalty_program_accounts_v166%rowtype;
  v_reward public.loyalty_program_rewards_v166%rowtype;
  v_replacement public.loyalty_program_visits_v166%rowtype;
  v_qualifies boolean; v_progress integer; v_count integer;
begin
  if p_booking is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,16601));
  select * into v_booking from public.bookings booking where booking.id=p_booking;
  if v_booking.id is null or v_booking.organization_id is null or v_booking.client_account_id is null then return; end if;
  select * into v_outcome from public.booking_outcomes outcome where outcome.booking_id=p_booking;
  v_qualifies:=v_booking.status<>'cancelled' and v_outcome.visit_status='completed'
    and v_booking.booking_date+v_booking.booking_time<=timezone('Europe/Samara',now());
  select * into v_visit from public.loyalty_program_visits_v166 visit where visit.booking_id=p_booking for update;

  if not v_qualifies then
    if v_visit.booking_id is null or v_visit.reversed_at is not null then return; end if;
    update public.loyalty_program_visits_v166 set reversed_at=now(),reversal_reason=
      case when v_booking.status='cancelled' then 'Запись отменена' else 'Визит больше не завершён' end
    where booking_id=p_booking returning * into v_visit;
    select * into v_account from public.loyalty_program_accounts_v166 where id=v_visit.account_id for update;
    select * into v_reward from public.loyalty_program_rewards_v166
      where organization_id=v_visit.organization_id and account_id=v_visit.account_id and cycle_number=v_visit.cycle_number for update;
    if v_reward.status='pending' then
      select * into v_replacement from public.loyalty_program_visits_v166 visit
      where visit.account_id=v_visit.account_id and visit.cycle_number>v_visit.cycle_number and visit.reversed_at is null
      order by visit.cycle_number,visit.credited_at,visit.booking_id limit 1 for update;
      if v_replacement.booking_id is not null then
        -- Keep a still-valid pending entitlement by moving the earliest later
        -- completed visit into the gap left by this reversal.
        update public.loyalty_program_visits_v166 set cycle_number=v_visit.cycle_number,rule_id=v_visit.rule_id
        where booking_id=v_replacement.booking_id;
      else
        update public.loyalty_program_rewards_v166 set status='voided',updated_at=now() where id=v_reward.id;
        insert into public.loyalty_program_history_v166(
          organization_id,client_account_id,account_id,rule_id,booking_id,reward_id,event_type,reason,details
        ) values(v_visit.organization_id,v_visit.client_account_id,v_visit.account_id,v_visit.rule_id,p_booking,
          v_reward.id,'reward_voided','Завершённый визит отменён или изменён',jsonb_build_object('cycle_number',v_visit.cycle_number));
        if v_account.cycle_number=v_visit.cycle_number+1 and v_account.manual_progress=0 then
          update public.loyalty_program_accounts_v166 set cycle_number=v_visit.cycle_number,
            current_rule_id=v_visit.rule_id,updated_at=now() where id=v_account.id;
          v_account.cycle_number:=v_visit.cycle_number;
        end if;
      end if;
    elsif v_reward.status in ('redeemed','expired') and v_account.cycle_number>v_visit.cycle_number then
      -- A final reward stays in history; compensate its invalidated source by
      -- requiring one additional completed visit in the current cycle.
      update public.loyalty_program_accounts_v166 set manual_progress=manual_progress-1,updated_at=now()
      where id=v_account.id returning * into v_account;
    end if;
    select count(*)+case when v_account.cycle_number=v_visit.cycle_number then v_account.manual_progress else 0 end into v_progress
    from public.loyalty_program_visits_v166 visit
    where visit.account_id=v_visit.account_id and visit.cycle_number=v_visit.cycle_number and visit.reversed_at is null;
    insert into public.loyalty_program_history_v166(
      organization_id,client_account_id,account_id,rule_id,booking_id,event_type,progress_delta,progress_after,reason,details
    ) values(v_visit.organization_id,v_visit.client_account_id,v_visit.account_id,v_visit.rule_id,p_booking,
      'visit_reversed',-1,greatest(0,v_progress),v_visit.reversal_reason,jsonb_build_object(
        'cycle_number',v_visit.cycle_number,'replacement_booking_id',v_replacement.booking_id));
    return;
  end if;

  if v_visit.booking_id is not null and v_visit.reversed_at is null then return; end if;
  if not coalesce((select enabled from public.loyalty_program_settings_v166 where organization_id=v_booking.organization_id),false) then return; end if;
  select * into v_rule from public.loyalty_program_rules_v166
  where organization_id=v_booking.organization_id and active;
  -- The completion event is authoritative. A booking may have been scheduled
  -- before the program was enabled and still be the first visit completed
  -- afterwards. Existing outcomes are never backfilled by this migration.
  if v_rule.id is null then return; end if;

  insert into public.loyalty_program_accounts_v166(organization_id,client_account_id,current_rule_id)
  values(v_booking.organization_id,v_booking.client_account_id,v_rule.id)
  on conflict(organization_id,client_account_id) do nothing;
  select * into v_account from public.loyalty_program_accounts_v166
  where organization_id=v_booking.organization_id and client_account_id=v_booking.client_account_id for update;
  select * into v_rule from public.loyalty_program_rules_v166 where id=v_account.current_rule_id;

  if v_visit.booking_id is null then
    insert into public.loyalty_program_visits_v166(
      booking_id,organization_id,account_id,client_account_id,rule_id,cycle_number
    ) values(p_booking,v_booking.organization_id,v_account.id,v_booking.client_account_id,v_rule.id,v_account.cycle_number);
  else
    update public.loyalty_program_visits_v166 set reversed_at=null,reversal_reason=null,credited_at=now(),
      account_id=v_account.id,rule_id=v_rule.id,cycle_number=v_account.cycle_number
    where booking_id=p_booking;
  end if;
  select count(*)+v_account.manual_progress into v_progress
  from public.loyalty_program_visits_v166 visit
  where visit.account_id=v_account.id and visit.cycle_number=v_account.cycle_number and visit.reversed_at is null;
  insert into public.loyalty_program_history_v166(
    organization_id,client_account_id,account_id,rule_id,booking_id,event_type,progress_delta,progress_after,details
  ) values(v_booking.organization_id,v_booking.client_account_id,v_account.id,v_rule.id,p_booking,
    'visit_counted',1,least(v_progress,v_rule.goal_visits),jsonb_build_object('cycle_number',v_account.cycle_number));

  if v_progress>=v_rule.goal_visits then
    insert into public.loyalty_program_rewards_v166(
      organization_id,account_id,client_account_id,rule_id,cycle_number,reward_kind,reward_value,
      reward_title,reward_terms,expires_at
    ) values(
      v_booking.organization_id,v_account.id,v_booking.client_account_id,v_rule.id,v_account.cycle_number,
      v_rule.reward_kind,v_rule.reward_value,v_rule.reward_title,v_rule.reward_terms,
      case when v_rule.validity_days is null then null else now()+make_interval(days=>v_rule.validity_days) end
    ) on conflict(organization_id,account_id,cycle_number) do update set
      status='pending',issued_at=now(),expires_at=excluded.expires_at,redeemed_at=null,redeemed_booking_id=null,
      redemption_request_id=null,redemption_reason=null,updated_at=now()
      where public.loyalty_program_rewards_v166.status='voided'
    returning * into v_reward;
    if v_reward.id is not null then
      insert into public.loyalty_program_history_v166(
        organization_id,client_account_id,account_id,rule_id,booking_id,reward_id,event_type,progress_after,details
      ) values(v_booking.organization_id,v_booking.client_account_id,v_account.id,v_rule.id,p_booking,v_reward.id,
        'reward_issued',0,jsonb_build_object('cycle_number',v_account.cycle_number,'reward_title',v_rule.reward_title));
      select * into v_rule from public.loyalty_program_rules_v166
        where organization_id=v_booking.organization_id and active;
      update public.loyalty_program_accounts_v166 set cycle_number=cycle_number+1,current_rule_id=v_rule.id,
        manual_progress=0,updated_at=now() where id=v_account.id;
    end if;
  end if;
end $$;
revoke all on function public.reconcile_minuta_loyalty_booking_v166(uuid) from public,anon,authenticated,service_role;

create or replace function public.reconcile_minuta_loyalty_outcome_v166()
returns trigger language plpgsql security definer set search_path to '' as $$
begin perform public.reconcile_minuta_loyalty_booking_v166(new.booking_id); return new; end $$;
create trigger booking_outcomes_loyalty_program_v166
after insert or update of visit_status on public.booking_outcomes
for each row execute function public.reconcile_minuta_loyalty_outcome_v166();
revoke all on function public.reconcile_minuta_loyalty_outcome_v166() from public,anon,authenticated,service_role;

create or replace function public.reconcile_minuta_loyalty_booking_status_v166()
returns trigger language plpgsql security definer set search_path to '' as $$
begin perform public.reconcile_minuta_loyalty_booking_v166(new.id); return new; end $$;
create trigger bookings_loyalty_program_v166
after update of status on public.bookings
for each row when(old.status is distinct from new.status)
execute function public.reconcile_minuta_loyalty_booking_status_v166();
revoke all on function public.reconcile_minuta_loyalty_booking_status_v166() from public,anon,authenticated,service_role;

create or replace function public.adjust_minuta_loyalty_progress_v166(
  p_organization uuid,p_client_account uuid,p_delta integer,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_account public.loyalty_program_accounts_v166%rowtype;
  v_rule public.loyalty_program_rules_v166%rowtype; v_existing public.loyalty_program_history_v166%rowtype;
  v_visits integer; v_progress integer; v_reward public.loyalty_program_rewards_v166%rowtype;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  if p_request_id is null or p_delta=0 or p_delta not between -100 and 100
     or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
    raise exception using errcode='22023',message='invalid_loyalty_progress_adjustment';
  end if;
  if not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='loyalty_client_not_in_organization';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_client_account::text,16602));
  select * into v_existing from public.loyalty_program_history_v166
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.client_account_id<>p_client_account or v_existing.progress_delta<>p_delta
       or v_existing.reason<>btrim(p_reason) then
      raise exception using errcode='23505',message='loyalty_program_request_conflict';
    end if;
    return jsonb_build_object('progress',v_existing.progress_after,'recovered',true);
  end if;
  if not coalesce((select enabled from public.loyalty_program_settings_v166 where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='loyalty_program_disabled';
  end if;
  select * into v_rule from public.loyalty_program_rules_v166 where organization_id=p_organization and active;
  insert into public.loyalty_program_accounts_v166(organization_id,client_account_id,current_rule_id)
    values(p_organization,p_client_account,v_rule.id) on conflict(organization_id,client_account_id) do nothing;
  select * into v_account from public.loyalty_program_accounts_v166
    where organization_id=p_organization and client_account_id=p_client_account for update;
  select * into v_rule from public.loyalty_program_rules_v166 where id=v_account.current_rule_id;
  select count(*) into v_visits from public.loyalty_program_visits_v166
    where account_id=v_account.id and cycle_number=v_account.cycle_number and reversed_at is null;
  v_progress:=v_visits+v_account.manual_progress+p_delta;
  if v_progress<0 or v_progress>v_rule.goal_visits then
    raise exception using errcode='22023',message='invalid_loyalty_progress_result';
  end if;
  update public.loyalty_program_accounts_v166 set manual_progress=manual_progress+p_delta,updated_at=now()
    where id=v_account.id;
  insert into public.loyalty_program_history_v166(
    organization_id,client_account_id,account_id,rule_id,event_type,progress_delta,progress_after,reason,request_id,actor_id
  ) values(p_organization,p_client_account,v_account.id,v_rule.id,'manual_adjustment',p_delta,v_progress,btrim(p_reason),p_request_id,auth.uid());
  if v_progress=v_rule.goal_visits then
    insert into public.loyalty_program_rewards_v166(
      organization_id,account_id,client_account_id,rule_id,cycle_number,reward_kind,reward_value,reward_title,reward_terms,expires_at
    ) values(p_organization,v_account.id,p_client_account,v_rule.id,v_account.cycle_number,v_rule.reward_kind,v_rule.reward_value,
      v_rule.reward_title,v_rule.reward_terms,case when v_rule.validity_days is null then null else now()+make_interval(days=>v_rule.validity_days) end)
    on conflict(organization_id,account_id,cycle_number) do update set
      status='pending',issued_at=now(),expires_at=excluded.expires_at,redeemed_at=null,redeemed_booking_id=null,
      redemption_request_id=null,redemption_reason=null,updated_at=now()
      where public.loyalty_program_rewards_v166.status='voided'
    returning * into v_reward;
    if v_reward.id is not null then
      insert into public.loyalty_program_history_v166(
        organization_id,client_account_id,account_id,rule_id,reward_id,event_type,progress_after,details
      ) values(p_organization,p_client_account,v_account.id,v_rule.id,v_reward.id,'reward_issued',0,
        jsonb_build_object('cycle_number',v_account.cycle_number,'source','manual_adjustment'));
      select * into v_rule from public.loyalty_program_rules_v166 where organization_id=p_organization and active;
      update public.loyalty_program_accounts_v166 set cycle_number=cycle_number+1,current_rule_id=v_rule.id,
        manual_progress=0,updated_at=now() where id=v_account.id;
    end if;
  end if;
  return jsonb_build_object('progress',case when v_reward.id is null then v_progress else 0 end,'reward_id',v_reward.id,'recovered',false);
end $$;
revoke all on function public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid) to authenticated;

create or replace function public.redeem_minuta_loyalty_reward_v166(
  p_organization uuid,p_reward uuid,p_booking uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_reward public.loyalty_program_rewards_v166%rowtype;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  if p_request_id is null or char_length(btrim(coalesce(p_reason,''))) not between 3 and 500 then
    raise exception using errcode='22023',message='invalid_loyalty_reward_redemption';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_reward::text,16603));
  select * into v_reward from public.loyalty_program_rewards_v166
    where organization_id=p_organization and redemption_request_id=p_request_id;
  if found then
    if v_reward.id<>p_reward or v_reward.redeemed_booking_id is distinct from p_booking
       or v_reward.redemption_reason<>btrim(p_reason) then
      raise exception using errcode='23505',message='loyalty_program_request_conflict';
    end if;
    return jsonb_build_object('id',v_reward.id,'status',v_reward.status,'recovered',true);
  end if;
  perform public.expire_minuta_loyalty_rewards_v166(p_organization,null);
  select * into v_reward from public.loyalty_program_rewards_v166
    where id=p_reward and organization_id=p_organization for update;
  if v_reward.id is null then raise exception using errcode='P0002',message='loyalty_reward_not_found'; end if;
  if v_reward.status<>'pending' then raise exception using errcode='55000',message='loyalty_reward_not_available'; end if;
  if p_booking is not null and not exists(
    select 1 from public.bookings booking where booking.id=p_booking and booking.organization_id=p_organization
      and booking.client_account_id=v_reward.client_account_id and booking.status<>'cancelled'
  ) then raise exception using errcode='42501',message='loyalty_reward_booking_denied'; end if;
  update public.loyalty_program_rewards_v166 set status='redeemed',redeemed_at=now(),
    redeemed_booking_id=p_booking,redemption_request_id=p_request_id,redemption_reason=btrim(p_reason),updated_at=now()
  where id=v_reward.id returning * into v_reward;
  insert into public.loyalty_program_history_v166(
    organization_id,client_account_id,account_id,rule_id,booking_id,reward_id,event_type,reason,request_id,actor_id
  ) values(p_organization,v_reward.client_account_id,v_reward.account_id,v_reward.rule_id,p_booking,v_reward.id,
    'reward_redeemed',btrim(p_reason),p_request_id,auth.uid());
  return jsonb_build_object('id',v_reward.id,'status',v_reward.status,'recovered',false);
end $$;
revoke all on function public.redeem_minuta_loyalty_reward_v166(uuid,uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.redeem_minuta_loyalty_reward_v166(uuid,uuid,uuid,text,uuid) to authenticated;

create or replace function public.get_minuta_loyalty_program_workspace_v166(p_organization uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  perform public.expire_minuta_loyalty_rewards_v166(p_organization,null);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.loyalty_program_settings_v166 where organization_id=p_organization),false),
    'rule',coalesce((select jsonb_build_object(
      'id',rule.id,'version',rule.version,'goal_visits',rule.goal_visits,'reward_kind',rule.reward_kind,
      'reward_value',rule.reward_value,'reward_title',rule.reward_title,'reward_terms',rule.reward_terms,
      'validity_days',rule.validity_days,'starts_at',rule.starts_at
    ) from public.loyalty_program_rules_v166 rule where rule.organization_id=p_organization and rule.active),'{}'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object(
      'id',client.id,'client_name',client.client_name,'client_phone',client.client_phone
    ) order by client.client_name,client.id) from (
      select distinct on (booking.client_account_id) booking.client_account_id id,booking.client_name,booking.client_phone
      from public.bookings booking where booking.organization_id=p_organization and booking.client_account_id is not null
      order by booking.client_account_id,booking.created_at desc
    ) client),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',account.id,'client_account_id',account.client_account_id,'rule_id',account.current_rule_id,
      'cycle_number',account.cycle_number,'progress',greatest(0,account.manual_progress+(
        select count(*) from public.loyalty_program_visits_v166 visit where visit.account_id=account.id
          and visit.cycle_number=account.cycle_number and visit.reversed_at is null
      )),'goal_visits',rule.goal_visits
    ) order by account.updated_at desc,account.id) from public.loyalty_program_accounts_v166 account
      join public.loyalty_program_rules_v166 rule on rule.id=account.current_rule_id
      where account.organization_id=p_organization),'[]'::jsonb),
    'rewards',coalesce((select jsonb_agg(jsonb_build_object(
      'id',reward.id,'client_account_id',reward.client_account_id,'cycle_number',reward.cycle_number,
      'reward_kind',reward.reward_kind,'reward_value',reward.reward_value,'reward_title',reward.reward_title,
      'reward_terms',reward.reward_terms,'status',reward.status,'issued_at',reward.issued_at,
      'expires_at',reward.expires_at,'redeemed_at',reward.redeemed_at,'redeemed_booking_id',reward.redeemed_booking_id
    ) order by reward.issued_at desc,reward.id) from public.loyalty_program_rewards_v166 reward
      where reward.organization_id=p_organization),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object(
      'id',entry.id,'client_account_id',entry.client_account_id,'event_type',entry.event_type,
      'progress_delta',entry.progress_delta,'progress_after',entry.progress_after,'booking_id',entry.booking_id,
      'reward_id',entry.reward_id,'reason',entry.reason,'created_at',entry.created_at
    ) order by entry.id desc) from (select * from public.loyalty_program_history_v166
      where organization_id=p_organization order by id desc limit 100) entry),'[]'::jsonb),
    'stats',jsonb_build_object(
      'issued',(select count(*) from public.loyalty_program_rewards_v166 where organization_id=p_organization),
      'redeemed',(select count(*) from public.loyalty_program_rewards_v166 where organization_id=p_organization and status='redeemed')
    )
  );
end $$;
revoke all on function public.get_minuta_loyalty_program_workspace_v166(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_loyalty_program_workspace_v166(uuid) to authenticated;

create or replace function public.get_client_loyalty_program_v166(p_session_token text,p_organization uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  v_identity record; v_client uuid; v_account public.loyalty_program_accounts_v166%rowtype;
  v_rule public.loyalty_program_rules_v166%rowtype; v_reward public.loyalty_program_rewards_v166%rowtype;
  v_progress integer:=0; v_enabled boolean:=false; v_state text:='not_enabled';
begin
  if p_organization is null then raise exception using errcode='22023',message='organization_required'; end if;
  select * into v_identity from public.resolve_client_identity_session_v155(p_session_token);
  if v_identity.session_id is not null then
    v_client:=v_identity.client_account_id;
    if v_identity.session_scope='booking' and not exists(
      select 1 from public.bookings where id=v_identity.claimed_booking_id and organization_id=p_organization
        and client_account_id=v_client
    ) then raise exception using errcode='42501',message='client_loyalty_access_denied'; end if;
    if v_identity.session_scope='organization' and v_identity.organization_id<>p_organization then
      raise exception using errcode='42501',message='client_loyalty_access_denied';
    end if;
  else
    select resolved.client_account_id into v_client from public.resolve_client_session(p_session_token) resolved;
  end if;
  if v_client is null or not exists(
    select 1 from public.bookings where organization_id=p_organization and client_account_id=v_client
  ) then raise exception using errcode='42501',message='client_loyalty_access_denied'; end if;
  perform public.expire_minuta_loyalty_rewards_v166(p_organization,v_client);
  v_enabled:=coalesce((select enabled from public.loyalty_program_settings_v166 where organization_id=p_organization),false);
  select * into v_rule from public.loyalty_program_rules_v166 where organization_id=p_organization and active;
  select * into v_account from public.loyalty_program_accounts_v166
    where organization_id=p_organization and client_account_id=v_client;
  if v_account.id is not null then
    select * into v_rule from public.loyalty_program_rules_v166 where id=v_account.current_rule_id;
    select greatest(0,v_account.manual_progress+count(*)) into v_progress from public.loyalty_program_visits_v166 visit
      where visit.account_id=v_account.id and visit.cycle_number=v_account.cycle_number and visit.reversed_at is null;
    select * into v_reward from public.loyalty_program_rewards_v166
      where organization_id=p_organization and client_account_id=v_client
      order by case status when 'pending' then 0 when 'redeemed' then 1 when 'expired' then 2 else 3 end,issued_at desc limit 1;
  end if;
  v_state:=case when not v_enabled or v_rule.id is null then 'not_enabled'
    when v_reward.status='pending' then 'available'
    when v_progress>0 then 'progress'
    when v_reward.status='redeemed' then 'used'
    when v_reward.status='expired' then 'expired'
    else 'progress' end;
  return jsonb_build_object(
    'organization_id',p_organization,'state',v_state,'progress',v_progress,
    'goal_visits',case when v_enabled then v_rule.goal_visits end,
    'remaining',case when v_enabled then greatest(0,v_rule.goal_visits-v_progress) end,
    'reward',case when v_enabled then jsonb_build_object(
      'title',coalesce(v_reward.reward_title,v_rule.reward_title),
      'kind',coalesce(v_reward.reward_kind,v_rule.reward_kind),
      'value',coalesce(v_reward.reward_value,v_rule.reward_value),
      'available',v_reward.status='pending','expires_at',v_reward.expires_at,
      'terms',coalesce(v_reward.reward_terms,v_rule.reward_terms)
    ) else null end
  );
end $$;
revoke all on function public.get_client_loyalty_program_v166(text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_client_loyalty_program_v166(text,uuid) to anon,authenticated;

comment on function public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid)
  is 'minuta:v166:loyalty-program:settings';
comment on function public.get_minuta_loyalty_program_workspace_v166(uuid)
  is 'minuta:v166:loyalty-program:workspace';
comment on function public.get_client_loyalty_program_v166(text,uuid)
  is 'minuta:v166:loyalty-program:client-contract';

notify pgrst,'reload schema';
commit;
