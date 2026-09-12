begin;

set local lock_timeout = '10s';
set local statement_timeout = '2min';
set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.benefit_ledger') is null
     or to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.performer_profiles') is null
     or to_regclass('public.locations') is null
     or to_regprocedure('public.get_minuta_benefit_role(uuid)') is null
     or to_regprocedure('public.write_minuta_benefit_audit(uuid,text,uuid,jsonb)') is null
     or to_regprocedure('public.get_minuta_client_commerce_v147(uuid,uuid)') is null
     or to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is null
     or to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') is null then
    raise exception using errcode='P0001',message='v150_requires_benefits_v73_commerce_v147_and_application_v149';
  end if;
end $$;

-- Refuse to run this older migration over a partially installed or newer
-- lifecycle. This guard executes before the first schema mutation.
do $apply_version_guard$
declare
  v_name text; v_proc regprocedure; v_relation regclass; v_hash text; v_marker text;
begin
  if to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)') is null then
    if to_regclass('public.benefit_freeze_periods') is not null
       or to_regclass('public.benefit_lifecycle_requests') is not null
       or to_regprocedure('public.get_minuta_benefit_timezone_v150(uuid)') is not null
       or to_regprocedure('public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)') is not null
       or to_regprocedure('public.sync_minuta_benefit_expiry_v150(uuid,uuid)') is not null
       or to_regprocedure('public.get_minuta_benefit_lifecycle_v150(uuid,uuid)') is not null then
      raise exception using errcode='55000',message='v150_apply_blocked_partial_or_newer_lifecycle';
    end if;
    return;
  end if;

  foreach v_name in array array[
    'public.get_minuta_benefit_timezone_v150(uuid)',
    'public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)',
    'public.sync_minuta_benefit_expiry_v150(uuid,uuid)',
    'public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)',
    'public.get_minuta_benefit_lifecycle_v150(uuid,uuid)',
    'public.set_minuta_benefit_status(uuid,uuid,text)'
  ] loop
    v_proc:=to_regprocedure(v_name);
    if v_proc is null then
      raise exception using errcode='55000',message='v150_apply_blocked_partial_or_newer_lifecycle';
    end if;
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),
      'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),'acl',coalesce(procedure_row.proacl::text,'')
    )) into v_hash
    from pg_catalog.pg_proc procedure_row join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    v_marker:=obj_description(v_proc::oid,'pg_proc');
    if v_marker is distinct from 'minuta_benefit_lifecycle_v150:sha256='||v_hash then
      raise exception using errcode='55000',message='v150_apply_blocked_newer_function_definition';
    end if;
  end loop;

  foreach v_name in array array['public.benefit_freeze_periods','public.benefit_lifecycle_requests'] loop
    v_relation:=to_regclass(v_name);
    if v_relation is null then
      raise exception using errcode='55000',message='v150_apply_blocked_partial_or_newer_lifecycle';
    end if;
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'kind',relation_row.relkind,'owner',pg_get_userbyid(relation_row.relowner),
      'row_security',relation_row.relrowsecurity,'force_row_security',relation_row.relforcerowsecurity,
      'acl',coalesce(relation_row.relacl::text,''),
      'columns',coalesce((select jsonb_agg(jsonb_build_object(
        'number',attribute_row.attnum,'name',attribute_row.attname,'type',format_type(attribute_row.atttypid,attribute_row.atttypmod),
        'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,'generated',attribute_row.attgenerated,
        'default',pg_get_expr(default_row.adbin,default_row.adrelid)
      ) order by attribute_row.attnum)
        from pg_catalog.pg_attribute attribute_row left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
      'constraints',coalesce((select jsonb_agg(jsonb_build_object(
        'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
        'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
      ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
      'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid) order by index_row.indexrelid::regclass::text)
        from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb),
      'policies',coalesce((select jsonb_agg(jsonb_build_object(
        'name',policy_row.polname,'command',policy_row.polcmd,'permissive',policy_row.polpermissive,
        'roles',coalesce((select jsonb_agg(pg_get_userbyid(role_oid) order by pg_get_userbyid(role_oid))
          from unnest(policy_row.polroles) role_oid),'[]'::jsonb),
        'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),
        'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb),
      'triggers',coalesce((select jsonb_agg(jsonb_build_object(
        'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,'definition',pg_get_triggerdef(trigger_row.oid,true)
      ) order by trigger_row.tgname) from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb)
    )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
    if obj_description(v_relation::oid,'pg_class') is distinct from 'minuta_benefit_lifecycle_v150:sha256='||v_hash then
      raise exception using errcode='55000',message='v150_apply_blocked_newer_table_definition';
    end if;
  end loop;

  select public.minuta_financial_sha256_v129(jsonb_build_object(
    'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
    'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
  )),obj_description(constraint_row.oid,'pg_constraint') into v_hash,v_marker
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid='public.benefit_ledger'::regclass and constraint_row.conname='benefit_ledger_event_type_check';
  if v_marker is distinct from 'minuta_benefit_lifecycle_v150:sha256='||v_hash then
    raise exception using errcode='55000',message='v150_apply_blocked_newer_constraint_definition';
  end if;
end
$apply_version_guard$;

alter table public.benefit_ledger drop constraint if exists benefit_ledger_event_type_check;
alter table public.benefit_ledger add constraint benefit_ledger_event_type_check
  check(event_type in ('issued','reserved','redeemed','released','frozen','activated','expired','cancelled'));
comment on constraint benefit_ledger_event_type_check on public.benefit_ledger is 'minuta_benefit_lifecycle_v150';

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

comment on table public.benefit_freeze_periods is 'minuta_benefit_lifecycle_v150';
comment on table public.benefit_lifecycle_requests is 'minuta_benefit_lifecycle_v150';

create or replace function public.get_minuta_benefit_timezone_v150(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_timezone text;
begin
  select location.timezone into v_timezone
  from public.locations location
  where location.organization_id=p_organization and location.active
  order by location.is_primary desc,location.id
  limit 1;
  if v_timezone is null
     or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=v_timezone) then
    raise exception using errcode='22023',message='benefit_organization_timezone_unavailable';
  end if;
  return v_timezone;
end $$;
revoke all on function public.get_minuta_benefit_timezone_v150(uuid) from public,anon,authenticated,service_role;
comment on function public.get_minuta_benefit_timezone_v150(uuid) is 'minuta_benefit_lifecycle_v150';

create or replace function public.minuta_benefit_frozen_days_v150(
  p_timezone text,p_frozen_at timestamptz,p_now timestamptz default clock_timestamp()
) returns integer language plpgsql stable set search_path to '' as $$
begin
  if p_timezone is null
     or not exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=p_timezone) then
    raise exception using errcode='22023',message='benefit_organization_timezone_unavailable';
  end if;
  return greatest(
    pg_catalog.timezone(p_timezone,p_now)::date-pg_catalog.timezone(p_timezone,p_frozen_at)::date,
    0
  );
end $$;
revoke all on function public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
comment on function public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz) is 'minuta_benefit_lifecycle_v150';

create or replace function public.sync_minuta_benefit_expiry_v150(p_organization uuid,p_client_account uuid default null)
returns integer language plpgsql security definer set search_path to '' as $$
declare v_role text; v_timezone text; v_today date; v_row record; v_count integer:=0;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  v_timezone:=public.get_minuta_benefit_timezone_v150(p_organization);
  v_today:=pg_catalog.timezone(v_timezone,clock_timestamp())::date;
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
      and instrument.expires_on<v_today
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
comment on function public.sync_minuta_benefit_expiry_v150(uuid,uuid) is 'minuta_benefit_lifecycle_v150';

create or replace function public.set_minuta_benefit_lifecycle_v150(
  p_organization uuid,p_instrument uuid,p_action text,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_instrument public.client_benefit_instruments%rowtype;
  v_request public.benefit_lifecycle_requests%rowtype; v_period public.benefit_freeze_periods%rowtype;
  v_reason text:=btrim(coalesce(p_reason,'')); v_timezone text; v_today date;
  v_days integer:=0; v_new_expiry date; v_result jsonb;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  v_timezone:=public.get_minuta_benefit_timezone_v150(p_organization);
  v_today:=pg_catalog.timezone(v_timezone,clock_timestamp())::date;
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
    if v_instrument.expires_on<v_today then raise exception using errcode='55000',message='benefit_expired'; end if;
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
    v_days:=public.minuta_benefit_frozen_days_v150(v_timezone,v_period.frozen_at,clock_timestamp());
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
comment on function public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid) is 'minuta_benefit_lifecycle_v150';

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
comment on function public.set_minuta_benefit_status(uuid,uuid,text) is 'minuta_benefit_lifecycle_compatibility_v150';

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
comment on function public.get_minuta_benefit_lifecycle_v150(uuid,uuid) is 'minuta_benefit_lifecycle_v150';

do $stamp_v150$
declare v_name text; v_proc regprocedure; v_relation regclass; v_hash text;
begin
  foreach v_name in array array[
    'public.get_minuta_benefit_timezone_v150(uuid)',
    'public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)',
    'public.sync_minuta_benefit_expiry_v150(uuid,uuid)',
    'public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)',
    'public.get_minuta_benefit_lifecycle_v150(uuid,uuid)',
    'public.set_minuta_benefit_status(uuid,uuid,text)'
  ] loop
    v_proc:=to_regprocedure(v_name);
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),
      'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),'acl',coalesce(procedure_row.proacl::text,'')
    )) into v_hash
    from pg_catalog.pg_proc procedure_row join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    execute format('comment on function %s is %L',v_name,'minuta_benefit_lifecycle_v150:sha256='||v_hash);
  end loop;

  foreach v_name in array array['public.benefit_freeze_periods','public.benefit_lifecycle_requests'] loop
    v_relation:=to_regclass(v_name);
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'kind',relation_row.relkind,'owner',pg_get_userbyid(relation_row.relowner),
      'row_security',relation_row.relrowsecurity,'force_row_security',relation_row.relforcerowsecurity,
      'acl',coalesce(relation_row.relacl::text,''),
      'columns',coalesce((select jsonb_agg(jsonb_build_object(
        'number',attribute_row.attnum,'name',attribute_row.attname,'type',format_type(attribute_row.atttypid,attribute_row.atttypmod),
        'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,'generated',attribute_row.attgenerated,
        'default',pg_get_expr(default_row.adbin,default_row.adrelid)
      ) order by attribute_row.attnum)
        from pg_catalog.pg_attribute attribute_row left join pg_catalog.pg_attrdef default_row
          on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
        where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
      'constraints',coalesce((select jsonb_agg(jsonb_build_object(
        'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
        'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
      ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
      'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid) order by index_row.indexrelid::regclass::text)
        from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb),
      'policies',coalesce((select jsonb_agg(jsonb_build_object(
        'name',policy_row.polname,'command',policy_row.polcmd,'permissive',policy_row.polpermissive,
        'roles',coalesce((select jsonb_agg(pg_get_userbyid(role_oid) order by pg_get_userbyid(role_oid))
          from unnest(policy_row.polroles) role_oid),'[]'::jsonb),
        'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),
        'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb),
      'triggers',coalesce((select jsonb_agg(jsonb_build_object(
        'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,'definition',pg_get_triggerdef(trigger_row.oid,true)
      ) order by trigger_row.tgname) from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb)
    )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
    execute format('comment on table %s is %L',v_name,'minuta_benefit_lifecycle_v150:sha256='||v_hash);
  end loop;

  select public.minuta_financial_sha256_v129(jsonb_build_object(
    'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
    'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
  )) into v_hash from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid='public.benefit_ledger'::regclass and constraint_row.conname='benefit_ledger_event_type_check';
  execute format('comment on constraint benefit_ledger_event_type_check on public.benefit_ledger is %L',
    'minuta_benefit_lifecycle_v150:sha256='||v_hash);
end
$stamp_v150$;

commit;

-- Phase two starts only after the compatibility function is visible. The table
-- lock drains any invocation that began with the v73 function before phase one
-- committed, then backfills and reconciles the exact locked snapshot.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '2min';
set local search_path = public, extensions, pg_catalog;

lock table public.client_benefit_instruments in exclusive mode;

insert into public.benefit_freeze_periods(
  organization_id,instrument_id,frozen_at,expires_on_before,freeze_reason,frozen_by
)
select instrument.organization_id,instrument.id,instrument.updated_at,instrument.expires_on,
  'Перенесено из прежней заморозки',instrument.issued_by
from public.client_benefit_instruments instrument
where instrument.status='frozen'
  and not exists(
    select 1 from public.benefit_freeze_periods period
    where period.instrument_id=instrument.id and period.thawed_at is null
  )
on conflict do nothing;

update public.benefit_freeze_periods period
set thawed_at=clock_timestamp(),expires_on_after=instrument.expires_on,extended_days=0,
  unfreeze_reason='Согласовано при установке v150',close_kind=case when instrument.status='cancelled' then 'cancelled' else 'unfrozen' end
from public.client_benefit_instruments instrument
where period.instrument_id=instrument.id and period.organization_id=instrument.organization_id
  and period.thawed_at is null and instrument.status<>'frozen';

commit;
