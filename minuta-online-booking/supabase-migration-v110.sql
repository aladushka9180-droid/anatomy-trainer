create extension if not exists pgcrypto;

create table if not exists public.organization_data_governance (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  privacy_version text not null default '2026-09-05', terms_version text not null default '2026-09-05',
  booking_retention_months integer not null default 36 check (booking_retention_months between 1 and 120),
  visitor_retention_days integer not null default 7 check (visitor_retention_days between 1 and 90),
  audit_retention_months integer not null default 12 check (audit_retention_months between 1 and 60),
  deletion_grace_days integer not null default 7 check (deletion_grace_days between 1 and 30),
  updated_at timestamptz not null default now(), updated_by uuid references auth.users(id) on delete set null
);
create table if not exists public.booking_legal_acceptances (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_type text not null check (document_type in ('privacy','terms')), document_version text not null,
  client_phone_hash text, accepted_at timestamptz not null default now(), unique (booking_id, document_type, document_version)
);
create table if not exists public.minuta_data_subject_requests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete set null, requested_by uuid references auth.users(id) on delete set null,
  request_type text not null check (request_type in ('export','correction','restriction','erasure','account_deletion','organization_deletion')),
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled','rejected')),
  execute_after timestamptz, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.minuta_personal_data_access_log (
  id bigint generated always as identity primary key, organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null, action text not null, subject_type text not null,
  subject_id text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists booking_legal_acceptances_org_idx on public.booking_legal_acceptances (organization_id, accepted_at desc);
create index if not exists minuta_data_subject_requests_org_idx on public.minuta_data_subject_requests (organization_id, created_at desc);
create index if not exists minuta_data_subject_requests_pending_idx on public.minuta_data_subject_requests (status, execute_after) where status='pending';
create index if not exists minuta_personal_data_access_log_org_idx on public.minuta_personal_data_access_log (organization_id, created_at desc);
alter table public.organization_data_governance enable row level security;
alter table public.booking_legal_acceptances enable row level security;
alter table public.minuta_data_subject_requests enable row level security;
alter table public.minuta_personal_data_access_log enable row level security;
revoke all on public.organization_data_governance, public.booking_legal_acceptances, public.minuta_data_subject_requests, public.minuta_personal_data_access_log from public, anon, authenticated;

create or replace function public.require_minuta_governance_role_v110(p_organization uuid,p_owner_only boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare v_role text; begin
  select m.role into v_role from public.organization_memberships m where m.organization_id=p_organization and m.user_id=auth.uid() limit 1;
  if v_role is null or (p_owner_only and v_role<>'owner') or (not p_owner_only and v_role not in ('owner','admin')) then raise exception 'Недостаточно прав'; end if;
  return v_role;
end $$;

create or replace function public.record_minuta_booking_legal_acceptance_v110(p_token uuid,p_privacy_version text,p_terms_version text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_booking public.bookings%rowtype; v_phone_hash text; begin
  if p_token is null or nullif(trim(p_privacy_version),'') is null or nullif(trim(p_terms_version),'') is null then return false; end if;
  select * into v_booking from public.bookings where manage_token=p_token limit 1;
  if v_booking.id is null then return false; end if;
  v_phone_hash:=encode(digest(regexp_replace(coalesce(v_booking.client_phone,''),'\D','','g'),'sha256'),'hex');
  insert into public.booking_legal_acceptances(booking_id,organization_id,document_type,document_version,client_phone_hash)
  values(v_booking.id,v_booking.organization_id,'privacy',trim(p_privacy_version),v_phone_hash),(v_booking.id,v_booking.organization_id,'terms',trim(p_terms_version),v_phone_hash) on conflict do nothing;
  return true;
end $$;

create or replace function public.submit_minuta_client_data_request_v110(p_token uuid,p_request_type text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_booking public.bookings%rowtype; v_id uuid; begin
  if p_request_type not in ('export','correction','restriction','erasure') then raise exception 'Недопустимый тип запроса'; end if;
  select * into v_booking from public.bookings where manage_token=p_token limit 1;
  if v_booking.id is null then raise exception 'Запись не найдена'; end if;
  insert into public.minuta_data_subject_requests(organization_id,booking_id,request_type) values(v_booking.organization_id,v_booking.id,p_request_type) returning id into v_id;
  return v_id;
end $$;

create or replace function public.get_minuta_data_governance_workspace_v110(p_organization uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_role text; v_settings jsonb; begin
  v_role:=public.require_minuta_governance_role_v110(p_organization,false);
  insert into public.organization_data_governance(organization_id) values(p_organization) on conflict do nothing;
  select to_jsonb(g)-'updated_by' into v_settings from public.organization_data_governance g where g.organization_id=p_organization;
  return jsonb_build_object('role',v_role,'settings',v_settings,
    'requests',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (select id,request_type,status,execute_after,created_at from public.minuta_data_subject_requests where organization_id=p_organization order by created_at desc limit 20)r),'[]'::jsonb),
    'recent_access',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (select action,subject_type,created_at from public.minuta_personal_data_access_log where organization_id=p_organization order by created_at desc limit 20)a),'[]'::jsonb));
end $$;

create or replace function public.save_minuta_data_governance_v110(p_organization uuid,p_booking_retention_months integer,p_visitor_retention_days integer,p_audit_retention_months integer,p_deletion_grace_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; begin
  perform public.require_minuta_governance_role_v110(p_organization,true);
  insert into public.organization_data_governance(organization_id,booking_retention_months,visitor_retention_days,audit_retention_months,deletion_grace_days,updated_by)
  values(p_organization,p_booking_retention_months,p_visitor_retention_days,p_audit_retention_months,p_deletion_grace_days,auth.uid())
  on conflict(organization_id) do update set booking_retention_months=excluded.booking_retention_months,visitor_retention_days=excluded.visitor_retention_days,audit_retention_months=excluded.audit_retention_months,deletion_grace_days=excluded.deletion_grace_days,updated_by=auth.uid(),updated_at=now();
  select to_jsonb(g)-'updated_by' into v_result from public.organization_data_governance g where g.organization_id=p_organization; return v_result;
end $$;

create or replace function public.export_minuta_organization_data_v110(p_organization uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payload jsonb; v_rows jsonb; v_table text; v_tables text[]:=array['locations','organization_memberships','services','bookings','clients','working_hours','organization_notification_settings','organization_display_settings','booking_legal_acceptances','minuta_data_subject_requests']; begin
  perform public.require_minuta_governance_role_v110(p_organization,true);
  select jsonb_build_object('exported_at',now(),'organization',to_jsonb(o)) into v_payload from public.organizations o where o.id=p_organization;
  foreach v_table in array v_tables loop
    if to_regclass('public.'||v_table) is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name=v_table and column_name='organization_id') then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)-array[''manage_token'',''client_phone_hash'',''token_hash'',''payment_url'',''secret'',''updated_by'']::text[]),''[]''::jsonb) from public.%I x where x.organization_id=$1',v_table) into v_rows using p_organization;
      v_payload:=v_payload||jsonb_build_object(v_table,v_rows);
    end if;
  end loop;
  insert into public.minuta_personal_data_access_log(organization_id,actor_user_id,action,subject_type,subject_id) values(p_organization,auth.uid(),'export','organization',p_organization::text);
  return v_payload;
