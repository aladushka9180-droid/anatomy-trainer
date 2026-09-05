begin;

set local lock_timeout = '5s';
set local statement_timeout = '10min';
set local search_path = pg_catalog, public;

create temporary table crm_snapshot_guard_manifest (
  setting_name text primary key,
  setting_value text not null
) on commit drop;

insert into crm_snapshot_guard_manifest(setting_name,setting_value) values
  ('manifest_version','1'),
  ('source_runtime','offline-postgresql-17-network-none'),
  ('source_scope','public-ddl-data-plus-auth-uuid-placeholders'),
  ('uuid_policy','global-bijection-with-ephemeral-map'),
  ('unknown_table_data_policy','deny-and-empty'),
  ('unknown_sensitive_column_policy','fail-closed'),
  ('unknown_fk_dependency_policy','fail-closed'),
  ('outbound_function_policy','drop-one-pinned-function-otherwise-fail'),
  ('acl_policy','revoke-public');

create temporary table crm_snapshot_allowed_table (
  table_name text primary key
) on commit drop;

insert into crm_snapshot_allowed_table(table_name) values
  ('organizations'),
  ('locations'),
  ('organization_memberships'),
  ('performer_profiles'),
  ('services'),
  ('client_accounts'),
  ('bookings'),
  ('booking_outcomes'),
  ('booking_series'),
  ('organization_inventory_settings'),
  ('inventory_warehouses'),
  ('inventory_items'),
  ('inventory_stock_balances'),
  ('inventory_movements'),
  ('inventory_service_usage'),
  ('organization_payroll_settings'),
  ('payroll_plans'),
  ('payroll_plan_tiers'),
  ('payroll_periods'),
  ('payroll_period_plan_snapshots'),
  ('payroll_items'),
  ('payroll_adjustments');

create temporary table crm_snapshot_column_policy (
  table_name text not null,
  column_name text not null,
  action text not null check (action in (
    'keep_category','pseudonym','phone','clear','redact_json_object',
    'redact_json_array','random_uuid','random_hash','nullify'
  )),
  required boolean not null default false,
  primary key(table_name,column_name)
) on commit drop;

-- Every character, JSON, bytea or security-looking column in retained tables
-- must occur here. Unknown free text is rejected before the first mutation.
insert into crm_snapshot_column_policy(table_name,column_name,action,required) values
  ('organizations','name','pseudonym',true),
  ('organizations','public_slug','pseudonym',true),
  ('organizations','status','keep_category',true),
  ('locations','name','pseudonym',true),
  ('locations','timezone','keep_category',true),
  ('locations','address','clear',true),
  ('organization_memberships','role','keep_category',true),
  ('performer_profiles','display_name','pseudonym',true),
  ('services','name','pseudonym',true),
  ('client_accounts','normalized_phone','phone',true),
  ('client_accounts','access_code_hash','random_hash',true),
  ('client_accounts','auth_user_id','nullify',false),
  ('bookings','booking_code','pseudonym',true),
  ('bookings','manage_token','random_uuid',true),
  ('bookings','request_id','random_uuid',false),
  ('bookings','request_fingerprint','random_hash',false),
  ('bookings','client_name','pseudonym',true),
  ('bookings','client_phone','phone',true),
  ('bookings','status','keep_category',true),
  ('bookings','payment_status','keep_category',false),
  ('bookings','payment_url','clear',false),
  ('bookings','color_key','keep_category',false),
  ('bookings','provider_note','clear',false),
  ('bookings','booking_scope_source','keep_category',false),
  ('bookings','booking_policy_snapshot','redact_json_object',false),
  ('bookings','cancellation_reason','keep_category',false),
  ('bookings','refund_status','keep_category',false),
  ('bookings','booking_source','keep_category',false),
  ('bookings','created_by_role','keep_category',false),
  ('booking_outcomes','visit_status','keep_category',true),
  ('booking_outcomes','payment_method','keep_category',true),
  ('booking_outcomes','completion_source','keep_category',false),
  ('booking_series','client_name','pseudonym',true),
  ('booking_series','client_phone','phone',true),
  ('booking_series','manage_token','random_uuid',false),
  ('booking_series','access_token','random_uuid',false),
  ('booking_series','series_token','random_uuid',false),
  ('inventory_warehouses','name','pseudonym',true),
  ('inventory_items','name','pseudonym',true),
  ('inventory_items','sku','pseudonym',true),
  ('inventory_items','unit','keep_category',true),
  ('inventory_movements','movement_type','keep_category',true),
  ('inventory_movements','request_id','random_uuid',true),
  ('inventory_movements','reason','clear',true),
  ('payroll_plans','name','pseudonym',true),
  ('payroll_periods','name','pseudonym',true),
  ('payroll_periods','status','keep_category',true),
  ('payroll_periods','source_fingerprint','random_hash',true),
  ('payroll_period_plan_snapshots','plan_name','pseudonym',true),
  ('payroll_period_plan_snapshots','tiers','redact_json_array',true),
  ('payroll_items','service_name','pseudonym',true),
  ('payroll_items','source_snapshot','redact_json_object',true),
  ('payroll_adjustments','reason','pseudonym',true);

