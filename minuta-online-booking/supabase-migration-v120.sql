\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=pg_catalog,public,extensions;

do $$ begin
  if to_regclass('public.client_record_entries') is null
     or to_regclass('public.client_record_settings') is null
     or to_regprocedure('public.can_access_minuta_client_record(uuid,text,uuid)') is null
     or to_regprocedure('public.create_minuta_client_record(uuid,text,uuid,uuid,text,text,text,text,integer)') is null
     or to_regprocedure('public.complete_minuta_client_file(uuid)') is null
     or to_regprocedure('public.archive_minuta_client_record(uuid)') is null
     or to_regprocedure('public.get_minuta_client_field_role(uuid)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception using errcode='P0001',message='v120_requires_client_records_v112';
  end if;
end $$;

create table if not exists public.client_result_series(
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_phone text not null check(client_phone ~ '^7[0-9]{10}$'),
  booking_id uuid references public.bookings(id) on delete set null,
  booking_was_linked boolean not null default true,
  booking_performer_id uuid not null references auth.users(id) on delete restrict,
  visit_label text not null check(char_length(visit_label) between 1 and 300),
  service_label text not null check(char_length(service_label) between 1 and 300),
  before_session text not null default '' check(char_length(before_session)<=2000),
  work_done text not null default '' check(char_length(work_done)<=2000),
  after_session text not null default '' check(char_length(after_session)<=2000),
  recommendations text not null default '' check(char_length(recommendations)<=2000),
  state text not null default 'active' check(state in ('active','archived')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  last_request_by uuid not null references auth.users(id) on delete restrict,
  last_request_id uuid not null,
  unique(organization_id,booking_id),
  unique(last_request_by,last_request_id)
);

create table if not exists public.client_result_assets(
  result_id uuid not null references public.client_result_series(id) on delete restrict,
  record_entry_id uuid primary key references public.client_record_entries(id) on delete cascade,
  purpose text not null check(purpose in ('before','after')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(result_id,purpose)
);

create table if not exists public.client_result_consents(
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.client_result_series(id) on delete restrict,
  scope text not null check(scope in ('private_storage','external_share')),
  action text not null check(action in ('granted','revoked')),
  notice_version text not null check(char_length(notice_version) between 1 and 50),
  request_id uuid not null,
  payload_hash text not null check(payload_hash ~ '^[0-9a-f]{64}$'),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default clock_timestamp(),
  unique(recorded_by,request_id,scope)
);

do $$
begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_result_consents' and column_name='payload_hash')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_result_series' and column_name='before_session')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='client_result_assets' and column_name='purpose') then
    raise exception using errcode='P0001',message='v120_incompatible_existing_schema';
  end if;
end $$;

create index if not exists client_result_series_client_v120_idx
  on public.client_result_series(organization_id,client_phone,created_at desc,id desc)
  where state='active';
create index if not exists client_result_consents_effective_v120_idx
  on public.client_result_consents(result_id,scope,recorded_at desc,id desc);

alter table public.client_result_series enable row level security;
alter table public.client_result_assets enable row level security;
alter table public.client_result_consents enable row level security;
revoke all on public.client_result_series,public.client_result_assets,public.client_result_consents
  from public,anon,authenticated,service_role;
grant all on public.client_result_series,public.client_result_assets,public.client_result_consents to service_role;

create or replace function public.can_access_minuta_client_result_v120(p_result uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.client_result_series result
    where result.id=p_result
      and public.can_access_minuta_client_record(result.organization_id,result.client_phone,result.booking_id)
      and (not result.booking_was_linked
        or result.booking_performer_id=auth.uid()
        or public.get_minuta_client_field_role(result.organization_id) in ('owner','admin'))
  );
$$;

create or replace function public.client_result_consent_active_v120(p_result uuid,p_scope text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select consent.action='granted'
    from public.client_result_consents consent
    where consent.result_id=p_result and consent.scope=p_scope
    order by consent.recorded_at desc,consent.id desc limit 1),false);
$$;

