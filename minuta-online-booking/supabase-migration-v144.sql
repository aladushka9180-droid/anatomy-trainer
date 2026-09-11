\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='5min';
set local search_path=public,extensions,pg_catalog;

do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.client_import_batches') is null
     or to_regclass('public.organization_imported_clients') is null
     or to_regclass('public.booking_history_import_batches') is null
     or to_regclass('public.organization_imported_booking_history') is null
     or to_regclass('public.client_record_entries') is null
     or to_regclass('public.minuta_personal_data_access_log') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null
     or to_regprocedure('public.import_minuta_clients(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.import_minuta_booking_history(uuid,jsonb,uuid,text)') is null then
    raise exception using errcode='P0001',message='v144_requires_v95_v99_v110_v112';
  end if;
end $$;

create table if not exists public.provider_data_transfer_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  transfer_kind text not null check (transfer_kind in ('clients','history')),
  source_system text not null check (source_system in ('yclients','dikidi','masters','other')),
  source_file_name text,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  target_state_hash text not null check (target_state_hash ~ '^[0-9a-f]{64}$'),
  staged_payload jsonb check (staged_payload is null or jsonb_typeof(staged_payload)='array'),
  input_count integer not null check (input_count between 1 and 500),
  planned_create_count integer not null default 0 check (planned_create_count between 0 and 500),
  planned_update_count integer not null default 0 check (planned_update_count between 0 and 500),
  planned_unchanged_count integer not null default 0 check (planned_unchanged_count between 0 and 500),
  conflict_count integer not null default 0 check (conflict_count between 0 and 500),
  status text not null default 'previewed' check (status in ('previewed','applied','rolled_back','expired')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  legacy_client_batch_id uuid,
  legacy_history_batch_id uuid,
  applied_result jsonb,
  expires_at timestamptz not null default (now()+interval '15 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by uuid references auth.users(id) on delete restrict,
  unique (organization_id,request_id),
  check ((transfer_kind='history' and char_length(source_file_name) between 1 and 160)
    or (transfer_kind='clients' and source_file_name is null)),
  check ((status='previewed' and staged_payload is not null and applied_at is null and rolled_back_at is null and rolled_back_by is null)
    or (status='expired' and staged_payload is null and applied_at is null and rolled_back_at is null and rolled_back_by is null)
    or (status='applied' and staged_payload is null and applied_at is not null and rolled_back_at is null and rolled_back_by is null)
    or (status='rolled_back' and staged_payload is null and applied_at is not null and rolled_back_at is not null and rolled_back_by is not null)),
  check ((status in ('previewed','expired') and legacy_client_batch_id is null
      and legacy_history_batch_id is null and applied_result is null)
    or (status in ('applied','rolled_back') and legacy_client_batch_id is not null
      and jsonb_typeof(applied_result)='object'
      and ((transfer_kind='clients' and legacy_history_batch_id is null)
        or (transfer_kind='history' and legacy_history_batch_id is not null))))
);

create table if not exists public.provider_data_transfer_changes (
  batch_id uuid not null references public.provider_data_transfer_batches(id) on delete restrict,
  sequence_no integer not null check (sequence_no between 1 and 2000),
  entity_kind text not null check (entity_kind in ('client','history')),
  entity_key text not null check (char_length(entity_key) between 1 and 160),
  operation text not null check (operation in ('created','updated')),
  before_row jsonb,
  after_row jsonb not null check (jsonb_typeof(after_row)='object'),
  primary key (batch_id,sequence_no),
  unique (batch_id,entity_kind,entity_key),
  check ((operation='created' and before_row is null)
    or (operation='updated' and jsonb_typeof(before_row)='object'))
);

do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='provider_data_transfer_batches'
        and column_name in ('id','organization_id','request_id','transfer_kind','source_system','source_file_name',
          'payload_hash','target_state_hash','staged_payload','input_count','planned_create_count','planned_update_count',
          'planned_unchanged_count','conflict_count','status','actor_id','legacy_client_batch_id',
          'legacy_history_batch_id','applied_result','expires_at','created_at','updated_at','applied_at','rolled_back_at',
          'rolled_back_by'))<>25
     or (select count(*) from information_schema.columns
      where table_schema='public' and table_name='provider_data_transfer_changes'
        and column_name in ('batch_id','sequence_no','entity_kind','entity_key','operation','before_row','after_row'))<>7 then
    raise exception using errcode='P0001',message='v144_incompatible_existing_schema';
  end if;
  if exists (
    select 1 from public.organization_imported_clients
    where source_external_id is not null
    group by organization_id,source_system,source_external_id
    having count(*)>1
  ) then
    raise exception using errcode='P0001',message='v144_duplicate_source_external_ids';
  end if;
end $$;

create unique index if not exists organization_imported_clients_source_v144_idx
  on public.organization_imported_clients(organization_id,source_system,source_external_id)
  where source_external_id is not null;
create index if not exists provider_data_transfer_batches_scope_v144_idx
  on public.provider_data_transfer_batches(organization_id,created_at desc,id desc);
create index if not exists provider_data_transfer_batches_expiry_v144_idx
  on public.provider_data_transfer_batches(expires_at,id)
  where status='previewed';

alter table public.provider_data_transfer_batches enable row level security;
alter table public.provider_data_transfer_changes enable row level security;
revoke all on table public.provider_data_transfer_batches,public.provider_data_transfer_changes
  from public,anon,authenticated,service_role;
