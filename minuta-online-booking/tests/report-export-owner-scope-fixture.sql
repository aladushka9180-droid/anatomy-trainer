-- Synthetic empty-database fixture. Never run against an existing project database.
create schema auth;
create role authenticated nologin;
create role anon nologin;
create role service_role nologin;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function public.normalize_client_phone(value text) returns text language sql immutable as $$
  select case when length(regexp_replace(coalesce(value,''),'[^0-9]','','g'))=11
    then '7'||right(regexp_replace(value,'[^0-9]','','g'),10)
    else regexp_replace(coalesce(value,''),'[^0-9]','','g') end
$$;
create table public.organizations(id uuid primary key,status text not null);
create table public.organization_memberships(organization_id uuid,user_id uuid,role text,active boolean);
create table public.locations(id uuid primary key,organization_id uuid,active boolean);
create table public.services(id uuid primary key,name text,price_rub integer,duration_minutes integer);
create table public.bookings(
  id uuid primary key,organization_id uuid,location_id uuid,booking_code text,service_id uuid,
  performer_id uuid,client_account_id uuid,client_name text,client_phone text,booking_date date,booking_time time,
  duration_minutes integer,original_price_rub integer,total_price_rub integer,status text,created_at timestamptz,
  reschedule_count integer,deposit_amount_rub integer,payment_status text,booking_source text,
  created_by_user_id uuid,created_by_role text
);
create table public.booking_outcomes(
  booking_id uuid,visit_status text,completed_performer_id uuid,payment_method text,amount_rub integer,
  actual_duration_minutes integer,calculated_amount_rub integer,completion_source text
);
create table public.booking_session_items(
  id uuid primary key,booking_id uuid,item_kind text,service_id uuid,title text,
  position integer,duration_minutes integer,price_rub integer,extends_duration boolean
);
create table public.organization_imported_booking_history(
  id uuid primary key,organization_id uuid,performer_id uuid,normalized_phone text,display_phone text,
  booking_date date,booking_time time,duration_minutes integer,client_name text,price_rub integer,
  source_provider_name text,source_note text,service_name text
);
insert into public.organizations values
  ('00000000-0000-4000-8000-000000000001','active'),
  ('00000000-0000-4000-8000-000000000002','active');
insert into public.organization_memberships values
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','owner',true),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012','admin',true),
  ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000013','specialist',true),
  ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000014','owner',true);
insert into public.locations values
  ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',true),
  ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001',true),
  ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000002',true);
insert into public.services values ('00000000-0000-4000-8000-000000000031','Синтетическая услуга',1000,40);
insert into public.bookings(id,organization_id,location_id,booking_code,service_id,performer_id,client_name,client_phone,
  booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,created_at,reschedule_count,
  deposit_amount_rub,payment_status,booking_source,created_by_role) values
  ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021',
    'A','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000013','Синтетический клиент A','+7 (900) 111-22-33',
    '2026-08-20','10:00',40,1000,1000,'confirmed','2026-08-01',0,0,'paid','provider_manual','specialist'),
  ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021',
    'B','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000013','Синтетический клиент A','+7 (900) 111-22-33',
    '2026-09-02','10:00',40,1000,1000,'confirmed','2026-09-01',0,0,'paid','provider_manual','specialist'),
  ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000022',
    'C','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000013','Синтетический клиент B','+7 (900) 444-55-66',
    '2026-09-03','11:00',40,1000,1000,'confirmed','2026-09-01',0,0,'paid','provider_manual','specialist'),
  ('00000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000023',
    'D','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000014','Синтетический клиент X','+7 (900) 777-88-99',
    '2026-09-04','12:00',40,1000,1000,'confirmed','2026-09-01',0,0,'paid','provider_manual','owner');
insert into public.booking_outcomes(booking_id,visit_status,completed_performer_id,payment_method,amount_rub,actual_duration_minutes,calculated_amount_rub,completion_source)
select id,'completed',performer_id,'cash',1000,40,1000,'manual' from public.bookings;
insert into public.booking_session_items
select id,id,'primary',service_id,'Синтетическая услуга',1,40,1000,true from public.bookings;
insert into public.organization_imported_booking_history values
  ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000013',
    '79001112233','+7 (900) 111-22-33','2026-09-05','13:00',40,'Синтетический клиент A',1000,'Тестовый источник','','Синтетическая услуга'),
  ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000013',
    '79008889900','+7 (900) 888-99-00','2026-09-06','14:00',40,'Синтетический клиент C',1000,'Тестовый источник','','Синтетическая услуга');