do $preflight$
declare
  v_problem text;
begin
  if current_setting('server_version_num')::integer < 170000 then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','requires_postgresql_17')::text;
  end if;

  if exists (
    select 1 from pg_namespace
    where nspname in ('cron','net','vault','storage','supabase_functions','realtime')
  ) then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','forbidden_managed_schema_loaded')::text;
  end if;

  select string_agg(relation_row.relname,',' order by relation_row.relname) into v_problem
  from pg_class relation_row
  join pg_namespace namespace_row on namespace_row.oid=relation_row.relnamespace
  where namespace_row.nspname='public' and relation_row.relkind in ('m','f');
  if v_problem is not null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','unsupported_data_relation','objects',string_to_array(v_problem,','))::text;
  end if;

  if to_regclass('auth.users') is null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','auth_uuid_placeholder_missing')::text;
  end if;
  select string_agg(column_name,',' order by ordinal_position) into v_problem
  from information_schema.columns
  where table_schema='auth' and table_name='users';
  if v_problem is distinct from 'id' or not exists (
    select 1 from information_schema.columns
    where table_schema='auth' and table_name='users'
      and column_name='id' and data_type='uuid'
  ) then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','auth_users_must_contain_only_uuid_id')::text;
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema='auth' and table_name<>'users' and table_type='BASE TABLE'
  ) then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','unexpected_auth_data_table')::text;
  end if;

  select string_agg(policy.table_name,',' order by policy.table_name) into v_problem
  from crm_snapshot_allowed_table policy
  where to_regclass(format('public.%I',policy.table_name)) is null;
  if v_problem is not null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','required_tables_missing','objects',string_to_array(v_problem,','))::text;
  end if;

  select string_agg(policy.table_name||'.'||policy.column_name,',' order by policy.table_name,policy.column_name)
  into v_problem
  from crm_snapshot_column_policy policy
  where policy.required and not exists (
    select 1 from information_schema.columns column_row
    where column_row.table_schema='public'
      and column_row.table_name=policy.table_name
      and column_row.column_name=policy.column_name
  );
  if v_problem is not null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','required_columns_missing','objects',string_to_array(v_problem,','))::text;
  end if;

  select string_agg(column_row.table_name||'.'||column_row.column_name,','
                    order by column_row.table_name,column_row.ordinal_position)
  into v_problem
  from information_schema.columns column_row
  join crm_snapshot_allowed_table allowed on allowed.table_name=column_row.table_name
  join pg_namespace namespace_row on namespace_row.nspname='public'
  join pg_class relation_row on relation_row.relnamespace=namespace_row.oid
    and relation_row.relname=column_row.table_name
  join pg_attribute attribute_row on attribute_row.attrelid=relation_row.oid
    and attribute_row.attname=column_row.column_name and not attribute_row.attisdropped
  join pg_type type_row on type_row.oid=attribute_row.atttypid
  where column_row.table_schema='public'
    and (
      type_row.typcategory='S'
      or type_row.typname in ('json','jsonb','bytea')
      or type_row.typname='_text'
      or column_row.column_name ~* '(token|secret|hash|url|email|phone|name|note|address|comment|payload|details)'
    )
    and not exists (
      select 1 from crm_snapshot_column_policy policy
      where policy.table_name=column_row.table_name
        and policy.column_name=column_row.column_name
    );
  if v_problem is not null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','unknown_sensitive_columns','objects',string_to_array(v_problem,','))::text;
  end if;

  select string_agg(
    child_namespace.nspname||'.'||child.relname||'->'||parent_namespace.nspname||'.'||parent.relname,
    ',' order by child.relname,parent.relname
  ) into v_problem
  from pg_constraint constraint_row
  join pg_class child on child.oid=constraint_row.conrelid
  join pg_namespace child_namespace on child_namespace.oid=child.relnamespace
  join pg_class parent on parent.oid=constraint_row.confrelid
  join pg_namespace parent_namespace on parent_namespace.oid=parent.relnamespace
  join crm_snapshot_allowed_table allowed on allowed.table_name=child.relname
  where constraint_row.contype='f'
    and child_namespace.nspname='public'
    and not (
      (parent_namespace.nspname='public' and exists (
        select 1 from crm_snapshot_allowed_table parent_allowed
        where parent_allowed.table_name=parent.relname
      ))
      or (parent_namespace.nspname='auth' and parent.relname='users')
    );
  if v_problem is not null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','unknown_fk_dependency','objects',string_to_array(v_problem,','))::text;
  end if;

  select string_agg(
    namespace_row.nspname||'.'||procedure_row.proname||'('||pg_get_function_identity_arguments(procedure_row.oid)||')',
    ',' order by namespace_row.nspname,procedure_row.proname,procedure_row.oid
  ) into v_problem
  from pg_proc procedure_row
  join pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
  where namespace_row.nspname='public'
    and procedure_row.prokind in ('f','p')
    and (
      procedure_row.prosrc ~* '(vault|dblink|(^|[^a-z])net[.]|http_(get|post|request)|extensions[.]http)'
      or procedure_row.probin ~* '(dblink|http)'
    )
    and not (
      procedure_row.proname='get_telegram_reminder_secret_hash'
      and pg_get_function_identity_arguments(procedure_row.oid)=''
    );
  if v_problem is not null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','unexpected_outbound_or_secret_function','objects',string_to_array(v_problem,','))::text;
  end if;