grant all on table public.provider_data_transfer_batches,public.provider_data_transfer_changes to service_role;

create or replace function public.canonicalize_minuta_provider_transfer_v144(
  p_kind text,
  p_rows jsonb
) returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_kind text:=lower(btrim(coalesce(p_kind,'')));
  v_row jsonb;
  v_result jsonb:='[]'::jsonb;
  v_phone text;
  v_name text;
  v_display_phone text;
  v_email text;
  v_note text;
  v_external_id text;
  v_birthday date;
  v_last_visit date;
  v_visit_count integer;
  v_total_spent integer;
  v_marketing boolean;
  v_personal_data boolean;
  v_service text;
  v_provider text;
  v_sheet text;
  v_date date;
  v_time time without time zone;
  v_duration integer;
  v_price integer;
begin
  if v_kind not in ('clients','history') or p_rows is null or jsonb_typeof(p_rows)<>'array'
     or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception using errcode='22023',message='invalid_provider_transfer_payload';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row)<>'object' then
      raise exception using errcode='22023',message='invalid_provider_transfer_row';
    end if;
    v_phone:=public.normalize_client_phone(v_row->>'phone');
    v_display_phone:=btrim(coalesce(nullif(v_row->>'display_phone',''),v_row->>'phone',''));
    if v_kind='clients' then
      v_name:=btrim(coalesce(v_row->>'name',''));
      v_email:=nullif(lower(btrim(coalesce(v_row->>'email',''))),'');
      v_note:=nullif(btrim(coalesce(v_row->>'note','')),'');
      v_external_id:=nullif(btrim(coalesce(v_row->>'external_id','')),'');
      begin v_birthday:=nullif(v_row->>'birthday','')::date;
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_birthday'; end;
      begin v_last_visit:=nullif(v_row->>'last_visit_on','')::date;
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_last_visit'; end;
      begin v_visit_count:=greatest(0,coalesce((v_row->>'visit_count')::integer,0));
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_visit_count'; end;
      begin v_total_spent:=greatest(0,coalesce((v_row->>'total_spent_rub')::integer,0));
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_total_spent'; end;
      v_marketing:=case when jsonb_typeof(v_row->'marketing_consent')='boolean'
        then (v_row->>'marketing_consent')::boolean else null end;
      v_personal_data:=case when jsonb_typeof(v_row->'personal_data_consent')='boolean'
        then (v_row->>'personal_data_consent')::boolean else null end;
      if coalesce(v_phone,'')!~'^7[0-9]{10}$' or char_length(v_name) not between 1 and 80
         or char_length(v_display_phone) not between 10 and 24
         or (v_email is not null and (char_length(v_email)>254 or v_email!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
         or char_length(coalesce(v_note,''))>1000 or char_length(coalesce(v_external_id,''))>120
         or (v_birthday is not null and (v_birthday<date '1900-01-01' or v_birthday>current_date))
         or (v_last_visit is not null and (v_last_visit<date '1900-01-01' or v_last_visit>current_date))
         or v_visit_count>1000000 or v_total_spent>2000000000 then
        raise exception using errcode='22023',message='invalid_provider_transfer_client';
      end if;
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'phone',v_phone,'display_phone',v_display_phone,'name',v_name,'email',coalesce(v_email,''),
        'birthday',coalesce(v_birthday::text,''),'note',coalesce(v_note,''),'external_id',coalesce(v_external_id,''),
        'visit_count',v_visit_count,'total_spent_rub',v_total_spent,'last_visit_on',coalesce(v_last_visit::text,''),
        'marketing_consent',v_marketing,'personal_data_consent',v_personal_data));
    else
      v_name:=btrim(coalesce(v_row->>'client_name',''));
      v_service:=btrim(coalesce(v_row->>'service_name',''));
      v_provider:=nullif(btrim(coalesce(v_row->>'source_provider_name','')),'');
      v_note:=nullif(btrim(coalesce(v_row->>'source_note','')),'');
      v_sheet:=btrim(coalesce(v_row->>'source_sheet',''));
      begin v_date:=(v_row->>'booking_date')::date;
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_history_date'; end;
      begin v_time:=(v_row->>'booking_time')::time;
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_history_time'; end;
      begin v_duration:=(v_row->>'duration_minutes')::integer;
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_history_duration'; end;
      begin v_price:=coalesce((v_row->>'price_rub')::integer,0);
      exception when others then raise exception using errcode='22023',message='invalid_provider_transfer_history_price'; end;
      if coalesce(v_phone,'')!~'^7[0-9]{10}$' or char_length(v_name) not between 2 and 80
         or char_length(v_display_phone) not between 10 and 24 or char_length(v_service) not between 1 and 400
         or char_length(v_sheet) not between 1 and 80 or char_length(coalesce(v_provider,''))>120
         or char_length(coalesce(v_note,''))>1000 or v_date is null
         or v_date<date '2000-01-01' or v_date>current_date or v_time is null
         or extract(second from v_time)<>0 or v_duration is null or v_duration not between 1 and 480
         or extract(epoch from v_time)+v_duration*60>=86400 or v_price not between 0 and 10000000 then
        raise exception using errcode='22023',message='invalid_provider_transfer_history';
      end if;
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'booking_date',v_date::text,'booking_time',to_char(v_time,'HH24:MI:SS'),'duration_minutes',v_duration,
        'client_name',v_name,'phone',v_phone,'display_phone',v_display_phone,'service_name',v_service,
        'source_note',coalesce(v_note,''),'source_provider_name',coalesce(v_provider,''),
        'price_rub',v_price,'source_sheet',v_sheet));
    end if;
  end loop;
  if v_kind='clients' and exists (
    select 1 from jsonb_array_elements(v_result) as result_rows(row_value)
    group by row_value->>'phone' having count(*)>1
  ) then
    raise exception using errcode='22023',message='duplicate_provider_transfer_phone';
  end if;
  if v_kind='clients' and exists (
    select 1 from jsonb_array_elements(v_result) as result_rows(row_value)
    where nullif(row_value->>'external_id','') is not null
    group by row_value->>'external_id' having count(distinct row_value->>'phone')>1
  ) then
    raise exception using errcode='22023',message='duplicate_provider_transfer_external_id';
  end if;
  return v_result;
