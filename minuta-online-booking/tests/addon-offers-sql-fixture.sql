-- Synthetic disposable schema only. Not a full production schema or restore.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
create extension btree_gist;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public.performer_profiles(id uuid primary key);
create table public.organizations(id uuid primary key,public_slug text unique);
create table public.locations(id uuid primary key,organization_id uuid);
create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean);
create table public.services(id uuid primary key,performer_id uuid references performer_profiles(id),name text,duration_minutes integer,price_rub integer,active boolean default true);
create table public.provider_schedule(performer_id uuid,weekday integer,start_time time,end_time time,enabled boolean,break_start time,break_end time);
create table public.provider_days_off(performer_id uuid,off_date date,all_day boolean,start_time time,end_time time);
create table public.group_booking_events(organization_id uuid,location_id uuid,performer_id uuid,event_date date,status text,start_time time,duration_minutes integer);
create table public.bookings(
 id uuid primary key default gen_random_uuid(),request_id uuid unique,performer_id uuid,organization_id uuid,location_id uuid,service_id uuid,
 booking_date date,booking_time time,duration_minutes integer,status text default 'confirmed',booking_code text default 'synthetic',manage_token uuid default gen_random_uuid(),
 client_phone text,client_name text,provider_note text,original_price_rub integer,total_price_rub integer,
 unique(id,organization_id,location_id)
);
create table public.booking_session_items(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id) on delete cascade,performer_id uuid,
 position integer check(position between 1 and 20),item_kind text check(item_kind in('primary','addon')),service_id uuid,title text,
 duration_minutes integer check(duration_minutes between 0 and 480),price_rub integer check(price_rub between 0 and 1000000),extends_duration boolean,
 unique(booking_id,position));
create table public.booking_session_revisions(id uuid primary key default gen_random_uuid(),booking_id uuid,performer_id uuid,items jsonb,total_price_rub integer,total_duration_minutes integer);
create table public.resource_groups(id uuid primary key,organization_id uuid,active boolean);
create table public.resources(id uuid primary key,organization_id uuid,location_id uuid,group_id uuid references resource_groups(id),active boolean,unique(id,organization_id,location_id));
create table public.service_resource_requirements(organization_id uuid,service_id uuid,group_id uuid,quantity integer,active boolean,updated_at timestamptz default now(),unique(organization_id,service_id,group_id));
create table public.booking_resource_allocations(booking_id uuid,resource_id uuid,organization_id uuid,location_id uuid,starts_at timestamp,ends_at timestamp,booking_status text,
 created_at timestamptz default now(),updated_at timestamptz default now(),primary key(booking_id,resource_id),check(starts_at<ends_at),
 foreign key(booking_id,organization_id,location_id) references bookings(id,organization_id,location_id),
 foreign key(resource_id,organization_id,location_id) references resources(id,organization_id,location_id),
 exclude using gist(resource_id with =,tsrange(starts_at,ends_at,'[)') with &&) where(booking_status='active'));
-- These three upstream seams are synthetic. Resource and session triggers are
-- loaded unchanged from existing v69/v53 source by the runner.
create function public.get_public_minuta_catalog_v5(p_slug text) returns jsonb language sql stable security definer as $$
 select jsonb_build_object('locations',coalesce((select jsonb_agg(jsonb_build_object('id',l.id)) from public.locations l where l.organization_id=o.id),'[]'::jsonb),
 'services',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'location_ids',(select jsonb_agg(l.id) from public.locations l where l.organization_id=o.id))) from public.services s where s.active),'[]'::jsonb))
 from public.organizations o where public_slug=p_slug $$;
create function public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time,integer) returns boolean language sql stable as $$select true$$;
create function public.minuta_slot_respects_booking_buffer(uuid,date,time,integer,uuid) returns boolean language sql stable as $$select true$$;
create function public.require_minuta_resource_manager(uuid) returns void language plpgsql as $$begin if auth.uid()<>'10000000-0000-0000-0000-000000000001'::uuid then raise exception 'fixture_denied';end if;end$$;
create function public.write_minuta_resource_audit(uuid,text,uuid,jsonb) returns void language plpgsql as $$begin return;end$$;
create function public.get_minuta_resource_workspace(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date) returns table(booking_date date,booking_time time) language sql stable as $$
 select d::date,t::time from generate_series($4::timestamp,$5::timestamp,'1 day') d cross join generate_series('2000-01-01 08:00'::timestamp,'2000-01-01 19:00'::timestamp,'30 minutes') t $$;
create function public.book_minuta_appointment_v3(uuid,text,uuid,uuid,date,time,text,text,integer,integer,text)
 returns table(result_code text) language plpgsql security definer as $$
 declare owner_id uuid; org_id uuid;
 begin
 select performer_id into owner_id from public.services where id=$4;
 select id into org_id from public.organizations where public_slug=$2;
 insert into public.bookings(request_id,performer_id,organization_id,location_id,service_id,booking_date,booking_time,duration_minutes,client_name,client_phone,provider_note,original_price_rub,total_price_rub)
 values($1,owner_id,org_id,$3,$4,$5,$6,$10,$7,$8,$11,$9,$9);
 return query select 'ok'::text;
 end $$;
insert into public.performer_profiles values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into public.organizations values('20000000-0000-0000-0000-000000000001','synthetic-offers');
insert into public.organization_memberships values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true);
insert into public.locations values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.services values
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Основная услуга',60,2000,true),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Дополнительная услуга',30,501,true),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Поминутная услуга',1,20,true),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','Чужая услуга',30,500,true),
 ('40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','Другая допуслуга',30,300,true);
insert into public.provider_schedule select '10000000-0000-0000-0000-000000000001',n,'08:00','20:00',true,null,null from generate_series(1,7) n;
insert into public.resource_groups values('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',true),('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001',true);
insert into public.resources values('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',true),
 ('60000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002',true);
insert into public.service_resource_requirements(organization_id,service_id,group_id,quantity,active) values('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,true),
 ('20000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',1,true);
