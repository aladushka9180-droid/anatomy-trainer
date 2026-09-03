\set ON_ERROR_STOP on

begin;
set local search_path = public, extensions, pg_catalog;

do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.bookings_performer_date_time_v94_idx') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception using errcode='P0001',message='v95_requires_v65_v94';
  end if;
end $$;

create table if not exists public.client_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  source_system text not null check (source_system in ('yclients','dikidi','masters','other')),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  input_count integer not null check (input_count between 1 and 500),
  created_count integer not null default 0 check (created_count between 0 and 500),
  updated_count integer not null default 0 check (updated_count between 0 and 500),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id,request_id)
);

create table if not exists public.organization_imported_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  normalized_phone text not null check (normalized_phone ~ '^7[0-9]{10}$'),
  display_phone text not null check (char_length(display_phone) between 10 and 24),
  client_name text not null check (char_length(client_name) between 1 and 80),
  email text check (email is null or char_length(email) between 3 and 254),
  birthday date,
  note text check (note is null or char_length(note) <= 1000),
  source_system text not null check (source_system in ('yclients','dikidi','masters','other')),
  source_external_id text check (source_external_id is null or char_length(source_external_id) <= 120),
  imported_visit_count integer not null default 0 check (imported_visit_count between 0 and 1000000),
  imported_total_spent_rub integer not null default 0 check (imported_total_spent_rub between 0 and 2000000000),
  imported_last_visit_on date,
  marketing_consent boolean,
  personal_data_consent boolean,
  last_import_batch_id uuid not null references public.client_import_batches(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,normalized_phone)
);

do $$
begin
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='client_import_batches'
      and column_name in ('id','organization_id','request_id','source_system','payload_hash','input_count','created_count','updated_count','actor_id','created_at'))<>10
     or (select count(*) from information_schema.columns where table_schema='public' and table_name='organization_imported_clients'
      and column_name in ('id','organization_id','normalized_phone','display_phone','client_name','email','birthday','note','source_system','source_external_id','imported_visit_count','imported_total_spent_rub','imported_last_visit_on','marketing_consent','personal_data_consent','last_import_batch_id','created_at','updated_at'))<>18
     or (select count(*) from (values
       ('id','uuid','NO'),('organization_id','uuid','NO'),('request_id','uuid','NO'),('source_system','text','NO'),('payload_hash','text','NO'),
       ('input_count','integer','NO'),('created_count','integer','NO'),('updated_count','integer','NO'),('actor_id','uuid','NO'),('created_at','timestamp with time zone','NO')
     ) expected(column_name,data_type,is_nullable) join information_schema.columns actual
       on actual.table_schema='public' and actual.table_name='client_import_batches' and actual.column_name=expected.column_name
      and actual.data_type=expected.data_type and actual.is_nullable=expected.is_nullable)<>10
     or (select count(*) from (values
       ('id','uuid','NO'),('organization_id','uuid','NO'),('normalized_phone','text','NO'),('display_phone','text','NO'),('client_name','text','NO'),
       ('email','text','YES'),('birthday','date','YES'),('note','text','YES'),('source_system','text','NO'),('source_external_id','text','YES'),
       ('imported_visit_count','integer','NO'),('imported_total_spent_rub','integer','NO'),('imported_last_visit_on','date','YES'),
       ('marketing_consent','boolean','YES'),('personal_data_consent','boolean','YES'),('last_import_batch_id','uuid','NO'),
       ('created_at','timestamp with time zone','NO'),('updated_at','timestamp with time zone','NO')
     ) expected(column_name,data_type,is_nullable) join information_schema.columns actual
       on actual.table_schema='public' and actual.table_name='organization_imported_clients' and actual.column_name=expected.column_name
      and actual.data_type=expected.data_type and actual.is_nullable=expected.is_nullable)<>18
     or not exists(select 1 from pg_constraint constraint_row where constraint_row.conrelid='public.client_import_batches'::regclass
      and constraint_row.contype='u' and array_length(constraint_row.conkey,1)=2
      and (select array_agg(attribute_row.attname order by key_row.ordinality) from unnest(constraint_row.conkey) with ordinality key_row(attnum,ordinality) join pg_attribute attribute_row on attribute_row.attrelid=constraint_row.conrelid and attribute_row.attnum=key_row.attnum)=array['organization_id','request_id']::name[])
     or not exists(select 1 from pg_constraint constraint_row where constraint_row.conrelid='public.organization_imported_clients'::regclass
      and constraint_row.contype='u' and array_length(constraint_row.conkey,1)=2
      and (select array_agg(attribute_row.attname order by key_row.ordinality) from unnest(constraint_row.conkey) with ordinality key_row(attnum,ordinality) join pg_attribute attribute_row on attribute_row.attrelid=constraint_row.conrelid and attribute_row.attnum=key_row.attnum)=array['organization_id','normalized_phone']::name[])
     or (select count(*) from pg_constraint constraint_row where constraint_row.contype='f' and constraint_row.confdeltype='r'
      and ((constraint_row.conrelid='public.client_import_batches'::regclass and constraint_row.confrelid in ('public.organizations'::regclass,'auth.users'::regclass))
        or (constraint_row.conrelid='public.organization_imported_clients'::regclass and constraint_row.confrelid in ('public.organizations'::regclass,'public.client_import_batches'::regclass))))<>4 then
    raise exception using errcode='P0001',message='v95_incompatible_existing_schema';
  end if;
