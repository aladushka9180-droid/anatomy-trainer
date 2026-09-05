begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regprocedure('public.get_minuta_client_field_role(uuid)') is null
     or to_regprocedure('public.normalize_client_phone(text)') is null
     or to_regclass('public.organization_imported_clients') is null
     or to_regclass('storage.objects') is null then
    raise exception 'v112_requires_client_fields_import_and_storage';
  end if;
end $$;

-- Opt-in, private client records. No existing booking or financial data changes.
create table if not exists public.client_record_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.client_record_entries (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_phone text not null check (client_phone ~ '^7[0-9]{10}$'),
  booking_id uuid references public.bookings(id) on delete set null,
  -- Preserve the original visit scope if its booking is later deleted.
  booking_was_linked boolean not null default false,
  booking_performer_id uuid,
  visit_label text not null default '',
  kind text not null check (kind in ('note','file')),
  body text not null default '' check (char_length(body)<=2000),
  file_name text not null default '' check (char_length(file_name)<=180),
  mime_type text,
  byte_size integer,
  object_path text unique,
  ready boolean not null default false,
  archived boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((kind='note' and char_length(btrim(body))>0 and object_path is null and mime_type is null and byte_size is null)
    or (kind='file' and btrim(file_name)<>'' and mime_type is not null
      and mime_type in ('application/pdf','image/jpeg','image/png','image/webp')
      and byte_size is not null and byte_size between 1 and 10485760 and object_path is not null))
);
create index if not exists client_record_entries_client_v112_idx
  on public.client_record_entries(organization_id,client_phone,created_at desc,id desc);
alter table public.client_record_entries add column if not exists expired_at timestamptz;
alter table public.client_record_entries add column if not exists cleanup_attempted_at timestamptz;
create index if not exists client_record_entries_pending_v112_idx
  on public.client_record_entries(created_at,id) where kind='file' and not ready;
alter table public.client_record_settings enable row level security;
alter table public.client_record_entries enable row level security;
revoke all on public.client_record_settings,public.client_record_entries from public,anon,authenticated;
grant all on public.client_record_settings,public.client_record_entries to service_role;