end
$preflight$;

-- This is the only pinned production helper allowed to mention Vault. It is
-- not needed in the isolated snapshot, and RESTRICT prevents a hidden cascade.
drop function if exists public.get_telegram_reminder_secret_hash() restrict;

-- Business updates must not dispatch notification/audit trigger side effects.
-- Constraint safety is established by the immutable identifiers and the FK
-- closure preflight; all trigger states are restored before export.
do $disable_business_triggers$
declare
  v_table record;
begin
  for v_table in select table_name from crm_snapshot_allowed_table order by table_name loop
    execute format('alter table public.%I disable trigger all',v_table.table_name);
  end loop;
end
$disable_business_triggers$;

-- Remove all rows outside the exact business allowlist. FK closure was proven
-- above, therefore CASCADE cannot silently erase a retained business row.
do $deny_unknown_data$
declare
  v_tables text;
begin
  select string_agg(format('%I.%I',namespace_row.nspname,relation_row.relname),',')
  into v_tables
  from pg_class relation_row
  join pg_namespace namespace_row on namespace_row.oid=relation_row.relnamespace
  where namespace_row.nspname='public'
    and relation_row.relkind in ('r','p')
    and not exists (
      select 1 from crm_snapshot_allowed_table allowed
      where allowed.table_name=relation_row.relname
    );
  if v_tables is not null then
    execute 'truncate table '||v_tables||' restart identity cascade';
  end if;
end
$deny_unknown_data$;

create temporary table crm_snapshot_uuid_map (
  source_uuid uuid primary key,
  pseudo_uuid uuid unique,
  check (pseudo_uuid is null or pseudo_uuid<>source_uuid)
) on commit drop;

do $collect_uuid_values$
declare
  v_column record;
