-- PostgreSQL 17 full-schema rehearsal. Run only in a disposable, offline restore.
-- The caller must create minuta_export_fixture_guard.target after restore verification.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '90s';
set local lock_timeout = '5s';
do $guard$
declare marker_count integer;
begin
  if current_database() is distinct from 'postgres'
    or inet_server_addr() is distinct from inet '127.0.0.1'
    or pg_is_in_recovery() is distinct from false
    or to_regclass('minuta_export_fixture_guard.target') is null then
    raise exception 'export_full_schema_disposable_loopback_marker_required';
  end if;
  execute 'select count(*) from minuta_export_fixture_guard.target where purpose=$1 and disposable is true'
    into marker_count using 's04-s10-full-schema';
  if marker_count is distinct from 1 then raise exception 'export_full_schema_marker_missing'; end if;
  if to_regprocedure('public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)') is not null
    or to_regprocedure('public.get_minuta_report_export_imported_history(uuid,date,date,uuid,uuid,text,integer,integer)') is not null
    or to_regprocedure('public.minuta_report_export_client_key(uuid,text)') is not null then
    raise exception 'export_candidate_already_present';
  end if;
  if to_regprocedure('public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer)') is null
    or to_regprocedure('public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)') is null
    or to_regprocedure('public.get_minuta_team_analytics(uuid,date,date)') is null
    or to_regclass('public.organization_imported_booking_history') is null
    or to_regclass('public.payroll_adjustments') is null then
    raise exception 'export_full_schema_dependencies_missing';
  end if;
end $guard$;

-- Fresh random IDs keep every assertion inside one synthetic organization.
do $fixture$
begin
  perform set_config('export_probe.owner',gen_random_uuid()::text,true);
  perform set_config('export_probe.admin',gen_random_uuid()::text,true);
  perform set_config('export_probe.staff',gen_random_uuid()::text,true);
  perform set_config('export_probe.org',gen_random_uuid()::text,true);
  perform set_config('export_probe.loc_a',gen_random_uuid()::text,true);
  perform set_config('export_probe.loc_b',gen_random_uuid()::text,true);
  perform set_config('export_probe.service',gen_random_uuid()::text,true);
  perform set_config('export_probe.old_booking',gen_random_uuid()::text,true);
  perform set_config('export_probe.booking_a',gen_random_uuid()::text,true);
  perform set_config('export_probe.booking_b',gen_random_uuid()::text,true);
  perform set_config('export_probe.history',gen_random_uuid()::text,true);
  perform set_config('export_probe.date',(current_date+30)::text,true);
end $fixture$;

-- Disable only fixture-trigger side effects, then restore normal trigger mode
-- before calling any existing or candidate RPC. All rows are rolled back.
set local session_replication_role = replica;
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select actor,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  actor::text||'@example.invalid',now(),'{}','{}',now(),now()
from (values (current_setting('export_probe.owner')::uuid),
  (current_setting('export_probe.admin')::uuid),(current_setting('export_probe.staff')::uuid)) users(actor);
insert into public.performer_profiles(id,display_name)
values (current_setting('export_probe.owner')::uuid,'Export fixture owner'),
  (current_setting('export_probe.admin')::uuid,'Export fixture admin'),
  (current_setting('export_probe.staff')::uuid,'Export fixture staff');
insert into public.organizations(id,name,created_by)
values (current_setting('export_probe.org')::uuid,'Export fixture organization',current_setting('export_probe.owner')::uuid);
insert into public.locations(id,organization_id,name,timezone,is_primary)
values (current_setting('export_probe.loc_a')::uuid,current_setting('export_probe.org')::uuid,'Export fixture A','Europe/Samara',true),
  (current_setting('export_probe.loc_b')::uuid,current_setting('export_probe.org')::uuid,'Export fixture B','Europe/Samara',false);
insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
values (current_setting('export_probe.org')::uuid,current_setting('export_probe.owner')::uuid,'owner',true,true),
  (current_setting('export_probe.org')::uuid,current_setting('export_probe.admin')::uuid,'admin',false,true),
  (current_setting('export_probe.org')::uuid,current_setting('export_probe.staff')::uuid,'specialist',true,true);
insert into public.services(id,organization_id,performer_id,name,duration_minutes,price_rub,active)
values (current_setting('export_probe.service')::uuid,current_setting('export_probe.org')::uuid,
  current_setting('export_probe.staff')::uuid,'Export synthetic service',40,1000,true);
insert into public.bookings(id,booking_code,manage_token,organization_id,location_id,performer_id,service_id,
  client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
  status,deposit_amount_rub,payment_status,payment_url,booking_policy_snapshot,booking_source)
