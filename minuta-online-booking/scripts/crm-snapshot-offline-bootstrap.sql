\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role bypassrls;
create role supabase_admin;
create role authenticator;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create function auth.email() returns text language sql stable as $$select auth.jwt()->>'email'$$;
grant usage on schema public,auth,extensions to anon,authenticated,service_role;
