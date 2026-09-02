begin;

set local search_path = public, extensions, pg_catalog;

do $$ begin
  if to_regclass('public.organization_payroll_settings') is null
     or to_regprocedure('public.get_minuta_payroll_workspace(uuid,date,date)') is null
     or to_regclass('public.client_accounts') is null
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='bookings' and column_name='client_account_id') then
    raise exception using errcode='P0001',message='v73_requires_v72_and_client_accounts';
  end if;
end $$;

create table if not exists public.organization_benefit_settings (
  organization_id uuid primary key references public.organizations(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz,
  enabled_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.benefit_products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check(char_length(name) between 2 and 120),
  kind text not null check(kind in ('visit_pass','certificate','package')),
  sale_price_rub integer not null default 0 check(sale_price_rub between 0 and 10000000),
  face_value_rub integer not null default 0 check(face_value_rub between 0 and 10000000),
  visits_count integer not null default 0 check(visits_count between 0 and 10000),
  validity_days integer not null check(validity_days between 1 and 3650),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  check((kind='certificate' and face_value_rub>0 and visits_count=0)
     or (kind in ('visit_pass','package') and visits_count>0 and face_value_rub=0))
);

create table if not exists public.benefit_product_services (
  product_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  included_units integer not null default 1 check(included_units between 1 and 10000),
  primary key(product_id,service_id),
  foreign key(product_id,organization_id) references public.benefit_products(id,organization_id) on delete cascade
);

create table if not exists public.client_benefit_instruments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  product_id uuid not null,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  request_id uuid not null,
  public_code text not null unique check(char_length(public_code) between 8 and 40),
  status text not null default 'active' check(status in ('active','frozen','exhausted','expired','cancelled')),
  product_snapshot jsonb not null,
  remaining_amount_rub integer not null default 0 check(remaining_amount_rub between 0 and 10000000),
  remaining_visits integer not null default 0 check(remaining_visits between 0 and 10000),
  issued_at timestamptz not null default now(),
  expires_on date not null,
  issued_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  unique(organization_id,request_id),
  foreign key(product_id,organization_id) references public.benefit_products(id,organization_id) on delete restrict
);

create index if not exists client_benefit_instruments_scope_idx
  on public.client_benefit_instruments(organization_id,client_account_id,status,expires_on);

create table if not exists public.benefit_instrument_service_balances (
  instrument_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  initial_units integer not null check(initial_units between 1 and 10000),
  remaining_units integer not null check(remaining_units between 0 and initial_units),
  primary key(instrument_id,service_id),
  foreign key(instrument_id,organization_id) references public.client_benefit_instruments(id,organization_id) on delete restrict
);

create table if not exists public.benefit_redemptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  instrument_id uuid not null,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  service_id uuid not null references public.services(id) on delete restrict,
  units integer not null default 0 check(units between 0 and 10000),
  amount_rub integer not null default 0 check(amount_rub between 0 and 10000000),
  status text not null check(status in ('reserved','redeemed','released')),
  reserved_at timestamptz not null default now(),
  redeemed_at timestamptz,
  released_at timestamptz,
  acted_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique(id,organization_id),
  foreign key(instrument_id,organization_id) references public.client_benefit_instruments(id,organization_id) on delete restrict,
  check((units>0 and amount_rub=0) or (amount_rub>0 and units=0))
);

create unique index if not exists benefit_redemptions_booking_active_idx
  on public.benefit_redemptions(booking_id) where status in ('reserved','redeemed');

create table if not exists public.benefit_ledger (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  instrument_id uuid not null,
  redemption_id uuid,
  event_type text not null check(event_type in ('issued','reserved','redeemed','released','frozen','activated','cancelled')),
  amount_delta_rub integer not null default 0,
  visits_delta integer not null default 0,
  amount_balance_rub integer not null check(amount_balance_rub>=0),
  visits_balance integer not null check(visits_balance>=0),
  details jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(instrument_id,organization_id) references public.client_benefit_instruments(id,organization_id) on delete restrict,
  foreign key(redemption_id,organization_id) references public.benefit_redemptions(id,organization_id) on delete restrict
);

create index if not exists benefit_ledger_scope_idx on public.benefit_ledger(organization_id,instrument_id,id desc);

