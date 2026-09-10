\set ON_ERROR_STOP on

-- The long-lived isolated migration database predates v119.  Recreate only the
-- exact profile table shape that v140 reads; production must already have v119.
create table if not exists public.organization_client_profiles (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  normalized_phone text not null check (normalized_phone ~ '^7[0-9]{10}$'),
  birthday date,
  birthday_overridden boolean not null default false,
  online_booking_blocked boolean not null default false,
  online_booking_blocked_at timestamptz,
  online_booking_blocked_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (organization_id,normalized_phone),
  constraint organization_client_profiles_birthday_check
    check (birthday is null or birthday between date '1900-01-01' and current_date),
  constraint organization_client_profiles_block_metadata_check
    check ((online_booking_blocked and online_booking_blocked_at is not null)
      or (not online_booking_blocked and online_booking_blocked_at is null and online_booking_blocked_by is null))
);

do $$ begin
  if (select count(*) from information_schema.columns where table_schema='public'
      and table_name='organization_client_profiles' and column_name in (
        'organization_id','normalized_phone','birthday','birthday_overridden','online_booking_blocked',
        'online_booking_blocked_at','online_booking_blocked_by','updated_at','updated_by'))<>9
     or not exists(select 1 from pg_constraint constraint_row
       where constraint_row.conrelid='public.organization_client_profiles'::regclass
         and constraint_row.contype='p' and array_length(constraint_row.conkey,1)=2) then
    raise exception using errcode='P0001',message='v140_test_profile_prerequisite_incompatible';
  end if;
end $$;

alter table public.organization_client_profiles enable row level security;
revoke all on public.organization_client_profiles from public,anon,authenticated,service_role;
grant all on public.organization_client_profiles to service_role;