create or replace function public.can_access_minuta_client_record(p_org uuid,p_phone text,p_booking uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(p_phone ~ '^7[0-9]{10}$',false) and exists (
    select 1 from public.organization_memberships m
    join public.organizations o on o.id=m.organization_id and o.status='active'
    where m.organization_id=p_org and m.user_id=auth.uid() and m.active
    and (
      exists(select 1 from public.bookings b where b.organization_id=p_org
        and public.normalize_client_phone(b.client_phone)=p_phone
        and (p_booking is null or b.id=p_booking)
        and (m.role in ('owner','admin') or b.performer_id=auth.uid()))
      or (p_booking is null and m.role in ('owner','admin') and exists (
        select 1 from public.organization_imported_clients c
        where c.organization_id=p_org and c.normalized_phone=p_phone))
    )
  );
$$;

create or replace function public.set_minuta_client_records_enabled(p_organization uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce(public.get_minuta_client_field_role(p_organization),'') not in ('owner','admin') then
    raise exception using errcode='42501',message='client_records_manager_required';
  end if;
  insert into public.client_record_settings(organization_id,enabled,updated_by)
  values(p_organization,coalesce(p_enabled,false),auth.uid())
  on conflict(organization_id) do update set enabled=excluded.enabled,updated_by=auth.uid(),updated_at=now();
  return jsonb_build_object('enabled',coalesce(p_enabled,false));
end $$;

create or replace function public.get_minuta_client_records(p_organization uuid,p_phone text,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_phone text:=public.normalize_client_phone(p_phone); v_role text; v_enabled boolean; v_rows jsonb;
begin
  v_role:=public.get_minuta_client_field_role(p_organization);
  if not public.can_access_minuta_client_record(p_organization,v_phone) then
    raise exception using errcode='42501',message='client_records_access_denied';
  end if;
  select coalesce((select enabled from public.client_record_settings where organization_id=p_organization),false) into v_enabled;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) into v_rows from (
    select id,booking_id,visit_label,kind,body,file_name,mime_type,byte_size,object_path,created_at,
      (created_by=auth.uid() or v_role in ('owner','admin')) as can_delete
    from public.client_record_entries
    where organization_id=p_organization and client_phone=v_phone and ready and not archived and v_enabled
      and public.can_access_minuta_client_record(organization_id,client_phone,booking_id)
      and (not booking_was_linked or v_role in ('owner','admin') or booking_performer_id=auth.uid())
    order by created_at desc,id desc limit 31 offset greatest(0,least(coalesce(p_offset,0),100000))
  ) e;
  return jsonb_build_object('enabled',v_enabled,'can_enable',v_role in ('owner','admin'),'entries',v_rows);
end $$;

create or replace function public.create_minuta_client_record(
  p_organization uuid,p_phone text,p_id uuid,p_booking uuid,p_kind text,p_body text,
  p_file_name text default '',p_mime_type text default null,p_byte_size integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_phone text:=public.normalize_client_phone(p_phone); v_row public.client_record_entries%rowtype;
  v_label text:=''; v_path text; v_performer uuid;
begin
  if not public.can_access_minuta_client_record(p_organization,v_phone,p_booking) then
    raise exception using errcode='42501',message='client_records_access_denied';
  end if;
  if not coalesce((select enabled from public.client_record_settings where organization_id=p_organization),false) then
    raise exception 'client_records_disabled';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('note','file')
    or char_length(btrim(coalesce(p_body,'')))>2000 or char_length(coalesce(p_file_name,''))>180
    or (p_kind='note' and (btrim(coalesce(p_body,''))='' or coalesce(p_file_name,'')<>'' or p_mime_type is not null or p_byte_size is not null))
    or (p_kind='file' and (btrim(coalesce(p_file_name,''))='' or p_mime_type is null
      or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')
      or p_byte_size is null or p_byte_size not between 1 and 10485760)) then
    raise exception using errcode='22023',message='invalid_client_record';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,112));
  select * into v_row from public.client_record_entries where id=p_id;
  if found then
    if v_row.organization_id<>p_organization or v_row.client_phone<>v_phone or v_row.created_by<>auth.uid()
      or v_row.booking_id is distinct from p_booking or v_row.kind<>p_kind or v_row.body<>btrim(coalesce(p_body,''))
      or v_row.file_name<>coalesce(p_file_name,'') or v_row.mime_type is distinct from p_mime_type
      or v_row.byte_size is distinct from p_byte_size or v_row.archived then raise exception 'client_record_request_conflict'; end if;
    if v_row.expired_at is not null or (not v_row.ready and v_row.created_at < now()-interval '7 days') then
      raise exception 'client_record_upload_expired';
    end if;
    return jsonb_build_object('id',v_row.id,'object_path',v_row.object_path,'ready',v_row.ready);
  end if;
  if p_booking is not null then
    select to_char(b.booking_date,'DD.MM.YYYY')||' · '||to_char(b.booking_time,'HH24:MI')||' · '||coalesce(s.name,'Услуга'),b.performer_id
    into v_label,v_performer from public.bookings b left join public.services s on s.id=b.service_id
    where b.id=p_booking and b.organization_id=p_organization and public.normalize_client_phone(b.client_phone)=v_phone
      and public.can_access_minuta_client_record(p_organization,v_phone,b.id) for share of b;
    if not found then raise exception using errcode='42501',message='client_records_access_denied'; end if;
  end if;
  if p_kind='file' then
    v_path:=p_organization::text||'/'||p_id::text||case p_mime_type
      when 'application/pdf' then '.pdf' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' else '' end;
  end if;
  insert into public.client_record_entries(id,organization_id,client_phone,booking_id,booking_was_linked,booking_performer_id,visit_label,kind,body,
    file_name,mime_type,byte_size,object_path,ready,created_by)
  values(p_id,p_organization,v_phone,p_booking,p_booking is not null,v_performer,coalesce(v_label,''),p_kind,btrim(coalesce(p_body,'')),
    coalesce(p_file_name,''),p_mime_type,p_byte_size,v_path,p_kind='note',auth.uid());
  return jsonb_build_object('id',p_id,'object_path',v_path,'ready',p_kind='note');
end $$;

create or replace function public.complete_minuta_client_file(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.client_record_entries%rowtype;
begin
  select * into v_row from public.client_record_entries where id=p_id for update;
  if not found or auth.uid() is null or v_row.created_by is distinct from auth.uid() or v_row.archived or v_row.kind<>'file'
    or not public.can_access_minuta_client_record(v_row.organization_id,v_row.client_phone,v_row.booking_id)
    or (v_row.booking_was_linked and v_row.booking_performer_id is distinct from auth.uid()
      and public.get_minuta_client_field_role(v_row.organization_id) not in ('owner','admin'))
    or not coalesce((select enabled from public.client_record_settings where organization_id=v_row.organization_id),false) then
    raise exception using errcode='42501',message='client_records_access_denied';
  end if;
  if v_row.expired_at is not null or (not v_row.ready and v_row.created_at < now()-interval '7 days') then
    raise exception 'client_record_upload_expired';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='minuta-client-records' and name=v_row.object_path
    and metadata->>'size'=v_row.byte_size::text and metadata->>'mimetype'=v_row.mime_type) then
    raise exception 'client_record_upload_incomplete';
  end if;
  update public.client_record_entries set ready=true where id=p_id;
  return jsonb_build_object('id',p_id,'ready',true);
end $$;

create or replace function public.archive_minuta_client_record(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.client_record_entries%rowtype;
begin
  select * into v_row from public.client_record_entries where id=p_id for update;
  if not found or auth.uid() is null or not public.can_access_minuta_client_record(v_row.organization_id,v_row.client_phone,v_row.booking_id)
    or (v_row.booking_was_linked and v_row.booking_performer_id is distinct from auth.uid()
      and public.get_minuta_client_field_role(v_row.organization_id) not in ('owner','admin'))
    or not coalesce((v_row.created_by=auth.uid() or public.get_minuta_client_field_role(v_row.organization_id) in ('owner','admin')),false) then
    raise exception using errcode='42501',message='client_records_access_denied';
  end if;
  update public.client_record_entries set archived=true where id=p_id;
  return jsonb_build_object('id',p_id,'archived',true);
end $$;

-- Storage uses opaque UUID paths, never phone numbers. No public URLs or upserts.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('minuta-client-records','minuta-client-records',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.can_use_minuta_client_object(p_name text,p_action text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare v_upload public.client_record_entries%rowtype;
begin
  if p_action='upload' then
    -- Keep a shared lock for the whole Storage INSERT transaction. Cleanup's
    -- FOR UPDATE cannot claim this row while its upload INSERT is in flight.
    select * into v_upload from public.client_record_entries where object_path=p_name for share;
    if not found or v_upload.ready or v_upload.expired_at is not null
      or v_upload.created_at < now()-interval '7 days' then return false; end if;
  end if;
  return exists(select 1 from public.client_record_entries e
    join public.client_record_settings s on s.organization_id=e.organization_id
    where e.object_path=p_name and e.kind='file'
      and public.can_access_minuta_client_record(e.organization_id,e.client_phone,e.booking_id)
      and (not e.booking_was_linked or e.booking_performer_id=auth.uid()
        or exists(select 1 from public.organization_memberships m where m.organization_id=e.organization_id
          and m.user_id=auth.uid() and m.active and m.role in ('owner','admin')))
      and case p_action
        when 'read' then s.enabled and e.ready and not e.archived
        when 'upload' then s.enabled and not e.ready and not e.archived and e.created_by=auth.uid()
          and e.expired_at is null and e.created_at >= now()-interval '7 days'
        else false end);
end
$$;
drop policy if exists client_record_object_read_v112 on storage.objects;
create policy client_record_object_read_v112 on storage.objects for select to authenticated
using(bucket_id='minuta-client-records' and public.can_use_minuta_client_object(name,'read'));
drop policy if exists client_record_object_upload_v112 on storage.objects;
create policy client_record_object_upload_v112 on storage.objects for insert to authenticated
with check(bucket_id='minuta-client-records' and public.can_use_minuta_client_object(name,'upload'));
drop policy if exists client_record_object_delete_v112 on storage.objects;
-- Archive only: retain physical objects for recovery, never grant UPDATE/DELETE.
-- Restrictive guards prevent a future broad Storage policy from exposing this bucket.
drop policy if exists client_record_object_guard_v112 on storage.objects;
create policy client_record_object_guard_v112 on storage.objects as restrictive for select to authenticated
using(bucket_id<>'minuta-client-records' or public.can_use_minuta_client_object(name,'read'));
drop policy if exists client_record_object_insert_guard_v112 on storage.objects;
create policy client_record_object_insert_guard_v112 on storage.objects as restrictive for insert to authenticated
with check(bucket_id<>'minuta-client-records' or public.can_use_minuta_client_object(name,'upload'));
drop policy if exists client_record_object_update_guard_v112 on storage.objects;
create policy client_record_object_update_guard_v112 on storage.objects as restrictive for update to authenticated
using(bucket_id<>'minuta-client-records') with check(bucket_id<>'minuta-client-records');
drop policy if exists client_record_object_delete_guard_v112 on storage.objects;
create policy client_record_object_delete_guard_v112 on storage.objects as restrictive for delete to authenticated
using(bucket_id<>'minuta-client-records');
drop policy if exists client_record_object_anon_guard_v112 on storage.objects;
create policy client_record_object_anon_guard_v112 on storage.objects as restrictive for all to anon
using(bucket_id<>'minuta-client-records') with check(bucket_id<>'minuta-client-records');

-- Only the maintenance worker can claim expired unfinished uploads. The same row
-- lock as finalize prevents a completed file from becoming a cleanup target.
-- Objects must be removed through Storage API, NEVER by deleting storage.objects.
create or replace function public.claim_expired_minuta_client_records(p_limit integer default 100,p_execute boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.client_record_entries%rowtype; v_result jsonb:='[]'::jsonb;
begin
  for v_row in select * from public.client_record_entries
    where kind='file' and not ready and created_at < now()-interval '7 days'
      and (p_execute is not true or expired_at is null or expired_at < now()-interval '1 hour')
    order by cleanup_attempted_at nulls first,created_at,id limit least(100,greatest(1,coalesce(p_limit,100)))
    for update skip locked
  loop
    if p_execute is true then
      update public.client_record_entries set expired_at=coalesce(expired_at,now()),cleanup_attempted_at=now() where id=v_row.id;
    end if;
    -- First mark the row, then let old Storage requests drain for one hour.
    -- Already expired rows remain eligible after a failed Storage API call.
    if p_execute is not true or v_row.expired_at < now()-interval '1 hour' then
      v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_row.id,'object_path',v_row.object_path));
    end if;
  end loop;
  return v_result;
end $$;

create or replace function public.finish_expired_minuta_client_record(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_row public.client_record_entries%rowtype;
begin
  select * into v_row from public.client_record_entries where id=p_id for update;
  if not found then return true; end if;
  if v_row.kind<>'file' or v_row.ready or v_row.expired_at is null
    or v_row.created_at >= now()-interval '7 days'
    or v_row.expired_at >= now()-interval '1 hour' then return false; end if;
  if exists(select 1 from storage.objects where bucket_id='minuta-client-records' and name=v_row.object_path) then
    return false;
  end if;
  delete from public.client_record_entries where id=p_id;
  return true;
end $$;
revoke all on function public.claim_expired_minuta_client_records(integer,boolean),
  public.finish_expired_minuta_client_record(uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_expired_minuta_client_records(integer,boolean),
  public.finish_expired_minuta_client_record(uuid) to service_role;

revoke all on function public.can_access_minuta_client_record(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.can_use_minuta_client_object(text,text) from public,anon;
grant execute on function public.can_use_minuta_client_object(text,text) to authenticated;
revoke all on function public.set_minuta_client_records_enabled(uuid,boolean),public.get_minuta_client_records(uuid,text,integer),
  public.create_minuta_client_record(uuid,text,uuid,uuid,text,text,text,text,integer),
  public.complete_minuta_client_file(uuid),public.archive_minuta_client_record(uuid) from public,anon;
grant execute on function public.set_minuta_client_records_enabled(uuid,boolean),public.get_minuta_client_records(uuid,text,integer),
  public.create_minuta_client_record(uuid,text,uuid,uuid,text,text,text,text,integer),
  public.complete_minuta_client_file(uuid),public.archive_minuta_client_record(uuid) to authenticated;
commit;
