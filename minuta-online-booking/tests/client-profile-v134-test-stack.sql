-- TEST DATABASE ONLY. The isolated database intentionally keeps an older CRM
-- baseline; these transactional fixtures reproduce the columns used by v134.
create table if not exists public.organization_imported_clients(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  normalized_phone text not null,
  display_phone text not null,
  client_name text not null,
  source_system text not null,
  imported_visit_count integer not null default 0,
  imported_total_spent_rub integer not null default 0,
  last_import_batch_id uuid not null references public.client_import_batches(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,normalized_phone)
);

create table if not exists public.organization_imported_booking_history(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  normalized_phone text not null,
  display_phone text not null,
  client_name text not null
);

create table if not exists public.organization_client_profiles(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_phone text not null,
  birthday date,
  birthday_overridden boolean not null default false,
  online_booking_blocked boolean not null default false,
  online_booking_blocked_at timestamptz,
  online_booking_blocked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(organization_id,normalized_phone)
);

create table if not exists public.client_result_series(
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  client_phone text not null,
  booking_id uuid references public.bookings(id) on delete set null,
  booking_was_linked boolean not null default true,
  booking_performer_id uuid not null references auth.users(id) on delete restrict,
  visit_label text not null,
  service_label text not null,
  before_session text not null default '',
  work_done text not null default '',
  after_session text not null default '',
  recommendations text not null default '',
  state text not null default 'active',
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  last_request_by uuid not null references auth.users(id) on delete restrict,
  last_request_id uuid not null,
  unique(organization_id,booking_id),
  unique(last_request_by,last_request_id)
);