begin
  for v_column in
    select column_row.table_name,column_row.column_name
    from information_schema.columns column_row
    join crm_snapshot_allowed_table allowed on allowed.table_name=column_row.table_name
    where column_row.table_schema='public' and column_row.data_type='uuid'
      and column_row.is_generated='NEVER'
    order by column_row.table_name,column_row.ordinal_position
  loop
    execute format(
      'insert into crm_snapshot_uuid_map(source_uuid) select distinct %1$I from public.%2$I where %1$I is not null on conflict(source_uuid) do nothing',
      v_column.column_name,v_column.table_name
    );
  end loop;

  insert into crm_snapshot_uuid_map(source_uuid)
  select id from auth.users on conflict(source_uuid) do nothing;

  update crm_snapshot_uuid_map set pseudo_uuid=gen_random_uuid();
  if exists (
    select 1 from crm_snapshot_uuid_map generated
    join crm_snapshot_uuid_map source on source.source_uuid=generated.pseudo_uuid
  ) then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','uuid_map_collision')::text;
  end if;
end
$collect_uuid_values$;

do $apply_uuid_map$
declare
  v_column record;
begin
  for v_column in
    select column_row.table_name,column_row.column_name
    from information_schema.columns column_row
    join crm_snapshot_allowed_table allowed on allowed.table_name=column_row.table_name
    where column_row.table_schema='public' and column_row.data_type='uuid'
      and column_row.is_generated='NEVER'
    order by column_row.table_name,column_row.ordinal_position
  loop
    execute format(
      'update public.%1$I target set %2$I=mapping.pseudo_uuid from crm_snapshot_uuid_map mapping where target.%2$I=mapping.source_uuid',
      v_column.table_name,v_column.column_name
    );
  end loop;

  update auth.users target
  set id=mapping.pseudo_uuid
  from crm_snapshot_uuid_map mapping
  where target.id=mapping.source_uuid;
end
$apply_uuid_map$;

create temporary table crm_snapshot_phone_map (
  canonical_phone text primary key,
  pseudo_phone text not null unique
) on commit drop;

with source_phone as (
  select normalized_phone as value from public.client_accounts
  union
  select client_phone from public.bookings
  union
  select client_phone from public.booking_series
), canonical_source as (
  select distinct regexp_replace(value,'[^0-9]','','g') as value
  from source_phone
  where coalesce(value,'') not in ('','0000000000')
), numbered_source as (
  select value,row_number() over(order by value) as sequence
  from canonical_source
), available_phone as (
  select candidate,row_number() over(order by candidate) as sequence
  from (
    select '7'||lpad(series::text,10,'0') as candidate
    from generate_series(1,(select count(*)*2+100 from numbered_source)) series
  ) candidate_row
  where not exists(select 1 from canonical_source where value=candidate_row.candidate)
)
insert into crm_snapshot_phone_map(canonical_phone,pseudo_phone)
select source.value,available.candidate
from numbered_source source
join available_phone available using(sequence);

update public.client_accounts account
set normalized_phone=phone.pseudo_phone,
    access_code_hash=md5(gen_random_uuid()::text||random()::text)
      ||md5(gen_random_uuid()::text||clock_timestamp()::text)
from crm_snapshot_phone_map phone
where phone.canonical_phone=regexp_replace(account.normalized_phone,'[^0-9]','','g');

update public.bookings booking
set client_phone=phone.pseudo_phone
from crm_snapshot_phone_map phone
where phone.canonical_phone=regexp_replace(booking.client_phone,'[^0-9]','','g');

update public.booking_series series
set client_phone=phone.pseudo_phone
from crm_snapshot_phone_map phone
where phone.canonical_phone=regexp_replace(series.client_phone,'[^0-9]','','g');

update public.organizations
set name='Организация '||left(replace(id::text,'-',''),12),
    public_slug='snapshot-'||left(md5(id::text),24);
update public.locations
set name='Филиал '||left(replace(id::text,'-',''),12),address='';
update public.performer_profiles
set display_name='Специалист '||left(replace(id::text,'-',''),12);
update public.services
set name='Услуга '||left(replace(id::text,'-',''),12);
update public.bookings
set booking_code='SNAP-'||upper(left(md5(id::text),12)),
    manage_token=gen_random_uuid(),
    client_name='Клиент '||right(client_phone,10);
update public.booking_series
set client_name='Клиент '||right(client_phone,10);
update public.inventory_warehouses
set name='Склад '||left(replace(id::text,'-',''),12);
update public.inventory_items
set name='Материал '||left(replace(id::text,'-',''),12),
    sku='SKU-'||upper(left(md5(id::text),16));
