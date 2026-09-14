\set ON_ERROR_STOP on

begin;
set local statement_timeout='90s';
set local lock_timeout='15s';
set local search_path=public,extensions,pg_catalog;

create function pg_temp.v163_assert(ok boolean,label text)
returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'v163_assert:%',label; end if; end $$;

do $test$
<<fixture>>
declare
  owner_id uuid:=gen_random_uuid(); specialist_id uuid:=gen_random_uuid(); outsider_id uuid:=gen_random_uuid();
  organization_id uuid:=gen_random_uuid(); foreign_organization_id uuid:=gen_random_uuid(); location_id uuid:=gen_random_uuid();
  cash_id uuid; expense_id uuid; add_request uuid:=gen_random_uuid(); reverse_request uuid:=gen_random_uuid(); payload jsonb;
  today_date date:=current_date;
begin
  perform pg_temp.v163_assert(to_regclass('public.financial_expense_metadata') is not null,'metadata_table');
  perform pg_temp.v163_assert(to_regprocedure('public.record_minuta_expense_v163(uuid,text,smallint,text,bigint,date,uuid,uuid)') is not null,'record_rpc');
  perform pg_temp.v163_assert(has_function_privilege('authenticated','public.record_minuta_expense_v163(uuid,text,smallint,text,bigint,date,uuid,uuid)','EXECUTE'),'record_authenticated');
  perform pg_temp.v163_assert(not has_function_privilege('anon','public.record_minuta_expense_v163(uuid,text,smallint,text,bigint,date,uuid,uuid)','EXECUTE'),'record_anon_denied');

  set local session_replication_role=replica;
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
    (owner_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',owner_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (specialist_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',specialist_id::text||'@example.invalid',now(),'{}','{}',now(),now()),
    (outsider_id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',outsider_id::text||'@example.invalid',now(),'{}','{}',now(),now());
  set local session_replication_role=origin;
  insert into public.performer_profiles(id,display_name) values(owner_id,'V163 owner'),(specialist_id,'V163 specialist'),(outsider_id,'V163 outsider');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled,created_by) values
    (organization_id,'V163 organization','v163-'||replace(organization_id::text,'-',''),'active',true,owner_id),
    (foreign_organization_id,'V163 foreign','v163-'||replace(foreign_organization_id::text,'-',''),'active',true,outsider_id);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values
    (organization_id,owner_id,'owner',true,true,owner_id),
    (organization_id,specialist_id,'specialist',true,true,owner_id),
    (foreign_organization_id,outsider_id,'owner',true,true,outsider_id);
  insert into public.locations(id,organization_id,name,timezone,address,active,is_primary)
    values(location_id,organization_id,'V163 location','Europe/Samara','V163 address',true,true);

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform public.set_minuta_finance_enabled_v133(organization_id,true);
  payload:=public.create_minuta_financial_account_v129(organization_id,gen_random_uuid(),'Основная касса','cash');
  cash_id:=(payload->>'id')::uuid;

  payload:=public.record_minuta_expense_v163(organization_id,'materials',1,'Масло и простыни',125050,today_date,cash_id,add_request);
  expense_id:=(payload->>'expense_id')::uuid;
  perform pg_temp.v163_assert(not (payload->>'replayed')::boolean,'first_add');
  perform pg_temp.v163_assert((select count(*)=1 from public.financial_expense_metadata where organization_id=fixture.organization_id and request_id=add_request),'one_metadata_row');
  perform pg_temp.v163_assert((select count(*)=2 from public.financial_transactions where organization_id=fixture.organization_id and source_id=expense_id and operation_type in('supplier_expense_accrual','supplier_expense_payment')),'two_ledger_transactions');

  payload:=public.record_minuta_expense_v163(organization_id,'materials',1,'Масло и простыни',125050,today_date,cash_id,add_request);
  perform pg_temp.v163_assert((payload->>'replayed')::boolean and (payload->>'expense_id')::uuid=expense_id,'add_replay');
  begin
    perform public.record_minuta_expense_v163(organization_id,'rent',1,'Другая нагрузка',125050,today_date,cash_id,add_request);
    raise exception 'v163_add_conflict_accepted';
  exception when unique_violation then null;
  end;

  payload:=public.get_minuta_finance_expenses_v163(organization_id,today_date,today_date);
  perform pg_temp.v163_assert((payload->>'expense_minor')::bigint=125050,'expense_total');
  perform pg_temp.v163_assert(payload->>'timezone'='Europe/Samara','organization_timezone');
  perform pg_temp.v163_assert(payload->>'category_version'='1','category_version');
  perform pg_temp.v163_assert(jsonb_array_length(payload->'daily_expenses')=1 and jsonb_array_length(payload->'expense_structure')=1 and jsonb_array_length(payload->'operations')=1,'read_collections');
  perform pg_temp.v163_assert(jsonb_array_length(payload->'accounts')=1,'cash_account');

  perform set_config('request.jwt.claim.sub',specialist_id::text,true);
  begin
    perform public.get_minuta_finance_expenses_v163(organization_id,today_date,today_date);
    raise exception 'v163_specialist_read_accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_minuta_expense_v163(organization_id,'other',1,'Недопустимая запись',100,today_date,cash_id,gen_random_uuid());
    raise exception 'v163_specialist_write_accepted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  begin
    perform public.get_minuta_finance_expenses_v163(organization_id,today_date,today_date);
    raise exception 'v163_outsider_read_accepted';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  payload:=public.reverse_minuta_expense_v163(organization_id,expense_id,reverse_request,'operator_correction');
  perform pg_temp.v163_assert((payload->>'reversed')::boolean and not (payload->>'replayed')::boolean,'first_reversal');
  payload:=public.reverse_minuta_expense_v163(organization_id,expense_id,reverse_request,'operator_correction');
  perform pg_temp.v163_assert((payload->>'replayed')::boolean,'reversal_replay');
  payload:=public.get_minuta_finance_expenses_v163(organization_id,today_date,today_date);
  perform pg_temp.v163_assert((payload->>'expense_minor')::bigint=0,'reversed_total');
  perform pg_temp.v163_assert((payload#>>'{operations,0,reversed}')::boolean,'reversed_operation_visible');

  begin
    update public.financial_expense_metadata set description='Незаметная правка' where source_id=expense_id;
    raise exception 'v163_metadata_update_accepted';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.financial_expense_metadata where source_id=expense_id;
    raise exception 'v163_metadata_delete_accepted';
  exception when sqlstate '55000' then null;
  end;
end
$test$;

rollback;
