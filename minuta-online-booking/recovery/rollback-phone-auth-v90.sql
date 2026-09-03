begin;

do $$
declare
  v_name text;
  v_definition text;
begin
  if to_regclass('public.minuta_auth_trigger_guard_v90') is null then
    return;
  end if;
  if exists(select 1 from public.client_accounts where auth_user_id is not null) then
    raise exception using errcode='55000',message='v90_rollback_blocked_client_auth_links_exist';
  end if;
  select trigger_name,original_definition into v_name,v_definition
  from public.minuta_auth_trigger_guard_v90
  limit 1;
  if v_name is not null then
    execute format('drop trigger if exists %I on auth.users',v_name);
    execute v_definition;
  end if;
end $$;

drop function if exists public.bootstrap_client_sms_session(text);
drop function if exists public.get_minuta_phone_auth_capability();
drop function if exists public.has_minuta_provider_access();
drop index if exists public.client_accounts_auth_user_v90_idx;
alter table public.client_accounts drop column if exists auth_user_id;
drop table if exists public.minuta_auth_trigger_guard_v90;

commit;