values
  (current_setting('export_probe.old_booking')::uuid,'EXPOOLD001',gen_random_uuid(),current_setting('export_probe.org')::uuid,
    current_setting('export_probe.loc_a')::uuid,current_setting('export_probe.staff')::uuid,current_setting('export_probe.service')::uuid,
    'Export synthetic A','79990000001',current_setting('export_probe.date')::date-1,'10:00',40,1000,1000,
    'confirmed',0,'not_required','','{}','provider_manual'),
  (current_setting('export_probe.booking_a')::uuid,'EXPONEW001',gen_random_uuid(),current_setting('export_probe.org')::uuid,
    current_setting('export_probe.loc_a')::uuid,current_setting('export_probe.staff')::uuid,current_setting('export_probe.service')::uuid,
    'Export synthetic A','79990000001',current_setting('export_probe.date')::date,'10:00',40,1000,1000,
    'confirmed',0,'not_required','','{}','provider_manual'),
  (current_setting('export_probe.booking_b')::uuid,'EXPOOTHR01',gen_random_uuid(),current_setting('export_probe.org')::uuid,
    current_setting('export_probe.loc_b')::uuid,current_setting('export_probe.staff')::uuid,current_setting('export_probe.service')::uuid,
    'Export synthetic B','79990000002',current_setting('export_probe.date')::date,'11:00',40,1000,1000,
    'confirmed',0,'not_required','','{}','provider_manual');
insert into public.booking_outcomes(booking_id,performer_id,completed_performer_id,visit_status,payment_method,
  amount_rub,actual_duration_minutes,calculated_amount_rub,completion_source,updated_at)
select booking.id,booking.performer_id,booking.performer_id,'completed','cash',1000,40,1000,'manual',now()
from public.bookings booking where booking.id in (current_setting('export_probe.old_booking')::uuid,
  current_setting('export_probe.booking_a')::uuid,current_setting('export_probe.booking_b')::uuid);
insert into public.booking_session_items(booking_id,performer_id,position,item_kind,service_id,title,duration_minutes,price_rub,extends_duration)
select booking.id,booking.performer_id,1,'primary',booking.service_id,'Export synthetic service',40,1000,true
from public.bookings booking where booking.id in (current_setting('export_probe.old_booking')::uuid,
  current_setting('export_probe.booking_a')::uuid,current_setting('export_probe.booking_b')::uuid);
insert into public.client_import_batches(organization_id,request_id,source_system,payload_hash,input_count,actor_id)
values (current_setting('export_probe.org')::uuid,gen_random_uuid(),'other',repeat('a',64),1,current_setting('export_probe.owner')::uuid);
insert into public.booking_history_import_batches(organization_id,request_id,source_file_name,payload_hash,input_count,
  actor_id,client_import_batch_id)
select current_setting('export_probe.org')::uuid,gen_random_uuid(),'synthetic.csv',repeat('b',64),1,
  current_setting('export_probe.owner')::uuid,batch.id from public.client_import_batches batch
where batch.organization_id=current_setting('export_probe.org')::uuid;
insert into public.organization_imported_booking_history(id,organization_id,performer_id,import_batch_id,
  source_fingerprint,source_file_name,source_sheet,booking_date,booking_time,duration_minutes,
  client_name,normalized_phone,display_phone,service_name,price_rub)
select current_setting('export_probe.history')::uuid,current_setting('export_probe.org')::uuid,
  current_setting('export_probe.staff')::uuid,batch.id,repeat('c',64),'synthetic.csv','Sheet 1',
  current_setting('export_probe.date')::date,'12:00',40,'Export synthetic A','79990000001',
  '+7 (999) 000-00-01','Export synthetic service',1000
from public.booking_history_import_batches batch where batch.organization_id=current_setting('export_probe.org')::uuid;
insert into public.payroll_periods(organization_id,name,starts_on,ends_on,status)
values (current_setting('export_probe.org')::uuid,'Export fixture payroll',current_setting('export_probe.date')::date,
  current_setting('export_probe.date')::date,'approved');
insert into public.payroll_adjustments(period_id,organization_id,performer_id,amount_rub,reason)
select period.id,current_setting('export_probe.org')::uuid,current_setting('export_probe.staff')::uuid,321,
  'Synthetic export adjustment' from public.payroll_periods period
where period.organization_id=current_setting('export_probe.org')::uuid;
insert into public.booking_events(organization_id,booking_id,performer_id,event_type,actor_user_id,actor_role,
  booking_date,delta_completed_rub,delta_received_rub)
values (current_setting('export_probe.org')::uuid,current_setting('export_probe.booking_a')::uuid,
  current_setting('export_probe.staff')::uuid,'visit_completed',current_setting('export_probe.owner')::uuid,'owner',
  current_setting('export_probe.date')::date,1000,1000);