end $$;

revoke all on function public.canonicalize_minuta_provider_transfer_v144(text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.minuta_provider_transfer_target_hash_v144(
  p_organization uuid,
  p_kind text,
  p_source_system text,
  p_payload jsonb
) returns text
language plpgsql
stable
set search_path=''
as $$
declare
  v_kind text:=lower(btrim(coalesce(p_kind,'')));
  v_source text:=lower(btrim(coalesce(p_source_system,'')));
  v_state jsonb;
begin
  if v_kind not in ('clients','history') or v_source not in ('yclients','dikidi','masters','other')
     or p_payload is null or jsonb_typeof(p_payload)<>'array' then
    raise exception using errcode='22023',message='invalid_provider_transfer_target_hash';
  end if;
  if v_kind='clients' then
    select jsonb_build_object('clients',coalesce(jsonb_agg(to_jsonb(client_row) order by client_row.id),'[]'::jsonb))
    into v_state
    from public.organization_imported_clients client_row
    where client_row.organization_id=p_organization and (
      client_row.normalized_phone in (
        select row_value->>'phone'
        from jsonb_array_elements(p_payload) as payload_rows(row_value)
      )
      or (client_row.source_system=v_source and client_row.source_external_id in (
        select nullif(row_value->>'external_id','')
        from jsonb_array_elements(p_payload) as payload_rows(row_value)
        where nullif(row_value->>'external_id','') is not null
      ))
    );
  else
    select jsonb_build_object(
      'clients',coalesce((
        select jsonb_agg(to_jsonb(client_row) order by client_row.id)
        from public.organization_imported_clients client_row
        where client_row.organization_id=p_organization and client_row.normalized_phone in (
          select row_value->>'phone'
          from jsonb_array_elements(p_payload) as payload_rows(row_value)
        )
      ),'[]'::jsonb),
      'history',coalesce((
        select jsonb_agg(to_jsonb(history_row) order by history_row.id)
        from public.organization_imported_booking_history history_row
        where history_row.organization_id=p_organization and history_row.normalized_phone in (
          select row_value->>'phone'
          from jsonb_array_elements(p_payload) as payload_rows(row_value)
        )
      ),'[]'::jsonb)
    ) into v_state;
  end if;
  return encode(extensions.digest(convert_to(v_state::text,'UTF8'),'sha256'),'hex');
end $$;

revoke all on function public.minuta_provider_transfer_target_hash_v144(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;

create or replace function public.preview_minuta_provider_transfer_v144(
  p_organization uuid,
  p_kind text,
  p_source_system text,
  p_rows jsonb,
  p_request_id uuid,
  p_source_file text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
set lock_timeout='5s'
as $$
declare
  v_actor uuid:=auth.uid();
  v_kind text:=lower(btrim(coalesce(p_kind,'')));
  v_source text:=lower(btrim(coalesce(p_source_system,'')));
  v_source_file text:=null;
  v_payload jsonb;
  v_payload_hash text;
  v_target_hash text;
  v_count integer;
  v_create integer:=0;
  v_update integer:=0;
  v_unchanged integer:=0;
  v_conflicts integer:=0;
  v_batch public.provider_data_transfer_batches%rowtype;
begin
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='provider_transfer_manager_required';
  end if;
  if p_request_id is null or v_kind not in ('clients','history')
     or v_source not in ('yclients','dikidi','masters','other') then
    raise exception using errcode='22023',message='invalid_provider_transfer_request';
  end if;
  if v_kind='history' then
    v_source_file:=regexp_replace(btrim(coalesce(p_source_file,'')),'^.*[\\/]','','g');
    if char_length(v_source_file) not between 1 and 160 or v_source_file~'[[:cntrl:]]' then
      raise exception using errcode='22023',message='invalid_provider_transfer_source_file';
    end if;
  end if;
  v_payload:=public.canonicalize_minuta_provider_transfer_v144(v_kind,p_rows);
  lock table public.organization_imported_booking_history in share row exclusive mode;
  lock table public.organization_imported_clients in share row exclusive mode;
  with expired as (
    select id from public.provider_data_transfer_batches
    where status='previewed' and expires_at<=now()
    order by expires_at,id limit 100 for update skip locked
  )
  update public.provider_data_transfer_batches batch set
    status='expired',staged_payload=null,updated_at=now()
  from expired where batch.id=expired.id;
  v_count:=jsonb_array_length(v_payload);
  v_payload_hash:=encode(extensions.digest(convert_to(
    concat_ws(E'\n','provider-transfer-v144',v_kind,v_source,coalesce(v_source_file,''),v_payload::text),
    'UTF8'),'sha256'),'hex');
  v_target_hash:=public.minuta_provider_transfer_target_hash_v144(
    p_organization,v_kind,v_source,v_payload);

  if v_kind='clients' then
    select count(*) into v_conflicts
    from jsonb_array_elements(v_payload) as payload_rows(row_value)
    join public.organization_imported_clients existing
      on existing.organization_id=p_organization
      and existing.source_system=v_source
      and existing.source_external_id=nullif(row_value->>'external_id','')
      and existing.normalized_phone<>(row_value->>'phone')
    where nullif(row_value->>'external_id','') is not null;
    select
      count(*) filter (where existing.id is null),
      count(*) filter (where existing.id is not null and not (
        existing.display_phone is not distinct from row_value->>'display_phone'
        and existing.client_name is not distinct from row_value->>'name'
        and existing.email is not distinct from nullif(row_value->>'email','')
        and existing.birthday is not distinct from nullif(row_value->>'birthday','')::date
        and existing.note is not distinct from nullif(row_value->>'note','')
        and existing.source_system is not distinct from v_source
        and existing.source_external_id is not distinct from coalesce(
          nullif(row_value->>'external_id',''),existing.source_external_id)
        and existing.imported_visit_count is not distinct from greatest(
          existing.imported_visit_count,(row_value->>'visit_count')::integer)
        and existing.imported_total_spent_rub is not distinct from greatest(
          existing.imported_total_spent_rub,(row_value->>'total_spent_rub')::integer)
        and existing.imported_last_visit_on is not distinct from greatest(
          existing.imported_last_visit_on,nullif(row_value->>'last_visit_on','')::date)
        and existing.marketing_consent is not distinct from coalesce(
          (row_value->>'marketing_consent')::boolean,existing.marketing_consent)
        and existing.personal_data_consent is not distinct from coalesce(
          (row_value->>'personal_data_consent')::boolean,existing.personal_data_consent)
      )),
      count(*) filter (where existing.id is not null and (
        existing.display_phone is not distinct from row_value->>'display_phone'
        and existing.client_name is not distinct from row_value->>'name'
        and existing.email is not distinct from nullif(row_value->>'email','')
        and existing.birthday is not distinct from nullif(row_value->>'birthday','')::date
        and existing.note is not distinct from nullif(row_value->>'note','')
        and existing.source_system is not distinct from v_source
        and existing.source_external_id is not distinct from coalesce(
          nullif(row_value->>'external_id',''),existing.source_external_id)
        and existing.imported_visit_count is not distinct from greatest(
          existing.imported_visit_count,(row_value->>'visit_count')::integer)
        and existing.imported_total_spent_rub is not distinct from greatest(
          existing.imported_total_spent_rub,(row_value->>'total_spent_rub')::integer)
        and existing.imported_last_visit_on is not distinct from greatest(
          existing.imported_last_visit_on,nullif(row_value->>'last_visit_on','')::date)
        and existing.marketing_consent is not distinct from coalesce(
          (row_value->>'marketing_consent')::boolean,existing.marketing_consent)
        and existing.personal_data_consent is not distinct from coalesce(
          (row_value->>'personal_data_consent')::boolean,existing.personal_data_consent)
      ))
      into v_create,v_update,v_unchanged
    from jsonb_array_elements(v_payload) as payload_rows(row_value)
    left join public.organization_imported_clients existing
      on existing.organization_id=p_organization and existing.normalized_phone=row_value->>'phone';
  else
    select count(*) filter (where existing.id is null)
      into v_create
    from (
      select distinct encode(extensions.digest(convert_to(concat_ws('|',
        row_value->>'booking_date',(row_value->>'booking_time')::time::text,
        row_value->>'duration_minutes',row_value->>'phone',lower(row_value->>'service_name'),
        lower(coalesce(row_value->>'source_provider_name',''))),'UTF8'),'sha256'),'hex') as fingerprint
      from jsonb_array_elements(v_payload) as payload_rows(row_value)
    ) incoming
    left join public.organization_imported_booking_history existing
      on existing.organization_id=p_organization
      and existing.source_fingerprint=incoming.fingerprint;
    v_unchanged:=v_count-v_create;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,144));
  select * into v_batch from public.provider_data_transfer_batches
  where organization_id=p_organization and request_id=p_request_id for update;
  if found then
    if v_batch.payload_hash<>v_payload_hash or v_batch.transfer_kind<>v_kind
       or v_batch.source_system<>v_source
       or v_batch.source_file_name is distinct from v_source_file
       or v_batch.actor_id<>v_actor then
      raise exception using errcode='22023',message='provider_transfer_request_conflict';
    end if;
    if v_batch.status in ('applied','rolled_back') then
      return jsonb_build_object(
        'batch_id',v_batch.id,'kind',v_batch.transfer_kind,'status',v_batch.status,
        'input_count',v_batch.input_count,'create_count',v_batch.planned_create_count,
        'update_count',v_batch.planned_update_count,'unchanged_count',v_batch.planned_unchanged_count,
        'conflict_count',v_batch.conflict_count,'expires_at',v_batch.expires_at,'idempotent',true);
    end if;
    if v_batch.status='expired' or v_batch.expires_at<=now()
       or v_batch.target_state_hash<>v_target_hash then
      update public.provider_data_transfer_batches set
        target_state_hash=v_target_hash,staged_payload=v_payload,input_count=v_count,planned_create_count=v_create,
        planned_update_count=v_update,planned_unchanged_count=v_unchanged,
        conflict_count=v_conflicts,status='previewed',expires_at=now()+interval '15 minutes',updated_at=now()
      where id=v_batch.id returning * into v_batch;
    end if;
    return jsonb_build_object(
      'batch_id',v_batch.id,'kind',v_batch.transfer_kind,'status',v_batch.status,
      'input_count',v_batch.input_count,'create_count',v_batch.planned_create_count,
      'update_count',v_batch.planned_update_count,'unchanged_count',v_batch.planned_unchanged_count,
      'conflict_count',v_batch.conflict_count,'expires_at',v_batch.expires_at,'idempotent',true);
  end if;

  insert into public.provider_data_transfer_batches(
    organization_id,request_id,transfer_kind,source_system,source_file_name,payload_hash,target_state_hash,staged_payload,
    input_count,planned_create_count,planned_update_count,planned_unchanged_count,conflict_count,actor_id
  ) values(
    p_organization,p_request_id,v_kind,v_source,v_source_file,v_payload_hash,v_target_hash,v_payload,
    v_count,v_create,v_update,v_unchanged,v_conflicts,v_actor
  ) returning * into v_batch;
  return jsonb_build_object(
    'batch_id',v_batch.id,'kind',v_batch.transfer_kind,'status',v_batch.status,
    'input_count',v_batch.input_count,'create_count',v_batch.planned_create_count,
    'update_count',v_batch.planned_update_count,'unchanged_count',v_batch.planned_unchanged_count,
    'conflict_count',v_batch.conflict_count,'expires_at',v_batch.expires_at,'idempotent',false);
end $$;

create or replace function public.apply_minuta_provider_transfer_v144(
  p_organization uuid,
  p_batch uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
set lock_timeout='5s'
as $$
declare
  v_actor uuid:=auth.uid();
  v_batch public.provider_data_transfer_batches%rowtype;
  v_legacy_result jsonb;
  v_public_result jsonb;
  v_client_batch uuid;
  v_history_batch uuid;
  v_legacy_request uuid:=gen_random_uuid();
  v_client_change_count integer:=0;
  v_expected_client_count integer:=0;
  v_history_change_count integer:=0;
begin
  if v_actor is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='provider_transfer_manager_required';
  end if;
  lock table public.organization_imported_booking_history in share row exclusive mode;
  lock table public.organization_imported_clients in share row exclusive mode;
  select * into v_batch from public.provider_data_transfer_batches
  where id=p_batch and organization_id=p_organization for update;
  if not found or v_batch.actor_id<>v_actor then
    raise exception using errcode='42501',message='provider_transfer_batch_denied';
  end if;
  if v_batch.status='applied' then
    return coalesce(v_batch.applied_result,'{}'::jsonb)||jsonb_build_object('idempotent',true);
  end if;
  if v_batch.status<>'previewed' then
    raise exception using errcode='22023',message='provider_transfer_batch_not_applicable';
  end if;
  if v_batch.expires_at<=now() or v_batch.staged_payload is null then
    update public.provider_data_transfer_batches set
      status='expired',staged_payload=null,updated_at=now()
    where id=v_batch.id;
    return jsonb_build_object(
      'batch_id',v_batch.id,'kind',v_batch.transfer_kind,'status','expired','idempotent',false);
  end if;
  if v_batch.conflict_count>0 then
    raise exception using errcode='40001',message='provider_transfer_conflict';
  end if;

  -- Match the write order of the legacy history import and prevent a direct
  -- legacy import from slipping between the before/after snapshots.
  if public.minuta_provider_transfer_target_hash_v144(
       p_organization,v_batch.transfer_kind,v_batch.source_system,v_batch.staged_payload
     )<>v_batch.target_state_hash then
    update public.provider_data_transfer_batches set
      status='expired',staged_payload=null,updated_at=now()
    where id=v_batch.id;
    return jsonb_build_object(
      'batch_id',v_batch.id,'kind',v_batch.transfer_kind,'status','expired',
      'reason','target_changed','idempotent',false);
  end if;

  select count(distinct row_value->>'phone') into v_expected_client_count
  from jsonb_array_elements(v_batch.staged_payload) as payload_rows(row_value);

  insert into public.provider_data_transfer_changes(
    batch_id,sequence_no,entity_kind,entity_key,operation,before_row,after_row
  )
  select v_batch.id,row_number() over(order by existing.normalized_phone)::integer,
    'client',existing.normalized_phone,'updated',to_jsonb(existing),to_jsonb(existing)
  from public.organization_imported_clients existing
  join (
    select distinct row_value->>'phone' as normalized_phone
    from jsonb_array_elements(v_batch.staged_payload) as payload_rows(row_value)
  ) affected using(normalized_phone)
  where existing.organization_id=p_organization;

  if v_batch.transfer_kind='clients' then
    if exists (
      select 1 from jsonb_array_elements(v_batch.staged_payload) as payload_rows(row_value)
      join public.organization_imported_clients existing
        on existing.organization_id=p_organization
        and existing.source_system=v_batch.source_system
        and existing.source_external_id=nullif(row_value->>'external_id','')
        and existing.normalized_phone<>(row_value->>'phone')
      where nullif(row_value->>'external_id','') is not null
    ) then
      raise exception using errcode='40001',message='provider_transfer_conflict';
    end if;
    v_legacy_result:=public.import_minuta_clients(
      p_organization,v_batch.source_system,v_batch.staged_payload,v_legacy_request);
    v_client_batch:=(v_legacy_result->>'batch_id')::uuid;
  else
    v_legacy_result:=public.import_minuta_booking_history(
      p_organization,v_batch.staged_payload,v_legacy_request,v_batch.source_file_name);
    v_history_batch:=(v_legacy_result->>'batch_id')::uuid;
    select client_import_batch_id into v_client_batch
    from public.booking_history_import_batches where id=v_history_batch and organization_id=p_organization;
    if v_client_batch is null then
      raise exception using errcode='P0001',message='provider_transfer_history_journal_missing';
    end if;
  end if;

  update public.provider_data_transfer_changes change_row set after_row=to_jsonb(current_row)
  from public.organization_imported_clients current_row
  where change_row.batch_id=v_batch.id and change_row.entity_kind='client'
    and current_row.organization_id=p_organization
    and current_row.normalized_phone=change_row.entity_key;

  select count(*) into v_client_change_count
  from public.provider_data_transfer_changes where batch_id=v_batch.id;
  insert into public.provider_data_transfer_changes(
    batch_id,sequence_no,entity_kind,entity_key,operation,before_row,after_row
  )
  select v_batch.id,v_client_change_count+row_number() over(order by current_row.normalized_phone)::integer,
    'client',current_row.normalized_phone,'created',null,to_jsonb(current_row)
  from public.organization_imported_clients current_row
  join (
    select distinct row_value->>'phone' as normalized_phone
    from jsonb_array_elements(v_batch.staged_payload) as payload_rows(row_value)
  ) affected using(normalized_phone)
  where current_row.organization_id=p_organization
    and not exists (
      select 1 from public.provider_data_transfer_changes change_row
      where change_row.batch_id=v_batch.id and change_row.entity_kind='client'
        and change_row.entity_key=current_row.normalized_phone
    );
  select count(*) into v_client_change_count
  from public.provider_data_transfer_changes where batch_id=v_batch.id;
  if v_client_change_count<>v_expected_client_count then
    raise exception using errcode='P0001',message='provider_transfer_client_journal_incomplete';
  end if;

  if v_batch.transfer_kind='history' then
    insert into public.provider_data_transfer_changes(
      batch_id,sequence_no,entity_kind,entity_key,operation,before_row,after_row
    )
    select v_batch.id,v_client_change_count+row_number() over(order by history.id)::integer,
      'history',history.id::text,'created',null,to_jsonb(history)
    from public.organization_imported_booking_history history
    where history.organization_id=p_organization and history.import_batch_id=v_history_batch;
    select count(*) into v_history_change_count
    from public.provider_data_transfer_changes
    where batch_id=v_batch.id and entity_kind='history';
    if v_history_change_count<>coalesce((v_legacy_result->>'created_count')::integer,0) then
      raise exception using errcode='P0001',message='provider_transfer_history_journal_incomplete';
    end if;
  end if;

  v_public_result:=jsonb_build_object(
    'batch_id',v_batch.id,'kind',v_batch.transfer_kind,'status','applied',
    'input_count',v_batch.input_count,
    'created_count',case when v_batch.transfer_kind='clients' then v_batch.planned_create_count
      else coalesce((v_legacy_result->>'created_count')::integer,0) end,
    'updated_count',case when v_batch.transfer_kind='clients' then v_batch.planned_update_count else 0 end,
    'unchanged_count',v_batch.planned_unchanged_count,
    'duplicate_count',coalesce((v_legacy_result->>'duplicate_count')::integer,0),
    'idempotent',false);
  update public.provider_data_transfer_batches set
    status='applied',staged_payload=null,legacy_client_batch_id=v_client_batch,
    legacy_history_batch_id=v_history_batch,applied_result=v_public_result,
    applied_at=now(),updated_at=now()
  where id=v_batch.id;
  return v_public_result;
end $$;

create or replace function public.rollback_minuta_provider_transfer_v144(
  p_organization uuid,
  p_batch uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
set lock_timeout='5s'
as $$
declare
  v_batch public.provider_data_transfer_batches%rowtype;
  v_change public.provider_data_transfer_changes%rowtype;
  v_conflicts integer:=0;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='provider_transfer_manager_required';
  end if;
  lock table public.organization_imported_booking_history in share row exclusive mode;
  lock table public.organization_imported_clients in share row exclusive mode;
  lock table public.client_record_entries in share row exclusive mode;
  select * into v_batch from public.provider_data_transfer_batches
  where id=p_batch and organization_id=p_organization for update;
  if not found then
    raise exception using errcode='22023',message='provider_transfer_batch_missing';
  end if;
  if v_batch.status='rolled_back' then
    return jsonb_build_object('batch_id',v_batch.id,'status','rolled_back','idempotent',true);
  end if;
  if v_batch.status='previewed' then
    update public.provider_data_transfer_batches
      set status='expired',staged_payload=null,updated_at=now()
      where id=v_batch.id;
    return jsonb_build_object('batch_id',v_batch.id,'status','expired','idempotent',false);
  end if;
  if v_batch.status<>'applied' or v_batch.legacy_client_batch_id is null then
    raise exception using errcode='22023',message='provider_transfer_batch_not_rollbackable';
  end if;

  perform 1
  from public.organization_imported_clients current_row
  join public.provider_data_transfer_changes change_row
    on change_row.batch_id=v_batch.id and change_row.entity_kind='client'
    and change_row.entity_key=current_row.normalized_phone
  where current_row.organization_id=p_organization
  order by current_row.normalized_phone
  for update of current_row;
  perform 1
  from public.organization_imported_booking_history current_row
  join public.provider_data_transfer_changes change_row
    on change_row.batch_id=v_batch.id and change_row.entity_kind='history'
    and change_row.entity_key=current_row.id::text
  where current_row.organization_id=p_organization
  order by current_row.id
  for update of current_row;

  select count(*) into v_conflicts
  from public.provider_data_transfer_changes change_row
  left join public.organization_imported_clients current_row
    on change_row.entity_kind='client' and current_row.organization_id=p_organization
    and current_row.normalized_phone=change_row.entity_key
  where change_row.batch_id=v_batch.id and change_row.entity_kind='client'
    and (current_row.id is null or to_jsonb(current_row)<>change_row.after_row);
  select v_conflicts+count(*) into v_conflicts
  from public.provider_data_transfer_changes change_row
  left join public.organization_imported_booking_history current_row
    on change_row.entity_kind='history' and current_row.organization_id=p_organization
    and current_row.id::text=change_row.entity_key
  where change_row.batch_id=v_batch.id and change_row.entity_kind='history'
    and (current_row.id is null or to_jsonb(current_row)<>change_row.after_row);
  if v_conflicts>0 then
    raise exception using errcode='40001',message='provider_transfer_rollback_conflict';
  end if;
  if exists (
    select 1 from public.provider_data_transfer_changes change_row
    join public.client_record_entries record_row
      on record_row.organization_id=p_organization and record_row.client_phone=change_row.entity_key
    where change_row.batch_id=v_batch.id and change_row.entity_kind='client'
      and change_row.operation='created'
  ) then
    raise exception using errcode='40001',message='provider_transfer_rollback_client_records_exist';
  end if;

  delete from public.organization_imported_booking_history current_row
  using public.provider_data_transfer_changes change_row
  where change_row.batch_id=v_batch.id and change_row.entity_kind='history'
    and current_row.organization_id=p_organization and current_row.id::text=change_row.entity_key;

  for v_change in
    select * from public.provider_data_transfer_changes
    where batch_id=v_batch.id and entity_kind='client'
    order by sequence_no desc
  loop
    if v_change.operation='created' then
      delete from public.organization_imported_clients
      where organization_id=p_organization and normalized_phone=v_change.entity_key;
    else
      update public.organization_imported_clients set
        display_phone=v_change.before_row->>'display_phone',
        client_name=v_change.before_row->>'client_name',
        email=v_change.before_row->>'email',
        birthday=(v_change.before_row->>'birthday')::date,
        note=v_change.before_row->>'note',
        source_system=v_change.before_row->>'source_system',
        source_external_id=v_change.before_row->>'source_external_id',
        imported_visit_count=(v_change.before_row->>'imported_visit_count')::integer,
        imported_total_spent_rub=(v_change.before_row->>'imported_total_spent_rub')::integer,
        imported_last_visit_on=(v_change.before_row->>'imported_last_visit_on')::date,
        marketing_consent=(v_change.before_row->>'marketing_consent')::boolean,
        personal_data_consent=(v_change.before_row->>'personal_data_consent')::boolean,
        last_import_batch_id=(v_change.before_row->>'last_import_batch_id')::uuid,
        updated_at=(v_change.before_row->>'updated_at')::timestamptz
      where organization_id=p_organization and normalized_phone=v_change.entity_key;
    end if;
  end loop;

  if v_batch.legacy_history_batch_id is not null then
    delete from public.booking_history_import_batches
    where id=v_batch.legacy_history_batch_id and organization_id=p_organization;
  end if;
  delete from public.client_import_batches
  where id=v_batch.legacy_client_batch_id and organization_id=p_organization;
  update public.provider_data_transfer_batches set
    status='rolled_back',rolled_back_at=now(),rolled_back_by=auth.uid(),updated_at=now()
  where id=v_batch.id;
  return jsonb_build_object('batch_id',v_batch.id,'status','rolled_back','idempotent',false);
end $$;

create or replace function public.get_minuta_provider_transfer_journal_v144(
  p_organization uuid,
  p_limit integer default 20
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='provider_transfer_manager_required';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode='22023',message='invalid_provider_transfer_journal_limit';
  end if;
  return jsonb_build_object('batches',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',batch.id,'kind',batch.transfer_kind,'source_system',batch.source_system,
      'source_file_name',batch.source_file_name,'status',batch.status,'input_count',batch.input_count,
      'create_count',batch.planned_create_count,'update_count',batch.planned_update_count,
      'unchanged_count',batch.planned_unchanged_count,'conflict_count',batch.conflict_count,
      'created_at',batch.created_at,'applied_at',batch.applied_at,'rolled_back_at',batch.rolled_back_at
    ) order by batch.created_at desc,batch.id desc)
    from (
      select * from public.provider_data_transfer_batches
      where organization_id=p_organization
      order by created_at desc,id desc limit p_limit
    ) batch
  ),'[]'::jsonb));
