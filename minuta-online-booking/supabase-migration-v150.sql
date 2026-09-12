begin;

set local lock_timeout = '10s';
set local statement_timeout = '2min';
set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.benefit_ledger') is null
     or to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.performer_profiles') is null
     or to_regprocedure('public.get_minuta_benefit_role(uuid)') is null
     or to_regprocedure('public.write_minuta_benefit_audit(uuid,text,uuid,jsonb)') is null
     or to_regprocedure('public.get_minuta_client_commerce_v147(uuid,uuid)') is null then
    raise exception using errcode='P0001',message='v150_requires_benefits_v73_and_commerce_v147';
  end if;
end $$;

alter table public.benefit_ledger drop constraint if exists benefit_ledger_event_type_check;
alter table public.benefit_ledger add constraint benefit_ledger_event_type_check
  check(event_type in ('issued','reserved','redeemed','released','frozen','activated','expired','cancelled'));

create table if not exists public.benefit_freeze_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  instrument_id uuid not null,
  frozen_at timestamptz not null default now(),
  thawed_at timestamptz,
  expires_on_before date not null,
  expires_on_after date,
  extended_days integer not null default 0 check(extended_days between 0 and 365000),
  freeze_reason text not null default '' check(char_length(freeze_reason)<=300),
  unfreeze_reason text not null default '' check(char_length(unfreeze_reason)<=300),
  frozen_by uuid references auth.users(id) on delete set null,
  thawed_by uuid references auth.users(id) on delete set null,
  close_kind text check(close_kind is null or close_kind in ('unfrozen','cancelled')),
  unique(id,organization_id),
  foreign key(instrument_id,organization_id) references public.client_benefit_instruments(id,organization_id) on delete restrict,
  check((thawed_at is null and expires_on_after is null and close_kind is null)
     or (thawed_at is not null and expires_on_after is not null and close_kind is not null))
);

create unique index if not exists benefit_freeze_periods_one_open_idx
  on public.benefit_freeze_periods(instrument_id) where thawed_at is null;
create index if not exists benefit_freeze_periods_history_idx
  on public.benefit_freeze_periods(organization_id,instrument_id,frozen_at desc,id desc);

