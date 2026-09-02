begin;

set local search_path = public, extensions, pg_catalog;

-- v89 adds organization-scoped custom client fields. The feature is disabled
-- by default and does not rewrite bookings or the financial/loyalty ledgers.
do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.bookings') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='bookings' and column_name='organization_id'
     ) then
    raise exception using errcode='P0001',message='v89_requires_v65_and_client_accounts';
  end if;
end $$;

create table if not exists public.organization_client_field_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.client_field_definitions (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (char_length(btrim(label)) between 2 and 80),
  field_type text not null check (field_type in ('text','textarea','number','date','boolean','select')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options)='array'),
  required boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between -10000 and 10000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,organization_id),
  unique (organization_id,field_key)
);

create table if not exists public.client_field_values (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  definition_id uuid not null,
  client_phone text not null check (client_phone ~ '^7[0-9]{10}$'),
  value_json jsonb not null check (octet_length(value_json::text)<=4000),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id,definition_id,client_phone),
  foreign key (definition_id,organization_id)
    references public.client_field_definitions(id,organization_id) on delete cascade
);

create index if not exists client_field_values_client_idx
  on public.client_field_values(organization_id,client_phone,definition_id);

create table if not exists public.client_field_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('settings_changed','definition_saved','value_saved','value_deleted')),
  definition_id uuid,
  client_ref_hash text check (client_ref_hash is null or client_ref_hash ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb check (octet_length(details::text)<=8000),
  created_at timestamptz not null default now(),
  unique (organization_id,request_id)
);

create index if not exists client_field_audit_scope_idx
  on public.client_field_audit_log(organization_id,created_at desc,id desc);

insert into public.organization_client_field_settings(organization_id)
select organization.id from public.organizations organization
on conflict(organization_id) do nothing;

create or replace function public.initialize_minuta_client_field_settings()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  insert into public.organization_client_field_settings(organization_id)
  values(new.id) on conflict(organization_id) do nothing;
  return new;
end $$;

drop trigger if exists organizations_initialize_client_fields_v89 on public.organizations;
create trigger organizations_initialize_client_fields_v89
after insert on public.organizations
for each row execute function public.initialize_minuta_client_field_settings();

create or replace function public.reject_minuta_client_field_audit_mutation()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  raise exception using errcode='42501',message='client_field_audit_is_immutable';
end $$;

drop trigger if exists client_field_audit_immutable_v89 on public.client_field_audit_log;
create trigger client_field_audit_immutable_v89
before update or delete on public.client_field_audit_log
for each row execute function public.reject_minuta_client_field_audit_mutation();

alter table public.organization_client_field_settings enable row level security;
alter table public.client_field_definitions enable row level security;
alter table public.client_field_values enable row level security;
alter table public.client_field_audit_log enable row level security;

revoke all on table public.organization_client_field_settings,public.client_field_definitions,
  public.client_field_values,public.client_field_audit_log from public,anon,authenticated;
grant all on table public.organization_client_field_settings,public.client_field_definitions,
  public.client_field_values,public.client_field_audit_log to service_role;

create or replace function public.get_minuta_client_field_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization
    and membership.user_id=auth.uid() and membership.active;
  if v_role is null then
    raise exception using errcode='42501',message='client_field_membership_required';
  end if;
  return v_role;
end $$;

create or replace function public.require_minuta_client_field_access(
  p_organization uuid,p_phone text,p_manager boolean default false
) returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;v_phone text;
begin
  v_role:=public.get_minuta_client_field_role(p_organization);
  if p_manager and v_role not in ('owner','admin') then
    raise exception using errcode='42501',message='client_field_manager_required';
  end if;
  if p_phone is not null then
    v_phone:=public.normalize_client_phone(p_phone);
    if v_phone!~'^7[0-9]{10}$' then
      raise exception using errcode='22023',message='invalid_client_phone';
    end if;
    if not exists(
      select 1 from public.bookings booking
      where booking.organization_id=p_organization
        and public.normalize_client_phone(booking.client_phone)=v_phone
        and (v_role in ('owner','admin') or booking.performer_id=auth.uid())
    ) then
      raise exception using errcode='42501',message='client_field_client_access_denied';
    end if;
  end if;
  return v_role;
