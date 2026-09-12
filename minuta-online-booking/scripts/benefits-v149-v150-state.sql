\set ON_ERROR_STOP on

begin transaction isolation level repeatable read read only;
set local search_path=public,extensions,pg_catalog;

with
v149_proc as (
  select procedure_row.oid,
    obj_description(procedure_row.oid,'pg_proc') as marker,
    'minuta-benefit-application-v149:sha256='||public.minuta_financial_sha256_v129(jsonb_build_object(
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
        from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb))) as expected
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
  where procedure_row.oid=any(array[
    to_regprocedure('public.apply_minuta_benefit_v149(uuid,uuid,uuid,text,integer,uuid)'),
    to_regprocedure('public.protect_minuta_benefit_application_v149()')
  ])
),
v149_relation as (
  select relation_row.oid,
    obj_description(relation_row.oid,'pg_class') as marker,
    'minuta-benefit-application-v149:sha256='||public.minuta_financial_sha256_v129(jsonb_build_object(
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
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb))) as expected
  from pg_catalog.pg_class relation_row
  where relation_row.oid=to_regclass('public.benefit_application_requests')
),
v149_state as (
  select
    ((select count(*) from v149_proc)>0 or (select count(*) from v149_relation)>0
      or to_regclass('public.benefit_application_business_v149_idx') is not null) as any_present,
    ((select count(*)=2 and bool_and(marker=expected) from v149_proc)
      and (select count(*)=1 and bool_and(marker=expected) from v149_relation)
      and not has_function_privilege('authenticated','public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)','execute')) as exact
),
v150_proc as (
  select procedure_row.oid,
    obj_description(procedure_row.oid,'pg_proc') as marker,
    'minuta_benefit_lifecycle_v150:sha256='||public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),
      'volatility',procedure_row.provolatile,'security_definer',procedure_row.prosecdef,
      'strict',procedure_row.proisstrict,'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
      'result',pg_get_function_result(procedure_row.oid),'arguments',pg_get_function_arguments(procedure_row.oid),
      'identity_arguments',pg_get_function_identity_arguments(procedure_row.oid),
      'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),'acl',coalesce(procedure_row.proacl::text,''))) as expected
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
  where procedure_row.oid=any(array[
    to_regprocedure('public.get_minuta_benefit_timezone_v150(uuid)'),
    to_regprocedure('public.minuta_benefit_frozen_days_v150(text,timestamptz,timestamptz)'),
    to_regprocedure('public.sync_minuta_benefit_expiry_v150(uuid,uuid)'),
    to_regprocedure('public.set_minuta_benefit_lifecycle_v150(uuid,uuid,text,text,uuid)'),
    to_regprocedure('public.get_minuta_benefit_lifecycle_v150(uuid,uuid)'),
    to_regprocedure('public.set_minuta_benefit_status(uuid,uuid,text)')
  ])
),
v150_relation as (
  select relation_row.oid,
    obj_description(relation_row.oid,'pg_class') as marker,
    'minuta_benefit_lifecycle_v150:sha256='||public.minuta_financial_sha256_v129(jsonb_build_object(
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
        where trigger_row.tgrelid=relation_row.oid and not trigger_row.tgisinternal),'[]'::jsonb))) as expected
  from pg_catalog.pg_class relation_row
  where relation_row.oid=any(array[
    to_regclass('public.benefit_freeze_periods'),
    to_regclass('public.benefit_lifecycle_requests')
  ])
),
ledger_constraint as (
  select constraint_row.oid,obj_description(constraint_row.oid,'pg_constraint') as marker,
    'minuta_benefit_lifecycle_v150:sha256='||public.minuta_financial_sha256_v129(jsonb_build_object(
      'name',constraint_row.conname,'type',constraint_row.contype,'definition',pg_get_constraintdef(constraint_row.oid,true),
      'validated',constraint_row.convalidated,'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred)) as expected
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid='public.benefit_ledger'::regclass and constraint_row.conname='benefit_ledger_event_type_check'
),
baseline_status as (
  select
    public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',procedure_row.prosrc,'kind',procedure_row.prokind,'language',language_row.lanname,
      'owner',pg_get_userbyid(procedure_row.proowner),'volatility',procedure_row.provolatile,
      'security_definer',procedure_row.prosecdef,'strict',procedure_row.proisstrict,
      'leakproof',procedure_row.proleakproof,'parallel',procedure_row.proparallel,
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
        from aclexplode(procedure_row.proacl) grant_row),'[]'::jsonb))) as actual_hash,
    public.minuta_financial_sha256_v129(jsonb_build_object(
      'source',$v73$
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
end $v73$,
      'kind','f','language','plpgsql','owner','postgres','volatility','v','security_definer',true,
      'strict',false,'leakproof',false,'parallel','u','result','jsonb',
      'arguments','p_organization uuid, p_instrument uuid, p_status text',
      'identity_arguments','p_organization uuid, p_instrument uuid, p_status text',
      'config',jsonb_build_array('search_path=""'),
      'acl',jsonb_build_array(
        jsonb_build_object('grantor','postgres','grantee','authenticated','privilege','EXECUTE','grantable',false),
        jsonb_build_object('grantor','postgres','grantee','postgres','privilege','EXECUTE','grantable',false)
      ))) as expected_hash
  from pg_catalog.pg_proc procedure_row
  join pg_catalog.pg_language language_row on language_row.oid=procedure_row.prolang
  where procedure_row.oid='public.set_minuta_benefit_status(uuid,uuid,text)'::regprocedure
),
baseline_ledger_constraint as (
  select
    public.minuta_financial_sha256_v129(jsonb_build_object(
      'name',constraint_row.conname,'type',constraint_row.contype,
      'definition',pg_get_constraintdef(constraint_row.oid,true),'validated',constraint_row.convalidated,
      'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred)) as actual_hash,
    public.minuta_financial_sha256_v129(jsonb_build_object(
      'name','benefit_ledger_event_type_check','type','c',
      'definition','CHECK (event_type = ANY (ARRAY[''issued''::text, ''reserved''::text, ''redeemed''::text, ''released''::text, ''frozen''::text, ''activated''::text, ''cancelled''::text]))',
      'validated',true,'deferrable',false,'deferred',false)) as expected_hash
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid='public.benefit_ledger'::regclass
    and constraint_row.conname='benefit_ledger_event_type_check'
),
v150_state as (
  select
    (exists(select 1 from v150_proc where oid is distinct from to_regprocedure('public.set_minuta_benefit_status(uuid,uuid,text)')::oid)
      or exists(select 1 from v150_proc where marker like 'minuta_benefit_lifecycle_v150:%')
      or (select count(*) from v150_relation)>0
      or exists(select 1 from ledger_constraint where marker like 'minuta_benefit_lifecycle_v150:%')) as any_present,
    ((select count(*)=6 and bool_and(marker=expected) from v150_proc)
      and (select count(*)=2 and bool_and(marker=expected) from v150_relation)
      and (select count(*)=1 and bool_and(marker=expected) from ledger_constraint)) as exact
),
chosen_timezones as (
  select organization_row.organization_id,chosen.timezone,zone.name as valid_name
  from (select distinct organization_id from public.client_benefit_instruments) organization_row
  left join lateral (
    select location.timezone from public.locations location
    where location.organization_id=organization_row.organization_id and location.active
    order by location.is_primary desc,location.id limit 1
  ) chosen on true
  left join pg_catalog.pg_timezone_names zone on zone.name=chosen.timezone
),
candidate as (
  select count(*) as expected_backfill,
    public.minuta_financial_sha256_v129(coalesce(jsonb_agg(jsonb_build_object(
      'id',instrument.id,'organization_id',instrument.organization_id,'updated_at',instrument.updated_at,
      'expires_on',instrument.expires_on,'issued_by',instrument.issued_by
    ) order by instrument.id),'[]'::jsonb)) as candidate_hash
  from public.client_benefit_instruments instrument where instrument.status='frozen'
)
select json_build_object(
  'v148Secure',position('commercial_refund_amount_mismatch' in pg_get_functiondef('public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid)'::regprocedure))>0,
  'prerequisites',to_regclass('public.organizations') is not null and to_regclass('public.bookings') is not null
    and to_regclass('public.client_benefit_instruments') is not null and to_regclass('public.benefit_redemptions') is not null
    and to_regclass('public.benefit_ledger') is not null and to_regclass('public.commercial_sale_lines') is not null
    and to_regclass('public.financial_transactions') is not null and to_regclass('public.performer_profiles') is not null
    and to_regclass('public.locations') is not null and to_regprocedure('public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)') is not null
    and to_regprocedure('public.get_minuta_benefit_role(uuid)') is not null
    and to_regprocedure('public.set_minuta_benefit_status(uuid,uuid,text)') is not null
    and to_regprocedure('public.write_minuta_benefit_audit(uuid,text,uuid,jsonb)') is not null
    and to_regprocedure('public.has_organization_role(uuid,text[])') is not null
    and to_regprocedure('public.get_minuta_client_commerce_v147(uuid,uuid)') is not null
    and to_regprocedure('public.minuta_financial_sha256_v129(jsonb)') is not null,
  'v149Any',(select any_present from v149_state),'v149Exact',(select exact from v149_state),
  'v149ProcExact',(select count(*)=2 and bool_and(marker=expected) from v149_proc),
  'v149RelationExact',(select count(*)=1 and bool_and(marker=expected) from v149_relation),
  'v149LegacyExecute',has_function_privilege('authenticated','public.apply_minuta_benefit(uuid,uuid,uuid,text,integer)','execute'),
  'v150Any',(select any_present from v150_state),'v150Exact',(select exact from v150_state),
  'baselineStatusExact',(select actual_hash=expected_hash from baseline_status),
  'baselineLedgerConstraintExact',(select actual_hash=expected_hash from baseline_ledger_constraint),
  'classification',case
    when not (select any_present from v149_state) and not (select any_present from v150_state) then 'absent'
    when (select exact from v149_state) and not (select any_present from v150_state) then 'v149-exact'
    when (select exact from v149_state) and (select exact from v150_state) then 'v150-phase1-or-complete-exact'
    else 'unknown' end,
  'invalidTimezoneOrganizations',(select count(*) from chosen_timezones where timezone is null or valid_name is null),
  'expectedBackfill',(select expected_backfill from candidate),'candidateHash',(select candidate_hash from candidate),
  'baselineStatusHash',(select public.minuta_financial_sha256_v129(jsonb_build_object(
    'source',procedure_row.prosrc,'kind',procedure_row.prokind,'owner',pg_get_userbyid(procedure_row.proowner),'volatility',procedure_row.provolatile,
    'security_definer',procedure_row.prosecdef,'config',coalesce(to_jsonb(procedure_row.proconfig),'null'::jsonb),'acl',coalesce(procedure_row.proacl::text,'')))
    from pg_catalog.pg_proc procedure_row where procedure_row.oid='public.set_minuta_benefit_status(uuid,uuid,text)'::regprocedure),
  'baselineLedgerConstraintHash',(select public.minuta_financial_sha256_v129(jsonb_build_object(
    'definition',pg_get_constraintdef(constraint_row.oid,true),'validated',constraint_row.convalidated,
    'deferrable',constraint_row.condeferrable,'deferred',constraint_row.condeferred))
    from pg_catalog.pg_constraint constraint_row where constraint_row.conrelid='public.benefit_ledger'::regclass and constraint_row.conname='benefit_ledger_event_type_check'),
  'sales',(select count(*) from public.commercial_sales),'refunds',(select count(*) from public.commercial_sale_refunds),
  'transactions',(select count(*) from public.financial_transactions),'redemptions',(select count(*) from public.benefit_redemptions)
);

rollback;
