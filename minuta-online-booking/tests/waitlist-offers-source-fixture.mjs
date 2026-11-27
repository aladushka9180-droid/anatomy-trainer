// Synthetic application seam only; no original-source restore authority.
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actor=id(1),org=id(2),loc=id(3),service=id(4),request=id(5),token=id(6),offer=id(7);
const scaffold=`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table public.organizations(id uuid primary key,public_slug text);
create table public.services(id uuid primary key,performer_id uuid,price_rub integer,duration_minutes integer,active boolean);
create table public.fixture_members(org uuid,user_id uuid,role text,active boolean);
create function public.has_organization_role(p_org uuid,p_roles text[]) returns boolean language sql stable security definer as $$
select exists(select 1 from public.fixture_members where org=p_org and user_id=auth.uid() and active and role=any(p_roles))$$;
create function public.is_organization_member(p_org uuid) returns boolean language sql stable security definer as $$
select exists(select 1 from public.fixture_members where org=p_org and user_id=auth.uid() and active)$$;
create table public.organization_waitlist_requests(id uuid primary key,organization_id uuid,location_id uuid,
performer_id uuid,service_id uuid,manage_token uuid unique,client_name text,client_phone text,desired_date date,
time_period text,status text,updated_at timestamptz default now());
alter table public.organization_waitlist_requests enable row level security;
grant select on public.organization_waitlist_requests to authenticated;
create policy fixture_request_read on public.organization_waitlist_requests for select to authenticated using (
has_organization_role(organization_id,array['owner','admin']) or (performer_id=auth.uid() and is_organization_member(organization_id)));
create function public.set_minuta_waitlist_status_v111(uuid,text) returns text language sql as $$select 'legacy-preserved'::text$$;
create table public.fixture_slots(organization_slug text,location_id uuid,service_id uuid,day date,time time,available boolean);
create function public.get_public_minuta_available_slots_v101(text,uuid,uuid,date,date)
returns table(booking_date date,booking_time time) language sql stable security definer as $$
select day,time from public.fixture_slots where organization_slug=$1 and location_id=$2 and service_id=$3 and day between $4 and $5 and available$$;
create table public.bookings(id uuid primary key default gen_random_uuid(),request_id uuid unique,
organization_id uuid,location_id uuid,service_id uuid,performer_id uuid,booking_date date,booking_time time,
duration_minutes integer,original_price_rub integer,total_price_rub integer,booking_code text,
manage_token uuid default gen_random_uuid(),status text);
create function public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time,text,text,integer,integer)
returns table(result_code text,booking_code text,manage_token uuid,request_id uuid,service_id uuid,booking_date date,
booking_time time,duration_minutes integer,original_price_rub integer,total_price_rub integer,status text,
current_price_rub integer,current_duration_minutes integer)
language plpgsql security definer as $$declare b public.bookings%rowtype; mode text:=current_setting('fixture.booking_mode',true);begin
if mode='busy' then raise exception using errcode='23P01',message='slot_unavailable';end if;
if mode='buffer' then raise exception 'booking_buffer_conflict';end if;
if mode='unknown' then raise exception 'unrelated_source_failure';end if;
if mode='unknown_exclusion' then raise exception using errcode='23P01',message='unrelated_exclusion_failure';end if;
if mode='zero_ack' then return;end if;
if mode='changed' then return query select 'service_terms_changed'::text,null::text,null::uuid,$1,$4,$5,$6,null::integer,null::integer,null::integer,null::text,2000,90;return;end if;
select * into b from public.bookings where bookings.request_id=$1;
if not found then
 insert into public.bookings(request_id,organization_id,location_id,service_id,performer_id,booking_date,booking_time,
 duration_minutes,original_price_rub,total_price_rub,booking_code,status)
 values($1,'${org}',$3,$4,'${actor}',$5,$6,$10,$9,$9,'FIXTURE-'||$1::text,'new') returning * into b;
 update public.fixture_slots fs set available=false where fs.organization_slug=$2 and fs.location_id=$3 and fs.service_id=$4 and fs.day=$5 and fs.time=$6;
end if;
return query select 'ok'::text,case when mode='bad_ack' then 'BAD' else b.booking_code end,b.manage_token,
b.request_id,b.service_id,b.booking_date,b.booking_time,b.duration_minutes,b.original_price_rub,b.total_price_rub,b.status,b.total_price_rub,b.duration_minutes;
if mode='multiple_ack' then return query select 'ok'::text,b.booking_code,b.manage_token,b.request_id,b.service_id,b.booking_date,b.booking_time,b.duration_minutes,b.original_price_rub,b.total_price_rub,b.status,b.total_price_rub,b.duration_minutes;end if;
end$$;
insert into public.organizations values('${org}','fixture-org');
insert into public.services values('${service}','${actor}',1500,60,true);
insert into public.fixture_members values('${org}','${actor}','specialist',true);
insert into public.organization_waitlist_requests values('${request}','${org}','${loc}','${actor}','${service}',
'${token}','Synthetic client','79990000000',current_date+1,'any','waiting',now());
insert into public.fixture_slots values('fixture-org','${loc}','${service}',current_date+1,'10:00',true);
`;
export {id,actor,org,loc,service,request,token,offer,scaffold};