end $$;

create or replace function public.export_minuta_provider_transfer_data_v144(
  p_organization uuid,
  p_kind text,
  p_limit integer default 1000,
  p_offset integer default 0
) returns jsonb
language plpgsql
security definer
set search_path=''
set lock_timeout='5s'
as $$
declare
  v_kind text:=lower(btrim(coalesce(p_kind,'')));
  v_rows jsonb;
  v_has_more boolean;
  v_exported_at timestamptz:=now();
  v_dataset_revision text;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner']) then
    raise exception using errcode='42501',message='provider_transfer_owner_required';
  end if;
  if v_kind not in ('clients','history') or p_limit is null or p_limit not between 1 and 1000
     or p_offset is null or p_offset<0 or p_offset+p_limit>100000 then
    raise exception using errcode='22023',message='invalid_provider_transfer_export_page';
  end if;
  if v_kind='clients' then
    lock table public.organization_imported_clients in share mode;
    select encode(extensions.digest(convert_to(concat_ws('|',
      'provider-transfer-export-v144',p_organization::text,v_kind,count(*)::text,
      coalesce(max(entry.updated_at)::text,''),coalesce(max(entry.created_at)::text,''),
      coalesce(max(entry.id::text),'')),'UTF8'),'sha256'),'hex')
    into v_dataset_revision
    from public.organization_imported_clients entry where entry.organization_id=p_organization;
    select coalesce(jsonb_agg(jsonb_build_object(
      'name',entry.client_name,'phone',entry.normalized_phone,'display_phone',entry.display_phone,
      'email',entry.email,'birthday',entry.birthday,'note',entry.note,'source_system',entry.source_system,
      'external_id',entry.source_external_id,'visit_count',entry.imported_visit_count,
      'total_spent_rub',entry.imported_total_spent_rub,'last_visit_on',entry.imported_last_visit_on,
      'marketing_consent',entry.marketing_consent,'personal_data_consent',entry.personal_data_consent
    ) order by entry.normalized_phone,entry.id),'[]'::jsonb)
    into v_rows from (
      select * from public.organization_imported_clients
      where organization_id=p_organization order by normalized_phone,id limit p_limit offset p_offset
    ) entry;
    select exists(select 1 from public.organization_imported_clients
      where organization_id=p_organization order by normalized_phone,id offset p_offset+p_limit limit 1)
      into v_has_more;
  else
    lock table public.organization_imported_booking_history in share mode;
    select encode(extensions.digest(convert_to(concat_ws('|',
      'provider-transfer-export-v144',p_organization::text,v_kind,count(*)::text,
      coalesce(max(entry.imported_at)::text,''),coalesce(max(entry.id::text),'')),
      'UTF8'),'sha256'),'hex')
    into v_dataset_revision
    from public.organization_imported_booking_history entry where entry.organization_id=p_organization;
    select coalesce(jsonb_agg(jsonb_build_object(
      'booking_date',entry.booking_date,'booking_time',entry.booking_time,
      'duration_minutes',entry.duration_minutes,'client_name',entry.client_name,
      'phone',entry.normalized_phone,'display_phone',entry.display_phone,
      'service_name',entry.service_name,'source_note',entry.source_note,
      'source_provider_name',entry.source_provider_name,'price_rub',entry.price_rub,
      'source_sheet',entry.source_sheet,'source_file_name',entry.source_file_name
    ) order by entry.booking_date,entry.booking_time,entry.id),'[]'::jsonb)
    into v_rows from (
      select * from public.organization_imported_booking_history
      where organization_id=p_organization order by booking_date,booking_time,id limit p_limit offset p_offset
    ) entry;
    select exists(select 1 from public.organization_imported_booking_history
      where organization_id=p_organization order by booking_date,booking_time,id offset p_offset+p_limit limit 1)
      into v_has_more;
  end if;
  if p_offset=0 then
    insert into public.minuta_personal_data_access_log(
      organization_id,actor_user_id,action,subject_type,subject_id,details
    ) values(
      p_organization,auth.uid(),'export','provider_transfer',v_kind,
      jsonb_build_object('data_kind',v_kind,'schema_version',1,'dataset_revision',v_dataset_revision)
    );
  end if;
  return jsonb_build_object(
    'schema_version',1,'kind',v_kind,'exported_at',v_exported_at,
    'dataset_revision',v_dataset_revision,'rows',v_rows,
    'has_more',v_has_more,'next_offset',case when v_has_more then p_offset+p_limit else null end);
