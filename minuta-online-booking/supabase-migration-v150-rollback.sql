-- Roll back the v150 benefit lifecycle only before lifecycle actions or automatic expirations exist.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if coalesce(obj_description(to_regprocedure('public.get_minuta_benefit_timezone_v150(uuid)')::oid,'pg_proc'),'')<>'minuta_benefit_lifecycle_v150'
     or coalesce(obj_description(to_regprocedure('public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)')::oid,'pg_proc'),'')<>'minuta_benefit_lifecycle_v150'
     or coalesce(obj_description(to_regprocedure('public.sync_minuta_benefit_expiry_v150(uuid,uuid)')::oid,'pg_proc'),'')<>'minuta_benefit_lifecycle_v150'
     or coalesce(obj_description(to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)')::oid,'pg_proc'),'')<>'minuta_benefit_lifecycle_v150'
     or position('minuta_benefit_frozen_days_v150' in pg_get_functiondef(to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)')))=0
     or coalesce(obj_description(to_regprocedure('public.get_minuta_benefit_lifecycle_v150(uuid,uuid)')::oid,'pg_proc'),'')<>'minuta_benefit_lifecycle_v150'
     or position('sync_minuta_benefit_expiry_v150' in pg_get_functiondef(to_regprocedure('public.get_minuta_benefit_lifecycle_v150(uuid,uuid)')))=0
     or coalesce(obj_description(to_regprocedure('public.set_minuta_benefit_status(uuid,uuid,text)')::oid,'pg_proc'),'')<>'minuta_benefit_lifecycle_compatibility_v150'
     or position('set_minuta_benefit_lifecycle_v150' in pg_get_functiondef(to_regprocedure('public.set_minuta_benefit_status(uuid,uuid,text)')))=0 then
    raise exception using errcode='55000',message='v150_rollback_blocked_unexpected_function_version';
  end if;
  if to_regclass('public.benefit_freeze_periods') is null
     or coalesce(obj_description(to_regclass('public.benefit_freeze_periods')::oid,'pg_class'),'')<>'minuta_benefit_lifecycle_v150'
     or to_regclass('public.benefit_lifecycle_requests') is null
     or coalesce(obj_description(to_regclass('public.benefit_lifecycle_requests')::oid,'pg_class'),'')<>'minuta_benefit_lifecycle_v150' then
    raise exception using errcode='55000',message='v150_rollback_blocked_unexpected_table_version';
  end if;
  if coalesce((select obj_description(constraint_row.oid,'pg_constraint')
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid='public.benefit_ledger'::regclass
      and constraint_row.conname='benefit_ledger_event_type_check'),'')<>'minuta_benefit_lifecycle_v150' then
    raise exception using errcode='55000',message='v150_rollback_blocked_unexpected_constraint_version';
  end if;
  if to_regclass('public.benefit_lifecycle_requests') is not null
     and exists(select 1 from public.benefit_lifecycle_requests limit 1) then
    raise exception using errcode='55000',message='v150_rollback_blocked_lifecycle_history_exists';
  end if;
  if to_regclass('public.benefit_freeze_periods') is not null
     and exists(select 1 from public.benefit_freeze_periods limit 1) then
    raise exception using errcode='55000',message='v150_rollback_blocked_freeze_history_exists';
  end if;
  if to_regclass('public.benefit_ledger') is not null
     and exists(select 1 from public.benefit_ledger where event_type='expired' limit 1) then
    raise exception using errcode='55000',message='v150_rollback_blocked_expiry_history_exists';
  end if;
end
$guard$;

create or replace function public.set_minuta_benefit_status(p_organization uuid,p_instrument uuid,p_status text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_old text; v_amount integer; v_visits integer;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select status,remaining_amount_rub,remaining_visits into v_old,v_amount,v_visits from public.client_benefit_instruments
  where id=p_instrument and organization_id=p_organization for update;
  if v_old is null then raise exception using errcode='P0002',message='benefit_instrument_not_found'; end if;
  if p_status not in ('active','frozen','cancelled') or v_old in ('exhausted','expired','cancelled') then
    raise exception using errcode='55000',message='invalid_benefit_status_transition';
  end if;
  if p_status='cancelled' and exists(select 1 from public.benefit_redemptions where instrument_id=p_instrument and status='reserved') then
    raise exception using errcode='55000',message='release_reserved_benefits_before_cancel';
  end if;
  update public.client_benefit_instruments set status=p_status where id=p_instrument;
  insert into public.benefit_ledger(organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details)
  values(p_organization,p_instrument,case p_status when 'active' then 'activated' when 'frozen' then 'frozen' else 'cancelled' end,
    v_amount,v_visits,auth.uid(),jsonb_build_object('from',v_old,'to',p_status));
  perform public.write_minuta_benefit_audit(p_organization,'benefit_status_changed',p_instrument,jsonb_build_object('from',v_old,'to',p_status));
  return jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status',p_status);
end $$;
revoke all on function public.set_minuta_benefit_status(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_benefit_status(uuid,uuid,text) to authenticated;
comment on function public.set_minuta_benefit_status(uuid,uuid,text) is 'minuta_benefit_status_v73_restored_by_v150_rollback';

drop function if exists public.get_minuta_benefit_lifecycle_v150(uuid,uuid);
drop function if exists public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid);
drop function if exists public.sync_minuta_benefit_expiry_v150(uuid,uuid);
drop function if exists public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz);
drop function if exists public.get_minuta_benefit_timezone_v150(uuid);

drop table if exists public.benefit_lifecycle_requests;
drop table if exists public.benefit_freeze_periods;

alter table public.benefit_ledger drop constraint if exists benefit_ledger_event_type_check;
alter table public.benefit_ledger add constraint benefit_ledger_event_type_check
  check(event_type in ('issued','reserved','redeemed','released','frozen','activated','cancelled'));

commit;
