\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';

-- Independent of the optional legal/data-governance v110 layer.
do $$ begin
  if to_regclass('public.product_feedback') is null
     or to_regprocedure('public.get_minuta_feedback_capability()') is null then
    raise exception 'v111_requires_feedback_v109';
  end if;
end $$;

alter table public.product_feedback add column if not exists client_request_id uuid;
create unique index if not exists product_feedback_actor_request_idx
  on public.product_feedback(reporter_user_id,client_request_id) where client_request_id is not null;

create table if not exists public.product_feedback_attachments(
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.product_feedback(id) on delete restrict,
  object_path text not null unique,
  display_name text not null check(char_length(display_name) between 1 and 200),
  mime_type text not null check(mime_type in ('image/webp','video/mp4','video/webm','video/quicktime')),
  byte_size bigint not null check(byte_size between 1 and 104857600),
  created_at timestamptz not null default now()
);
create index if not exists product_feedback_attachments_parent_idx on public.product_feedback_attachments(feedback_id);
create table if not exists public.product_feedback_replies(
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.product_feedback(id) on delete restrict,
  message text not null check(char_length(btrim(message)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists product_feedback_replies_parent_idx on public.product_feedback_replies(feedback_id,created_at);
alter table public.product_feedback_attachments enable row level security;
alter table public.product_feedback_replies enable row level security;
revoke all on public.product_feedback_attachments,public.product_feedback_replies from public,anon,authenticated;
grant select on public.product_feedback_attachments to service_role;
grant select,insert on public.product_feedback_replies to service_role;
comment on table public.product_feedback_replies is 'Support-only replies. Service credentials must never be exposed to the browser.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-feedback-media','product-feedback-media',false,104857600,array['image/webp','video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- A daily object-count gate bounds direct Storage uploads, not just RPC submissions.
create or replace function public.can_upload_minuta_feedback_media()
returns boolean language sql stable security definer set search_path=''
as $$ select auth.uid() is not null and
  (select count(*) from storage.objects o where o.bucket_id='product-feedback-media'
   and (storage.foldername(o.name))[1]=auth.uid()::text and o.created_at>now()-interval '24 hours')<50 $$;
revoke all on function public.can_upload_minuta_feedback_media() from public,anon,authenticated,service_role;
grant execute on function public.can_upload_minuta_feedback_media() to authenticated,service_role;
drop policy if exists product_feedback_media_insert on storage.objects;
create policy product_feedback_media_insert on storage.objects for insert to authenticated
with check(bucket_id='product-feedback-media' and (storage.foldername(name))[1]=auth.uid()::text and public.can_upload_minuta_feedback_media());
drop policy if exists product_feedback_media_select on storage.objects;
create policy product_feedback_media_select on storage.objects for select to authenticated
using(bucket_id='product-feedback-media' and (storage.foldername(name))[1]=auth.uid()::text);
-- No browser update/delete policy: attachments already submitted cannot disappear
-- after a lost RPC response. Unlinked objects are cleaned through the Storage API.

create or replace function public.get_minuta_feedback_media_capability()
returns jsonb language sql stable security definer set search_path=''
as $$ select case when auth.uid() is null then null else jsonb_build_object('version',2,'max_files',5,'video_bytes',104857600) end $$;

create or replace function public.get_my_minuta_feedback_request(p_request_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$ select jsonb_build_object('request_number',f.request_number)
  from public.product_feedback f where f.reporter_user_id=auth.uid() and f.client_request_id=p_request_id $$;

create or replace function public.create_minuta_feedback_media(
  p_organization uuid,p_kind text,p_message text,p_expected_result text,
  p_page_path text,p_client_version text,p_device_summary text,p_request_id uuid,p_attachments jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  actor uuid:=auth.uid();
  request_row public.product_feedback;
  attachment jsonb;
  object_row storage.objects;
  object_size bigint;
  object_mime text;
  total_size bigint:=0;
  object_paths text[]:=array[]::text[];
  safe_page text:=split_part(split_part(btrim(coalesce(p_page_path,'')),'?',1),'#',1);
begin
  if actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request_id is null then raise exception 'feedback_request_id_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('feedback:'||actor::text,0));
  select * into request_row from public.product_feedback where reporter_user_id=actor and client_request_id=p_request_id;
  if found then return jsonb_build_object('request_number',request_row.request_number); end if;
  if p_organization is not null and not exists(
    select 1 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
    where m.organization_id=p_organization and m.user_id=actor and m.active and o.status='active'
  ) then raise exception using errcode='42501',message='feedback_organization_denied'; end if;
  if p_kind is null or p_kind not in ('problem','suggestion')
     or char_length(btrim(coalesce(p_message,''))) not between 10 and 4000
     or char_length(coalesce(p_expected_result,''))>2000
     or char_length(safe_page) not between 1 and 300 or safe_page not like '/%'
     or char_length(btrim(coalesce(p_client_version,''))) not between 1 and 32
     or char_length(coalesce(p_device_summary,''))>300
     or p_attachments is null or jsonb_typeof(p_attachments)<>'array' then
    raise exception using errcode='22023',message='invalid_feedback';
  end if;
  if jsonb_array_length(p_attachments)>5 then raise exception 'feedback_too_many_attachments'; end if;
  if (select count(*) from public.product_feedback where reporter_user_id=actor and created_at>now()-interval '24 hours')>=20 then
    raise exception 'feedback_daily_limit';
  end if;
  for attachment in select value from jsonb_array_elements(p_attachments) loop
    if jsonb_typeof(attachment)<>'object'
       or coalesce(attachment->>'path','')!~('^'||actor::text||'/[0-9a-f-]{36}[.](webp|mp4|webm|mov)$')
       or char_length(btrim(coalesce(attachment->>'name',''))) not between 1 and 200
       or (attachment->>'path')=any(object_paths) then raise exception 'invalid_feedback_attachment'; end if;
    select * into object_row from storage.objects where bucket_id='product-feedback-media' and name=attachment->>'path';
    if not found then raise exception 'feedback_attachment_missing'; end if;
    object_size:=(object_row.metadata->>'size')::bigint;
    object_mime:=object_row.metadata->>'mimetype';
    if object_size is null or object_size<1 or object_size>104857600 or object_mime is null
       or object_mime not in ('image/webp','video/mp4','video/webm','video/quicktime')
       or (object_mime='image/webp' and object_size>4194304) then raise exception 'invalid_feedback_attachment_metadata'; end if;
    total_size:=total_size+object_size;
    object_paths:=array_append(object_paths,attachment->>'path');
    if exists(select 1 from public.product_feedback_attachments where object_path=attachment->>'path') then
      raise exception 'feedback_attachment_already_used';
    end if;
  end loop;
  if total_size>209715200 then raise exception 'feedback_attachments_too_large'; end if;
  insert into public.product_feedback(reporter_user_id,organization_id,kind,message,expected_result,page_path,client_version,device_summary,client_request_id)
  values(actor,p_organization,p_kind,btrim(p_message),nullif(btrim(p_expected_result),''),safe_page,btrim(p_client_version),p_device_summary,p_request_id)
  returning * into request_row;
  for attachment in select value from jsonb_array_elements(p_attachments) loop
    select * into object_row from storage.objects where bucket_id='product-feedback-media' and name=attachment->>'path';
    insert into public.product_feedback_attachments(feedback_id,object_path,display_name,mime_type,byte_size)
    values(request_row.id,object_row.name,btrim(attachment->>'name'),object_row.metadata->>'mimetype',(object_row.metadata->>'size')::bigint);
  end loop;
  return jsonb_build_object('request_number',request_row.request_number);
end $$;

create or replace function public.list_my_minuta_feedback()
returns jsonb language sql stable security definer set search_path=''
as $$ select coalesce(jsonb_agg(jsonb_build_object(
  'request_number',f.request_number,'status',f.status,'message',f.message,'created_at',f.created_at,
  'attachments',(select coalesce(jsonb_agg(jsonb_build_object('path',a.object_path,'name',a.display_name,'mime',a.mime_type) order by a.created_at),'[]'::jsonb)
                 from public.product_feedback_attachments a where a.feedback_id=f.id),
  'replies',(select coalesce(jsonb_agg(jsonb_build_object('message',r.message,'created_at',r.created_at) order by r.created_at),'[]'::jsonb)
            from public.product_feedback_replies r where r.feedback_id=f.id)
  ) order by f.created_at desc),'[]'::jsonb)
  from (select * from public.product_feedback where reporter_user_id=auth.uid() order by created_at desc limit 20) f $$;

revoke all on function public.get_minuta_feedback_media_capability(),public.get_my_minuta_feedback_request(uuid),public.list_my_minuta_feedback(),public.create_minuta_feedback_media(uuid,text,text,text,text,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_feedback_media_capability(),public.get_my_minuta_feedback_request(uuid),public.list_my_minuta_feedback(),public.create_minuta_feedback_media(uuid,text,text,text,text,text,text,uuid,jsonb) to authenticated,service_role;

do $$ begin
  if coalesce((select public from storage.buckets where id='product-feedback-media'),true)
     or has_table_privilege('authenticated','public.product_feedback_replies','SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated','public.product_feedback_attachments','SELECT,INSERT,UPDATE,DELETE')
     or not (select relrowsecurity from pg_class where oid='public.product_feedback_replies'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.product_feedback_attachments'::regclass) then
    raise exception 'v111_postcondition_failed';
  end if;
end $$;
notify pgrst,'reload schema';
commit;
