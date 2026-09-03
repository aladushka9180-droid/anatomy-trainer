begin;

set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.client_accounts') is null
     or to_regclass('public.client_device_sessions') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.get_minuta_client_field_workspace(uuid,text)') is null then
    raise exception using errcode='P0001',message='v90_requires_v54_v65_and_v89';
  end if;
end $$;

alter table public.client_accounts
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists client_accounts_auth_user_v90_idx
  on public.client_accounts(auth_user_id)
  where auth_user_id is not null;

-- Supabase provider registration creates performer_profiles through an auth.users
-- trigger. Client OTP registrations are explicitly marked account_type=client and
-- must bypass only that trigger, otherwise a client would receive an empty business.
create table if not exists public.minuta_auth_trigger_guard_v90 (
  trigger_name text primary key,
  original_definition text not null,
  created_at timestamptz not null default now()
);
alter table public.minuta_auth_trigger_guard_v90 enable row level security;
revoke all on table public.minuta_auth_trigger_guard_v90 from public, anon, authenticated, service_role;

do $$
declare
  v_count integer;
  v_name text;
  v_definition text;
  v_guarded_definition text;
begin
  if exists(select 1 from public.minuta_auth_trigger_guard_v90) then
    return;
  end if;

  select count(*), min(trigger_row.tgname), min(pg_get_triggerdef(trigger_row.oid, true))
  into v_count, v_name, v_definition
  from pg_trigger trigger_row
  join pg_proc handler on handler.oid=trigger_row.tgfoid
  where trigger_row.tgrelid='auth.users'::regclass
    and not trigger_row.tgisinternal
    and pg_get_functiondef(handler.oid) ilike '%performer_profiles%';

  if v_count <> 1 then
    raise exception using errcode='P0001',message='v90_requires_one_performer_auth_trigger';
  end if;
  if position(' WHEN ' in upper(v_definition)) > 0 then
    raise exception using errcode='P0001',message='v90_performer_auth_trigger_already_conditional';
  end if;

  v_guarded_definition := replace(
    v_definition,
    ' EXECUTE FUNCTION ',
    ' WHEN ((new.raw_user_meta_data ->> ''account_type'') IS DISTINCT FROM ''client'') EXECUTE FUNCTION '
  );
  if v_guarded_definition = v_definition then
    v_guarded_definition := replace(
      v_definition,
      ' EXECUTE PROCEDURE ',
      ' WHEN ((new.raw_user_meta_data ->> ''account_type'') IS DISTINCT FROM ''client'') EXECUTE PROCEDURE '
    );
  end if;
  if v_guarded_definition = v_definition then
    raise exception using errcode='P0001',message='v90_unsupported_auth_trigger_definition';
  end if;

  insert into public.minuta_auth_trigger_guard_v90(trigger_name,original_definition)
  values(v_name,v_definition);
  execute format('drop trigger %I on auth.users',v_name);
  execute v_guarded_definition;
end $$;

create or replace function public.has_minuta_provider_access()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select auth.uid() is not null and exists(
    select 1
    from public.organization_memberships membership
    where membership.user_id=auth.uid()
      and membership.active
  );
$$;

create or replace function public.get_minuta_phone_auth_capability()
returns boolean
language sql
stable
security invoker
set search_path to ''
as $$
  select true;
$$;

create or replace function public.bootstrap_client_sms_session(p_device_name text default null)
returns table(session_token text,session_expires_at timestamptz)
language plpgsql
security definer
set search_path to 'pg_catalog','extensions'
as $$
declare
  v_user_id uuid:=auth.uid();
  v_phone text;
  v_account_by_auth public.client_accounts%rowtype;
  v_account_by_phone public.client_accounts%rowtype;
  v_account_id uuid;
  v_session_token text;
  v_session_expires_at timestamptz:=now()+interval '90 days';
begin
  if v_user_id is null then
    raise exception using errcode='42501',message='client_sms_auth_required';
  end if;
  if p_device_name is not null and char_length(btrim(p_device_name)) not between 1 and 120 then
    raise exception using errcode='P0001',message='invalid_device_name';
  end if;

  select public.normalize_client_phone(account.phone)
  into v_phone
  from auth.users account
  where account.id=v_user_id
    and account.phone_confirmed_at is not null;
  if v_phone is null or v_phone !~ '^7[0-9]{10}$' then
    raise exception using errcode='42501',message='verified_phone_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-auth:'||v_user_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('client-account:'||v_phone,0));

  select account.* into v_account_by_auth
  from public.client_accounts account
  where account.auth_user_id=v_user_id
  for update;

  select account.* into v_account_by_phone
  from public.client_accounts account
  where account.normalized_phone=v_phone
  for update;

  if v_account_by_auth.id is not null then
    if v_account_by_phone.id is not null and v_account_by_phone.id<>v_account_by_auth.id then
      raise exception using errcode='23505',message='client_phone_already_linked';
    end if;
    v_account_id:=v_account_by_auth.id;
    if v_account_by_auth.normalized_phone<>v_phone then
      update public.client_accounts
      set normalized_phone=v_phone,updated_at=now()
      where id=v_account_id;
    end if;
  elsif v_account_by_phone.id is not null then
    if v_account_by_phone.auth_user_id is not null and v_account_by_phone.auth_user_id<>v_user_id then
      raise exception using errcode='23505',message='client_phone_already_linked';
    end if;
    v_account_id:=v_account_by_phone.id;
    update public.client_accounts
    set auth_user_id=v_user_id,updated_at=now()
    where id=v_account_id;
  else
    v_account_id:=gen_random_uuid();
    insert into public.client_accounts(id,normalized_phone,access_code_hash,auth_user_id)
    values(
      v_account_id,
      v_phone,
      encode(digest(encode(gen_random_bytes(32),'hex')||':'||v_account_id::text,'sha256'),'hex'),
      v_user_id
    );
  end if;

  update public.bookings booking
  set client_account_id=v_account_id
  where booking.client_account_id is null
    and booking.client_phone<>'0000000000'
    and public.normalize_client_phone(booking.client_phone)=v_phone;

  v_session_token:=encode(gen_random_bytes(32),'hex');
  insert into public.client_device_sessions(client_account_id,token_hash,device_name,expires_at)
  values(
    v_account_id,
    encode(digest(v_session_token,'sha256'),'hex'),
    nullif(btrim(p_device_name),''),
    v_session_expires_at
  );
  return query select v_session_token,v_session_expires_at;
end;
$$;

revoke all on function public.has_minuta_provider_access() from public, anon, authenticated, service_role;
revoke all on function public.get_minuta_phone_auth_capability() from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_client_sms_session(text) from public, anon, authenticated, service_role;
grant execute on function public.has_minuta_provider_access() to authenticated;
grant execute on function public.get_minuta_phone_auth_capability() to anon, authenticated;
grant execute on function public.bootstrap_client_sms_session(text) to authenticated;

commit;
