\set ON_ERROR_STOP on

-- v127 adds a short-lived, single-use handoff from authenticated PrimeTime Pro
-- to the separate PrimeTime client site without exposing Supabase session tokens.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
begin
  if to_regprocedure('public.get_minuta_workspace()') is null then
    raise exception using errcode='55000',message='v127_requires_minuta_workspace_v66';
  end if;
  if to_regprocedure('extensions.gen_random_bytes(integer)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='55000',message='v127_requires_pgcrypto';
  end if;
  if to_regclass('public.primetime_handoffs') is not null
     or to_regprocedure('public.create_primetime_handoff(text)') is not null
     or to_regprocedure('public.consume_primetime_handoff(text,text)') is not null then
    raise exception using errcode='55000',message='v127_objects_already_exist';
  end if;
end $guard$;

create table public.primetime_handoffs (
  ticket_hash text primary key check (ticket_hash ~ '^[0-9a-f]{64}$'),
  state_hash text not null check (state_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null unique,
  workspace jsonb not null check (jsonb_typeof(workspace) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create index primetime_handoffs_expires_idx on public.primetime_handoffs(expires_at);
alter table public.primetime_handoffs enable row level security;
revoke all on table public.primetime_handoffs from public,anon,authenticated,service_role;

create function public.create_primetime_handoff(p_state text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_ticket bytea;
  v_ticket_hex text;
  v_state text := lower(trim(coalesce(p_state,'')));
  v_workspace jsonb;
  v_expires timestamptz := clock_timestamp() + interval '2 minutes';
begin
  if v_actor is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if v_state !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='primetime_state_invalid';
  end if;

  select jsonb_build_object(
    'available', true,
    'organizations', coalesce(jsonb_agg(jsonb_build_object(
      'id', organization.item -> 'id',
      'name', organization.item -> 'name',
      'public_slug', organization.item -> 'public_slug',
      'status', organization.item -> 'status',
      'public_booking_enabled', organization.item -> 'public_booking_enabled',
      'current_role', organization.item -> 'current_role',
      'can_manage', organization.item -> 'can_manage',
      'locations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', location.item -> 'id',
          'name', location.item -> 'name',
          'address', location.item -> 'address',
          'active', location.item -> 'active',
          'is_primary', location.item -> 'is_primary'
        ) order by location.ordinality)
        from (
          select raw.item,raw.ordinality
          from jsonb_array_elements(organization.item -> 'locations') with ordinality raw(item,ordinality)
          where (raw.item ->> 'active')::boolean is true
          order by raw.ordinality
          limit 50
        ) location
      ), '[]'::jsonb),
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
          'user_id', member.item -> 'user_id',
          'display_name', member.item -> 'display_name',
          'role', member.item -> 'role',
          'is_bookable', member.item -> 'is_bookable',
          'active', member.item -> 'active',
          'is_current_user', member.item -> 'is_current_user'
        ) order by member.ordinality)
        from (
          select raw.item,raw.ordinality
          from jsonb_array_elements(organization.item -> 'members') with ordinality raw(item,ordinality)
          where (raw.item ->> 'active')::boolean is true
            and (raw.item ->> 'is_bookable')::boolean is true
            and (
              (organization.item ->> 'can_manage')::boolean is true
              or (raw.item ->> 'is_current_user')::boolean is true
            )
          order by raw.ordinality
          limit 100
        ) member
      ), '[]'::jsonb)
    ) order by organization.ordinality), '[]'::jsonb)
  )
  into v_workspace
  from (
    select raw.item,raw.ordinality
    from jsonb_array_elements(public.get_minuta_workspace() -> 'organizations') with ordinality raw(item,ordinality)
    where raw.item ->> 'status' = 'active'
      and (raw.item ->> 'public_booking_enabled')::boolean is true
    order by raw.ordinality
    limit 20
  ) organization;

  if octet_length(v_workspace::text) > 65536 then
    raise exception using errcode='54000',message='primetime_workspace_too_large';
  end if;

  v_ticket := extensions.gen_random_bytes(32);
  v_ticket_hex := encode(v_ticket, 'hex');

  delete from public.primetime_handoffs where expires_at <= clock_timestamp();

  insert into public.primetime_handoffs(ticket_hash,state_hash,user_id,workspace,expires_at)
  values (
    encode(extensions.digest(v_ticket,'sha256'),'hex'),
    encode(extensions.digest(decode(v_state,'hex'),'sha256'),'hex'),
    v_actor,v_workspace,v_expires
  )
  on conflict(user_id) do update set
    ticket_hash=excluded.ticket_hash,
    state_hash=excluded.state_hash,
    workspace=excluded.workspace,
    expires_at=excluded.expires_at,
    created_at=clock_timestamp();

  return jsonb_build_object('ticket',v_ticket_hex,'expires_at',v_expires);
end;
$$;

create function public.consume_primetime_handoff(p_ticket text,p_state text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_row public.primetime_handoffs%rowtype;
begin
  if p_ticket is null or p_ticket !~ '^[0-9a-f]{64}$'
     or p_state is null or p_state !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  delete from public.primetime_handoffs
  where ticket_hash = encode(extensions.digest(decode(p_ticket,'hex'),'sha256'),'hex')
    and state_hash = encode(extensions.digest(decode(p_state,'hex'),'sha256'),'hex')
    and expires_at > clock_timestamp()
  returning * into v_row;

  if not found then
    delete from public.primetime_handoffs where expires_at <= clock_timestamp();
    return null;
  end if;

  return jsonb_build_object('user_id',v_row.user_id,'workspace',v_row.workspace);
end;
$$;

revoke all on function public.create_primetime_handoff(text) from public,anon,authenticated,service_role;
revoke all on function public.consume_primetime_handoff(text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_primetime_handoff(text) to authenticated;
grant execute on function public.consume_primetime_handoff(text,text) to anon;

do $verify$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='primetime_handoffs' and c.relrowsecurity
  ) then raise exception using errcode='55000',message='v127_rls_guard_failed'; end if;
  if has_table_privilege('anon','public.primetime_handoffs','select')
     or has_table_privilege('authenticated','public.primetime_handoffs','select') then
    raise exception using errcode='55000',message='v127_table_privilege_guard_failed';
  end if;
  if not has_function_privilege('authenticated','public.create_primetime_handoff(text)','execute')
     or has_function_privilege('anon','public.create_primetime_handoff(text)','execute')
     or not has_function_privilege('anon','public.consume_primetime_handoff(text,text)','execute') then
    raise exception using errcode='55000',message='v127_function_privilege_guard_failed';
  end if;
end $verify$;

notify pgrst,'reload schema';
commit;
