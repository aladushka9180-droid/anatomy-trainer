\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
do $$ begin
  if to_regclass('public.product_feedback') is null or to_regclass('storage.objects') is null then
    raise exception 'v116_requires_feedback_v109_and_storage';
  end if;
end $$;

create table if not exists public.product_feedback_media_settings(
  singleton boolean primary key default true check(singleton), enabled boolean not null default false
);
insert into public.product_feedback_media_settings(singleton) values(true) on conflict do nothing;
-- Both the legacy v109 RPC and media v3 INSERT pass through this gate.
-- The actor lock is shared with media create/reserve/release; a replay does not INSERT.
create index if not exists feedback_actor_created_v116_idx on public.product_feedback(reporter_user_id,created_at);
create or replace function public.enforce_minuta_feedback_daily_limit_v116()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('feedback-media:'||new.reporter_user_id::text,0));
  if (select count(*) from public.product_feedback where reporter_user_id=new.reporter_user_id
      and created_at>now()-interval '24 hours')>=20 then
    raise exception using errcode='P0001',message='feedback_daily_limit';
  end if;
  return new;
end $$;
revoke all on function public.enforce_minuta_feedback_daily_limit_v116() from public,anon,authenticated,service_role;
drop trigger if exists enforce_feedback_daily_limit_v116 on public.product_feedback;
create trigger enforce_feedback_daily_limit_v116 before insert on public.product_feedback
  for each row execute function public.enforce_minuta_feedback_daily_limit_v116();
create table if not exists public.product_feedback_media_requests(
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  feedback_id uuid not null unique references public.product_feedback(id) on delete restrict,
  payload jsonb not null,
  primary key(actor_id,request_id)
);
create table if not exists public.product_feedback_media_uploads(
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null, attachment_id uuid not null,
  object_path text not null unique, display_name text not null check(char_length(btrim(display_name)) between 1 and 200),
  mime_type text not null check(mime_type in ('image/webp','video/mp4','video/webm','video/quicktime')),
  expected_bytes bigint not null check(expected_bytes between 1 and 20971520),
  state text not null default 'reserved' check(state in ('reserved','linked','cleanup','deleted')),
  feedback_id uuid references public.product_feedback(id) on delete restrict,
  created_at timestamptz not null default now(),
  cleanup_token uuid, cleanup_until timestamptz,
  primary key(actor_id,request_id,attachment_id),
  check((state='linked')=(feedback_id is not null))
);
create index if not exists feedback_media_uploads_cleanup_idx on public.product_feedback_media_uploads(state,created_at);
create index if not exists feedback_media_uploads_feedback_idx on public.product_feedback_media_uploads(feedback_id) where feedback_id is not null;
alter table public.product_feedback_media_settings enable row level security;
alter table public.product_feedback_media_requests enable row level security;
alter table public.product_feedback_media_uploads enable row level security;
revoke all on public.product_feedback_media_settings,public.product_feedback_media_requests,public.product_feedback_media_uploads from public,anon,authenticated;
grant select,update on public.product_feedback_media_settings to service_role;
grant select on public.product_feedback_media_requests,public.product_feedback_media_uploads to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-feedback-media','product-feedback-media',false,20971520,array['image/webp','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.get_minuta_feedback_media_capability()
returns jsonb language sql stable security definer set search_path=''
as $$ select case when auth.uid() is not null and (select enabled from public.product_feedback_media_settings where singleton)
  then jsonb_build_object('version',3,'max_files',5,'video_bytes',20971520,'total_bytes',41943040) else null end $$;