end $$;

create or replace function public.purge_expired_minuta_provider_transfer_previews_v144(
  p_limit integer default 100
) returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer:=0;
begin
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception using errcode='22023',message='invalid_provider_transfer_purge_limit';
  end if;
  with expired as (
    select id from public.provider_data_transfer_batches
    where status='previewed' and expires_at<=now()
    order by expires_at,id limit p_limit for update skip locked
  )
  update public.provider_data_transfer_batches batch set
    status='expired',staged_payload=null,updated_at=now()
  from expired where batch.id=expired.id;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

revoke all on function
  public.preview_minuta_provider_transfer_v144(uuid,text,text,jsonb,uuid,text),
  public.apply_minuta_provider_transfer_v144(uuid,uuid),
  public.rollback_minuta_provider_transfer_v144(uuid,uuid),
  public.get_minuta_provider_transfer_journal_v144(uuid,integer),
  public.export_minuta_provider_transfer_data_v144(uuid,text,integer,integer),
  public.purge_expired_minuta_provider_transfer_previews_v144(integer)
from public,anon,authenticated,service_role;
grant execute on function
  public.preview_minuta_provider_transfer_v144(uuid,text,text,jsonb,uuid,text),
  public.apply_minuta_provider_transfer_v144(uuid,uuid),
  public.rollback_minuta_provider_transfer_v144(uuid,uuid),
  public.get_minuta_provider_transfer_journal_v144(uuid,integer),
  public.export_minuta_provider_transfer_data_v144(uuid,text,integer,integer)
to authenticated;
grant execute on function public.purge_expired_minuta_provider_transfer_previews_v144(integer)
to service_role;

commit;
