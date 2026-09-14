begin transaction isolation level repeatable read read only;
set local search_path=public,extensions,pg_catalog;
with expected(name) as (values
 ('message_center_settings_v161'),('message_support_agents_v161'),('message_conversations_v161'),
 ('message_participants_v161'),('conversation_messages_v161'),('conversation_system_events_v161'),
 ('conversation_message_actions_v161'),('message_action_confirmations_v161'),('message_read_receipts_v161'),
 ('message_attachments_v161'),('message_support_requests_v161'),('message_idempotency_receipts_v161'),
 ('message_audit_events_v161')
), actual as (
 select expected.name,to_regclass('public.'||expected.name) relation from expected
), tables as (
 select actual.name,actual.relation,
   coalesce((select jsonb_agg(attribute_row.attname order by attribute_row.attnum)
     from pg_attribute attribute_row where attribute_row.attrelid=actual.relation
       and attribute_row.attnum>0 and not attribute_row.attisdropped),'[]'::jsonb) columns,
   coalesce(class_row.relrowsecurity,false) rls,coalesce(class_row.relforcerowsecurity,false) force_rls,
   coalesce(pg_get_userbyid(class_row.relowner),'') owner,
   obj_description(actual.relation,'pg_class') marker,
   case when actual.relation is null then false else
     not has_table_privilege('anon',actual.relation,'select,insert,update,delete,truncate,references,trigger')
     and not has_table_privilege('authenticated',actual.relation,'select,insert,update,delete,truncate,references,trigger')
     and not has_table_privilege('service_role',actual.relation,'select,insert,update,delete,truncate,references,trigger') end acl_denied
 from actual left join pg_class class_row on class_row.oid=actual.relation
), functions as (
 select procedure_row.proname name,
   encode(extensions.digest(convert_to(replace(procedure_row.prosrc,E'\r',''),'UTF8'),'sha256'),'hex') source_hash,
   obj_description(procedure_row.oid,'pg_proc') marker,pg_get_userbyid(procedure_row.proowner) owner,
   jsonb_build_object('public',exists(select 1 from aclexplode(coalesce(procedure_row.proacl,acldefault('f',procedure_row.proowner))) grant_row
       where grant_row.grantee=0 and grant_row.privilege_type='EXECUTE'),
     'anon',has_function_privilege('anon',procedure_row.oid,'execute'),
     'authenticated',has_function_privilege('authenticated',procedure_row.oid,'execute'),
     'service_role',has_function_privilege('service_role',procedure_row.oid,'execute')) access
 from pg_proc procedure_row join pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
 where namespace_row.nspname='public' and procedure_row.proname like '%\_v161' escape '\'
)
select jsonb_build_object('classification',case when count(relation)=0 and (select count(*) from functions)=0 then 'absent'
  when count(relation)=count(*) and bool_and(marker='minuta_message_center_v161'
    and rls and force_rls and owner='postgres' and acl_denied)
    and not exists(select 1 from pg_class class_row join pg_namespace namespace_row on namespace_row.oid=class_row.relnamespace
      where namespace_row.nspname='public' and class_row.relkind='r' and class_row.relname like '%\_v161' escape '\'
        and class_row.relname not in(select name from expected)) then 'exact'
  else 'partial-or-newer' end,'presentCount',count(relation),'expectedPresentCount',count(*),
  'allTablesMarked',coalesce(bool_and(marker is null or marker='minuta_message_center_v161'),false),
  'tables',coalesce(jsonb_agg(jsonb_build_object('name',name,'columns',columns) order by name),'[]'::jsonb),
  'functions',coalesce((select jsonb_agg(jsonb_build_object('name',name,'sourceHash',source_hash,
    'marker',marker,'owner',owner,'access',access) order by name) from functions),'[]'::jsonb))
from tables;
rollback;