create table if not exists public.benefit_lifecycle_requests (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  instrument_id uuid not null,
  action text not null check(action in ('freeze','unfreeze')),
  reason text not null default '' check(char_length(reason)<=300),
  actor_id uuid references auth.users(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(organization_id,request_id),
  foreign key(instrument_id,organization_id) references public.client_benefit_instruments(id,organization_id) on delete restrict
);

create index if not exists benefit_lifecycle_requests_instrument_idx
  on public.benefit_lifecycle_requests(organization_id,instrument_id,created_at desc);

alter table public.benefit_freeze_periods enable row level security;
alter table public.benefit_lifecycle_requests enable row level security;

drop policy if exists benefit_manager_read_v150 on public.benefit_freeze_periods;
create policy benefit_manager_read_v150 on public.benefit_freeze_periods for select to authenticated
  using(public.has_organization_role(organization_id,array['owner','admin']));
drop policy if exists benefit_manager_read_v150 on public.benefit_lifecycle_requests;
create policy benefit_manager_read_v150 on public.benefit_lifecycle_requests for select to authenticated
  using(public.has_organization_role(organization_id,array['owner','admin']));

revoke all on public.benefit_freeze_periods,public.benefit_lifecycle_requests from public,anon,authenticated,service_role;
grant select on public.benefit_freeze_periods,public.benefit_lifecycle_requests to authenticated;
grant select on public.benefit_freeze_periods,public.benefit_lifecycle_requests to service_role;

insert into public.benefit_freeze_periods(
  organization_id,instrument_id,frozen_at,expires_on_before,freeze_reason,frozen_by
)
select instrument.organization_id,instrument.id,instrument.updated_at,instrument.expires_on,'Перенесено из прежней заморозки',instrument.issued_by
from public.client_benefit_instruments instrument
where instrument.status='frozen'
  and not exists(select 1 from public.benefit_freeze_periods period where period.instrument_id=instrument.id and period.thawed_at is null)
on conflict do nothing;

create or replace function public.sync_minuta_benefit_expiry_v150(p_organization uuid,p_client_account uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_role text; v_row record; v_count integer:=0;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_client_account is not null and not exists(
    select 1 from public.bookings booking
    where booking.organization_id=p_organization and booking.client_account_id=p_client_account
  ) then
    raise exception using errcode='42501',message='benefit_client_not_in_organization';
  end if;
  for v_row in
    select instrument.id,instrument.remaining_amount_rub,instrument.remaining_visits,instrument.expires_on
    from public.client_benefit_instruments instrument
    where instrument.organization_id=p_organization and instrument.status='active'
      and instrument.expires_on<current_date
      and (p_client_account is null or instrument.client_account_id=p_client_account)
    for update
  loop
    update public.client_benefit_instruments set status='expired' where id=v_row.id;
    insert into public.benefit_ledger(
      organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
    ) values(
      p_organization,v_row.id,'expired',v_row.remaining_amount_rub,v_row.remaining_visits,null,
      jsonb_build_object('expires_on',v_row.expires_on,'source','clock')
    );
    insert into public.benefit_audit_log(organization_id,actor_id,action,subject_id,details)
    values(p_organization,null,'benefit_expired',v_row.id,jsonb_build_object('expires_on',v_row.expires_on));
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;
revoke all on function public.sync_minuta_benefit_expiry_v150(uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.set_minuta_benefit_lifecycle_v150(
  p_organization uuid,p_instrument uuid,p_action text,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_instrument public.client_benefit_instruments%rowtype;
  v_request public.benefit_lifecycle_requests%rowtype; v_period public.benefit_freeze_periods%rowtype;
  v_reason text:=btrim(coalesce(p_reason,'')); v_days integer:=0; v_new_expiry date; v_result jsonb;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_request_id is null then raise exception using errcode='22023',message='benefit_lifecycle_request_id_required'; end if;
  if p_action not in ('freeze','unfreeze') then raise exception using errcode='22023',message='invalid_benefit_lifecycle_action'; end if;
  if char_length(v_reason)>300 then raise exception using errcode='22023',message='benefit_lifecycle_reason_too_long'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,15001));
  select * into v_request from public.benefit_lifecycle_requests
  where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_request.instrument_id<>p_instrument or v_request.action<>p_action or v_request.reason<>v_reason then
      raise exception using errcode='23505',message='benefit_lifecycle_request_conflict';
    end if;
    return v_request.result||jsonb_build_object('replayed',true);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select * into v_instrument from public.client_benefit_instruments
  where id=p_instrument and organization_id=p_organization for update;
  if v_instrument.id is null then raise exception using errcode='P0002',message='benefit_instrument_not_found'; end if;

  if p_action='freeze' then
    if v_instrument.status<>'active' then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
    if v_instrument.expires_on<current_date then raise exception using errcode='55000',message='benefit_expired'; end if;
    if v_instrument.remaining_amount_rub=0 and v_instrument.remaining_visits=0 then
      raise exception using errcode='55000',message='benefit_exhausted';
    end if;
    if exists(select 1 from public.benefit_redemptions where instrument_id=p_instrument and status='reserved') then
      raise exception using errcode='55000',message='release_reserved_benefits_before_freeze';
    end if;
    if exists(select 1 from public.benefit_freeze_periods where instrument_id=p_instrument and thawed_at is null) then
      raise exception using errcode='55000',message='benefit_freeze_period_already_open';
    end if;
    insert into public.benefit_freeze_periods(
      organization_id,instrument_id,expires_on_before,freeze_reason,frozen_by
    ) values(p_organization,p_instrument,v_instrument.expires_on,v_reason,auth.uid()) returning * into v_period;
    update public.client_benefit_instruments set status='frozen' where id=p_instrument;
    insert into public.benefit_ledger(
      organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
    ) values(
      p_organization,p_instrument,'frozen',v_instrument.remaining_amount_rub,v_instrument.remaining_visits,auth.uid(),
      jsonb_build_object('from','active','to','frozen','reason',v_reason,'freeze_period_id',v_period.id,'expires_on',v_instrument.expires_on)
    );
    perform public.write_minuta_benefit_audit(p_organization,'benefit_frozen',p_instrument,
      jsonb_build_object('reason',v_reason,'freeze_period_id',v_period.id,'expires_on',v_instrument.expires_on));
    v_result:=jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status','frozen',
      'expires_on',v_instrument.expires_on,'frozen_at',v_period.frozen_at,'extended_days',0,'replayed',false);
  else
    if v_instrument.status<>'frozen' then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
    select * into v_period from public.benefit_freeze_periods
    where instrument_id=p_instrument and thawed_at is null order by frozen_at desc,id desc limit 1 for update;
    if v_period.id is null then
      insert into public.benefit_freeze_periods(
        organization_id,instrument_id,frozen_at,expires_on_before,freeze_reason,frozen_by
      ) values(
        p_organization,p_instrument,least(v_instrument.updated_at,now()),v_instrument.expires_on,
        'Восстановлено для прежней заморозки',v_instrument.issued_by
      ) returning * into v_period;
    end if;
    v_days:=greatest(current_date-v_period.frozen_at::date,0);
    v_new_expiry:=v_instrument.expires_on+v_days;
    update public.benefit_freeze_periods set thawed_at=now(),expires_on_after=v_new_expiry,
      extended_days=v_days,unfreeze_reason=v_reason,thawed_by=auth.uid(),close_kind='unfrozen'
    where id=v_period.id;
    update public.client_benefit_instruments set status='active',expires_on=v_new_expiry where id=p_instrument;
    insert into public.benefit_ledger(
      organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
    ) values(
      p_organization,p_instrument,'activated',v_instrument.remaining_amount_rub,v_instrument.remaining_visits,auth.uid(),
      jsonb_build_object('from','frozen','to','active','reason',v_reason,'freeze_period_id',v_period.id,
        'frozen_at',v_period.frozen_at,'extended_days',v_days,'expires_on_before',v_instrument.expires_on,'expires_on_after',v_new_expiry)
    );
    perform public.write_minuta_benefit_audit(p_organization,'benefit_unfrozen',p_instrument,
      jsonb_build_object('reason',v_reason,'freeze_period_id',v_period.id,'extended_days',v_days,
        'expires_on_before',v_instrument.expires_on,'expires_on_after',v_new_expiry));
    v_result:=jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status','active',
      'expires_on',v_new_expiry,'frozen_at',v_period.frozen_at,'extended_days',v_days,'replayed',false);
  end if;

  insert into public.benefit_lifecycle_requests(
    organization_id,request_id,instrument_id,action,reason,actor_id,result
  ) values(p_organization,p_request_id,p_instrument,p_action,v_reason,auth.uid(),v_result);
  return v_result;
