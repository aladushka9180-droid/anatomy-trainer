\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$ begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null then
    raise exception using errcode='P0001',message='v109_requires_organizations_and_memberships';
  end if;
end $$;

create table if not exists public.product_feedback(
  id uuid primary key default gen_random_uuid(),
  request_number bigint generated always as identity unique,
  reporter_user_id uuid not null references auth.users(id) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  kind text not null check(kind in ('problem','suggestion')),
  message text not null check(char_length(btrim(message)) between 10 and 4000),
  expected_result text check(expected_result is null or char_length(expected_result)<=2000),
  page_path text not null check(char_length(page_path) between 1 and 300 and page_path like '/%'),
  client_version text not null check(char_length(client_version) between 1 and 32),
  device_summary text check(device_summary is null or char_length(device_summary)<=300),
  screenshot_path text unique check(screenshot_path is null or char_length(screenshot_path)<=500),
  status text not null default 'new' check(status in ('new','in_review','planned','resolved','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_feedback_status_created_idx
  on public.product_feedback(status,created_at desc);
create index if not exists product_feedback_organization_created_idx
  on public.product_feedback(organization_id,created_at desc)
  where organization_id is not null;

alter table public.product_feedback enable row level security;
revoke all on table public.product_feedback from public,anon,authenticated;
revoke all on sequence public.product_feedback_request_number_seq from public,anon,authenticated;
grant select,update on table public.product_feedback to service_role;
grant usage,select on sequence public.product_feedback_request_number_seq to service_role;

comment on table public.product_feedback is 'Private product problems and suggestions submitted from the provider cabinet.';
comment on column public.product_feedback.device_summary is 'Coarse device context only; no IP, raw user agent, client records, passwords or tokens.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('product-feedback','product-feedback',false,4194304,array['image/webp'])
on conflict(id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists product_feedback_objects_owner_insert on storage.objects;
create policy product_feedback_objects_owner_insert on storage.objects
  for insert to authenticated
  with check(bucket_id='product-feedback' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists product_feedback_objects_owner_select on storage.objects;
create policy product_feedback_objects_owner_select on storage.objects
  for select to authenticated
  using(bucket_id='product-feedback' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists product_feedback_objects_owner_delete on storage.objects;
create policy product_feedback_objects_owner_delete on storage.objects
  for delete to authenticated
  using(bucket_id='product-feedback' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.get_minuta_feedback_capability()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$ select auth.uid() is not null $$;
revoke all on function public.get_minuta_feedback_capability() from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_feedback_capability() to authenticated,service_role;

create or replace function public.create_minuta_feedback(
  p_organization uuid,
  p_kind text,
  p_message text,
  p_expected_result text,
  p_page_path text,
  p_client_version text,
  p_device_summary text,
  p_screenshot_path text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_message text:=btrim(coalesce(p_message,''));
  v_expected text:=nullif(btrim(coalesce(p_expected_result,'')),'');
  v_page text:=split_part(split_part(btrim(coalesce(p_page_path,'')),'?',1),'#',1);
  v_version text:=btrim(coalesce(p_client_version,''));
  v_device text:=nullif(btrim(coalesce(p_device_summary,'')),'');
  v_screenshot text:=nullif(btrim(coalesce(p_screenshot_path,'')),'');
  v_number bigint;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_organization is not null and not exists(
    select 1 from public.organization_memberships membership
    join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
    where membership.organization_id=p_organization and membership.user_id=v_actor and membership.active
  ) then raise exception using errcode='42501',message='feedback_organization_denied'; end if;
  if p_kind not in ('problem','suggestion')
     or char_length(v_message) not between 10 and 4000
     or char_length(coalesce(v_expected,''))>2000
     or char_length(v_page) not between 1 and 300 or v_page not like '/%'
     or char_length(v_version) not between 1 and 32
     or char_length(coalesce(v_device,''))>300 then
    raise exception using errcode='22023',message='invalid_feedback';
  end if;
  if v_screenshot is not null and (
    char_length(v_screenshot)>500
    or v_screenshot not like v_actor::text||'/%'
    or v_screenshot!~('^'||v_actor::text||'/[0-9a-f-]{36}\\.webp$')
    or not exists(select 1 from storage.objects object where object.bucket_id='product-feedback' and object.name=v_screenshot)
  ) then raise exception using errcode='22023',message='invalid_feedback_screenshot'; end if;

  insert into public.product_feedback(
    reporter_user_id,organization_id,kind,message,expected_result,page_path,client_version,device_summary,screenshot_path
  ) values(
    v_actor,p_organization,p_kind,v_message,v_expected,v_page,v_version,v_device,v_screenshot
  ) returning request_number into v_number;

  return jsonb_build_object('request_number',v_number);
end;
$$;
revoke all on function public.create_minuta_feedback(uuid,text,text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_minuta_feedback(uuid,text,text,text,text,text,text,text) to authenticated,service_role;

do $$ begin
  if to_regclass('public.product_feedback') is null
     or not coalesce((select relrowsecurity from pg_class where oid='public.product_feedback'::regclass),false)
     or to_regprocedure('public.get_minuta_feedback_capability()') is null
     or to_regprocedure('public.create_minuta_feedback(uuid,text,text,text,text,text,text,text)') is null
     or has_table_privilege('authenticated','public.product_feedback','SELECT,INSERT,UPDATE,DELETE')
     or not has_function_privilege('authenticated','public.get_minuta_feedback_capability()','EXECUTE')
     or not has_function_privilege('authenticated','public.create_minuta_feedback(uuid,text,text,text,text,text,text,text)','EXECUTE')
     or coalesce((select public from storage.buckets where id='product-feedback'),true) then
    raise exception using errcode='P0001',message='v109_postcondition_failed';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
