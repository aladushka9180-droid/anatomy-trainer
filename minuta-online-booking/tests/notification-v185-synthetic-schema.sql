-- Empty PostgreSQL 17 database only. No production schema, accounts or sends.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create schema extensions;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role',true),'')
$$;
create table public.organizations(id uuid primary key,status text not null default 'active');
create table public.organization_memberships(
  organization_id uuid,user_id uuid,role text,active boolean default true
);
create table public.performer_profiles(id uuid primary key,display_name text);
create table public.services(id uuid primary key,name text);
create table public.bookings(
  id uuid primary key,booking_code text,manage_token uuid,performer_id uuid,service_id uuid,
  client_name text,client_phone text,booking_date date,booking_time time without time zone,
  status text,organization_id uuid
);
create function public.touch_minuta_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now();return new;end $$;
create function public.has_organization_role(uuid,text[]) returns boolean language sql stable as $$
select true$$;
create table public.organization_notification_settings(
  organization_id uuid primary key references public.organizations(id),enabled boolean not null default false,
  booking_created_enabled boolean not null default true,booking_confirmed_enabled boolean not null default true,
  booking_rescheduled_enabled boolean not null default true,booking_cancelled_enabled boolean not null default true,
  booking_reminder_enabled boolean not null default true,reminder_minutes_before integer not null default 1440,
  enabled_at timestamptz,enabled_by uuid,updated_at timestamptz not null default now()
);
create table public.organization_notification_channels(
  organization_id uuid,audience text,channel text,enabled boolean default false,updated_at timestamptz default now(),
  primary key(organization_id,audience,channel)
);
create table public.notification_recipient_endpoints(
  id uuid primary key default gen_random_uuid(),organization_id uuid,audience text,subject_key text,channel text,
  destination jsonb,consent_source text,consent_at timestamptz,active boolean,revoked_at timestamptz,
  created_at timestamptz default now(),updated_at timestamptz default now(),
  unique(organization_id,audience,subject_key,channel)
);
create table public.notification_outbox(
  id uuid primary key default gen_random_uuid(),performer_id uuid,booking_id uuid,organization_id uuid,
  event_key text unique,kind text constraint notification_outbox_kind_check check(kind in(
    'booking_created','booking_confirmed','booking_rescheduled','booking_cancelled','booking_reminder')),
  channel text,status text default 'pending',attempts integer default 0,next_attempt_at timestamptz default now(),
  locked_at timestamptz,lock_token uuid,last_error_code text,last_error text,provider_message_id text,sent_at timestamptz,
  delivered_at timestamptz,delivery_receipt_at timestamptz,delivery_receipt_source text,
  created_at timestamptz default now(),updated_at timestamptz default now(),audience text,recipient_key text,
  payload jsonb default '{}'::jsonb,dispatcher text default 'unified',unique(id,performer_id)
);
create table public.notification_delivery_attempts(
  id bigint generated always as identity primary key,outbox_id uuid,performer_id uuid,attempt_no integer,
  outcome text,error_code text,error_message text,provider_message_id text,delivered_at timestamptz,
  delivery_receipt_source text,started_at timestamptz default now(),finished_at timestamptz,
  unique(outbox_id,attempt_no)
);
create table public.notification_v114_organization_cutovers(organization_id uuid primary key);
create function public.enqueue_minuta_booking_notification(uuid,text) returns integer language sql as $$
select 0$$;
create function public.enqueue_minuta_booking_change_notification() returns trigger language plpgsql as $$
begin return new;end$$;
create trigger bookings_enqueue_change_notification_v88
after update of status,booking_date,booking_time on public.bookings
for each row execute function public.enqueue_minuta_booking_change_notification();
create function public.claim_minuta_notification_outbox(text[],integer)
returns table(outbox_id uuid,lock_token uuid,event_key text,organization_id uuid,performer_id uuid,booking_id uuid,
kind text,channel text,audience text,attempt_no integer,destination jsonb,message_payload jsonb)
language sql as $$select null::uuid,null::uuid,null::text,null::uuid,null::uuid,null::uuid,
null::text,null::text,null::text,0,null::jsonb,null::jsonb where false$$;
create function public.fail_notification_outbox(uuid,uuid,text,text,boolean,integer)
returns text language sql as $$select 'failed'::text$$;
create function public.confirm_minuta_notification_delivery_v114(text,text,timestamptz,text)
returns text language sql as $$select 'delivered'::text$$;
create function public.get_minuta_notification_workspace(uuid) returns jsonb language sql as $$
select '{}'::jsonb$$;
