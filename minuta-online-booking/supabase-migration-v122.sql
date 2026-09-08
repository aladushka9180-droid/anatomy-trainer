begin;

do $$ begin
  if to_regprocedure('public.reschedule_booking_v2(uuid,date,time without time zone)') is null then
    raise exception 'v122_requires_booking_policies_v76';
  end if;
end $$;

create table if not exists public.client_reschedule_requests (
  request_id uuid primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  requested_date date not null,
  requested_time time without time zone not null,
  result_code text not null,
  created_at timestamptz not null default now()
);
alter table public.client_reschedule_requests enable row level security;
revoke all on public.client_reschedule_requests from public,anon,authenticated,service_role;

-- Keep the legacy three-argument RPC for already installed clients. The new
-- overload serializes by booking before reading the receipt and mutating.
create or replace function public.reschedule_booking_v2(
  p_token uuid,p_date date,p_time time without time zone,p_request_id uuid
) returns text language plpgsql security definer set search_path to '' as $$
declare v_booking public.bookings%rowtype;
  v_receipt public.client_reschedule_requests%rowtype;
  v_code text;
begin
  if p_token is null or p_request_id is null or p_date is null or p_time is null then
    raise exception using errcode='22023',message='invalid_reschedule_request';
  end if;
  select * into v_booking from public.bookings where manage_token=p_token;
  if not found then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.id::text,7302));
  select * into v_booking from public.bookings where manage_token=p_token for update;
  if not found then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  select * into v_receipt from public.client_reschedule_requests where request_id=p_request_id;
  if found then
    if v_receipt.booking_id<>v_booking.id or v_receipt.requested_date<>p_date or v_receipt.requested_time<>p_time then
      raise exception using errcode='P0001',message='request_conflict';
    end if;
    return v_receipt.result_code;
  end if;
  if v_booking.status='cancelled' then raise exception using errcode='P0001',message='booking_unavailable'; end if;
  if v_booking.booking_date=p_date and v_booking.booking_time=p_time then
    v_code:=v_booking.booking_code;
  else
    v_code:=public.reschedule_booking_v2(p_token,p_date,p_time);
  end if;
  insert into public.client_reschedule_requests(request_id,booking_id,requested_date,requested_time,result_code)
    values(p_request_id,v_booking.id,p_date,p_time,v_code);
  return v_code;
end $$;
revoke all on function public.reschedule_booking_v2(uuid,date,time without time zone,uuid) from public,anon,authenticated,service_role;
grant execute on function public.reschedule_booking_v2(uuid,date,time without time zone,uuid) to anon,authenticated;

-- Portfolio image bytes are uploaded to private staging paths first. This RPC
-- switches the item and both optional photo references in one transaction and
-- returns old paths only after the metadata commit is certain.
create or replace function public.save_provider_portfolio_item(
  p_item_id uuid,p_expected_updated_at timestamptz,p_item jsonb,p_photos jsonb
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_user uuid:=auth.uid(); v_existing public.portfolio_items%rowtype;
  v_saved public.portfolio_items%rowtype; v_photo jsonb; v_type text; v_path text;
  v_previous text; v_retired jsonb:='[]'::jsonb; v_count integer; v_distinct integer;
begin
  if v_user is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_item_id is null or p_item is null or jsonb_typeof(p_item)<>'object'
    or coalesce(jsonb_typeof(p_photos),'array')<>'array' then
    raise exception using errcode='22023',message='invalid_portfolio_payload';
  end if;
  select * into v_existing from public.portfolio_items where id=p_item_id for update;
  if found then
    if v_existing.performer_id<>v_user then raise exception using errcode='42501',message='portfolio_item_forbidden'; end if;
    if p_expected_updated_at is null or v_existing.updated_at<>p_expected_updated_at then
      raise exception using errcode='40001',message='portfolio_item_changed';
    end if;
  elsif p_expected_updated_at is not null then
    raise exception using errcode='40001',message='portfolio_item_changed';
  end if;
  select count(*),count(distinct value->>'photo_type') into v_count,v_distinct
  from jsonb_array_elements(coalesce(p_photos,'[]'::jsonb)) value;
  if v_count>2 or v_count<>v_distinct or exists(
    select 1 from jsonb_array_elements(coalesce(p_photos,'[]'::jsonb)) value
    where value->>'photo_type' not in ('before','after')
      or nullif(value->>'storage_path','') is null
      or nullif(value->>'alt_text','') is null
  ) then raise exception using errcode='22023',message='invalid_portfolio_photos'; end if;

  if v_existing.id is null then
    insert into public.portfolio_items(id,performer_id,procedure_name,body_area,session_count,description,
      sort_order,published,consent_confirmed_at)
    values(p_item_id,v_user,trim(p_item->>'procedure_name'),coalesce(p_item->>'body_area',''),
      nullif(p_item->>'session_count','')::integer,coalesce(p_item->>'description',''),
      coalesce((p_item->>'sort_order')::integer,0),coalesce((p_item->>'published')::boolean,false),
      nullif(p_item->>'consent_confirmed_at','')::timestamptz);
  else
    update public.portfolio_items set
      procedure_name=trim(p_item->>'procedure_name'),body_area=coalesce(p_item->>'body_area',''),
      session_count=nullif(p_item->>'session_count','')::integer,description=coalesce(p_item->>'description',''),
      sort_order=coalesce((p_item->>'sort_order')::integer,sort_order),
      published=coalesce((p_item->>'published')::boolean,false),
      consent_confirmed_at=nullif(p_item->>'consent_confirmed_at','')::timestamptz
    where id=p_item_id and performer_id=v_user;
  end if;

  for v_photo in select value from jsonb_array_elements(coalesce(p_photos,'[]'::jsonb)) value loop
    v_type:=v_photo->>'photo_type'; v_path:=v_photo->>'storage_path';
    if v_path !~ ('^'||v_user::text||'/'||p_item_id::text||'/[0-9a-f-]{36}\\.webp$') then
      raise exception using errcode='22023',message='invalid_portfolio_storage_path';
    end if;
    select storage_path into v_previous from public.portfolio_photos
      where portfolio_item_id=p_item_id and photo_type=v_type and performer_id=v_user for update;
    insert into public.portfolio_photos(portfolio_item_id,performer_id,photo_type,storage_path,alt_text,width,height)
    values(p_item_id,v_user,v_type,v_path,v_photo->>'alt_text',(v_photo->>'width')::integer,(v_photo->>'height')::integer)
    on conflict(portfolio_item_id,photo_type) do update set
      storage_path=excluded.storage_path,alt_text=excluded.alt_text,width=excluded.width,height=excluded.height;
    if v_previous is not null and v_previous<>v_path then
      v_retired:=v_retired||jsonb_build_array(v_previous);
    end if;
  end loop;
  select * into v_saved from public.portfolio_items where id=p_item_id and performer_id=v_user;
  return jsonb_build_object('ok',true,'item_id',v_saved.id,'updated_at',v_saved.updated_at,'retired_paths',v_retired);
end $$;
revoke all on function public.save_provider_portfolio_item(uuid,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_provider_portfolio_item(uuid,timestamptz,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
