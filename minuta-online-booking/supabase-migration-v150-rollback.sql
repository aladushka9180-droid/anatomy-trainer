-- Roll back the v150 benefit lifecycle only before lifecycle actions or automatic expirations exist.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare
  v_name text; v_proc regprocedure; v_relation regclass; v_hash text; v_marker text;
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
    if v_proc is null then
      raise exception using errcode='55000',message='v150_rollback_blocked_unexpected_function_version';
    end if;
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),'acl',coalesce(procedure_row.proacl::text,'')
    )) into v_hash
    from pg_catalog.pg_proc procedure_row join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    if obj_description(v_proc::oid,'pg_proc') is distinct from 'minuta_benefit_lifecycle_v150:sha256='||v_hash then
      raise exception using errcode='55000',message='v150_rollback_blocked_unexpected_function_version';
    end if;
  end loop;

  foreach v_name in array array['public.benefit_freeze_periods','public.benefit_lifecycle_requests'] loop
    v_relation:=to_regclass(v_name);
    if v_relation is null then
      raise exception using errcode='55000',message='v150_rollback_blocked_unexpected_table_version';
    end if;
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'kind',relation_row.relkind,'row_security',relation_row.relrowsecurity,'acl',coalesce(relation_row.relacl::text,''),
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
        'roles',policy_row.polroles::text,'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),
        'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
      ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb)
    )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
    if obj_description(v_relation::oid,'pg_class') is distinct from 'minuta_benefit_lifecycle_v150:sha256='||v_hash then
      raise exception using errcode='55000',message='v150_rollback_blocked_unexpected_table_version';
    end if;
  end loop;

  select public.minuta_financial_sha256_v129(jsonb_build_object(
    'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
    'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred
  )),obj_description(constraint_row.oid,'pg_constraint') into v_hash,v_marker
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid='public.benefit_ledger'::regclass and constraint_row.conname='benefit_ledger_event_type_check';
  if v_marker is distinct from 'minuta_benefit_lifecycle_v150:sha256='||v_hash then
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
