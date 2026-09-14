-- Roll back v157 only while the exact schema is present and its durable ledger is empty.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $rollback_guard$
declare
  v_signature text; v_prefix text; v_access text; v_volatility "char"; v_security boolean;
  v_proc oid; v_hash text; v_table regclass:=to_regclass('public.provider_schedule_moves_v157');
begin
  if v_table is null then
    raise exception using errcode='55000',message='v157_rollback_requires_exact_schema';
  end if;
  for v_signature,v_prefix,v_access,v_volatility,v_security in select * from (values
    ('public.minuta_provider_schedule_snapshot_v157(public.bookings)','minuta_provider_schedule_move_snapshot_v157','none','i'::"char",false),
    ('public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','minuta_provider_schedule_move_v157','authenticated','v'::"char",true),
    ('public.get_minuta_provider_schedule_move_v157(uuid)','minuta_provider_schedule_move_lookup_v157','authenticated','s'::"char",true),
    ('public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)','minuta_provider_schedule_move_undo_v157','authenticated','v'::"char",true)
  ) contract(signature,prefix,access_mode,volatility,security_definer) loop
    v_proc:=to_regprocedure(v_signature);
    if v_proc is null then
      raise exception using errcode='55000',message='v157_rollback_requires_exact_schema';
    end if;
    select encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex')
      into v_hash from pg_catalog.pg_proc procedure_row where procedure_row.oid=v_proc;
    if pg_catalog.obj_description(v_proc,'pg_proc') is distinct from v_prefix||':sha256='||v_hash
       or (select pg_catalog.pg_get_userbyid(proowner)<>'postgres' or prosecdef<>v_security
             or provolatile<>v_volatility or proconfig is distinct from array['search_path=""']::text[]
           from pg_catalog.pg_proc where oid=v_proc)
       or coalesce(has_function_privilege('anon',v_proc,'EXECUTE'),false)
       or coalesce(has_function_privilege('authenticated',v_proc,'EXECUTE'),false)<>(v_access='authenticated')
       or coalesce(has_function_privilege('service_role',v_proc,'EXECUTE'),false)
       or exists(select 1 from aclexplode(coalesce(
            (select proacl from pg_catalog.pg_proc where oid=v_proc),
            acldefault('f',(select proowner from pg_catalog.pg_proc where oid=v_proc))
          )) grant_row
          left join pg_catalog.pg_roles role_row on role_row.oid=grant_row.grantee
          where grant_row.grantee<>(select proowner from pg_catalog.pg_proc where oid=v_proc) and (
            grant_row.privilege_type<>'EXECUTE' or grant_row.is_grantable or grant_row.grantee=0
            or coalesce(role_row.rolname,'') not in(case when v_access='authenticated' then 'authenticated' else '' end)
          )) then
      raise exception using errcode='55000',message='v157_rollback_blocked_schema_drift';
    end if;
  end loop;

  select encode(extensions.digest(convert_to(jsonb_build_object(
    'owner',(select pg_catalog.pg_get_userbyid(relation_row.relowner) from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'acl',(select coalesce(relation_row.relacl,'{}'::aclitem[])::text from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'rls',(select relation_row.relrowsecurity from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'force_rls',(select relation_row.relforcerowsecurity from pg_catalog.pg_class relation_row where relation_row.oid=v_table),
    'policies',(select jsonb_agg(jsonb_build_object(
      'name',policy_row.polname,'permissive',policy_row.polpermissive,
      'roles',(select jsonb_agg(pg_catalog.pg_get_userbyid(role_oid) order by pg_catalog.pg_get_userbyid(role_oid))
        from unnest(policy_row.polroles) role_oid),
      'command',policy_row.polcmd,'qual',pg_catalog.pg_get_expr(policy_row.polqual,policy_row.polrelid),
      'with_check',pg_catalog.pg_get_expr(policy_row.polwithcheck,policy_row.polrelid)
    ) order by policy_row.polname) from pg_catalog.pg_policy policy_row where policy_row.polrelid=v_table),
    'columns',(select jsonb_agg(jsonb_build_object(
      'name',attribute_row.attname,'type',pg_catalog.format_type(attribute_row.atttypid,attribute_row.atttypmod),
      'not_null',attribute_row.attnotnull,'identity',attribute_row.attidentity,
      'default',pg_catalog.pg_get_expr(default_row.adbin,default_row.adrelid)
    ) order by attribute_row.attnum)
      from pg_catalog.pg_attribute attribute_row
      left join pg_catalog.pg_attrdef default_row
        on default_row.adrelid=attribute_row.attrelid and default_row.adnum=attribute_row.attnum
      where attribute_row.attrelid=v_table and attribute_row.attnum>0 and not attribute_row.attisdropped),
    'constraints',(select jsonb_agg(jsonb_build_object(
      'name',constraint_row.conname,'type',constraint_row.contype,
      'definition',pg_catalog.pg_get_constraintdef(constraint_row.oid,true)
    ) order by constraint_row.conname) from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid=v_table),
    'indexes',(select jsonb_agg(pg_catalog.pg_get_indexdef(index_row.indexrelid) order by index_class.relname)
      from pg_catalog.pg_index index_row join pg_catalog.pg_class index_class on index_class.oid=index_row.indexrelid
      where index_row.indrelid=v_table),
    'triggers',(select jsonb_agg(pg_catalog.pg_get_triggerdef(trigger_row.oid,true) order by trigger_row.tgname)
      from pg_catalog.pg_trigger trigger_row where trigger_row.tgrelid=v_table and not trigger_row.tgisinternal)
  )::text,'UTF8'),'sha256'),'hex') into v_hash;
  if pg_catalog.obj_description(v_table,'pg_class') is distinct from 'minuta_provider_schedule_move_v157:sha256='||v_hash then
    raise exception using errcode='55000',message='v157_rollback_blocked_schema_drift';
  end if;
  if exists(select 1 from public.provider_schedule_moves_v157) then
    raise exception using errcode='55000',message='v157_rollback_blocked_durable_history_exists';
  end if;
end
$rollback_guard$;

drop function public.undo_minuta_provider_schedule_booking_v157(uuid,uuid);
drop function public.get_minuta_provider_schedule_move_v157(uuid);
drop function public.move_minuta_provider_schedule_booking_v157(
  uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text
);
drop function public.minuta_provider_schedule_snapshot_v157(public.bookings);
drop table public.provider_schedule_moves_v157;

notify pgrst,'reload schema';
commit;
