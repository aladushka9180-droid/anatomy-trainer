-- EMPTY SYNTHETIC DATABASE ONLY. Minimal surrounding schemas; actual inventory,
-- finance, sale and refund definitions are installed by the scoped harness.
create table public.sales_catalog_synthetic_fixture_marker(marker text primary key check(marker='sales-catalog-candidate-empty-synthetic'));
insert into public.sales_catalog_synthetic_fixture_marker values('sales-catalog-candidate-empty-synthetic');
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end $$;
create function auth.uid() returns uuid language sql stable as
  $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to authenticated,anon,service_role;
create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key,name text not null default 'Synthetic',public_slug text,status text not null default 'active');
create table public.organization_memberships(organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),role text not null,active boolean not null,is_bookable boolean not null default true,
  primary key(organization_id,user_id));
create function public.has_organization_role(p_organization uuid,p_roles text[]) returns boolean
language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_memberships
  where organization_id=p_organization and user_id=auth.uid() and active and role=any(p_roles))$$;
create function public.touch_minuta_organization_updated_at() returns trigger language plpgsql as $$begin new.updated_at:=now();return new;end $$;
create table public.locations(id uuid primary key,organization_id uuid not null references public.organizations(id),name text,
  timezone text default 'UTC',active boolean default true,is_primary boolean default true,unique(id,organization_id));
create table public.services(id uuid primary key,performer_id uuid references auth.users(id),name text,active boolean default true);
create table public.performer_profiles(id uuid primary key references auth.users(id),display_name text);
create table public.bookings(id uuid primary key,organization_id uuid not null references public.organizations(id),
  location_id uuid references public.locations(id),client_account_id uuid,performer_id uuid references auth.users(id),
  service_id uuid references public.services(id),client_name text,client_phone text,booking_date date default current_date,
  booking_time time default '10:00',created_at timestamptz default now(),status text default 'confirmed',
  payment_status text default 'not_required',deposit_amount_rub integer default 0);
create table public.booking_outcomes(booking_id uuid primary key references public.bookings(id),visit_status text,
  payment_method text,amount_rub integer,calculated_amount_rub integer,completion_source text,updated_at timestamptz);
create table public.payments(id uuid primary key default gen_random_uuid(),booking_id uuid references public.bookings(id),status text);
create table public.payment_provider_attempts(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),
  booking_id uuid references public.bookings(id),captured_amount_minor bigint default 0);
create table public.organization_benefit_settings(organization_id uuid primary key references public.organizations(id),enabled boolean default false);
create table public.benefit_products(id uuid primary key default gen_random_uuid(),organization_id uuid,name text,kind text,sale_price_rub integer,
  active boolean default true,unique(id,organization_id));
create table public.client_benefit_instruments(id uuid primary key default gen_random_uuid(),organization_id uuid,product_id uuid,client_account_id uuid,status text,
  unique(id,organization_id));
create table public.benefit_redemptions(id uuid primary key,instrument_id uuid,status text);
create table public.financial_expense_sources(id uuid primary key,organization_id uuid,unique(id,organization_id));
create table public.financial_suppliers(id uuid primary key,organization_id uuid,name text,unique(id,organization_id));
-- Unused finance/benefit prerequisites are explicit placeholders, never called
-- to claim full benefits or supplier integration proof.
create function public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid) returns jsonb language plpgsql as $$
declare v uuid;begin insert into public.client_benefit_instruments(organization_id,product_id,client_account_id,status)
values($1,$2,$3,'active') returning id into v;return jsonb_build_object('id',v);end $$;
create function public.set_minuta_benefit_status(uuid,uuid,text) returns void language sql as $$
update public.client_benefit_instruments set status=$3 where organization_id=$1 and id=$2$$;
create function public.create_minuta_financial_supplier_v132(uuid,uuid,text) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.accrue_minuta_supplier_expense_v132(uuid,uuid,uuid,bigint,timestamptz,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.pay_minuta_supplier_expense_v132(uuid,uuid,uuid,uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