create or replace function public.save_minuta_client_result_v120(
  p_organization uuid,p_phone text,p_booking uuid,p_id uuid,
  p_before_session text,p_work_done text,p_after_session text,p_recommendations text,
  p_private_storage_consent boolean,p_external_share_consent boolean,p_request uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid();
  v_phone text:=public.normalize_client_phone(p_phone);
  v_booking public.bookings%rowtype;
  v_existing public.client_result_series%rowtype;
  v_service text;
  v_payload_hash text;
  v_replay_result uuid;
  v_replay_hash text;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is null or p_booking is null or p_id is null or p_request is null
     or p_private_storage_consent is not true or p_external_share_consent is null
     or char_length(coalesce(p_before_session,''))>2000
     or char_length(coalesce(p_work_done,''))>2000
     or char_length(coalesce(p_after_session,''))>2000
     or char_length(coalesce(p_recommendations,''))>2000 then
    raise exception using errcode='22023',message='invalid_client_result';
  end if;
  if not public.can_access_minuta_client_record(p_organization,v_phone,p_booking) then
    raise exception using errcode='42501',message='client_result_access_denied';
  end if;
  if not coalesce((select enabled from public.client_record_settings where organization_id=p_organization),false) then
    raise exception using errcode='P0001',message='client_records_disabled';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('client-result-request:'||v_actor::text||':'||p_request::text,120));
  perform pg_advisory_xact_lock(hashtextextended('client-result-booking:'||p_organization::text||':'||p_booking::text,120));
  perform pg_advisory_xact_lock(hashtextextended('client-result:'||p_id::text,120));
  v_payload_hash:=encode(extensions.digest(convert_to(jsonb_build_array(
    p_organization,v_phone,p_booking,p_id,btrim(coalesce(p_before_session,'')),
    btrim(coalesce(p_work_done,'')),btrim(coalesce(p_after_session,'')),
    btrim(coalesce(p_recommendations,'')),p_private_storage_consent,p_external_share_consent
  )::text,'UTF8'),'sha256'),'hex');
  select consent.result_id,consent.payload_hash into v_replay_result,v_replay_hash
  from public.client_result_consents consent
  where consent.recorded_by=v_actor and consent.request_id=p_request
  order by consent.recorded_at,consent.id limit 1;
  if found then
    if v_replay_result<>p_id or v_replay_hash<>v_payload_hash then
      raise exception using errcode='P0001',message='client_result_request_conflict';
    end if;
    return jsonb_build_object('id',p_id,'saved',true,
      'private_storage_consent',public.client_result_consent_active_v120(p_id,'private_storage'),
      'external_share_consent',public.client_result_consent_active_v120(p_id,'external_share'));
  end if;

  select booking.* into v_booking from public.bookings booking
    where booking.id=p_booking and booking.organization_id=p_organization
      and public.normalize_client_phone(booking.client_phone)=v_phone and booking.status<>'cancelled'
    for share;
  if not found then raise exception using errcode='42501',message='client_result_access_denied'; end if;
  select coalesce(service.name,'Услуга') into v_service from public.services service where service.id=v_booking.service_id;
  v_service:=coalesce(v_service,'Услуга');

  select * into v_existing from public.client_result_series result where result.id=p_id for update;
  if not found and exists(select 1 from public.client_result_series result
    where result.organization_id=p_organization and result.booking_id=p_booking and result.id<>p_id) then
    raise exception using errcode='P0001',message='client_result_booking_conflict';
  end if;
  if found then
    if v_existing.organization_id<>p_organization or v_existing.client_phone<>v_phone
       or v_existing.booking_id is distinct from p_booking
       or not public.can_access_minuta_client_result_v120(v_existing.id) then
      raise exception using errcode='P0001',message='client_result_request_conflict';
    end if;
    update public.client_result_series set
      before_session=btrim(coalesce(p_before_session,'')),work_done=btrim(coalesce(p_work_done,'')),
      after_session=btrim(coalesce(p_after_session,'')),recommendations=btrim(coalesce(p_recommendations,'')),
      updated_by=v_actor,updated_at=now(),last_request_by=v_actor,last_request_id=p_request
    where id=p_id;
  else
    insert into public.client_result_series(
      id,organization_id,client_phone,booking_id,booking_was_linked,booking_performer_id,
      visit_label,service_label,before_session,work_done,after_session,recommendations,
      created_by,updated_by,last_request_by,last_request_id
    ) values(
      p_id,p_organization,v_phone,p_booking,true,v_booking.performer_id,
      to_char(v_booking.booking_date,'DD.MM.YYYY')||' · '||to_char(v_booking.booking_time,'HH24:MI'),v_service,
      btrim(coalesce(p_before_session,'')),btrim(coalesce(p_work_done,'')),
      btrim(coalesce(p_after_session,'')),btrim(coalesce(p_recommendations,'')),
      v_actor,v_actor,v_actor,p_request
    );
  end if;

  insert into public.client_result_consents(result_id,scope,action,notice_version,request_id,payload_hash,recorded_by)
  values
    (p_id,'private_storage','granted','2026-09-07',p_request,v_payload_hash,v_actor),
    (p_id,'external_share',case when p_external_share_consent then 'granted' else 'revoked' end,
      '2026-09-07',p_request,v_payload_hash,v_actor)
  on conflict(recorded_by,request_id,scope) do nothing;
  return jsonb_build_object('id',p_id,'saved',true,'private_storage_consent',true,
    'external_share_consent',p_external_share_consent);