end $$;

create or replace function public.validate_minuta_client_field_definition(
  p_type text,p_options jsonb
) returns jsonb language plpgsql immutable set search_path to '' as $$
declare v_options jsonb:=coalesce(p_options,'[]'::jsonb);v_count integer;
begin
  if coalesce(p_type,'') not in ('text','textarea','number','date','boolean','select') then
    raise exception using errcode='22023',message='invalid_client_field_type';
  end if;
  if jsonb_typeof(v_options)<>'array' then
    raise exception using errcode='22023',message='invalid_client_field_options';
  end if;
  v_count:=jsonb_array_length(v_options);
  if p_type='select' then
    if v_count not between 1 and 30
       or exists(select 1 from jsonb_array_elements(v_options) option_value
         where jsonb_typeof(option_value)<>'string'
           or char_length(btrim(option_value#>>'{}')) not between 1 and 80)
       or (select count(*) from (select distinct btrim(option_value#>>'{}') value
         from jsonb_array_elements(v_options) option_value) normalized)<>v_count then
      raise exception using errcode='22023',message='invalid_client_field_options';
    end if;
  elsif v_count<>0 then
    raise exception using errcode='22023',message='client_field_options_not_allowed';
  end if;
  return v_options;
end $$;

create or replace function public.validate_minuta_client_field_value(
  p_type text,p_options jsonb,p_value jsonb
) returns jsonb language plpgsql immutable set search_path to '' as $$
declare v_text text;v_number numeric;v_date date;
begin
  if p_value is null or p_value='null'::jsonb then
    raise exception using errcode='22023',message='client_field_value_required';
  end if;
  if p_type in ('text','textarea','date','select') then
    if jsonb_typeof(p_value)<>'string' then
      raise exception using errcode='22023',message='invalid_client_field_value';
    end if;
    v_text:=btrim(p_value#>>'{}');
    if char_length(v_text)<1
       or (p_type='text' and char_length(v_text)>200)
       or (p_type='textarea' and char_length(v_text)>2000) then
      raise exception using errcode='22023',message='invalid_client_field_value';
    end if;
    if p_type='date' then
      if v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode='22023',message='invalid_client_field_date';
      end if;
      begin
        v_date:=v_text::date;
      exception when others then
        raise exception using errcode='22023',message='invalid_client_field_date';
      end;
      if to_char(v_date,'YYYY-MM-DD')<>v_text then
        raise exception using errcode='22023',message='invalid_client_field_date';
      end if;
    elsif p_type='select' and not exists(
      select 1 from jsonb_array_elements_text(p_options) option_value where option_value=v_text
    ) then
      raise exception using errcode='22023',message='invalid_client_field_option';
    end if;
    return to_jsonb(v_text);
  elsif p_type='number' then
    if jsonb_typeof(p_value)<>'number' then
      raise exception using errcode='22023',message='invalid_client_field_value';
    end if;
    v_number:=(p_value#>>'{}')::numeric;
    if v_number not between -1000000000000 and 1000000000000 then
      raise exception using errcode='22023',message='invalid_client_field_value';
    end if;
  elsif p_type='boolean' and jsonb_typeof(p_value)<>'boolean' then
    raise exception using errcode='22023',message='invalid_client_field_value';
  end if;
  return p_value;
end $$;

create or replace function public.set_minuta_client_fields_enabled(
  p_organization uuid,p_enabled boolean,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;v_details jsonb;v_existing public.client_field_audit_log%rowtype;
begin
  v_role:=public.require_minuta_client_field_access(p_organization,null,true);
  if p_request_id is null or p_enabled is null then raise exception using errcode='22023',message='client_field_request_required'; end if;
  v_details:=jsonb_build_object('enabled',p_enabled);
  select * into v_existing from public.client_field_audit_log
  where organization_id=p_organization and request_id=p_request_id;
  if v_existing.id is not null then
    if v_existing.action<>'settings_changed' or v_existing.details<>v_details then
      raise exception using errcode='23505',message='client_field_request_conflict';
    end if;
    return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled,'idempotent',true);
  end if;
  insert into public.organization_client_field_settings(organization_id,enabled,enabled_at,enabled_by,updated_at)
  values(p_organization,p_enabled,case when p_enabled then now() else null end,case when p_enabled then auth.uid() else null end,now())
  on conflict(organization_id) do update set enabled=excluded.enabled,enabled_at=excluded.enabled_at,
    enabled_by=excluded.enabled_by,updated_at=excluded.updated_at;
  insert into public.client_field_audit_log(organization_id,request_id,actor_id,action,details)
  values(p_organization,p_request_id,auth.uid(),'settings_changed',v_details);
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled,'current_role',v_role,'idempotent',false);
end $$;

create or replace function public.save_minuta_client_field_definition(
  p_organization uuid,p_definition uuid,p_field_key text,p_label text,p_field_type text,
  p_options jsonb,p_required boolean,p_active boolean,p_sort_order integer,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;v_options jsonb;v_details jsonb;v_existing public.client_field_audit_log%rowtype;
begin
  v_role:=public.require_minuta_client_field_access(p_organization,null,true);
  if p_definition is null or p_request_id is null or coalesce(p_field_key,'')!~'^[a-z][a-z0-9_]{1,39}$'
     or char_length(btrim(coalesce(p_label,''))) not between 2 and 80
     or coalesce(p_sort_order,0) not between -10000 and 10000 then
    raise exception using errcode='22023',message='invalid_client_field_definition';
  end if;
  if not coalesce((select enabled from public.organization_client_field_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='client_fields_disabled';
  end if;
  v_options:=public.validate_minuta_client_field_definition(p_field_type,p_options);
  v_details:=jsonb_build_object('field_key',p_field_key,'label',btrim(p_label),'field_type',p_field_type,
    'options',v_options,'required',coalesce(p_required,false),'active',coalesce(p_active,true),'sort_order',coalesce(p_sort_order,0));
  select * into v_existing from public.client_field_audit_log
  where organization_id=p_organization and request_id=p_request_id;
  if v_existing.id is not null then
    if v_existing.action<>'definition_saved' or v_existing.definition_id is distinct from p_definition or v_existing.details<>v_details then
      raise exception using errcode='23505',message='client_field_request_conflict';
    end if;
    return jsonb_build_object('id',p_definition,'idempotent',true);
  end if;
  if exists(select 1 from public.client_field_definitions where id=p_definition and organization_id<>p_organization) then
    raise exception using errcode='23505',message='client_field_definition_conflict';
  end if;
  if exists(
    select 1 from public.client_field_definitions definition
    where definition.id=p_definition and definition.organization_id=p_organization
      and (definition.field_type<>p_field_type or definition.options<>v_options)
      and exists(select 1 from public.client_field_values value
        where value.organization_id=p_organization and value.definition_id=p_definition)
  ) then
    raise exception using errcode='55000',message='client_field_definition_in_use';
  end if;
  insert into public.client_field_definitions(id,organization_id,field_key,label,field_type,options,required,active,sort_order,created_by)
  values(p_definition,p_organization,p_field_key,btrim(p_label),p_field_type,v_options,coalesce(p_required,false),coalesce(p_active,true),coalesce(p_sort_order,0),auth.uid())
  on conflict(id) do update set field_key=excluded.field_key,label=excluded.label,field_type=excluded.field_type,
    options=excluded.options,required=excluded.required,active=excluded.active,sort_order=excluded.sort_order,updated_at=now()
  where client_field_definitions.organization_id=p_organization;
  insert into public.client_field_audit_log(organization_id,request_id,actor_id,action,definition_id,details)
  values(p_organization,p_request_id,auth.uid(),'definition_saved',p_definition,v_details);
  return jsonb_build_object('id',p_definition,'current_role',v_role,'idempotent',false);
end $$;

create or replace function public.set_minuta_client_field_value(
  p_organization uuid,p_definition uuid,p_client_phone text,p_value jsonb,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;v_phone text;v_client_ref text;v_definition public.client_field_definitions%rowtype;
  v_value jsonb;v_details jsonb;v_existing public.client_field_audit_log%rowtype;
begin
  v_role:=public.require_minuta_client_field_access(p_organization,p_client_phone,false);
  v_phone:=public.normalize_client_phone(p_client_phone);
  v_client_ref:=encode(extensions.digest(convert_to(p_organization::text||':'||v_phone,'UTF8'),'sha256'),'hex');
  if p_definition is null or p_request_id is null then raise exception using errcode='22023',message='invalid_client_field_value_request'; end if;
  if not coalesce((select enabled from public.organization_client_field_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='client_fields_disabled';
  end if;
  select * into v_definition from public.client_field_definitions
  where id=p_definition and organization_id=p_organization and active for update;
  if v_definition.id is null then raise exception using errcode='P0001',message='client_field_definition_not_found'; end if;
  v_value:=public.validate_minuta_client_field_value(v_definition.field_type,v_definition.options,p_value);
  v_details:=jsonb_build_object('value_sha256',encode(extensions.digest(convert_to(v_value::text,'UTF8'),'sha256'),'hex'));
  select * into v_existing from public.client_field_audit_log
  where organization_id=p_organization and request_id=p_request_id;
  if v_existing.id is not null then
    if v_existing.action<>'value_saved' or v_existing.definition_id is distinct from p_definition
       or v_existing.client_ref_hash is distinct from v_client_ref or v_existing.details<>v_details then
      raise exception using errcode='23505',message='client_field_request_conflict';
    end if;
    return jsonb_build_object('definition_id',p_definition,'client_phone',v_phone,'value',v_value,'idempotent',true);
  end if;
  insert into public.client_field_values(organization_id,definition_id,client_phone,value_json,updated_by)
  values(p_organization,p_definition,v_phone,v_value,auth.uid())
  on conflict(organization_id,definition_id,client_phone) do update set value_json=excluded.value_json,
    updated_by=excluded.updated_by,updated_at=now();
  insert into public.client_field_audit_log(organization_id,request_id,actor_id,action,definition_id,client_ref_hash,details)
  values(p_organization,p_request_id,auth.uid(),'value_saved',p_definition,v_client_ref,v_details);
  return jsonb_build_object('definition_id',p_definition,'client_phone',v_phone,'value',v_value,'current_role',v_role,'idempotent',false);
end $$;

create or replace function public.delete_minuta_client_field_value(
  p_organization uuid,p_definition uuid,p_client_phone text,p_request_id uuid
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;v_phone text;v_client_ref text;v_required boolean;v_existing public.client_field_audit_log%rowtype;
begin
  v_role:=public.require_minuta_client_field_access(p_organization,p_client_phone,false);
  v_phone:=public.normalize_client_phone(p_client_phone);
  v_client_ref:=encode(extensions.digest(convert_to(p_organization::text||':'||v_phone,'UTF8'),'sha256'),'hex');
  if p_definition is null or p_request_id is null then raise exception using errcode='22023',message='invalid_client_field_value_request'; end if;
  select required into v_required from public.client_field_definitions
  where id=p_definition and organization_id=p_organization and active;
  if v_required is null then raise exception using errcode='P0001',message='client_field_definition_not_found'; end if;
  if v_required then raise exception using errcode='23514',message='required_client_field_cannot_be_cleared'; end if;
  select * into v_existing from public.client_field_audit_log
  where organization_id=p_organization and request_id=p_request_id;
  if v_existing.id is not null then
    if v_existing.action<>'value_deleted' or v_existing.definition_id is distinct from p_definition
       or v_existing.client_ref_hash is distinct from v_client_ref then
      raise exception using errcode='23505',message='client_field_request_conflict';
    end if;
    return jsonb_build_object('definition_id',p_definition,'client_phone',v_phone,'deleted',true,'idempotent',true);
  end if;
  delete from public.client_field_values where organization_id=p_organization
    and definition_id=p_definition and client_phone=v_phone;
  insert into public.client_field_audit_log(organization_id,request_id,actor_id,action,definition_id,client_ref_hash)
  values(p_organization,p_request_id,auth.uid(),'value_deleted',p_definition,v_client_ref);
  return jsonb_build_object('definition_id',p_definition,'client_phone',v_phone,'deleted',true,'current_role',v_role,'idempotent',false);
end $$;

create or replace function public.get_minuta_client_field_workspace(
  p_organization uuid,p_client_phone text
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;v_phone text;v_enabled boolean;
begin
  v_role:=public.require_minuta_client_field_access(p_organization,p_client_phone,false);
  v_phone:=public.normalize_client_phone(p_client_phone);
  v_enabled:=coalesce((select enabled from public.organization_client_field_settings where organization_id=p_organization),false);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,'enabled',v_enabled,'client_phone',v_phone,
    'definitions',case when v_enabled then coalesce((select jsonb_agg(jsonb_build_object(
      'id',definition.id,'field_key',definition.field_key,'label',definition.label,'field_type',definition.field_type,
      'options',definition.options,'required',definition.required,'active',definition.active,'sort_order',definition.sort_order)
      order by definition.sort_order,definition.label,definition.id)
      from public.client_field_definitions definition
      where definition.organization_id=p_organization and (definition.active or v_role in ('owner','admin'))),'[]'::jsonb) else '[]'::jsonb end,
    'values',case when v_enabled then coalesce((select jsonb_agg(jsonb_build_object(
      'definition_id',value.definition_id,'value',value.value_json,'updated_at',value.updated_at)
      order by definition.sort_order,definition.label,definition.id)
      from public.client_field_values value
      join public.client_field_definitions definition on definition.id=value.definition_id and definition.organization_id=value.organization_id
      where value.organization_id=p_organization and value.client_phone=v_phone
        and (definition.active or v_role in ('owner','admin'))),'[]'::jsonb) else '[]'::jsonb end
  );
end $$;

revoke all on function public.initialize_minuta_client_field_settings() from public,anon,authenticated,service_role;
revoke all on function public.reject_minuta_client_field_audit_mutation() from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_client_field_role(uuid) from public,anon,authenticated,service_role;
revoke all on function public.require_minuta_client_field_access(uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.validate_minuta_client_field_definition(text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.validate_minuta_client_field_value(text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_client_fields_enabled(uuid,boolean,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_minuta_client_field_definition(uuid,uuid,text,text,text,jsonb,boolean,boolean,integer,uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_client_field_value(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.delete_minuta_client_field_value(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_client_field_workspace(uuid,text) from public,anon,authenticated,service_role;

grant execute on function public.set_minuta_client_fields_enabled(uuid,boolean,uuid) to authenticated;
grant execute on function public.save_minuta_client_field_definition(uuid,uuid,text,text,text,jsonb,boolean,boolean,integer,uuid) to authenticated;
grant execute on function public.set_minuta_client_field_value(uuid,uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.delete_minuta_client_field_value(uuid,uuid,text,uuid) to authenticated;
grant execute on function public.get_minuta_client_field_workspace(uuid,text) to authenticated;

commit;