create table if not exists public.benefit_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check(char_length(action) between 1 and 80),
  subject_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists benefit_audit_scope_idx on public.benefit_audit_log(organization_id,created_at desc,id desc);

create or replace function public.enforce_minuta_benefit_scope()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if tg_table_name in ('benefit_product_services','benefit_instrument_service_balances') then
    if not exists(select 1 from public.services service join public.organization_memberships membership
      on membership.organization_id=new.organization_id and membership.user_id=service.performer_id and membership.active and membership.is_bookable
      where service.id=new.service_id) then
      raise exception using errcode='23514',message='benefit_service_scope_mismatch';
    end if;
  elsif tg_table_name='client_benefit_instruments' then
    if not exists(select 1 from public.bookings booking where booking.organization_id=new.organization_id and booking.client_account_id=new.client_account_id) then
      raise exception using errcode='23514',message='benefit_client_scope_mismatch';
    end if;
  elsif tg_table_name='benefit_redemptions' then
    if not exists(select 1 from public.bookings booking join public.client_benefit_instruments instrument
      on instrument.id=new.instrument_id and instrument.organization_id=new.organization_id
      and instrument.client_account_id=booking.client_account_id
      where booking.id=new.booking_id and booking.organization_id=new.organization_id and booking.service_id=new.service_id) then
      raise exception using errcode='23514',message='benefit_redemption_scope_mismatch';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists benefit_product_services_scope on public.benefit_product_services;
create trigger benefit_product_services_scope before insert or update on public.benefit_product_services for each row execute function public.enforce_minuta_benefit_scope();
drop trigger if exists benefit_instrument_service_balances_scope on public.benefit_instrument_service_balances;
create trigger benefit_instrument_service_balances_scope before insert or update on public.benefit_instrument_service_balances for each row execute function public.enforce_minuta_benefit_scope();
drop trigger if exists client_benefit_instruments_scope on public.client_benefit_instruments;
create trigger client_benefit_instruments_scope before insert or update of organization_id,client_account_id on public.client_benefit_instruments for each row execute function public.enforce_minuta_benefit_scope();
drop trigger if exists benefit_redemptions_scope on public.benefit_redemptions;
create trigger benefit_redemptions_scope before insert or update of organization_id,instrument_id,booking_id,service_id on public.benefit_redemptions for each row execute function public.enforce_minuta_benefit_scope();

alter table public.organization_benefit_settings enable row level security;
alter table public.benefit_products enable row level security;
alter table public.benefit_product_services enable row level security;
alter table public.client_benefit_instruments enable row level security;
alter table public.benefit_instrument_service_balances enable row level security;
alter table public.benefit_redemptions enable row level security;
alter table public.benefit_ledger enable row level security;
alter table public.benefit_audit_log enable row level security;

do $$ declare v_table text;
begin
  foreach v_table in array array['organization_benefit_settings','benefit_products','benefit_product_services','client_benefit_instruments','benefit_instrument_service_balances','benefit_redemptions','benefit_ledger','benefit_audit_log'] loop
    execute format('drop policy if exists benefit_manager_read on public.%I',v_table);
    execute format('create policy benefit_manager_read on public.%I for select to authenticated using (public.has_organization_role(organization_id,array[''owner'',''admin'']))',v_table);
  end loop;
end $$;

revoke all on public.organization_benefit_settings,public.benefit_products,public.benefit_product_services,
  public.client_benefit_instruments,public.benefit_instrument_service_balances,public.benefit_redemptions,
  public.benefit_ledger,public.benefit_audit_log from public,anon,authenticated;
grant select on public.organization_benefit_settings,public.benefit_products,public.benefit_product_services,
  public.client_benefit_instruments,public.benefit_instrument_service_balances,public.benefit_redemptions,
  public.benefit_ledger,public.benefit_audit_log to authenticated;
grant all on public.organization_benefit_settings,public.benefit_products,public.benefit_product_services,
  public.client_benefit_instruments,public.benefit_instrument_service_balances,public.benefit_redemptions,
  public.benefit_ledger,public.benefit_audit_log to service_role;