set local session_replication_role = origin;

create temp table export_probe_baseline (
  legacy_team jsonb,legacy_events jsonb,legacy_bookings jsonb,
  booking_fingerprint text,history_fingerprint text,payroll_fingerprint text,
  legacy_definitions text[],legacy_acls text[]
) on commit drop;
do $legacy_baseline$
declare team jsonb; events jsonb; old_report jsonb;
begin
  perform set_config('request.jwt.claim.sub',current_setting('export_probe.owner'),true);
  team:=public.get_minuta_team_analytics(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date);
  events:=public.get_minuta_booking_events_v97(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,100,0);
  old_report:=public.get_minuta_staff_report_bookings_v97(current_setting('export_probe.org')::uuid,
    current_setting('export_probe.date')::date,current_setting('export_probe.date')::date,null,100,0);
  if team->>'can_view_team' is distinct from 'true'
    or jsonb_array_length(events->'events') is distinct from 1
    or jsonb_array_length(old_report->'bookings') is distinct from 2
    or not exists(select 1 from jsonb_array_elements(team->'performers') performer
      where performer->>'performer_id'=current_setting('export_probe.staff') and (performer->>'payroll_rub')::integer=321) then
    raise exception 'export_legacy_payload_baseline_failed';
  end if;
  insert into pg_temp.export_probe_baseline
  select team,events,old_report,
    (select md5(jsonb_agg(to_jsonb(booking) order by booking.id)::text) from public.bookings booking
      where booking.organization_id=current_setting('export_probe.org')::uuid) booking_fingerprint,
    (select md5(jsonb_agg(to_jsonb(history) order by history.id)::text) from public.organization_imported_booking_history history
      where history.organization_id=current_setting('export_probe.org')::uuid) history_fingerprint,
    (select md5(jsonb_agg(to_jsonb(period) order by period.id)::text) from public.payroll_periods period
      where period.organization_id=current_setting('export_probe.org')::uuid) payroll_fingerprint,
    (select array_agg(md5(pg_get_functiondef(oid)) order by oid) from pg_proc
      where oid in ('public.get_minuta_team_analytics(uuid,date,date)'::regprocedure,
        'public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)'::regprocedure,
        'public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer)'::regprocedure)),
    (select array_agg(coalesce(proacl::text,'') order by oid) from pg_proc
      where oid in ('public.get_minuta_team_analytics(uuid,date,date)'::regprocedure,
        'public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)'::regprocedure,
        'public.get_minuta_staff_report_bookings_v97(uuid,date,date,uuid,integer,integer)'::regprocedure));
end $legacy_baseline$;

\ir ../report-export-owner-scope-candidate.sql

do $catalog$
begin
  if has_function_privilege('authenticated',
      'public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)','EXECUTE') is distinct from true
    or has_function_privilege('authenticated',
      'public.get_minuta_report_export_imported_history(uuid,date,date,uuid,uuid,text,integer,integer)','EXECUTE') is distinct from true
    or has_function_privilege('anon',
      'public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)','EXECUTE') is distinct from false
    or has_function_privilege('anon',
      'public.get_minuta_report_export_imported_history(uuid,date,date,uuid,uuid,text,integer,integer)','EXECUTE') is distinct from false
    or has_function_privilege('service_role',
      'public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)','EXECUTE') is distinct from false
    or has_function_privilege('service_role',
      'public.get_minuta_report_export_imported_history(uuid,date,date,uuid,uuid,text,integer,integer)','EXECUTE') is distinct from false
    or has_function_privilege('authenticated','public.minuta_report_export_client_key(uuid,text)','EXECUTE') is distinct from false
    or not exists(select 1 from pg_class where oid='public.bookings'::regclass and relrowsecurity)
    or not exists(select 1 from pg_class where oid='public.organization_imported_booking_history'::regclass and relrowsecurity) then
    raise exception 'export_grant_or_rls_contract_failed';
  end if;
end $catalog$;

-- The same checks run after reapply. No real organization IDs or contacts appear.
\ir report-export-owner-scope-full-schema-checks.sql
\ir ../report-export-owner-scope-rollback.sql
do $rolled_back$
begin
  if to_regprocedure('public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)') is not null
    or to_regprocedure('public.get_minuta_report_export_imported_history(uuid,date,date,uuid,uuid,text,integer,integer)') is not null
    or to_regprocedure('public.minuta_report_export_client_key(uuid,text)') is not null then
    raise exception 'export_rollback_left_functions';
  end if;
end $rolled_back$;
\ir ../report-export-owner-scope-candidate.sql
\ir report-export-owner-scope-full-schema-checks.sql
rollback;
\echo 'report export full-schema apply/roles/scope/legacy/rollback/reapply: ok'
