-- Partial synthetic schema; not a database restore or release admission.
alter table public.organization_memberships add column is_bookable boolean default true;
create table public.organization_shift_settings(organization_id uuid,enabled boolean);
create table public.staff_location_shifts(id uuid,organization_id uuid,location_id uuid,performer_id uuid,shift_date date,start_time time,end_time time,break_start time,break_end time,active boolean);
create table public.staff_absences(organization_id uuid,performer_id uuid,starts_on date,ends_on date,active boolean);
create table public.provider_days_off(performer_id uuid,off_date date,all_day boolean,start_time time,end_time time);
create table public.performer_profiles(id uuid,display_name text);
create table public.payroll_periods(id uuid,organization_id uuid,location_id uuid,starts_on date,ends_on date,status text);
create table public.payroll_items(period_id uuid,performer_id uuid,payroll_rub integer);
create table public.payroll_adjustments(period_id uuid,performer_id uuid,amount_rub integer);
create table public.organization_retention_settings(organization_id uuid,enabled boolean,inactivity_days integer,cooldown_days integer);
create table public.client_marketing_consents(organization_id uuid,client_account_id uuid,status text);
create table public.retention_deliveries(id uuid,organization_id uuid,client_account_id uuid,last_booking_id uuid,status text,sent_at timestamptz,prepared_at timestamptz);
