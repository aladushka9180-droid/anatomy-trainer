-- TEST DATABASE ONLY. Requires v112 and v120 in an isolated database.
\set ON_ERROR_STOP on

create function pg_temp.client_results_assert(ok boolean,message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception 'v120: %',message; end if; end $$;
create function pg_temp.client_results_denied(sql_text text) returns void
language plpgsql as $$ begin
  begin execute sql_text; exception when insufficient_privilege then return; end;
  raise exception 'v120: expected access denial: %',sql_text;
end $$;

select booking.id::text booking,booking.organization_id::text org,member.user_id::text owner,
  public.normalize_client_phone(booking.client_phone) phone
from public.bookings booking
join public.organizations organization on organization.id=booking.organization_id and organization.status='active'
join public.organization_memberships member on member.organization_id=organization.id and member.role='owner' and member.active
where public.normalize_client_phone(booking.client_phone) ~ '^7[0-9]{10}$' and booking.status<>'cancelled'
order by booking.id limit 1 \gset cr120_
select set_config('test.cr120.org',:'cr120_org',false),set_config('test.cr120.owner',:'cr120_owner',false),
  set_config('test.cr120.phone',:'cr120_phone',false),set_config('test.cr120.booking',:'cr120_booking',false);

select pg_temp.client_results_assert(not has_table_privilege('authenticated','public.client_result_series','SELECT'),'raw series visible');
select pg_temp.client_results_assert(not has_table_privilege('authenticated','public.client_result_consents','SELECT'),'raw consent visible');
select pg_temp.client_results_assert(not has_function_privilege('anon','public.get_minuta_client_results_v120(uuid,text,integer)','EXECUTE'),'anonymous list executable');

select set_config('request.jwt.claim.sub',current_setting('test.cr120.owner'),false);
set role authenticated;
select public.set_minuta_client_records_enabled(current_setting('test.cr120.org')::uuid,true);
select public.save_minuta_client_result_v120(current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'),
  current_setting('test.cr120.booking')::uuid,'00000000-0120-4000-8000-000000000001',
  'До сеанса','Сделан тест','После сеанса','Рекомендации',true,false,'00000000-0120-4000-8000-000000000101');
select public.save_minuta_client_result_v120(current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'),
  current_setting('test.cr120.booking')::uuid,'00000000-0120-4000-8000-000000000001',
  'До сеанса','Сделан тест','После сеанса','Рекомендации',true,false,'00000000-0120-4000-8000-000000000101');
reset role;
select pg_temp.client_results_assert((select count(*)=1 from public.client_result_series where id='00000000-0120-4000-8000-000000000001'),'retry duplicated series');
select pg_temp.client_results_assert((select count(*)=2 from public.client_result_consents where result_id='00000000-0120-4000-8000-000000000001'),'retry duplicated consent events');

set role authenticated;
do $$ begin
  begin
    perform public.save_minuta_client_result_v120(current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'),
      current_setting('test.cr120.booking')::uuid,'00000000-0120-4000-8000-000000000001',
      'Другой текст','Сделан тест','После сеанса','Рекомендации',true,false,'00000000-0120-4000-8000-000000000101');
    raise exception 'v120: changed replay accepted';
  exception when raise_exception then if sqlerrm<>'client_result_request_conflict' then raise; end if; end;
end $$;
select public.create_minuta_client_result_media_v120(current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'),
  '00000000-0120-4000-8000-000000000001','00000000-0120-4000-8000-000000000201','before','image/jpeg',4);
select set_config('test.cr120.path',current_setting('test.cr120.org')||'/00000000-0120-4000-8000-000000000201.jpg',false);
insert into storage.objects(bucket_id,name,metadata)
values('minuta-client-records',current_setting('test.cr120.path'),' {"size":4,"mimetype":"image/jpeg"}');
select public.complete_minuta_client_result_media_v120('00000000-0120-4000-8000-000000000201');
select pg_temp.client_results_assert(jsonb_array_length(public.get_minuta_client_results_v120(
  current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'))->'entries')=1,'list entry missing');
select pg_temp.client_results_assert(jsonb_array_length(public.get_minuta_client_results_v120(
  current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'))->'media')=1,'list media missing');
select pg_temp.client_results_assert((public.get_minuta_client_result_v120(
  current_setting('test.cr120.org')::uuid,current_setting('test.cr120.booking')::uuid)->'entry'->>'id')='00000000-0120-4000-8000-000000000001','singular entry missing');
select pg_temp.client_results_assert(jsonb_array_length(public.get_minuta_client_result_v120(
  current_setting('test.cr120.org')::uuid,current_setting('test.cr120.booking')::uuid)->'media')=1,'singular top-level media missing');
select pg_temp.client_results_assert(jsonb_array_length(public.get_minuta_client_records(
  current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'))->'entries')=0,'result duplicated in generic records');
select public.set_minuta_client_records_enabled(current_setting('test.cr120.org')::uuid,false);
select pg_temp.client_results_assert(jsonb_array_length(public.get_minuta_client_results_v120(
  current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'))->'entries')=0,'disabled list exposed results');
select pg_temp.client_results_assert(public.get_minuta_client_result_v120(
  current_setting('test.cr120.org')::uuid,current_setting('test.cr120.booking')::uuid)->'entry'='null'::jsonb,'disabled singular exposed result');
do $$ begin
  begin
    perform public.save_minuta_client_result_v120(current_setting('test.cr120.org')::uuid,current_setting('test.cr120.phone'),
      current_setting('test.cr120.booking')::uuid,'00000000-0120-4000-8000-000000000001','','','','',true,false,gen_random_uuid());
    raise exception 'v120: save accepted while disabled';
  exception when raise_exception then if sqlerrm<>'client_records_disabled' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
select pg_temp.client_results_denied(format(
  'select public.save_minuta_client_result_v120(%L::uuid,%L,%L::uuid,%L::uuid,%L,%L,%L,%L,true,false,%L::uuid)',
  current_setting('test.cr120.org'),current_setting('test.cr120.phone'),current_setting('test.cr120.booking'),
  '00000000-0120-4000-8000-000000000001','','','','','00000000-0120-4000-8000-000000000199'));
select set_config('request.jwt.claim.sub',current_setting('test.cr120.owner'),false);
select public.set_minuta_client_records_enabled(current_setting('test.cr120.org')::uuid,true);
select set_config('request.jwt.claim.sub','ffffffff-ffff-4fff-8fff-ffffffffffff',false);
select pg_temp.client_results_denied(format('select public.get_minuta_client_results_v120(%L::uuid,%L,0)',current_setting('test.cr120.org'),current_setting('test.cr120.phone')));
select pg_temp.client_results_denied('select public.complete_minuta_client_result_media_v120(''00000000-0120-4000-8000-000000000201'')');
select set_config('request.jwt.claim.sub',current_setting('test.cr120.owner'),false);
select public.archive_minuta_client_result_media_v120('00000000-0120-4000-8000-000000000201');
reset role;
select pg_temp.client_results_assert((select count(*)=1 from storage.objects where bucket_id='minuta-client-records' and name=current_setting('test.cr120.path')),'archive physically deleted media');

create function pg_temp.check_client_results_v120_rollback() returns void language plpgsql as $$ begin
  perform pg_temp.client_results_assert(to_regprocedure('public.get_minuta_client_results_v120(uuid,text,integer)') is null,'rollback left list RPC');
  perform pg_temp.client_results_assert((select count(*)=1 from public.client_result_series where id='00000000-0120-4000-8000-000000000001'),'rollback lost series');
  perform pg_temp.client_results_assert((select count(*)=2 from public.client_result_consents where result_id='00000000-0120-4000-8000-000000000001'),'rollback lost consent ledger');
end $$;
create function pg_temp.check_client_results_v120_reapply() returns void language plpgsql as $$ begin
  perform pg_temp.client_results_assert(to_regprocedure('public.get_minuta_client_results_v120(uuid,text,integer)') is not null,'reapply missing list RPC');
  perform pg_temp.client_results_assert((select count(*)=1 from public.client_result_series where id='00000000-0120-4000-8000-000000000001'),'reapply lost series');
end $$;