end $$;

alter table public.client_import_batches enable row level security;
alter table public.organization_imported_clients enable row level security;
revoke all on table public.client_import_batches,public.organization_imported_clients from public,anon,authenticated;
grant all on table public.client_import_batches,public.organization_imported_clients to service_role;

create or replace function public.import_minuta_clients(
  p_organization uuid,
  p_source_system text,
  p_rows jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_source text:=lower(trim(coalesce(p_source_system,'')));
  v_count integer;
  v_payload_hash text;
  v_batch public.client_import_batches%rowtype;
  v_row jsonb;
  v_phone text;
  v_name text;
  v_display_phone text;
  v_email text;
  v_birthday date;
  v_note text;
  v_external_id text;
  v_visit_count integer;
  v_total_spent integer;
  v_last_visit date;
  v_marketing boolean;
  v_personal_data boolean;
  v_created integer:=0;
  v_updated integer:=0;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='client_import_manager_required';
  end if;
  if p_request_id is null then
    raise exception using errcode='22023',message='client_import_request_id_required';
  end if;
  if v_source not in ('yclients','dikidi','masters','other') then
    raise exception using errcode='22023',message='invalid_client_import_source';
  end if;
  if jsonb_typeof(p_rows)<>'array' then
    raise exception using errcode='22023',message='client_import_rows_must_be_array';
  end if;
  v_count:=jsonb_array_length(p_rows);
  if v_count<1 or v_count>500 then
    raise exception using errcode='22023',message='client_import_row_limit';
  end if;
  v_payload_hash:=encode(extensions.digest(p_rows::text,'sha256'),'hex');
  select * into v_batch from public.client_import_batches
  where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_batch.payload_hash<>v_payload_hash or v_batch.source_system<>v_source then
      raise exception using errcode='23505',message='client_import_request_conflict';
    end if;
    return jsonb_build_object('batch_id',v_batch.id,'input_count',v_batch.input_count,
      'created_count',v_batch.created_count,'updated_count',v_batch.updated_count,'idempotent',true);
  end if;

  insert into public.client_import_batches(
    organization_id,request_id,source_system,payload_hash,input_count,actor_id
  ) values (p_organization,p_request_id,v_source,v_payload_hash,v_count,auth.uid())
  returning * into v_batch;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_phone:=public.normalize_client_phone(v_row->>'phone');
    v_name:=trim(coalesce(v_row->>'name',''));
    v_display_phone:=trim(coalesce(nullif(v_row->>'display_phone',''),v_row->>'phone',''));
    v_email:=nullif(lower(trim(coalesce(v_row->>'email',''))),'');
    v_note:=nullif(trim(coalesce(v_row->>'note','')),'');
    v_external_id:=nullif(trim(coalesce(v_row->>'external_id','')),'');
    begin v_birthday:=nullif(v_row->>'birthday','')::date; exception when others then raise exception using errcode='22023',message='invalid_client_import_birthday'; end;
    begin v_last_visit:=nullif(v_row->>'last_visit_on','')::date; exception when others then raise exception using errcode='22023',message='invalid_client_import_last_visit'; end;
    begin v_visit_count:=greatest(0,coalesce((v_row->>'visit_count')::integer,0)); exception when others then raise exception using errcode='22023',message='invalid_client_import_visit_count'; end;
    begin v_total_spent:=greatest(0,coalesce((v_row->>'total_spent_rub')::integer,0)); exception when others then raise exception using errcode='22023',message='invalid_client_import_total_spent'; end;
    v_marketing:=case when jsonb_typeof(v_row->'marketing_consent')='boolean' then (v_row->>'marketing_consent')::boolean else null end;
    v_personal_data:=case when jsonb_typeof(v_row->'personal_data_consent')='boolean' then (v_row->>'personal_data_consent')::boolean else null end;
    if v_phone!~'^7[0-9]{10}$' or char_length(v_name) not between 1 and 80
       or char_length(v_display_phone) not between 10 and 24
       or (v_email is not null and (char_length(v_email)>254 or v_email!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
       or char_length(coalesce(v_note,''))>1000 or char_length(coalesce(v_external_id,''))>120
       or v_visit_count>1000000 or v_total_spent>2000000000 then
      raise exception using errcode='22023',message='invalid_client_import_row';
    end if;
    if exists(select 1 from public.organization_imported_clients where organization_id=p_organization and normalized_phone=v_phone) then
      v_updated:=v_updated+1;
    else
      v_created:=v_created+1;
    end if;
    insert into public.organization_imported_clients(
      organization_id,normalized_phone,display_phone,client_name,email,birthday,note,source_system,
      source_external_id,imported_visit_count,imported_total_spent_rub,imported_last_visit_on,
      marketing_consent,personal_data_consent,last_import_batch_id,updated_at
    ) values (
      p_organization,v_phone,v_display_phone,v_name,v_email,v_birthday,v_note,v_source,
      v_external_id,v_visit_count,v_total_spent,v_last_visit,v_marketing,v_personal_data,v_batch.id,now()
    ) on conflict (organization_id,normalized_phone) do update set
      display_phone=excluded.display_phone,client_name=excluded.client_name,
      email=coalesce(excluded.email,public.organization_imported_clients.email),
      birthday=coalesce(excluded.birthday,public.organization_imported_clients.birthday),
      note=coalesce(excluded.note,public.organization_imported_clients.note),
      source_system=excluded.source_system,
      source_external_id=coalesce(excluded.source_external_id,public.organization_imported_clients.source_external_id),
      imported_visit_count=greatest(public.organization_imported_clients.imported_visit_count,excluded.imported_visit_count),
      imported_total_spent_rub=greatest(public.organization_imported_clients.imported_total_spent_rub,excluded.imported_total_spent_rub),
      imported_last_visit_on=greatest(public.organization_imported_clients.imported_last_visit_on,excluded.imported_last_visit_on),
      marketing_consent=coalesce(excluded.marketing_consent,public.organization_imported_clients.marketing_consent),
      personal_data_consent=coalesce(excluded.personal_data_consent,public.organization_imported_clients.personal_data_consent),
      last_import_batch_id=excluded.last_import_batch_id,updated_at=now();
  end loop;
  update public.client_import_batches set created_count=v_created,updated_count=v_updated where id=v_batch.id;
  return jsonb_build_object('batch_id',v_batch.id,'input_count',v_count,
    'created_count',v_created,'updated_count',v_updated,'idempotent',false);
end $$;

drop function if exists public.get_minuta_imported_clients(uuid);

create or replace function public.get_minuta_imported_clients(p_organization uuid,p_limit integer,p_offset integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_role text;
begin
  if p_limit is null or p_limit<1 or p_limit>1000 or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception using errcode='22023',message='invalid_client_import_page';
  end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null then raise exception using errcode='42501',message='client_import_membership_required'; end if;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'can_import',v_role in ('owner','admin'),
    'clients',case when v_role in ('owner','admin') then coalesce((select jsonb_agg(jsonb_build_object(
      'phone',entry.normalized_phone,'display_phone',entry.display_phone,'name',entry.client_name,
      'email',entry.email,'birthday',entry.birthday,'note',entry.note,'source_system',entry.source_system,
      'visit_count',entry.imported_visit_count,'total_spent_rub',entry.imported_total_spent_rub,
      'last_visit_on',entry.imported_last_visit_on,'marketing_consent',entry.marketing_consent,
      'personal_data_consent',entry.personal_data_consent,'updated_at',entry.updated_at
    ) order by entry.updated_at desc,entry.id desc) from (
      select * from public.organization_imported_clients
      where organization_id=p_organization
      order by updated_at desc,id desc limit p_limit offset p_offset
    ) entry),'[]'::jsonb) else '[]'::jsonb end,
    'has_more',case when v_role in ('owner','admin') then exists(
      select 1 from public.organization_imported_clients entry
      where entry.organization_id=p_organization
      order by entry.updated_at desc,entry.id desc offset p_offset+p_limit limit 1
    ) else false end,
    'next_offset',case when v_role in ('owner','admin') and exists(
      select 1 from public.organization_imported_clients entry
      where entry.organization_id=p_organization
      order by entry.updated_at desc,entry.id desc offset p_offset+p_limit limit 1
    ) then p_offset+p_limit else null end,
    'recent_batches',case when v_role in ('owner','admin') then coalesce((select jsonb_agg(jsonb_build_object(
      'id',batch.id,'source_system',batch.source_system,'input_count',batch.input_count,
      'created_count',batch.created_count,'updated_count',batch.updated_count,'created_at',batch.created_at
    ) order by batch.created_at desc,batch.id desc) from (
      select * from public.client_import_batches where organization_id=p_organization order by created_at desc,id desc limit 10
    ) batch),'[]'::jsonb) else '[]'::jsonb end
  );
end $$;

revoke all on function public.import_minuta_clients(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_imported_clients(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.import_minuta_clients(uuid,text,jsonb,uuid) to authenticated;
grant execute on function public.get_minuta_imported_clients(uuid,integer,integer) to authenticated;

commit;

select format('drop index concurrently if exists %I.%I',namespace_row.nspname,index_class.relname)
from pg_class index_class
join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
join pg_index index_row on index_row.indexrelid=index_class.oid
where namespace_row.nspname='public'
  and index_class.relname in (
    'organization_imported_clients_name_v95_idx',
    'organization_imported_clients_updated_v95_idx',
    'client_import_batches_scope_v95_idx'
  )
  and (not index_row.indisvalid or not index_row.indisready)
\gexec

do $$
begin
  if exists (
    select 1
    from pg_class index_class
    join pg_namespace namespace_row on namespace_row.oid=index_class.relnamespace
    join pg_index index_row on index_row.indexrelid=index_class.oid
    where namespace_row.nspname='public'
      and index_class.relname in (
        'organization_imported_clients_name_v95_idx',
        'organization_imported_clients_updated_v95_idx',
        'client_import_batches_scope_v95_idx'
      )
      and index_row.indisvalid
      and index_row.indisready
      and regexp_replace(lower(pg_get_indexdef(index_row.indexrelid)),'\s','','g') <> case index_class.relname
        when 'organization_imported_clients_name_v95_idx'
          then 'createindexorganization_imported_clients_name_v95_idxonpublic.organization_imported_clientsusingbtree(organization_id,lower(client_name),id)'
        when 'organization_imported_clients_updated_v95_idx'
          then 'createindexorganization_imported_clients_updated_v95_idxonpublic.organization_imported_clientsusingbtree(organization_id,updated_atdesc,iddesc)'
        when 'client_import_batches_scope_v95_idx'
          then 'createindexclient_import_batches_scope_v95_idxonpublic.client_import_batchesusingbtree(organization_id,created_atdesc,iddesc)'
      end
  ) then
    raise exception using errcode='P0001',message='v95_incompatible_existing_index';
  end if;
end $$;

set lock_timeout = '5s';
set statement_timeout = '30min';
create index concurrently if not exists organization_imported_clients_name_v95_idx
  on public.organization_imported_clients(organization_id,lower(client_name),id);
create index concurrently if not exists organization_imported_clients_updated_v95_idx
  on public.organization_imported_clients(organization_id,updated_at desc,id desc);
create index concurrently if not exists client_import_batches_scope_v95_idx
  on public.client_import_batches(organization_id,created_at desc,id desc);
reset lock_timeout;
reset statement_timeout;
