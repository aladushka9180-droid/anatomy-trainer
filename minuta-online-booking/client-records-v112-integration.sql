-- Run ONLY against an isolated PostgreSQL/Supabase test database after v112.
-- Requires one existing booking in an active organization with an active owner.
-- Every fixture and setting is rolled back. No production execution.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='2min';

select b.id::text as booking,b.organization_id::text as org,m.user_id::text as owner,
  public.normalize_client_phone(b.client_phone) as phone
from public.bookings b
join public.organizations o on o.id=b.organization_id and o.status='active'
join public.organization_memberships m on m.organization_id=o.id and m.role='owner' and m.active
where public.normalize_client_phone(b.client_phone) ~ '^7[0-9]{10}$'
order by b.id limit 1 \gset cr_
select set_config('test.cr.org',:'cr_org',true),set_config('test.cr.owner',:'cr_owner',true),
  set_config('test.cr.phone',:'cr_phone',true),set_config('test.cr.booking',:'cr_booking',true);

create function pg_temp.assert_true(p_ok boolean,p_message text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'v112: %',p_message; end if; end $$;
create function pg_temp.denied(p_sql text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege then return; end;
  raise exception 'v112: expected access denial: %',p_sql;
end $$;

select pg_temp.assert_true(not has_table_privilege('authenticated','public.client_record_entries','SELECT'),'raw table SELECT revoked');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.client_record_settings','UPDATE'),'raw settings UPDATE revoked');
select pg_temp.assert_true(not has_function_privilege('anon','public.get_minuta_client_records(uuid,text,integer)','EXECUTE'),'anonymous RPC revoked');
select pg_temp.assert_true((select not public from storage.buckets where id='minuta-client-records'),'private bucket');

select set_config('request.jwt.claim.sub',current_setting('test.cr.owner'),true);
set local role authenticated;
select public.set_minuta_client_records_enabled(current_setting('test.cr.org')::uuid,true);
select pg_temp.assert_true((public.get_minuta_client_records(current_setting('test.cr.org')::uuid,current_setting('test.cr.phone'))->>'enabled')::boolean,'opt-in enabled');
select public.create_minuta_client_record(current_setting('test.cr.org')::uuid,current_setting('test.cr.phone'),
  '00000000-0112-4000-8000-000000000001',current_setting('test.cr.booking')::uuid,'note','v112 private fixture');
select public.create_minuta_client_record(current_setting('test.cr.org')::uuid,current_setting('test.cr.phone'),
  '00000000-0112-4000-8000-000000000001',current_setting('test.cr.booking')::uuid,'note','v112 private fixture');
do $$ begin
  begin
    perform public.create_minuta_client_record(current_setting('test.cr.org')::uuid,current_setting('test.cr.phone'),
      '00000000-0112-4000-8000-000000000001',current_setting('test.cr.booking')::uuid,'note','changed request');
    raise exception 'v112: idempotency mismatch accepted';
  exception when raise_exception then if sqlerrm<>'client_record_request_conflict' then raise; end if; end;
  begin
    perform public.create_minuta_client_record(current_setting('test.cr.org')::uuid,current_setting('test.cr.phone'),
      '00000000-0112-4000-8000-000000000002',null,'file','','fixture.pdf',null,null);
    raise exception 'v112: NULL file metadata accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.denied(format('select public.create_minuta_client_record(%L::uuid,%L,%L::uuid,%L::uuid,%L,%L)',
  current_setting('test.cr.org'),current_setting('test.cr.phone'),'00000000-0112-4000-8000-000000000003',
  'ffffffff-ffff-4fff-8fff-ffffffffffff','note','wrong booking'));

select public.create_minuta_client_record(current_setting('test.cr.org')::uuid,current_setting('test.cr.phone'),
  '00000000-0112-4000-8000-000000000004',current_setting('test.cr.booking')::uuid,'file','','fixture.pdf','application/pdf',4);
