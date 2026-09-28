-- Candidate only: core service catalog drafts, without media or client messages.
begin;

set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.services') is null
     or to_regclass('public.service_public_details_v159') is null
     or to_regclass('public.organization_memberships') is null
     or to_regclass('public.organizations') is null then
    raise exception using errcode='P0001',message='v183_requires_service_and_organization_schema';
  end if;
end $$;

create table public.service_catalog_requests_v183 (
  performer_id uuid not null,
  request_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (performer_id,request_id)
);
alter table public.service_catalog_requests_v183 enable row level security;
revoke all on public.service_catalog_requests_v183 from public,anon,authenticated;
grant all on public.service_catalog_requests_v183 to service_role;

create function public.minuta_service_catalog_etag_v183(p_service uuid)
returns text language sql stable security definer set search_path to '' as $$
  select md5(jsonb_build_array(s.name,s.duration_minutes,s.price_rub,s.active,
    d.short_description,d.highlights,d.important_note,d.photo_storage_path,
    d.photo_alt,d.photo_width,d.photo_height)::text)
  from public.services s left join public.service_public_details_v159 d on d.service_id=s.id
  where s.id=p_service;
$$;
revoke all on function public.minuta_service_catalog_etag_v183(uuid) from public,anon,authenticated,service_role;

create function public.get_minuta_service_catalog_draft_v183(p_organization uuid,p_service uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_service public.services%rowtype;
begin
  if auth.uid() is null or not exists(
    select 1 from public.organization_memberships m
    join public.organizations o on o.id=m.organization_id and o.status='active'
    where m.organization_id=p_organization and m.user_id=auth.uid() and m.active
  ) then raise exception using errcode='42501',message='service_catalog_organization_denied'; end if;
  select * into v_service from public.services s where s.id=p_service and s.performer_id=auth.uid();
  if not found then raise exception using errcode='P0002',message='service_catalog_service_not_found'; end if;
  return jsonb_build_object('organization_id',p_organization,'id',v_service.id,
    'name',v_service.name,'duration_minutes',v_service.duration_minutes,
    'price_rub',v_service.price_rub,'active',v_service.active,
    'etag',public.minuta_service_catalog_etag_v183(v_service.id));
end $$;
revoke all on function public.get_minuta_service_catalog_draft_v183(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_service_catalog_draft_v183(uuid,uuid) to authenticated;

create function public.save_minuta_service_catalog_draft_v183(
  p_organization uuid,p_request_id uuid,p_service uuid,p_expected_etag text,
  p_name text,p_duration_minutes integer,p_price_rub integer,p_active boolean
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_uid uuid:=auth.uid(); v_hash text; v_prior public.service_catalog_requests_v183%rowtype;
  v_id uuid; v_current_etag text; v_result jsonb;
begin
  if v_uid is null or not exists(
    select 1 from public.organization_memberships m
    join public.organizations o on o.id=m.organization_id and o.status='active'
    where m.organization_id=p_organization and m.user_id=v_uid and m.active
  ) then raise exception using errcode='42501',message='service_catalog_organization_denied'; end if;
  if p_request_id is null or (p_service is null and p_expected_etag is not null)
     or (p_service is not null and (p_expected_etag is null or p_expected_etag !~ '^[0-9a-f]{32}$')) then
    raise exception using errcode='22023',message='service_catalog_request_invalid';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 120
     or coalesce(p_duration_minutes,0) not between 1 and 480
     or coalesce(p_price_rub,-1) not between 0 and 1000000 or p_active is null then
    raise exception using errcode='22023',message='service_catalog_fields_invalid';
  end if;
  v_hash:=md5(jsonb_build_array(p_organization,p_service,p_expected_etag,
    btrim(p_name),p_duration_minutes,p_price_rub,p_active)::text);
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':'||p_request_id::text,183));
  select * into v_prior from public.service_catalog_requests_v183
    where performer_id=v_uid and request_id=p_request_id;
  if found then
    if v_prior.payload_hash<>v_hash then
      raise exception using errcode='23505',message='service_catalog_request_mismatch';
    end if;
    if not exists(select 1 from public.services s where s.id=(v_prior.result->>'id')::uuid and s.performer_id=v_uid) then
      return jsonb_build_object('saved',false,'reason','service_deleted','id',v_prior.result->>'id');
    end if;
    if public.minuta_service_catalog_etag_v183((v_prior.result->>'id')::uuid)<>v_prior.result->>'etag' then
      return jsonb_build_object('saved',false,'reason','service_changed_after_save','id',v_prior.result->>'id');
    end if;
    return v_prior.result;
  end if;
  if p_service is null then
    insert into public.services(performer_id,name,duration_minutes,price_rub,active)
      values(v_uid,btrim(p_name),p_duration_minutes,p_price_rub,p_active) returning id into v_id;
  else
    -- The online v159 writer locks details before services. Follow that order.
    perform 1 from public.service_public_details_v159 d where d.service_id=p_service for update;
    select s.id into v_id from public.services s
      where s.id=p_service and s.performer_id=v_uid for update;
    if not found then raise exception using errcode='P0002',message='service_catalog_service_not_found'; end if;
    v_current_etag:=public.minuta_service_catalog_etag_v183(v_id);
    if v_current_etag<>p_expected_etag then
      raise exception using errcode='40001',message='service_catalog_version_conflict';
    end if;
    update public.services set name=btrim(p_name),duration_minutes=p_duration_minutes,
      price_rub=p_price_rub,active=p_active where id=v_id;
  end if;
  v_result:=jsonb_build_object('saved',true,'organization_id',p_organization,
    'id',v_id,'etag',public.minuta_service_catalog_etag_v183(v_id));
  insert into public.service_catalog_requests_v183(performer_id,request_id,organization_id,payload_hash,result)
    values(v_uid,p_request_id,p_organization,v_hash,v_result);
  return v_result;
end $$;
revoke all on function public.save_minuta_service_catalog_draft_v183(uuid,uuid,uuid,text,text,integer,integer,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.save_minuta_service_catalog_draft_v183(uuid,uuid,uuid,text,text,integer,integer,boolean)
  to authenticated;

commit;