end $$;
revoke all on function public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid) to authenticated;

create or replace function public.set_minuta_benefit_status(p_organization uuid,p_instrument uuid,p_status text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_old text; v_amount integer; v_visits integer; v_expiry date; v_period public.benefit_freeze_periods%rowtype;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_status in ('active','frozen') then
    return public.set_minuta_benefit_lifecycle_v150(
      p_organization,p_instrument,case p_status when 'frozen' then 'freeze' else 'unfreeze' end,
      '',gen_random_uuid()
    )-'replayed';
  end if;
  if p_status<>'cancelled' then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select status,remaining_amount_rub,remaining_visits,expires_on into v_old,v_amount,v_visits,v_expiry
  from public.client_benefit_instruments where id=p_instrument and organization_id=p_organization for update;
  if v_old is null then raise exception using errcode='P0002',message='benefit_instrument_not_found'; end if;
  if v_old not in ('active','frozen') then raise exception using errcode='55000',message='invalid_benefit_status_transition'; end if;
  if exists(select 1 from public.benefit_redemptions where instrument_id=p_instrument and status='reserved') then
    raise exception using errcode='55000',message='release_reserved_benefits_before_cancel';
  end if;
  if v_old='frozen' then
    select * into v_period from public.benefit_freeze_periods where instrument_id=p_instrument and thawed_at is null
    order by frozen_at desc,id desc limit 1 for update;
    if v_period.id is not null then
      update public.benefit_freeze_periods set thawed_at=now(),expires_on_after=v_expiry,
        extended_days=0,unfreeze_reason='Отменено вместе с продуктом',thawed_by=auth.uid(),close_kind='cancelled'
      where id=v_period.id;
    end if;
  end if;
  update public.client_benefit_instruments set status='cancelled' where id=p_instrument;
  insert into public.benefit_ledger(
    organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details
  ) values(p_organization,p_instrument,'cancelled',v_amount,v_visits,auth.uid(),jsonb_build_object('from',v_old,'to','cancelled'));
  perform public.write_minuta_benefit_audit(p_organization,'benefit_status_changed',p_instrument,jsonb_build_object('from',v_old,'to','cancelled'));
  return jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status','cancelled');
end $$;
revoke all on function public.set_minuta_benefit_status(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_benefit_status(uuid,uuid,text) to authenticated;

create or replace function public.get_minuta_benefit_lifecycle_v150(p_organization uuid,p_client_account uuid default null)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_client_account is not null and not exists(
    select 1 from public.bookings booking
    where booking.organization_id=p_organization and booking.client_account_id=p_client_account
  ) then
    raise exception using errcode='42501',message='benefit_client_not_in_organization';
  end if;
  perform public.sync_minuta_benefit_expiry_v150(p_organization,p_client_account);
  return jsonb_build_object(
    'organization_id',p_organization,'client_account_id',p_client_account,'current_role',v_role,
    'instruments',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',instrument.id,'name',instrument.product_snapshot->>'name','kind',instrument.product_snapshot->>'kind',
        'public_code',instrument.public_code,'status',instrument.status,'expires_on',instrument.expires_on,
        'issued_at',instrument.issued_at,'remaining_amount_rub',instrument.remaining_amount_rub,
        'remaining_visits',instrument.remaining_visits,
        'allowed_actions',case instrument.status when 'active' then jsonb_build_array('freeze') when 'frozen' then jsonb_build_array('unfreeze') else '[]'::jsonb end,
        'current_freeze',(select jsonb_build_object('frozen_at',period.frozen_at,'reason',period.freeze_reason)
          from public.benefit_freeze_periods period where period.instrument_id=instrument.id and period.thawed_at is null
          order by period.frozen_at desc,period.id desc limit 1),
        'freeze_count',(select count(*) from public.benefit_freeze_periods period where period.instrument_id=instrument.id),
        'total_frozen_days',coalesce((select sum(period.extended_days) from public.benefit_freeze_periods period where period.instrument_id=instrument.id),0),
        'history',coalesce((select jsonb_agg(jsonb_build_object(
          'id',ledger.id,'event_type',ledger.event_type,'created_at',ledger.created_at,
          'amount_delta_rub',ledger.amount_delta_rub,'visits_delta',ledger.visits_delta,
          'amount_balance_rub',ledger.amount_balance_rub,'visits_balance',ledger.visits_balance,
          'actor_id',ledger.actor_id,'actor_name',profile.display_name,'details',ledger.details
        ) order by ledger.created_at desc,ledger.id desc)
          from public.benefit_ledger ledger left join public.performer_profiles profile on profile.id=ledger.actor_id
          where ledger.instrument_id=instrument.id),'[]'::jsonb)
      ) order by instrument.issued_at desc,instrument.id desc)
      from public.client_benefit_instruments instrument
      where instrument.organization_id=p_organization
        and (p_client_account is null or instrument.client_account_id=p_client_account)
    ),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_minuta_benefit_lifecycle_v150(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_benefit_lifecycle_v150(uuid,uuid) to authenticated;

commit;
