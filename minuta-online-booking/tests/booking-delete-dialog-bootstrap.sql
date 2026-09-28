-- Only an empty ephemeral PostgreSQL service, never the remote test/production DB.
\set ON_ERROR_STOP on
alter table auth.users
  add column instance_id uuid,
  add column aud text,
  add column role text,
  add column email text,
  add column email_confirmed_at timestamptz,
  add column raw_app_meta_data jsonb,
  add column raw_user_meta_data jsonb,
  add column created_at timestamptz,
  add column updated_at timestamptz;
create role supabase_auth_admin;
create role supabase_storage_admin;
create role dashboard_user;
create role pgbouncer;
create role supabase_read_only_user;
create role supabase_realtime_admin;
create schema minuta_migration_guard;
create table minuta_migration_guard.target(project_ref text primary key,allow_migrations boolean not null);
insert into minuta_migration_guard.target values('eldion-delete-fixture',true);