end $$;

create or replace function public.request_minuta_data_action_v110(p_organization uuid,p_request_type text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_days integer; v_execute_after timestamptz; begin
  perform public.require_minuta_governance_role_v110(p_organization,true);
  if p_request_type not in ('account_deletion','organization_deletion') then raise exception 'Недопустимый тип запроса'; end if;
  insert into public.organization_data_governance(organization_id) values(p_organization) on conflict do nothing;
  select deletion_grace_days into v_days from public.organization_data_governance where organization_id=p_organization; v_execute_after:=now()+make_interval(days=>v_days);
  insert into public.minuta_data_subject_requests(organization_id,requested_by,request_type,execute_after) values(p_organization,auth.uid(),p_request_type,v_execute_after) returning id into v_id;
  insert into public.minuta_personal_data_access_log(organization_id,actor_user_id,action,subject_type,subject_id) values(p_organization,auth.uid(),'deletion_requested',p_request_type,v_id::text);
  return jsonb_build_object('id',v_id,'execute_after',v_execute_after);
end $$;

create or replace function public.cancel_minuta_data_request_v110(p_request uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_org uuid; begin
  select organization_id into v_org from public.minuta_data_subject_requests where id=p_request and status='pending'; if v_org is null then return false; end if;
  perform public.require_minuta_governance_role_v110(v_org,true); update public.minuta_data_subject_requests set status='cancelled',updated_at=now() where id=p_request and status='pending'; return found;
end $$;

create or replace function public.run_minuta_privacy_cleanup_v110(p_organization uuid,p_execute boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_booking_months integer; v_visitor_days integer; v_audit_months integer; v_visitors bigint:=0; v_bookings bigint:=0; v_audits bigint:=0; begin
  perform public.require_minuta_governance_role_v110(p_organization,true); insert into public.organization_data_governance(organization_id) values(p_organization) on conflict do nothing;
  select booking_retention_months,visitor_retention_days,audit_retention_months into v_booking_months,v_visitor_days,v_audit_months from public.organization_data_governance where organization_id=p_organization;
  if to_regclass('public.booking_page_visits') is not null then execute 'select count(*) from public.booking_page_visits where organization_id=$1 and last_seen_at<now()-make_interval(days=>$2)' into v_visitors using p_organization,v_visitor_days; end if;
  select count(*) into v_bookings from public.bookings where organization_id=p_organization and status='cancelled' and booking_date<current_date-make_interval(months=>v_booking_months);
  select count(*) into v_audits from public.minuta_personal_data_access_log where organization_id=p_organization and created_at<now()-make_interval(months=>v_audit_months);
  if p_execute then
    if to_regclass('public.booking_page_visits') is not null then execute 'delete from public.booking_page_visits where organization_id=$1 and last_seen_at<now()-make_interval(days=>$2)' using p_organization,v_visitor_days; end if;
    update public.bookings set client_name='Удалено',client_phone='0000000000',provider_note=null where organization_id=p_organization and status='cancelled' and booking_date<current_date-make_interval(months=>v_booking_months);
    delete from public.minuta_personal_data_access_log where organization_id=p_organization and created_at<now()-make_interval(months=>v_audit_months);
    insert into public.minuta_personal_data_access_log(organization_id,actor_user_id,action,subject_type,details) values(p_organization,auth.uid(),'retention_cleanup','organization',jsonb_build_object('visitors',v_visitors,'bookings',v_bookings,'audit',v_audits));
  end if;
  return jsonb_build_object('executed',p_execute,'visitor_events',v_visitors,'cancelled_bookings',v_bookings,'access_log',v_audits);
end $$;

revoke all on function public.require_minuta_governance_role_v110(uuid,boolean),public.record_minuta_booking_legal_acceptance_v110(uuid,text,text),public.submit_minuta_client_data_request_v110(uuid,text),public.get_minuta_data_governance_workspace_v110(uuid),public.save_minuta_data_governance_v110(uuid,integer,integer,integer,integer),public.export_minuta_organization_data_v110(uuid),public.request_minuta_data_action_v110(uuid,text),public.cancel_minuta_data_request_v110(uuid),public.run_minuta_privacy_cleanup_v110(uuid,boolean) from public,anon,authenticated;
grant execute on function public.record_minuta_booking_legal_acceptance_v110(uuid,text,text),public.submit_minuta_client_data_request_v110(uuid,text) to anon,authenticated;
grant execute on function public.get_minuta_data_governance_workspace_v110(uuid),public.save_minuta_data_governance_v110(uuid,integer,integer,integer,integer),public.export_minuta_organization_data_v110(uuid),public.request_minuta_data_action_v110(uuid,text),public.cancel_minuta_data_request_v110(uuid),public.run_minuta_privacy_cleanup_v110(uuid,boolean) to authenticated;
