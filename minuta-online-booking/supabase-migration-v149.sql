-- v149: idempotent application of visit passes, service packages and certificates.
begin;
set local lock_timeout='10s';
set local search_path=public,extensions,pg_catalog;

do $prerequisites$
begin
  if to_regclass('public.benefit_redemptions') is null
     or to_regclass('public.client_benefit_instruments') is null
     or to_regclass('public.commercial_sale_lines') is null
     or to_regclass('public.financial_transactions') is null
     or to_regprocedure('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)') is null
     or to_regprocedure('public.get_minuta_benefit_role(uuid)') is null
     or to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') is null then
    raise exception using errcode='55000',message='v149_requires_benefits_and_financial_hash';
  end if;
end
$prerequisites$;

do $version_guard$
declare v_name text;v_proc regprocedure;v_relation regclass;v_hash text;v_marker text;
begin
  if to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)') is null then
    if to_regprocedure('public.protect_minuta_benefit_application_v149()') is not null
       or to_regclass('public.benefit_application_requests') is not null then
      raise exception using errcode='55000',message='v149_apply_partial_or_newer_objects_detected';
    end if;
    return;
  end if;

  foreach v_name in array array[
    'public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)',
    'public.protect_minuta_benefit_application_v149()'
  ] loop
    v_proc:=to_regprocedure(v_name);
    if v_proc is null then
      raise exception using errcode='55000',message='v149_apply_partial_or_newer_objects_detected';
    end if;
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),
      'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
      'acl',coalesce((select jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(grant_row.grantor),
        'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
      ) order by pg_get_userbyid(grant_row.grantor),
        case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        grant_row.privilege_type,grant_row.is_grantable)
        from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb)
    )) into v_hash
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    v_marker:=obj_description(v_proc::oid,'pg_proc');
    if v_marker is distinct from 'minuta-benefit-application-v149:sha256='||v_hash then
      raise exception using errcode='55000',message='v149_apply_newer_function_detected';
    end if;
  end loop;

  v_relation:=to_regclass('public.benefit_application_requests');
  if v_relation is null then
    raise exception using errcode='55000',message='v149_apply_partial_or_newer_objects_detected';
  end if;
  select public.minuta_financial_sha256_v129(jsonb_build_object(
    'kind',relation_row.relkind,'owner',pg_get_userbyid(relation_row.relowner),
    'row_security',relation_row.relrowsecurity,'force_row_security',relation_row.relforcerowsecurity,
    'acl',coalesce((select jsonb_agg(jsonb_build_object(
      'grantor',pg_get_userbyid(grant_row.grantor),
      'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
      'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
    ) order by pg_get_userbyid(grant_row.grantor),
      case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
      grant_row.privilege_type,grant_row.is_grantable)
      from aclexplode(relation_row.relacl) grant_row),'[]'::jsonb),
    'columns',coalesce((select jsonb_agg(jsonb_build_object(
      'number',attribute_row.attnum,'name',attribute_row.attname,
      'type',format_type(attribute_row.atttypid,attribute_row.atttypmod),
      'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,
      'generated',attribute_row.attgenerated,'default',pg_get_expr(default_row.adbin,default_row.adrelid)
    ) order by attribute_row.attnum)
      from pg_catalog.pg_attribute attribute_row
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
    'constraints',coalesce((select jsonb_agg(jsonb_build_object(
      'name',constraint_row.conname,'type',constraint_row.contype,
      'definition',pg_get_constraintdef(constraint_row.oid,true),
      'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,
      'deferred',constraint_row.condeferred
    ) order by constraint_row.conname)
      from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
    'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid)
      order by index_row.indexrelid::regclass::text)
      from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb),
    'policies',coalesce((select jsonb_agg(jsonb_build_object(
      'name',policy_row.polname,'command',policy_row.polcmd,'permissive',policy_row.polpermissive,
      'roles',coalesce((select jsonb_agg(pg_get_userbyid(role_oid) order by pg_get_userbyid(role_oid))
        from unnest(policy_row.polroles) role_oid),'[]'::jsonb),
      'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),
      'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
    ) order by policy_row.polname)
      from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb),
    'triggers',coalesce((select jsonb_agg(jsonb_build_object(
      'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,
      'definition',pg_get_triggerdef(trigger_row.oid,true)
    ) order by trigger_row.tgname)
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb)
  )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
  if obj_description(v_relation::oid,'pg_class') is distinct from
     'minuta-benefit-application-v149:sha256='||v_hash then
    raise exception using errcode='55000',message='v149_apply_newer_table_detected';
  end if;
end
$version_guard$;

create table if not exists public.benefit_application_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  instrument_id uuid not null references public.client_benefit_instruments(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  action text not null check(action in('reserve','redeem','release')),
  amount_rub integer check(amount_rub is null or amount_rub>0),
  redemption_id uuid not null references public.benefit_redemptions(id) on delete restrict,
  result_status text not null check(result_status in('reserved','redeemed','released')),
  commercial_sale_id uuid,
  sale_transaction_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(organization_id,request_id)
);

create index if not exists benefit_application_business_v149_idx
  on public.benefit_application_requests(organization_id,instrument_id,booking_id,created_at desc,id desc);

create or replace function public.protect_minuta_benefit_application_v149()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='55000',message='benefit_application_requests_are_immutable';
end
$$;

drop trigger if exists benefit_application_requests_immutable_v149 on public.benefit_application_requests;
create trigger benefit_application_requests_immutable_v149
before update or delete on public.benefit_application_requests
for each row execute function public.protect_minuta_benefit_application_v149();

create or replace function public.apply_minuta_benefit_v149(
  p_organization uuid,p_instrument uuid,p_booking uuid,p_action text,
  p_amount_rub integer default null,p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text;
  v_existing public.benefit_application_requests%rowtype;
  v_redemption public.benefit_redemptions%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_status text;
  v_sale uuid;
  v_sale_transaction uuid;
begin
  -- benefit_application_idempotency_v149
  v_role:=public.get_minuta_benefit_role(p_organization);
  if p_request_id is null then
    raise exception using errcode='22023',message='benefit_application_request_id_required';
  end if;
  if p_action not in('reserve','redeem','release') or (p_amount_rub is not null and p_amount_rub<=0) then
    raise exception using errcode='22023',message='invalid_benefit_application';
  end if;

  v_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_instrument,p_booking,p_action,p_amount_rub));
  select line.sale_id into v_sale from public.commercial_sale_lines line
    where line.organization_id=p_organization and line.benefit_instrument_id=p_instrument
    order by line.id desc limit 1;
  if v_sale is not null then
    select transaction_row.id into v_sale_transaction from public.financial_transactions transaction_row
      where transaction_row.organization_id=p_organization
        and transaction_row.source_type='commercial_sale' and transaction_row.source_id=v_sale
      order by transaction_row.created_at desc,transaction_row.id desc limit 1;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':benefit-application:'||p_request_id::text,149));
  select * into v_existing from public.benefit_application_requests
    where organization_id=p_organization and request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='benefit_application_idempotency_conflict';
    end if;
    return jsonb_build_object(
      'id',v_existing.redemption_id,'organization_id',p_organization,
      'status',v_existing.result_status,'request_id',p_request_id,'replayed',true,
      'commercial_sale_id',v_existing.commercial_sale_id,
      'sale_transaction_id',v_existing.sale_transaction_id);
  end if;

  -- Match the established booking/instrument lock order used by v76.
  perform pg_advisory_xact_lock(hashtextextended(p_booking::text,7302));
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select * into v_redemption from public.benefit_redemptions
    where organization_id=p_organization and instrument_id=p_instrument and booking_id=p_booking
    order by reserved_at desc,id desc limit 1 for update;

  -- A response can be lost after commit. Repeating the desired final state must
  -- confirm the committed result without consuming the balance a second time.
  if p_action='redeem' and v_redemption.status='redeemed' then
    v_result:=jsonb_build_object('id',v_redemption.id,'organization_id',p_organization,'status','redeemed');
  elsif p_action='release' and v_redemption.status='released' then
    v_result:=jsonb_build_object('id',v_redemption.id,'organization_id',p_organization,'status','released');
  else
    v_result:=public.apply_minuta_benefit(p_organization,p_instrument,p_booking,p_action,p_amount_rub);
  end if;

  if (v_result->>'organization_id')::uuid is distinct from p_organization
     or coalesce(v_result->>'status','') not in('reserved','redeemed','released') then
    raise exception using errcode='55000',message='benefit_application_result_mismatch';
  end if;
  v_status:=v_result->>'status';

  insert into public.benefit_application_requests(
    organization_id,request_id,request_fingerprint,instrument_id,booking_id,action,
    amount_rub,redemption_id,result_status,commercial_sale_id,sale_transaction_id,created_by)
  values(p_organization,p_request_id,v_fingerprint,p_instrument,p_booking,p_action,
    p_amount_rub,(v_result->>'id')::uuid,v_status,v_sale,v_sale_transaction,auth.uid());

  return v_result||jsonb_build_object(
    'request_id',p_request_id,'replayed',false,
    'commercial_sale_id',v_sale,'sale_transaction_id',v_sale_transaction);
end
$$;

alter table public.benefit_application_requests enable row level security;
revoke all on table public.benefit_application_requests from public,anon,authenticated,service_role;
revoke all on function public.protect_minuta_benefit_application_v149() from public,anon,authenticated,service_role;
revoke all on function public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid) to authenticated;

do $stamp_v149$
declare v_name text;v_proc regprocedure;v_relation regclass;v_hash text;
begin
  foreach v_name in array array[
    'public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)',
    'public.protect_minuta_benefit_application_v149()'
  ] loop
    v_proc:=to_regprocedure(v_name);
    select public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),
      'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),
      'acl',coalesce((select jsonb_agg(jsonb_build_object(
        'grantor',pg_get_userbyid(grant_row.grantor),
        'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
      ) order by pg_get_userbyid(grant_row.grantor),
        case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
        grant_row.privilege_type,grant_row.is_grantable)
        from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb)
    )) into v_hash
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
    where procedure_row.oid=v_proc;
    execute format('comment on function %s is %L',v_name,
      'minuta-benefit-application-v149:sha256='||v_hash);
  end loop;

  v_relation:=to_regclass('public.benefit_application_requests');
  select public.minuta_financial_sha256_v129(jsonb_build_object(
    'kind',relation_row.relkind,'owner',pg_get_userbyid(relation_row.relowner),
    'row_security',relation_row.relrowsecurity,'force_row_security',relation_row.relforcerowsecurity,
    'acl',coalesce((select jsonb_agg(jsonb_build_object(
      'grantor',pg_get_userbyid(grant_row.grantor),
      'grantee',case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
      'privilege',grant_row.privilege_type,'grantable',grant_row.is_grantable
    ) order by pg_get_userbyid(grant_row.grantor),
      case grant_row.grantee when 0 then 'PUBLIC' else pg_get_userbyid(grant_row.grantee) end,
      grant_row.privilege_type,grant_row.is_grantable)
      from aclexplode(relation_row.relacl) grant_row),'[]'::jsonb),
    'columns',coalesce((select jsonb_agg(jsonb_build_object(
      'number',attribute_row.attnum,'name',attribute_row.attname,
      'type',format_type(attribute_row.atttypid,attribute_row.atttypmod),
      'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,
      'generated',attribute_row.attgenerated,'default',pg_get_expr(default_row.adbin,default_row.adrelid)
    ) order by attribute_row.attnum)
      from pg_catalog.pg_attribute attribute_row
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid=relation_row.oid and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb),
    'constraints',coalesce((select jsonb_agg(jsonb_build_object(
      'name',constraint_row.conname,'type',constraint_row.contype,
      'definition',pg_get_constraintdef(constraint_row.oid,true),
      'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,
      'deferred',constraint_row.condeferred
    ) order by constraint_row.conname)
      from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid=relation_row.oid),'[]'::jsonb),
    'indexes',coalesce((select jsonb_agg(pg_get_indexdef(index_row.indexrelid)
      order by index_row.indexrelid::regclass::text)
      from pg_catalog.pg_index index_row where index_row.indrelid=relation_row.oid),'[]'::jsonb),
    'policies',coalesce((select jsonb_agg(jsonb_build_object(
      'name',policy_row.polname,'command',policy_row.polcmd,'permissive',policy_row.polpermissive,
      'roles',coalesce((select jsonb_agg(pg_get_userbyid(role_oid) order by pg_get_userbyid(role_oid))
        from unnest(policy_row.polroles) role_oid),'[]'::jsonb),
      'using',pg_get_expr(policy_row.polqual,policy_row.polrelid),
      'check',pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
    ) order by policy_row.polname)
      from pg_catalog.pg_policy policy_row where policy_row.polrelid=relation_row.oid),'[]'::jsonb),
    'triggers',coalesce((select jsonb_agg(jsonb_build_object(
      'name',trigger_row.tgname,'enabled',trigger_row.tgenabled,
      'definition',pg_get_triggerdef(trigger_row.oid,true)
    ) order by trigger_row.tgname)
      from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb)
  )) into v_hash from pg_catalog.pg_class relation_row where relation_row.oid=v_relation;
  execute format('comment on table public.benefit_application_requests is %L',
    'minuta-benefit-application-v149:sha256='||v_hash);
end
$stamp_v149$;

commit;
