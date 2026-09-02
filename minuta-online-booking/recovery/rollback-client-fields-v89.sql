begin;

-- Default disabled settings may be removed during a pre-activation rollback,
-- but definitions, values or audit entries are business data. Once any of
-- them exists, recovery must be a forward fix instead of destructive DDL.
do $$
begin
  if (to_regclass('public.client_field_definitions') is not null
      and exists(select 1 from public.client_field_definitions))
     or (to_regclass('public.client_field_values') is not null
      and exists(select 1 from public.client_field_values))
     or (to_regclass('public.client_field_audit_log') is not null
      and exists(select 1 from public.client_field_audit_log))
     or (to_regclass('public.organization_client_field_settings') is not null
      and exists(select 1 from public.organization_client_field_settings where enabled)) then
    raise exception using errcode='55000',message='v89_rollback_blocked_client_field_data_exists';
  end if;
end $$;

drop trigger if exists client_field_audit_immutable_v89 on public.client_field_audit_log;
drop trigger if exists organizations_initialize_client_fields_v89 on public.organizations;

drop function if exists public.get_minuta_client_field_workspace(uuid,text);
drop function if exists public.delete_minuta_client_field_value(uuid,uuid,text,uuid);
drop function if exists public.set_minuta_client_field_value(uuid,uuid,text,jsonb,uuid);
drop function if exists public.save_minuta_client_field_definition(uuid,uuid,text,text,text,jsonb,boolean,boolean,integer,uuid);
drop function if exists public.set_minuta_client_fields_enabled(uuid,boolean,uuid);
drop function if exists public.validate_minuta_client_field_value(text,jsonb,jsonb);
drop function if exists public.validate_minuta_client_field_definition(text,jsonb);
drop function if exists public.require_minuta_client_field_access(uuid,text,boolean);
drop function if exists public.get_minuta_client_field_role(uuid);
drop function if exists public.reject_minuta_client_field_audit_mutation();
drop function if exists public.initialize_minuta_client_field_settings();

drop table if exists public.client_field_audit_log;
drop table if exists public.client_field_values;
drop table if exists public.client_field_definitions;
drop table if exists public.organization_client_field_settings;

commit;
