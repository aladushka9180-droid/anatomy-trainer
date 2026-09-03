begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='client_accounts' and column_name='auth_user_id'
  ) or to_regprocedure('public.login_client_access(text,text,text)') is null
    or to_regprocedure('public.resolve_client_session(text)') is null then
    raise exception using errcode='P0001',message='v91_requires_v54_and_v90';
  end if;
end $$;

create or replace function public.bootstrap_client_identity_session(
  p_phone text default null,
  p_access_code text default null,
  p_device_name text default null
)
returns table(session_token text,session_expires_at timestamptz,error_code text)
language plpgsql
security definer
set search_path to 'pg_catalog','extensions'
as $$
declare
  v_user_id uuid:=auth.uid();
  v_account_id uuid;
  v_target_account_id uuid;
  v_target_auth_user_id uuid;
  v_login record;
  v_session_token text;
  v_session_expires_at timestamptz:=now()+interval '90 days';
begin
  if v_user_id is null then
    raise exception using errcode='42501',message='client_social_auth_required';
  end if;
  if p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120 then
    return query select null::text,null::timestamptz,'invalid_access'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-auth:'||v_user_id::text,0));
  select account.id into v_account_id
  from public.client_accounts account
  where account.auth_user_id=v_user_id
  for update;

  if v_account_id is not null then
    v_session_token:=encode(gen_random_bytes(32),'hex');
    insert into public.client_device_sessions(client_account_id,token_hash,device_name,expires_at)
    values(
      v_account_id,
      encode(digest(v_session_token,'sha256'),'hex'),
      nullif(btrim(p_device_name),''),
      v_session_expires_at
    );
    return query select v_session_token,v_session_expires_at,null::text;
    return;
  end if;

  if p_phone is null or p_access_code is null then
    return query select null::text,null::timestamptz,'client_identity_not_linked'::text;
    return;
  end if;

  select login.* into v_login
  from public.login_client_access(p_phone,p_access_code,p_device_name) login;
  if v_login.session_token is null then
    return query select null::text,v_login.session_expires_at,coalesce(v_login.error_code,'invalid_access')::text;
    return;
  end if;

  select resolved.client_account_id into v_target_account_id
  from public.resolve_client_session(v_login.session_token) resolved;
  if v_target_account_id is null then
    raise exception using errcode='P0001',message='client_identity_session_unavailable';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-account-id:'||v_target_account_id::text,0));
  select account.auth_user_id into v_target_auth_user_id
  from public.client_accounts account
  where account.id=v_target_account_id
  for update;

  select account.id into v_account_id
  from public.client_accounts account
  where account.auth_user_id=v_user_id
  for update;
  if v_account_id is not null and v_account_id<>v_target_account_id then
    return query select null::text,null::timestamptz,'client_identity_conflict'::text;
    return;
  end if;
  if v_target_auth_user_id is not null and v_target_auth_user_id<>v_user_id then
    return query select null::text,null::timestamptz,'client_identity_conflict'::text;
    return;
  end if;

  update public.client_accounts
  set auth_user_id=v_user_id,updated_at=now()
  where id=v_target_account_id and auth_user_id is null;

  return query select v_login.session_token,v_login.session_expires_at,null::text;
end;
$$;

revoke all on function public.bootstrap_client_identity_session(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_client_identity_session(text,text,text) to authenticated;

commit;
