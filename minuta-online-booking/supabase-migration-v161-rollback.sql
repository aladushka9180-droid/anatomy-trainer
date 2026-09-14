begin;

do $$
begin
  if to_regclass('public.provider_message_templates_v161') is not null
     and exists(select 1 from public.provider_message_templates_v161) then
    raise exception using errcode='55000',message='v161_message_templates_rollback_would_delete_data';
  end if;
end $$;

drop function if exists public.save_provider_message_template_v161(uuid,text,text,bigint,uuid);
drop function if exists public.get_provider_message_templates_v161(uuid);
drop table if exists public.provider_message_templates_v161;

commit;