create or replace function public.reserve_minuta_feedback_upload_v3(p_request_id uuid,p_attachment_id uuid,p_name text,p_mime text,p_bytes bigint)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); u public.product_feedback_media_uploads; o storage.objects; ext text;
begin
  if actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if not coalesce((select enabled from public.product_feedback_media_settings where singleton),false) then raise exception 'feedback_media_disabled'; end if;
  if p_request_id is null or p_attachment_id is null or char_length(btrim(coalesce(p_name,''))) not between 1 and 200
    or p_mime is null or p_mime not in ('image/webp','video/mp4','video/webm','video/quicktime')
    or p_bytes is null or p_bytes<1 or p_bytes>20971520 or (p_mime='image/webp' and p_bytes>4194304) then
    raise exception using errcode='22023',message='invalid_feedback_attachment';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('feedback-media:'||actor::text,0));
  select * into u from public.product_feedback_media_uploads where actor_id=actor and request_id=p_request_id and attachment_id=p_attachment_id for update;
  if found then
    if u.display_name<>p_name or u.mime_type<>p_mime or u.expected_bytes<>p_bytes then raise exception 'feedback_upload_payload_conflict'; end if;
    if u.state<>'reserved' or u.created_at<=now()-interval '48 hours' then raise exception 'feedback_upload_expired_or_used'; end if;
  else
    if (select count(*) from public.product_feedback_media_uploads where actor_id=actor and created_at>now()-interval '24 hours')>=20
      or (select count(*) from public.product_feedback_media_uploads where actor_id=actor and state in ('reserved','linked'))>=25
      or (select coalesce(sum(expected_bytes),0) from public.product_feedback_media_uploads where actor_id=actor and state in ('reserved','linked'))+p_bytes>209715200 then
      raise exception 'feedback_upload_quota';
    end if;
    if exists(select 1 from public.product_feedback_media_requests where actor_id=actor and request_id=p_request_id) then raise exception 'feedback_request_already_submitted'; end if;
    if (select count(*) from public.product_feedback_media_uploads where actor_id=actor and request_id=p_request_id and state in ('reserved','linked'))>=5
      or (select coalesce(sum(expected_bytes),0) from public.product_feedback_media_uploads where actor_id=actor and request_id=p_request_id and state in ('reserved','linked'))+p_bytes>41943040 then
      raise exception 'feedback_attachments_too_large';
    end if;
    ext:=case p_mime when 'image/webp' then 'webp' when 'video/mp4' then 'mp4' when 'video/webm' then 'webm' else 'mov' end;
    insert into public.product_feedback_media_uploads(actor_id,request_id,attachment_id,object_path,display_name,mime_type,expected_bytes)
      values(actor,p_request_id,p_attachment_id,actor::text||'/'||p_request_id::text||'/'||p_attachment_id::text||'.'||ext,p_name,p_mime,p_bytes) returning * into u;
  end if;
  select * into o from storage.objects where bucket_id='product-feedback-media' and name=u.object_path;
  if found and (coalesce(o.metadata->>'size','')<>u.expected_bytes::text or coalesce(o.metadata->>'mimetype','')<>u.mime_type) then raise exception 'feedback_upload_metadata_conflict'; end if;
  return jsonb_build_object('path',u.object_path,'uploaded',o.id is not null);
end $$;

create or replace function public.can_insert_minuta_feedback_media_v116(p_path text,p_metadata jsonb)
returns boolean language plpgsql volatile security definer set search_path=''
as $$ begin
  if auth.uid() is null or not coalesce((select enabled from public.product_feedback_media_settings where singleton),false) then return false; end if;
  -- Hold a row lock through the Storage INSERT transaction: cleanup must not pass
  -- its final absence check while an authorized object INSERT is still in flight.
  perform 1 from public.product_feedback_media_uploads where actor_id=auth.uid() and object_path=p_path
    and state='reserved' and created_at>now()-interval '48 hours'
    and expected_bytes::text=coalesce(p_metadata->>'size','') and mime_type=coalesce(p_metadata->>'mimetype','') for share;
  return found;
end $$;
-- Do not inherit the permissive v2 draft policies if a test database previously rehearsed it.
drop policy if exists product_feedback_media_insert on storage.objects;
drop policy if exists product_feedback_media_select on storage.objects;
drop policy if exists product_feedback_media_v116_insert on storage.objects;
create policy product_feedback_media_v116_insert on storage.objects for insert to authenticated
  with check(bucket_id='product-feedback-media' and public.can_insert_minuta_feedback_media_v116(name,metadata));
