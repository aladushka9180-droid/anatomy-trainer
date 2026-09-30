-- Disposable PostgreSQL container only. No production or shared test database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;

create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role',true),'')
$$;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;

create table public.bookings(organization_id uuid,client_phone text,client_name text);
create table public.organization_waitlist_requests(organization_id uuid,client_phone text,client_name text);
create table public.conversation_messages_v162(conversation_id uuid,sender_participant_id uuid);
create table public.message_participants_v162(id uuid,conversation_id uuid,active boolean);
create table public.message_conversations_v162(id uuid);
create table public.organization_memberships(organization_id uuid,user_id uuid,active boolean);

create function public.book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time,text,text,integer,integer)
  returns uuid language sql as $$ select null::uuid $$;
create function public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text)
  returns uuid language sql as $$ select null::uuid $$;
create function public.minuta_send_message_core_v162(uuid,uuid,text,text,uuid,text)
  returns uuid language sql as $$ select null::uuid $$;

grant usage on schema public,auth to anon,authenticated,service_role;
grant insert on public.bookings,public.organization_waitlist_requests,
  public.conversation_messages_v162 to anon,authenticated,service_role;