drop trigger if exists organization_benefit_settings_touch on public.organization_benefit_settings;
create trigger organization_benefit_settings_touch before update on public.organization_benefit_settings
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists benefit_products_touch on public.benefit_products;
create trigger benefit_products_touch before update on public.benefit_products
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists client_benefit_instruments_touch on public.client_benefit_instruments;
create trigger client_benefit_instruments_touch before update on public.client_benefit_instruments
for each row execute function public.touch_minuta_organization_updated_at();
drop trigger if exists benefit_redemptions_touch on public.benefit_redemptions;
create trigger benefit_redemptions_touch before update on public.benefit_redemptions
for each row execute function public.touch_minuta_organization_updated_at();

create or replace function public.get_minuta_benefit_role(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role not in ('owner','admin') then raise exception using errcode='42501',message='benefit_management_denied'; end if;
  return v_role;
end $$;
revoke all on function public.get_minuta_benefit_role(uuid) from public,anon,authenticated,service_role;

create or replace function public.write_minuta_benefit_audit(p_organization uuid,p_action text,p_subject uuid,p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path to '' as $$
  insert into public.benefit_audit_log(organization_id,actor_id,action,subject_id,details)
  values(p_organization,auth.uid(),p_action,p_subject,coalesce(p_details,'{}'::jsonb));
$$;
revoke all on function public.write_minuta_benefit_audit(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.protect_minuta_benefit_ledger()
returns trigger language plpgsql set search_path to '' as $$
begin raise exception using errcode='55000',message='benefit_ledger_immutable'; end $$;
drop trigger if exists benefit_ledger_immutable on public.benefit_ledger;
create trigger benefit_ledger_immutable before update or delete on public.benefit_ledger
for each row execute function public.protect_minuta_benefit_ledger();

create or replace function public.set_minuta_benefits_enabled(p_organization uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if v_role<>'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_enabled is null then raise exception using errcode='22023',message='invalid_benefit_enabled'; end if;
  insert into public.organization_benefit_settings(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set enabled=excluded.enabled,
    enabled_at=case when excluded.enabled then coalesce(public.organization_benefit_settings.enabled_at,now()) end,
    enabled_by=case when excluded.enabled then coalesce(public.organization_benefit_settings.enabled_by,auth.uid()) end;
  perform public.write_minuta_benefit_audit(p_organization,'benefits_enabled_changed',p_organization,jsonb_build_object('enabled',p_enabled));
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled);
end $$;
revoke all on function public.set_minuta_benefits_enabled(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_benefits_enabled(uuid,boolean) to authenticated;

create or replace function public.upsert_minuta_benefit_product(
  p_organization uuid,p_product uuid,p_name text,p_kind text,p_sale_price_rub integer,
  p_face_value_rub integer,p_visits_count integer,p_validity_days integer,p_services jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_product uuid; v_service jsonb; v_units integer:=0;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='benefits_disabled';
  end if;
  if nullif(trim(p_name),'') is null or p_kind not in ('visit_pass','certificate','package')
     or p_sale_price_rub is null or p_sale_price_rub not between 0 and 10000000
     or p_validity_days is null or p_validity_days not between 1 and 3650
     or jsonb_typeof(coalesce(p_services,'[]'::jsonb))<>'array'
     or (p_kind='certificate' and (coalesce(p_face_value_rub,0)<=0 or coalesce(p_visits_count,0)<>0))
     or (p_kind<>'certificate' and (coalesce(p_visits_count,0)<=0 or coalesce(p_face_value_rub,0)<>0)) then
    raise exception using errcode='22023',message='invalid_benefit_product';
  end if;
  for v_service in select value from jsonb_array_elements(coalesce(p_services,'[]'::jsonb)) loop
    if not (v_service?'service_id') or not (v_service?'units')
       or (v_service->>'units')::integer not between 1 and 10000
       or not exists(select 1 from public.services service join public.organization_memberships membership
          on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable
          where service.id=(v_service->>'service_id')::uuid) then
      raise exception using errcode='22023',message='invalid_benefit_product_service';
    end if;
    v_units:=v_units+(v_service->>'units')::integer;
  end loop;
  if p_kind='package' and v_units<>p_visits_count then
    raise exception using errcode='22023',message='package_units_mismatch';
  end if;
  if p_product is null then
    insert into public.benefit_products(organization_id,name,kind,sale_price_rub,face_value_rub,visits_count,validity_days,created_by)
    values(p_organization,trim(p_name),p_kind,p_sale_price_rub,coalesce(p_face_value_rub,0),coalesce(p_visits_count,0),p_validity_days,auth.uid()) returning id into v_product;
  else
    update public.benefit_products set name=trim(p_name),kind=p_kind,sale_price_rub=p_sale_price_rub,
      face_value_rub=coalesce(p_face_value_rub,0),visits_count=coalesce(p_visits_count,0),validity_days=p_validity_days,active=true
    where id=p_product and organization_id=p_organization returning id into v_product;
    if v_product is null then raise exception using errcode='P0002',message='benefit_product_not_found'; end if;
    delete from public.benefit_product_services where product_id=v_product;
  end if;
  insert into public.benefit_product_services(product_id,organization_id,service_id,included_units)
  select v_product,p_organization,(item->>'service_id')::uuid,(item->>'units')::integer
  from jsonb_array_elements(coalesce(p_services,'[]'::jsonb)) item
  on conflict(product_id,service_id) do update set included_units=excluded.included_units;
  perform public.write_minuta_benefit_audit(p_organization,'benefit_product_saved',v_product,jsonb_build_object('kind',p_kind));
  return jsonb_build_object('id',v_product,'organization_id',p_organization);
end $$;
revoke all on function public.upsert_minuta_benefit_product(uuid,uuid,text,text,integer,integer,integer,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upsert_minuta_benefit_product(uuid,uuid,text,text,integer,integer,integer,integer,jsonb) to authenticated;

create or replace function public.issue_minuta_benefit(p_organization uuid,p_product uuid,p_client_account uuid,p_expires_on date,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_product public.benefit_products%rowtype; v_existing public.client_benefit_instruments%rowtype; v_instrument uuid; v_code text; v_expiry date;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='benefits_disabled'; end if;
  if p_request_id is null then raise exception using errcode='22023',message='benefit_request_id_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,7301));
  select * into v_existing from public.client_benefit_instruments where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.product_id<>p_product or v_existing.client_account_id<>p_client_account then
      raise exception using errcode='23505',message='benefit_request_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,'public_code',v_existing.public_code,'expires_on',v_existing.expires_on);
  end if;
  select * into v_product from public.benefit_products where id=p_product and organization_id=p_organization and active;
  if v_product.id is null then raise exception using errcode='P0002',message='benefit_product_not_found'; end if;
  if not exists(select 1 from public.bookings where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='benefit_client_not_in_organization';
  end if;
  v_expiry:=coalesce(p_expires_on,current_date+v_product.validity_days);
  if v_expiry<current_date or v_expiry>current_date+3650 then raise exception using errcode='22023',message='invalid_benefit_expiry'; end if;
  v_code:='MIN-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
  insert into public.client_benefit_instruments(organization_id,product_id,client_account_id,request_id,public_code,product_snapshot,
    remaining_amount_rub,remaining_visits,expires_on,issued_by)
  values(p_organization,p_product,p_client_account,p_request_id,v_code,jsonb_build_object('name',v_product.name,'kind',v_product.kind,
    'sale_price_rub',v_product.sale_price_rub,'face_value_rub',v_product.face_value_rub,'visits_count',v_product.visits_count,
    'validity_days',v_product.validity_days,'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',link.service_id,'units',link.included_units) order by link.service_id) from public.benefit_product_services link where link.product_id=p_product),'[]'::jsonb)),v_product.face_value_rub,v_product.visits_count,v_expiry,auth.uid()) returning id into v_instrument;
  if v_product.kind='package' then
    insert into public.benefit_instrument_service_balances(instrument_id,organization_id,service_id,initial_units,remaining_units)
    select v_instrument,p_organization,service_id,included_units,included_units from public.benefit_product_services where product_id=p_product;
  end if;
  insert into public.benefit_ledger(organization_id,instrument_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
  values(p_organization,v_instrument,'issued',v_product.face_value_rub,v_product.visits_count,v_product.face_value_rub,v_product.visits_count,auth.uid());
  perform public.write_minuta_benefit_audit(p_organization,'benefit_issued',v_instrument,jsonb_build_object('product_id',p_product,'expires_on',v_expiry));
  return jsonb_build_object('id',v_instrument,'organization_id',p_organization,'public_code',v_code,'expires_on',v_expiry);
end $$;
revoke all on function public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid) from public,anon,authenticated,service_role;
grant execute on function public.issue_minuta_benefit(uuid,uuid,uuid,date,uuid) to authenticated;

create or replace function public.set_minuta_benefit_status(p_organization uuid,p_instrument uuid,p_status text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_old text; v_amount integer; v_visits integer;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select status,remaining_amount_rub,remaining_visits into v_old,v_amount,v_visits from public.client_benefit_instruments
  where id=p_instrument and organization_id=p_organization for update;
  if v_old is null then raise exception using errcode='P0002',message='benefit_instrument_not_found'; end if;
  if p_status not in ('active','frozen','cancelled') or v_old in ('exhausted','expired','cancelled') then
    raise exception using errcode='55000',message='invalid_benefit_status_transition';
  end if;
  if p_status='cancelled' and exists(select 1 from public.benefit_redemptions where instrument_id=p_instrument and status='reserved') then
    raise exception using errcode='55000',message='release_reserved_benefits_before_cancel';
  end if;
  update public.client_benefit_instruments set status=p_status where id=p_instrument;
  insert into public.benefit_ledger(organization_id,instrument_id,event_type,amount_balance_rub,visits_balance,actor_id,details)
  values(p_organization,p_instrument,case p_status when 'active' then 'activated' when 'frozen' then 'frozen' else 'cancelled' end,
    v_amount,v_visits,auth.uid(),jsonb_build_object('from',v_old,'to',p_status));
  perform public.write_minuta_benefit_audit(p_organization,'benefit_status_changed',p_instrument,jsonb_build_object('from',v_old,'to',p_status));
  return jsonb_build_object('id',p_instrument,'organization_id',p_organization,'status',p_status);
end $$;
revoke all on function public.set_minuta_benefit_status(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_benefit_status(uuid,uuid,text) to authenticated;

create or replace function public.apply_minuta_benefit(
  p_organization uuid,p_instrument uuid,p_booking uuid,p_action text,p_amount_rub integer default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_role text; v_instrument public.client_benefit_instruments%rowtype; v_booking public.bookings%rowtype;
  v_kind text; v_redemption uuid; v_units integer:=0; v_amount integer:=0; v_service_remaining integer;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  if not coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false) then raise exception using errcode='55000',message='benefits_disabled'; end if;
  if p_action not in ('reserve','redeem','release') then raise exception using errcode='22023',message='invalid_benefit_action'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_instrument::text,7300));
  select * into v_instrument from public.client_benefit_instruments where id=p_instrument and organization_id=p_organization for update;
  select * into v_booking from public.bookings where id=p_booking and organization_id=p_organization for update;
  if v_instrument.id is null or v_booking.id is null then raise exception using errcode='P0002',message='benefit_or_booking_not_found'; end if;
  if v_instrument.client_account_id is distinct from v_booking.client_account_id then raise exception using errcode='42501',message='benefit_client_mismatch'; end if;
  v_kind:=v_instrument.product_snapshot->>'kind';
  if p_action='reserve' then
    if v_booking.status='cancelled' or v_instrument.status<>'active'
       or current_date>v_instrument.expires_on or v_booking.booking_date>v_instrument.expires_on then
      raise exception using errcode='55000',message='benefit_not_available';
    end if;
    select id into v_redemption from public.benefit_redemptions where booking_id=p_booking and status in ('reserved','redeemed');
    if v_redemption is not null then
      if exists(select 1 from public.benefit_redemptions where id=v_redemption and instrument_id=p_instrument) then
        return jsonb_build_object('id',v_redemption,'organization_id',p_organization,'status',(select status from public.benefit_redemptions where id=v_redemption));
      end if;
      raise exception using errcode='23505',message='booking_already_has_benefit';
    end if;
    if v_kind='certificate' then
      v_amount:=coalesce(p_amount_rub,least(v_instrument.remaining_amount_rub,coalesce(v_booking.total_price_rub,0)));
      if v_amount<=0 or v_amount>v_instrument.remaining_amount_rub then raise exception using errcode='55000',message='insufficient_certificate_balance'; end if;
      update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub-v_amount where id=p_instrument;
    elsif v_kind='package' then
      select remaining_units into v_service_remaining from public.benefit_instrument_service_balances where instrument_id=p_instrument and service_id=v_booking.service_id for update;
      if coalesce(v_service_remaining,0)<1 then raise exception using errcode='55000',message='package_service_exhausted'; end if;
      v_units:=1;
      update public.benefit_instrument_service_balances set remaining_units=remaining_units-1 where instrument_id=p_instrument and service_id=v_booking.service_id;
      update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=p_instrument;
    else
      if v_instrument.remaining_visits<1 or (jsonb_array_length(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb))>0
         and not exists(select 1 from jsonb_array_elements(coalesce(v_instrument.product_snapshot->'services','[]'::jsonb)) allowed
           where (allowed->>'service_id')::uuid=v_booking.service_id)) then
        raise exception using errcode='55000',message='visit_pass_not_applicable';
      end if;
      v_units:=1;
      update public.client_benefit_instruments set remaining_visits=remaining_visits-1 where id=p_instrument;
    end if;
    insert into public.benefit_redemptions(organization_id,instrument_id,booking_id,service_id,units,amount_rub,status,acted_by)
    values(p_organization,p_instrument,p_booking,v_booking.service_id,v_units,v_amount,'reserved',auth.uid()) returning id into v_redemption;
    update public.client_benefit_instruments set status=case when remaining_amount_rub=0 and remaining_visits=0 then 'exhausted' else status end where id=p_instrument;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
    select p_organization,p_instrument,v_redemption,'reserved',-v_amount,-v_units,remaining_amount_rub,remaining_visits,auth.uid() from public.client_benefit_instruments where id=p_instrument;
  elsif p_action='redeem' then
    select id into v_redemption from public.benefit_redemptions where instrument_id=p_instrument and booking_id=p_booking and status='reserved' for update;
    if v_redemption is null then raise exception using errcode='P0002',message='benefit_reservation_not_found'; end if;
    if not exists(select 1 from public.booking_outcomes where booking_id=p_booking and visit_status='completed') then raise exception using errcode='55000',message='complete_visit_before_redemption'; end if;
    update public.benefit_redemptions set status='redeemed',redeemed_at=now(),acted_by=auth.uid() where id=v_redemption;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_balance_rub,visits_balance,actor_id)
    values(p_organization,p_instrument,v_redemption,'redeemed',v_instrument.remaining_amount_rub,v_instrument.remaining_visits,auth.uid());
  else
    select id,units,amount_rub into v_redemption,v_units,v_amount from public.benefit_redemptions
    where instrument_id=p_instrument and booking_id=p_booking and status in ('reserved','redeemed') for update;
    if v_redemption is null then raise exception using errcode='P0002',message='benefit_redemption_not_found'; end if;
    if (select status from public.benefit_redemptions where id=v_redemption)='redeemed' and v_role<>'owner' then
      raise exception using errcode='42501',message='owner_required_to_release_redeemed_benefit';
    end if;
    update public.benefit_redemptions set status='released',released_at=now(),acted_by=auth.uid() where id=v_redemption;
    update public.client_benefit_instruments set remaining_amount_rub=remaining_amount_rub+v_amount,
      remaining_visits=remaining_visits+v_units,status=case when expires_on<current_date then 'expired' when status='frozen' then 'frozen' else 'active' end where id=p_instrument;
    if v_kind='package' then update public.benefit_instrument_service_balances set remaining_units=remaining_units+v_units where instrument_id=p_instrument and service_id=v_booking.service_id; end if;
    insert into public.benefit_ledger(organization_id,instrument_id,redemption_id,event_type,amount_delta_rub,visits_delta,amount_balance_rub,visits_balance,actor_id)
    select p_organization,p_instrument,v_redemption,'released',v_amount,v_units,remaining_amount_rub,remaining_visits,auth.uid() from public.client_benefit_instruments where id=p_instrument;
  end if;
  perform public.write_minuta_benefit_audit(p_organization,'benefit_'||p_action,v_redemption,jsonb_build_object('instrument_id',p_instrument,'booking_id',p_booking));
  return jsonb_build_object('id',v_redemption,'organization_id',p_organization,'status',case p_action when 'reserve' then 'reserved' when 'redeem' then 'redeemed' else 'released' end);
end $$;
revoke all on function public.apply_minuta_benefit(uuid,uuid,uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.apply_minuta_benefit(uuid,uuid,uuid,text,integer) to authenticated;

create or replace function public.get_minuta_benefit_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_benefit_role(p_organization);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.organization_benefit_settings where organization_id=p_organization),false),
    'services',coalesce((select jsonb_agg(jsonb_build_object('id',service.id,'name',service.name,'performer_id',service.performer_id) order by service.name,service.id)
      from public.services service join public.organization_memberships membership on membership.organization_id=p_organization and membership.user_id=service.performer_id and membership.active and membership.is_bookable where service.active),'[]'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object('id',client.id,'client_name',client.client_name,'client_phone',client.client_phone) order by client.client_name,client.id)
      from (select distinct on (booking.client_account_id) booking.client_account_id id,booking.client_name,booking.client_phone
        from public.bookings booking where booking.organization_id=p_organization and booking.client_account_id is not null
        order by booking.client_account_id,booking.created_at desc) client),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',booking.id,'client_account_id',booking.client_account_id,'client_name',booking.client_name,
      'service_id',booking.service_id,'service_name',service.name,'booking_date',booking.booking_date,'booking_time',booking.booking_time,'status',booking.status) order by booking.booking_date desc,booking.booking_time desc)
      from public.bookings booking join public.services service on service.id=booking.service_id where booking.organization_id=p_organization and booking.client_account_id is not null and booking.booking_date>=current_date-90 and booking.status<>'cancelled'),'[]'::jsonb),
    'products',coalesce((select jsonb_agg(jsonb_build_object('id',product.id,'name',product.name,'kind',product.kind,'sale_price_rub',product.sale_price_rub,
      'face_value_rub',product.face_value_rub,'visits_count',product.visits_count,'validity_days',product.validity_days,'active',product.active,
      'services',coalesce((select jsonb_agg(jsonb_build_object('service_id',link.service_id,'units',link.included_units) order by link.service_id) from public.benefit_product_services link where link.product_id=product.id),'[]'::jsonb)) order by product.created_at desc)
      from public.benefit_products product where product.organization_id=p_organization),'[]'::jsonb),
    'instruments',coalesce((select jsonb_agg(jsonb_build_object('id',instrument.id,'product_id',instrument.product_id,'client_account_id',instrument.client_account_id,
      'public_code',instrument.public_code,'status',instrument.status,'product_snapshot',instrument.product_snapshot,'remaining_amount_rub',instrument.remaining_amount_rub,
      'remaining_visits',instrument.remaining_visits,'issued_at',instrument.issued_at,'expires_on',instrument.expires_on,
      'service_balances',coalesce((select jsonb_agg(jsonb_build_object('service_id',balance.service_id,'initial_units',balance.initial_units,'remaining_units',balance.remaining_units) order by balance.service_id) from public.benefit_instrument_service_balances balance where balance.instrument_id=instrument.id),'[]'::jsonb)) order by instrument.issued_at desc)
      from public.client_benefit_instruments instrument where instrument.organization_id=p_organization),'[]'::jsonb),
    'redemptions',coalesce((select jsonb_agg(jsonb_build_object('id',redemption.id,'instrument_id',redemption.instrument_id,'booking_id',redemption.booking_id,'units',redemption.units,
      'amount_rub',redemption.amount_rub,'status',redemption.status,'reserved_at',redemption.reserved_at,'redeemed_at',redemption.redeemed_at,'released_at',redemption.released_at) order by redemption.reserved_at desc)
      from public.benefit_redemptions redemption where redemption.organization_id=p_organization),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(jsonb_build_object('id',entry.id,'action',entry.action,'subject_id',entry.subject_id,'created_at',entry.created_at) order by entry.created_at desc,entry.id desc)
      from (select * from public.benefit_audit_log where organization_id=p_organization order by created_at desc,id desc limit 100) entry),'[]'::jsonb)
  );
end $$;
revoke all on function public.get_minuta_benefit_workspace(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_benefit_workspace(uuid) to authenticated;

commit;