drop policy if exists product_feedback_media_v116_select on storage.objects;
create policy product_feedback_media_v116_select on storage.objects for select to authenticated
  using(bucket_id='product-feedback-media' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.get_my_minuta_feedback_request_v3(p_request_id uuid,p_payload jsonb)
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare r public.product_feedback_media_requests; f public.product_feedback; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select * into r from public.product_feedback_media_requests where actor_id=auth.uid() and request_id=p_request_id;
  if not found then return null; end if;
  if r.payload is distinct from p_payload then raise exception 'feedback_request_payload_conflict'; end if;
  select * into f from public.product_feedback where id=r.feedback_id;
  return jsonb_build_object('request_id',r.request_id,'request_number',f.request_number,'organization_id',f.organization_id);
end $$;

create or replace function public.create_minuta_feedback_media_v3(
  p_request_id uuid,p_organization uuid,p_kind text,p_message text,p_expected_result text,
  p_page_path text,p_client_version text,p_device_summary text,p_attachments jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid:=auth.uid(); payload jsonb; existing jsonb; f public.product_feedback; a jsonb;
  u public.product_feedback_media_uploads; o storage.objects; paths text[]:=array[]::text[]; total_bytes bigint:=0;
begin
  if actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='invalid_feedback'; end if;
  payload:=jsonb_build_object('p_request_id',p_request_id,'p_organization',p_organization,'p_kind',p_kind,'p_message',p_message,
    'p_expected_result',p_expected_result,'p_page_path',p_page_path,'p_client_version',p_client_version,'p_device_summary',p_device_summary,'p_attachments',p_attachments);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('feedback-media:'||actor::text,0));
  existing:=public.get_my_minuta_feedback_request_v3(p_request_id,payload);
  if existing is not null then return existing; end if;
  if not coalesce((select enabled from public.product_feedback_media_settings where singleton),false) then raise exception 'feedback_media_disabled'; end if;
  if p_organization is not null and not exists(select 1 from public.organization_memberships m join public.organizations org on org.id=m.organization_id
    where m.user_id=actor and m.organization_id=p_organization and m.active and org.status='active') then
    raise exception using errcode='42501',message='feedback_organization_denied';
  end if;
  if p_kind is null or p_kind not in ('problem','suggestion') or char_length(btrim(coalesce(p_message,''))) not between 10 and 4000
    or char_length(coalesce(p_expected_result,''))>2000 or char_length(coalesce(p_page_path,'')) not between 1 and 300
    or p_page_path not like '/%' or p_page_path like '%?%' or p_page_path like '%#%'
    or char_length(btrim(coalesce(p_client_version,''))) not between 1 and 32 or char_length(coalesce(p_device_summary,''))>300
    or p_attachments is null or jsonb_typeof(p_attachments)<>'array' then raise exception using errcode='22023',message='invalid_feedback'; end if;
  if jsonb_array_length(p_attachments)>5 then raise exception using errcode='22023',message='invalid_feedback'; end if;
  for a in select value from jsonb_array_elements(p_attachments) order by value->>'path' loop
    if jsonb_typeof(a)<>'object' or a->>'path' is null or (a->>'path')=any(paths) then raise exception using errcode='22023',message='invalid_feedback'; end if;
    select * into u from public.product_feedback_media_uploads where actor_id=actor and request_id=p_request_id and object_path=a->>'path' for update;
    if not found or u.state<>'reserved' or u.created_at<=now()-interval '48 hours' then raise exception 'feedback_attachment_missing'; end if;
    if (a->>'name') is distinct from u.display_name or (a->>'mime') is distinct from u.mime_type or (a->>'size') is distinct from u.expected_bytes::text then raise exception using errcode='22023',message='invalid_feedback'; end if;
    select * into o from storage.objects where bucket_id='product-feedback-media' and name=u.object_path;
    if not found or coalesce(o.metadata->>'size','')<>u.expected_bytes::text or coalesce(o.metadata->>'mimetype','')<>u.mime_type then raise exception 'feedback_attachment_missing'; end if;
    total_bytes:=total_bytes+u.expected_bytes; paths:=array_append(paths,u.object_path);
  end loop;
  if total_bytes>41943040 then raise exception 'feedback_attachments_too_large'; end if;
  insert into public.product_feedback(reporter_user_id,organization_id,kind,message,expected_result,page_path,client_version,device_summary)
    values(actor,p_organization,p_kind,btrim(p_message),nullif(btrim(p_expected_result),''),p_page_path,btrim(p_client_version),p_device_summary) returning * into f;
  insert into public.product_feedback_media_requests(actor_id,request_id,feedback_id,payload) values(actor,p_request_id,f.id,payload);
  update public.product_feedback_media_uploads set state='linked',feedback_id=f.id where actor_id=actor and request_id=p_request_id and object_path=any(paths);
  return jsonb_build_object('request_id',p_request_id,'request_number',f.request_number,'organization_id',f.organization_id);
end $$;

create or replace function public.release_minuta_feedback_upload_v3(p_request_id uuid,p_path text)
returns boolean language plpgsql security definer set search_path=''
as $$ declare u public.product_feedback_media_uploads; begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('feedback-media:'||auth.uid()::text,0));
  select * into u from public.product_feedback_media_uploads
    where actor_id=auth.uid() and request_id=p_request_id and object_path=p_path for update;
  if not found or u.state='linked' then return false; end if;
  if u.state='reserved' then
    update public.product_feedback_media_uploads set state='cleanup'
      where actor_id=u.actor_id and request_id=u.request_id and attachment_id=u.attachment_id;
  end if;
  -- A lost release ACK can be retried even after the worker has finished.
  return true;
