begin;

do $$
begin
  if coalesce((select bool_or(enabled) from public.organization_retention_settings),false) then
    raise exception using errcode='P0001',message='disable_retention_before_rollback';
  end if;
  if exists(select 1 from public.client_marketing_consents)
     or exists(select 1 from public.retention_deliveries)
     or exists(select 1 from public.retention_audit_log) then
    raise exception using errcode='P0001',message='export_and_remove_all_retention_data_before_rollback';
  end if;
end;
$$;

drop function if exists public.finish_minuta_retention_delivery(uuid,uuid,text);
drop function if exists public.prepare_minuta_retention_delivery(uuid,uuid,text);
drop function if exists public.set_minuta_marketing_consent(uuid,uuid,text,text);
drop function if exists public.save_minuta_retention_settings(uuid,boolean,integer,integer,text);
drop function if exists public.get_minuta_retention_workspace(uuid);
drop function if exists public.render_minuta_retention_message(text,text,text,text);
drop function if exists public.write_minuta_retention_audit(uuid,text,uuid,jsonb);
drop function if exists public.require_minuta_retention_manager(uuid);

drop table if exists public.retention_audit_log;
drop table if exists public.retention_deliveries;
drop table if exists public.client_marketing_consents;
drop table if exists public.organization_retention_settings;

commit;