end $$;

create or replace function public.create_minuta_client_result_media_v120(
  p_organization uuid,p_phone text,p_result uuid,p_id uuid,p_purpose text,p_mime_type text,p_byte_size integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result public.client_result_series%rowtype; v_existing public.client_result_assets%rowtype; v_file jsonb;
begin
  select * into v_result from public.client_result_series result where result.id=p_result for update;
  if not found or v_result.organization_id<>p_organization
     or v_result.client_phone<>public.normalize_client_phone(p_phone)
     or v_result.state<>'active' or not public.can_access_minuta_client_result_v120(p_result)
     or not public.client_result_consent_active_v120(p_result,'private_storage') then
    raise exception using errcode='42501',message='client_result_access_denied';
  end if;
  if p_id is null or p_purpose not in ('before','after')
     or p_mime_type not in ('image/jpeg','image/png','image/webp')
     or p_byte_size is null or p_byte_size not between 1 and 10485760 then
    raise exception using errcode='22023',message='invalid_client_result_media';
  end if;
  select * into v_existing from public.client_result_assets asset
    where asset.result_id=p_result and asset.purpose=p_purpose;
  if found and v_existing.record_entry_id<>p_id then
    raise exception using errcode='P0001',message='client_result_media_slot_occupied';
  end if;
  v_file:=public.create_minuta_client_record(p_organization,p_phone,p_id,v_result.booking_id,'file','',
    case when p_purpose='before' then 'До' else 'После' end||case p_mime_type
      when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.webp' end,
    p_mime_type,p_byte_size);
  insert into public.client_result_assets(result_id,record_entry_id,purpose,created_by)
    values(p_result,p_id,p_purpose,auth.uid()) on conflict(record_entry_id) do nothing;
  select * into v_existing from public.client_result_assets asset where asset.record_entry_id=p_id;
  if not found or v_existing.result_id<>p_result or v_existing.purpose<>p_purpose then
    raise exception using errcode='P0001',message='client_result_media_request_conflict';
  end if;
  return v_file||jsonb_build_object('result_id',p_result,'purpose',p_purpose);
end $$;

create or replace function public.complete_minuta_client_result_media_v120(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_asset public.client_result_assets%rowtype;
begin
  select * into v_asset from public.client_result_assets asset where asset.record_entry_id=p_id for update;
  if not found or not public.can_access_minuta_client_result_v120(v_asset.result_id)
     or not public.client_result_consent_active_v120(v_asset.result_id,'private_storage') then
    raise exception using errcode='42501',message='client_result_access_denied';
  end if;
  return public.complete_minuta_client_file(p_id)||jsonb_build_object('result_id',v_asset.result_id,'purpose',v_asset.purpose);
end $$;

create or replace function public.archive_minuta_client_result_media_v120(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_asset public.client_result_assets%rowtype;
begin
  select * into v_asset from public.client_result_assets asset where asset.record_entry_id=p_id for update;
  if not found or not public.can_access_minuta_client_result_v120(v_asset.result_id) then
    raise exception using errcode='42501',message='client_result_access_denied';
  end if;
  return public.archive_minuta_client_record(p_id)||jsonb_build_object('result_id',v_asset.result_id,'purpose',v_asset.purpose);
end $$;

create or replace function public.get_minuta_client_results_v120(p_organization uuid,p_phone text,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_phone text:=public.normalize_client_phone(p_phone); v_enabled boolean; v_entries jsonb; v_media jsonb; v_ids uuid[];
begin
  if not public.can_access_minuta_client_record(p_organization,v_phone) then
    raise exception using errcode='42501',message='client_result_access_denied';
  end if;
  select coalesce((select enabled from public.client_record_settings where organization_id=p_organization),false) into v_enabled;
  select coalesce(jsonb_agg(to_jsonb(entry) order by entry.created_at desc,entry.id desc),'[]'::jsonb)
  into v_entries from(
    select result.id,result.booking_id,result.visit_label,result.service_label,result.before_session,
      result.work_done,result.after_session,result.recommendations,result.created_at,result.updated_at,
      public.client_result_consent_active_v120(result.id,'private_storage') private_storage_consent,
      public.client_result_consent_active_v120(result.id,'external_share') external_share_consent
    from public.client_result_series result
    where v_enabled and result.organization_id=p_organization and result.client_phone=v_phone and result.state='active'
      and public.can_access_minuta_client_result_v120(result.id)
      and public.client_result_consent_active_v120(result.id,'private_storage')
    order by result.created_at desc,result.id desc
    limit 31 offset greatest(0,least(coalesce(p_offset,0),100000))
  ) entry;
  select coalesce(array_agg((item->>'id')::uuid),array[]::uuid[]) into v_ids
  from jsonb_array_elements(v_entries) item;
  select coalesce(jsonb_agg(to_jsonb(media) order by media.result_id,media.purpose),'[]'::jsonb)
  into v_media from(
    select asset.result_id,entry.id,asset.purpose,entry.file_name,entry.mime_type,entry.byte_size,entry.object_path,entry.created_at,
      (entry.created_by=auth.uid() or public.get_minuta_client_field_role(result.organization_id) in ('owner','admin')) can_delete
    from public.client_result_assets asset
    join public.client_result_series result on result.id=asset.result_id
    join public.client_record_entries entry on entry.id=asset.record_entry_id
    where asset.result_id=any(v_ids) and result.organization_id=p_organization and result.client_phone=v_phone and result.state='active'
      and entry.ready and not entry.archived and public.can_access_minuta_client_result_v120(result.id)
      and public.client_result_consent_active_v120(result.id,'private_storage')
  ) media;
  return jsonb_build_object('enabled',v_enabled,
    'can_enable',public.get_minuta_client_field_role(p_organization) in ('owner','admin'),'entries',v_entries,'media',v_media);
end $$;

create or replace function public.get_minuta_client_result_v120(p_organization uuid,p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_booking public.bookings%rowtype; v_result public.client_result_series%rowtype; v_media jsonb; v_enabled boolean;
begin
  select booking.* into v_booking from public.bookings booking
    where booking.id=p_booking and booking.organization_id=p_organization;
  if not found or not public.can_access_minuta_client_record(p_organization,public.normalize_client_phone(v_booking.client_phone),p_booking) then
    raise exception using errcode='42501',message='client_result_access_denied';
  end if;
  select coalesce((select enabled from public.client_record_settings where organization_id=p_organization),false) into v_enabled;
  if not v_enabled then
    return jsonb_build_object('enabled',false,
      'can_enable',public.get_minuta_client_field_role(p_organization) in ('owner','admin'),'entry',null,'media','[]'::jsonb);
  end if;
  select * into v_result from public.client_result_series result
    where result.organization_id=p_organization and result.booking_id=p_booking and result.state='active'
      and public.can_access_minuta_client_result_v120(result.id)
      and public.client_result_consent_active_v120(result.id,'private_storage')
    order by result.updated_at desc,result.id desc limit 1;
  if not found then
    return jsonb_build_object('enabled',v_enabled,
      'can_enable',public.get_minuta_client_field_role(p_organization) in ('owner','admin'),'entry',null,'media','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('result_id',asset.result_id,'id',entry.id,'purpose',asset.purpose,
    'file_name',entry.file_name,'mime_type',entry.mime_type,'byte_size',entry.byte_size,'object_path',entry.object_path,
    'created_at',entry.created_at,'can_delete',(entry.created_by=auth.uid() or public.get_minuta_client_field_role(p_organization) in ('owner','admin')))
    order by asset.purpose),'[]'::jsonb) into v_media
  from public.client_result_assets asset join public.client_record_entries entry on entry.id=asset.record_entry_id
  where asset.result_id=v_result.id and entry.ready and not entry.archived;
  return jsonb_build_object('enabled',v_enabled,
    'can_enable',public.get_minuta_client_field_role(p_organization) in ('owner','admin'),
    'entry',jsonb_build_object('id',v_result.id,'booking_id',v_result.booking_id,'visit_label',v_result.visit_label,
      'service_label',v_result.service_label,'before_session',v_result.before_session,'work_done',v_result.work_done,
      'after_session',v_result.after_session,'recommendations',v_result.recommendations,'created_at',v_result.created_at,
      'updated_at',v_result.updated_at,'private_storage_consent',true,
      'external_share_consent',public.client_result_consent_active_v120(v_result.id,'external_share')),
    'media',v_media);
end $$;

-- Result photos must never be duplicated in the generic Files and photos list.
create or replace function public.get_minuta_client_records(p_organization uuid,p_phone text,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_phone text:=public.normalize_client_phone(p_phone); v_role text; v_enabled boolean; v_rows jsonb;
begin
  v_role:=public.get_minuta_client_field_role(p_organization);
  if not public.can_access_minuta_client_record(p_organization,v_phone) then
    raise exception using errcode='42501',message='client_records_access_denied';
  end if;
  select coalesce((select enabled from public.client_record_settings where organization_id=p_organization),false) into v_enabled;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) into v_rows from(
    select entry.id,entry.booking_id,entry.visit_label,entry.kind,entry.body,entry.file_name,entry.mime_type,
      entry.byte_size,entry.object_path,entry.created_at,(entry.created_by=auth.uid() or v_role in ('owner','admin')) can_delete
    from public.client_record_entries entry
    where entry.organization_id=p_organization and entry.client_phone=v_phone and entry.ready and not entry.archived and v_enabled
      and not exists(select 1 from public.client_result_assets asset where asset.record_entry_id=entry.id)
      and public.can_access_minuta_client_record(entry.organization_id,entry.client_phone,entry.booking_id)
      and (not entry.booking_was_linked or v_role in ('owner','admin') or entry.booking_performer_id=auth.uid())
    order by entry.created_at desc,entry.id desc limit 31 offset greatest(0,least(coalesce(p_offset,0),100000))
  ) e;
  return jsonb_build_object('enabled',v_enabled,'can_enable',v_role in ('owner','admin'),'entries',v_rows);
end $$;

-- Reuse the private v112 bucket, but require a live result and storage consent for result-linked objects.
create or replace function public.can_use_minuta_client_object(p_name text,p_action text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_upload public.client_record_entries%rowtype; v_result uuid;
begin
  if p_action='upload' then
    select * into v_upload from public.client_record_entries where object_path=p_name for share;
    if not found or v_upload.ready or v_upload.expired_at is not null or v_upload.created_at<now()-interval '7 days' then return false; end if;
  end if;
  select asset.result_id into v_result from public.client_result_assets asset
    join public.client_record_entries entry on entry.id=asset.record_entry_id where entry.object_path=p_name;
  if found and (not public.can_access_minuta_client_result_v120(v_result)
    or not public.client_result_consent_active_v120(v_result,'private_storage')) then return false; end if;
  return exists(select 1 from public.client_record_entries entry
    join public.client_record_settings setting on setting.organization_id=entry.organization_id
    where entry.object_path=p_name and entry.kind='file'
      and public.can_access_minuta_client_record(entry.organization_id,entry.client_phone,entry.booking_id)
      and (not entry.booking_was_linked or entry.booking_performer_id=auth.uid()
        or public.get_minuta_client_field_role(entry.organization_id) in ('owner','admin'))
      and case p_action when 'read' then setting.enabled and entry.ready and not entry.archived
        when 'upload' then setting.enabled and not entry.ready and not entry.archived and entry.created_by=auth.uid()
          and entry.expired_at is null and entry.created_at>=now()-interval '7 days' else false end);
end $$;

revoke all on function public.can_access_minuta_client_result_v120(uuid),public.client_result_consent_active_v120(uuid,text),
  public.get_minuta_client_results_v120(uuid,text,integer),
  public.get_minuta_client_result_v120(uuid,uuid),
  public.save_minuta_client_result_v120(uuid,text,uuid,uuid,text,text,text,text,boolean,boolean,uuid),
  public.create_minuta_client_result_media_v120(uuid,text,uuid,uuid,text,text,integer),
  public.complete_minuta_client_result_media_v120(uuid),public.archive_minuta_client_result_media_v120(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_client_results_v120(uuid,text,integer),
  public.get_minuta_client_result_v120(uuid,uuid),
  public.save_minuta_client_result_v120(uuid,text,uuid,uuid,text,text,text,text,boolean,boolean,uuid),
  public.create_minuta_client_result_media_v120(uuid,text,uuid,uuid,text,text,integer),
  public.complete_minuta_client_result_media_v120(uuid),public.archive_minuta_client_result_media_v120(uuid)
  to authenticated;
revoke all on function public.can_access_minuta_client_result_v120(uuid),public.client_result_consent_active_v120(uuid,text)
  from public,anon,authenticated,service_role;
grant execute on function public.can_access_minuta_client_result_v120(uuid),public.client_result_consent_active_v120(uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