end $$;

create or replace function public.claim_minuta_feedback_cleanup_v116(p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare result jsonb; begin
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'invalid_cleanup_limit'; end if;
  with candidates as (
    select actor_id,request_id,attachment_id from public.product_feedback_media_uploads
    where (state='reserved' and created_at<=now()-interval '48 hours')
       or (state='cleanup' and (cleanup_until is null or cleanup_until<now()))
    order by created_at,object_path for update skip locked limit p_limit
  ), marked as (
    update public.product_feedback_media_uploads u set state='cleanup',cleanup_token=gen_random_uuid(),cleanup_until=now()+interval '15 minutes'
    from candidates c where u.actor_id=c.actor_id and u.request_id=c.request_id and u.attachment_id=c.attachment_id
    returning u.object_path,u.cleanup_token
  ) select coalesce(jsonb_agg(jsonb_build_object('path',object_path,'token',cleanup_token)),'[]'::jsonb) into result from marked;
  return result;
end $$;
create or replace function public.finish_minuta_feedback_cleanup_v116(p_path text,p_token uuid)
returns boolean language plpgsql security definer set search_path=''
as $$ begin
  update public.product_feedback_media_uploads set state='deleted',cleanup_token=null,cleanup_until=null
    where object_path=p_path and state='cleanup' and cleanup_token=p_token;
  return found;
end $$;

revoke all on function public.get_minuta_feedback_media_capability(),public.reserve_minuta_feedback_upload_v3(uuid,uuid,text,text,bigint),
  public.can_insert_minuta_feedback_media_v116(text,jsonb),public.get_my_minuta_feedback_request_v3(uuid,jsonb),
  public.create_minuta_feedback_media_v3(uuid,uuid,text,text,text,text,text,text,jsonb),public.release_minuta_feedback_upload_v3(uuid,text),
  public.claim_minuta_feedback_cleanup_v116(integer),public.finish_minuta_feedback_cleanup_v116(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_feedback_media_capability(),public.reserve_minuta_feedback_upload_v3(uuid,uuid,text,text,bigint),
  public.can_insert_minuta_feedback_media_v116(text,jsonb),public.get_my_minuta_feedback_request_v3(uuid,jsonb),
  public.create_minuta_feedback_media_v3(uuid,uuid,text,text,text,text,text,text,jsonb),public.release_minuta_feedback_upload_v3(uuid,text) to authenticated,service_role;
grant execute on function public.claim_minuta_feedback_cleanup_v116(integer),public.finish_minuta_feedback_cleanup_v116(text,uuid) to service_role;
comment on table public.product_feedback_media_settings is 'v116 remains disabled until real isolated Storage tests, fresh backup and release gates pass.';
notify pgrst,'reload schema';
commit;
