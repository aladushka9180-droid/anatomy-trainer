-- v159: truthful public service cards, service-specific reviews and private service media.
begin;

do $$
begin
  if to_regclass('public.services') is null
     or to_regclass('public.booking_reviews') is null
     or to_regclass('public.booking_outcomes') is null
     or to_regclass('storage.objects') is null then
    raise exception using errcode='55000',message='v159_service_cards_prerequisites_missing';
  end if;
  if to_regclass('public.service_public_details_v159') is not null
     or to_regprocedure('public.get_public_service_cards_v159(uuid[])') is not null
     or exists(select 1 from storage.buckets where id='service-images') then
    raise exception using errcode='55000',message='v159_service_cards_state_not_absent';
  end if;
end $$;

create function public.minuta_service_highlights_valid_v159(value text[])
returns boolean language sql immutable strict set search_path to '' as $$
  select cardinality(value)<=3
    and array_position(value,null) is null
    and not exists(select 1 from unnest(value) item where btrim(item)='' or char_length(item)>120);
$$;
revoke all on function public.minuta_service_highlights_valid_v159(text[]) from public;
alter function public.minuta_service_highlights_valid_v159(text[]) owner to postgres;

create table public.service_public_details_v159 (
  service_id uuid primary key references public.services(id) on delete cascade,
  short_description text not null default '' check(char_length(short_description)<=360),
  highlights text[] not null default '{}'::text[] check(public.minuta_service_highlights_valid_v159(highlights)),
  important_note text not null default '' check(char_length(important_note)<=500),
  photo_storage_path text not null default '' check(char_length(photo_storage_path)<=500),
  photo_alt text not null default '' check(char_length(photo_alt)<=160),
  photo_width integer check(photo_width between 1 and 5000),
  photo_height integer check(photo_height between 1 and 5000),
  updated_at timestamptz not null default now()
);
alter table public.service_public_details_v159 enable row level security;
alter table public.service_public_details_v159 force row level security;
alter table public.service_public_details_v159 owner to postgres;
revoke all on table public.service_public_details_v159 from public,anon,authenticated;
grant all on table public.service_public_details_v159 to postgres,service_role;