select set_config('test.cr.path',current_setting('test.cr.org')||'/00000000-0112-4000-8000-000000000004.pdf',true);
select pg_temp.assert_true(public.can_use_minuta_client_object(current_setting('test.cr.path'),'upload'),'pending owner can upload');
select pg_temp.assert_true(not public.can_use_minuta_client_object(current_setting('test.cr.path'),'read'),'pending file hidden');
do $$ begin
  begin perform public.complete_minuta_client_file('00000000-0112-4000-8000-000000000004');
    raise exception 'v112: missing upload completed';
  exception when raise_exception then if sqlerrm<>'client_record_upload_incomplete' then raise; end if; end;
end $$;
insert into storage.objects(bucket_id,name,metadata)
values('minuta-client-records',current_setting('test.cr.path'),'{"size":4,"mimetype":"application/pdf"}');
select public.complete_minuta_client_file('00000000-0112-4000-8000-000000000004');
select public.complete_minuta_client_file('00000000-0112-4000-8000-000000000004');
select pg_temp.assert_true(public.can_use_minuta_client_object(current_setting('test.cr.path'),'read'),'completed file readable');
select pg_temp.assert_true(not public.can_use_minuta_client_object(current_setting('test.cr.path'),'upload'),'completed file cannot be overwritten');
select pg_temp.assert_true((select count(*)=1 from storage.objects where bucket_id='minuta-client-records' and name=current_setting('test.cr.path')),'Storage SELECT policy');

-- Simulate an authenticated account outside this organization; no fixture user needed.
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',true);
select pg_temp.denied(format('select public.get_minuta_client_records(%L::uuid,%L)',current_setting('test.cr.org'),current_setting('test.cr.phone')));
select pg_temp.denied(format('select public.set_minuta_client_records_enabled(%L::uuid,true)',current_setting('test.cr.org')));
select pg_temp.denied('select public.archive_minuta_client_record(''00000000-0112-4000-8000-000000000004'')');
select pg_temp.denied('select public.complete_minuta_client_file(''00000000-0112-4000-8000-000000000004'')');
select pg_temp.assert_true((select count(*)=0 from storage.objects where bucket_id='minuta-client-records' and name=current_setting('test.cr.path')),'foreign Storage SELECT denied');
select pg_temp.denied(format('insert into storage.objects(bucket_id,name) values(''minuta-client-records'',%L)',current_setting('test.cr.org')||'/foreign.pdf'));

select set_config('request.jwt.claim.sub',current_setting('test.cr.owner'),true);
select public.set_minuta_client_records_enabled(current_setting('test.cr.org')::uuid,false);
select pg_temp.assert_true(jsonb_array_length(public.get_minuta_client_records(current_setting('test.cr.org')::uuid,current_setting('test.cr.phone'))->'entries')=0,'disabled records hidden');
select pg_temp.assert_true(not public.can_use_minuta_client_object(current_setting('test.cr.path'),'read'),'disabled Storage hidden');
select public.set_minuta_client_records_enabled(current_setting('test.cr.org')::uuid,true);
select public.archive_minuta_client_record('00000000-0112-4000-8000-000000000004');
select public.archive_minuta_client_record('00000000-0112-4000-8000-000000000004');
select pg_temp.assert_true(not public.can_use_minuta_client_object(current_setting('test.cr.path'),'read'),'archived file hidden');
select pg_temp.assert_true(not public.can_use_minuta_client_object(current_setting('test.cr.path'),'delete'),'physical delete never allowed');
select pg_temp.denied('select public.complete_minuta_client_file(''00000000-0112-4000-8000-000000000004'')');
reset role;
select pg_temp.assert_true((select count(*)=1 from public.client_record_entries where id='00000000-0112-4000-8000-000000000001'),'retry created exactly one note');
select pg_temp.assert_true((select count(*)=1 from storage.objects where bucket_id='minuta-client-records' and name=current_setting('test.cr.path')),'archive retained original object');
update public.organizations set status='suspended' where id=current_setting('test.cr.org')::uuid;
set local role authenticated;
select pg_temp.denied(format('select public.get_minuta_client_records(%L::uuid,%L)',current_setting('test.cr.org'),current_setting('test.cr.phone')));
select pg_temp.assert_true(not public.can_use_minuta_client_object(current_setting('test.cr.path'),'read'),'suspended tenant hidden');
reset role;
rollback;