update public.inventory_movements
set request_id=gen_random_uuid(),reason='';
update public.payroll_plans
set name='План '||left(replace(id::text,'-',''),12);
update public.payroll_periods
set name='Период '||left(replace(id::text,'-',''),12),
    source_fingerprint=md5(gen_random_uuid()::text)||md5(random()::text);
update public.payroll_period_plan_snapshots
set plan_name='План '||left(replace(id::text,'-',''),12),tiers='[]'::jsonb;
update public.payroll_items
set service_name='Услуга '||left(replace(id::text,'-',''),12),source_snapshot='{}'::jsonb;
update public.payroll_adjustments set reason='Обезличено';

do $optional_columns$
begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_accounts' and column_name='auth_user_id') then
    execute 'update public.client_accounts set auth_user_id=null';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='request_id') then
    execute 'update public.bookings set request_id=gen_random_uuid() where request_id is not null';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='request_fingerprint') then
    execute $sql$update public.bookings
      set request_fingerprint=case when request_id is null then null
        else md5(gen_random_uuid()::text)||md5(random()::text) end$sql$;
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='payment_url') then
    execute 'update public.bookings set payment_url=''''';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='provider_note') then
    execute 'update public.bookings set provider_note=''''';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='booking_policy_snapshot') then
    execute $statement$update public.bookings set booking_policy_snapshot='{}'::jsonb$statement$;
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_series' and column_name='manage_token') then
    execute 'update public.booking_series set manage_token=gen_random_uuid()';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_series' and column_name='access_token') then
    execute 'update public.booking_series set access_token=gen_random_uuid()';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='booking_series' and column_name='series_token') then
    execute 'update public.booking_series set series_token=gen_random_uuid()';
  end if;
end
$optional_columns$;

do $postconditions$
declare
  v_problem text;
  v_table record;
  v_count bigint;
begin
  for v_table in
    select relation_row.relname
    from pg_class relation_row
    join pg_namespace namespace_row on namespace_row.oid=relation_row.relnamespace
    where namespace_row.nspname='public' and relation_row.relkind in ('r','p')
      and not exists(select 1 from crm_snapshot_allowed_table allowed where allowed.table_name=relation_row.relname)
  loop
    execute format('select count(*) from public.%I',v_table.relname) into v_count;
    if v_count<>0 then
      raise exception using
        message='crm_snapshot_guard_failed',
        detail=jsonb_build_object('code','denied_table_not_empty','objects',jsonb_build_array(v_table.relname))::text;
    end if;
  end loop;

  if exists(select 1 from public.client_accounts where normalized_phone !~ '^7[0-9]{10}$')
     or exists(select 1 from public.bookings where client_phone not in ('0000000000') and client_phone !~ '^7[0-9]{10}$')
     or exists(select 1 from public.booking_series where client_phone not in ('0000000000') and client_phone !~ '^7[0-9]{10}$') then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','phone_anonymization_failed')::text;
  end if;
  if exists(select 1 from public.client_accounts where access_code_hash !~ '^[0-9a-f]{64}$') then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','access_hash_rotation_failed')::text;
  end if;
  if exists(select 1 from public.bookings where payment_url<>'' or provider_note<>'') then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','booking_free_text_not_cleared')::text;
  end if;

  select string_agg(table_name||'.'||column_name,',' order by table_name,column_name) into v_problem
  from crm_snapshot_column_policy policy
  where policy.action not in ('keep_category','phone')
    and not exists (
      select 1 from information_schema.columns column_row
      where column_row.table_schema='public' and column_row.table_name=policy.table_name
        and column_row.column_name=policy.column_name
    ) and policy.required;
  if v_problem is not null then
    raise exception using
      message='crm_snapshot_guard_failed',
      detail=jsonb_build_object('code','required_transform_missing','objects',string_to_array(v_problem,','))::text;
  end if;
end
$postconditions$;

do $enable_business_triggers$
declare
  v_table record;
begin
  for v_table in select table_name from crm_snapshot_allowed_table order by table_name loop
    execute format('alter table public.%I enable trigger all',v_table.table_name);
  end loop;
end
$enable_business_triggers$;

-- The resulting dump is data-only usable by its owner. It must not preserve
-- broad grants even if the source DDL happened to contain them.
revoke all on schema public from public;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all functions in schema public from public;
alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke all on functions from public;

commit;

select 'crm_snapshot_anonymize_ok' as result;