create policy service_public_details_owner_read_v159 on public.service_public_details_v159
  for select to authenticated using(exists(select 1 from public.services s where s.id=service_id and s.performer_id=auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('service-images','service-images',false,2097152,array['image/webp']);

create function public.minuta_service_image_is_public_v159(p_path text)
returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.service_public_details_v159 d join public.services s on s.id=d.service_id
    where d.photo_storage_path=p_path and s.active);
$$;
revoke all on function public.minuta_service_image_is_public_v159(text) from public;
grant execute on function public.minuta_service_image_is_public_v159(text) to anon,authenticated;
alter function public.minuta_service_image_is_public_v159(text) owner to postgres;

create policy service_images_insert_v159 on storage.objects for insert to authenticated
  with check(bucket_id='service-images' and split_part(name,'/',1)=auth.uid()::text and split_part(name,'/',2)='services');
create policy service_images_update_v159 on storage.objects for update to authenticated
  using(bucket_id='service-images' and split_part(name,'/',1)=auth.uid()::text and split_part(name,'/',2)='services')
  with check(bucket_id='service-images' and split_part(name,'/',1)=auth.uid()::text and split_part(name,'/',2)='services');
create policy service_images_delete_v159 on storage.objects for delete to authenticated
  using(bucket_id='service-images' and split_part(name,'/',1)=auth.uid()::text and split_part(name,'/',2)='services');
create policy service_images_read_v159 on storage.objects for select to anon,authenticated using(
  bucket_id='service-images' and (
    split_part(name,'/',1)=auth.uid()::text
    or public.minuta_service_image_is_public_v159(name)
  )
);

create function public.get_minuta_service_public_details_v159(p_service uuid)
returns table(service_id uuid,short_description text,highlights text[],important_note text,photo_storage_path text,photo_alt text,photo_width integer,photo_height integer,updated_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select d.service_id,d.short_description,d.highlights,d.important_note,d.photo_storage_path,d.photo_alt,d.photo_width,d.photo_height,d.updated_at
  from public.service_public_details_v159 d join public.services s on s.id=d.service_id
  where (p_service is null or d.service_id=p_service) and s.performer_id=auth.uid();
$$;
revoke all on function public.get_minuta_service_public_details_v159(uuid) from public;
grant execute on function public.get_minuta_service_public_details_v159(uuid) to authenticated;
alter function public.get_minuta_service_public_details_v159(uuid) owner to postgres;

create function public.save_minuta_service_v159(
  p_service uuid,p_name text,p_duration_minutes integer,p_price_rub integer,p_active boolean,
  p_short_description text default '',p_highlights text[] default '{}'::text[],p_important_note text default '',
  p_photo_storage_path text default '',p_photo_alt text default '',p_photo_width integer default null,p_photo_height integer default null
) returns boolean language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid:=auth.uid(); v_description text:=btrim(coalesce(p_short_description,''));
  v_highlights text[]; v_note text:=btrim(coalesce(p_important_note,'')); v_path text:=btrim(coalesce(p_photo_storage_path,''));
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(select 1 from public.services s where s.id=p_service and s.performer_id=v_uid) then
    raise exception 'service_access_denied' using errcode='42501';
  end if;
  select coalesce(array_agg(btrim(item)) filter(where btrim(item)<>''),'{}'::text[]) into v_highlights
  from unnest(coalesce(p_highlights,'{}'::text[])) item;
  if char_length(v_description)>360 or char_length(v_note)>500 or not public.minuta_service_highlights_valid_v159(v_highlights) then
    raise exception 'service_details_invalid' using errcode='22023';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 120 or coalesce(p_duration_minutes,0) not between 1 and 480 or coalesce(p_price_rub,-1) not between 0 and 1000000 then
    raise exception 'service_invalid' using errcode='22023';
  end if;
  if v_path<>'' and (
    split_part(v_path,'/',1)<>v_uid::text or split_part(v_path,'/',2)<>'services' or split_part(v_path,'/',3)<>p_service::text
    or split_part(v_path,'/',4) !~ '^[0-9a-f-]{36}\.webp$' or split_part(v_path,'/',5)<>''
    or p_photo_width is null or p_photo_height is null or p_photo_width not between 1 and 5000 or p_photo_height not between 1 and 5000
  ) then raise exception 'service_photo_path_invalid' using errcode='22023'; end if;
  if v_path='' then p_photo_width:=null;p_photo_height:=null;p_photo_alt:=''; end if;
  update public.services set name=btrim(p_name),duration_minutes=p_duration_minutes,price_rub=p_price_rub,active=p_active
  where id=p_service and performer_id=v_uid;
  if v_description='' and cardinality(v_highlights)=0 and v_note='' and v_path='' then
    delete from public.service_public_details_v159 d where d.service_id=p_service;
    return true;
  end if;
  insert into public.service_public_details_v159(service_id,short_description,highlights,important_note,photo_storage_path,photo_alt,photo_width,photo_height)
  values(p_service,v_description,v_highlights,v_note,v_path,left(btrim(coalesce(p_photo_alt,'')),160),p_photo_width,p_photo_height)
  on conflict(service_id) do update set short_description=excluded.short_description,highlights=excluded.highlights,
    important_note=excluded.important_note,photo_storage_path=excluded.photo_storage_path,photo_alt=excluded.photo_alt,
    photo_width=excluded.photo_width,photo_height=excluded.photo_height,updated_at=now();
  return true;
end $$;
revoke all on function public.save_minuta_service_v159(uuid,text,integer,integer,boolean,text,text[],text,text,text,integer,integer) from public;
grant execute on function public.save_minuta_service_v159(uuid,text,integer,integer,boolean,text,text[],text,text,text,integer,integer) to authenticated;
alter function public.save_minuta_service_v159(uuid,text,integer,integer,boolean,text,text[],text,text,text,integer,integer) owner to postgres;

create function public.get_public_service_cards_v159(p_service_ids uuid[])
returns table(service_id uuid,short_description text,highlights text[],important_note text,photo_storage_path text,photo_alt text,photo_width integer,photo_height integer,average_rating numeric,total_reviews bigint,latest_review_text text,latest_review_rating integer,latest_review_created_at timestamptz)
language plpgsql stable security definer set search_path to '' as $$
begin
  if coalesce(cardinality(p_service_ids),0)>100 then raise exception 'too_many_services' using errcode='22023'; end if;
  return query
  with requested as (select distinct unnest(coalesce(p_service_ids,'{}'::uuid[])) id),
  valid_reviews as (
    select r.id,r.service_id,r.rating,r.review_text,r.created_at
    from public.booking_reviews r
    join public.bookings b on b.id=r.booking_id
    join public.booking_outcomes o on o.booking_id=b.id
    where r.published and b.status<>'cancelled' and o.visit_status='completed'
      and r.service_id=any(coalesce(p_service_ids,'{}'::uuid[]))
  ), review_summary as (
    select v.service_id,round(avg(v.rating),1) avg_rating,count(*) review_count from valid_reviews v group by v.service_id
  )
  select s.id,coalesce(d.short_description,''),coalesce(d.highlights,'{}'::text[]),coalesce(d.important_note,''),
    coalesce(d.photo_storage_path,''),coalesce(d.photo_alt,''),d.photo_width,d.photo_height,
    summary.avg_rating,coalesce(summary.review_count,0),coalesce(latest.review_text,''),latest.rating::integer,latest.created_at
  from requested q join public.services s on s.id=q.id and s.active
  left join public.service_public_details_v159 d on d.service_id=s.id
  left join review_summary summary on summary.service_id=s.id
  left join lateral(select v.review_text,v.rating,v.created_at from valid_reviews v
    where v.service_id=s.id and btrim(v.review_text)<>'' order by v.created_at desc,v.id desc limit 1) latest on true;
end $$;
revoke all on function public.get_public_service_cards_v159(uuid[]) from public;
grant execute on function public.get_public_service_cards_v159(uuid[]) to anon,authenticated;
alter function public.get_public_service_cards_v159(uuid[]) owner to postgres;

create function public.get_public_service_reviews_v159(p_service uuid)
returns table(rating integer,review_text text,created_at timestamptz)
language sql stable security definer set search_path to '' as $$
  select r.rating::integer,r.review_text::text,r.created_at
  from public.booking_reviews r
  join public.bookings b on b.id=r.booking_id
  join public.booking_outcomes o on o.booking_id=b.id
  join public.services s on s.id=r.service_id
  where r.service_id=p_service and s.active and r.published and b.status<>'cancelled' and o.visit_status='completed'
  order by r.created_at desc,r.id desc limit 50;
$$;
revoke all on function public.get_public_service_reviews_v159(uuid) from public;
grant execute on function public.get_public_service_reviews_v159(uuid) to anon,authenticated;
alter function public.get_public_service_reviews_v159(uuid) owner to postgres;

commit;
