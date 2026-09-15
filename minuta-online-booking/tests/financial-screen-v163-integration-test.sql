\set ON_ERROR_STOP on

-- Isolated PostgreSQL/Supabase CI only. The migration guard used by the CI
-- runner must reject production URLs before this script is invoked.
-- Prove that the empty v163 layer can be removed and reapplied before fixtures.
\ir ../supabase-migration-v163-rollback.sql
\ir ../supabase-migration-v163.sql

begin;
set local statement_timeout='60s';
set local lock_timeout='10s';

-- Fixed IDs are scoped to this rollback-only transaction.
set local session_replication_role='replica';
insert into auth.users(
  id,instance_id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('16300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','v163-owner@example.invalid',now(),'{}','{}',now(),now()),
  ('16300000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','v163-specialist@example.invalid',now(),'{}','{}',now(),now()),
  ('16300000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
    'authenticated','authenticated','v163-foreign@example.invalid',now(),'{}','{}',now(),now());

insert into public.performer_profiles(id,display_name) values
  ('16300000-0000-4000-8000-000000000001','V163 Owner'),
  ('16300000-0000-4000-8000-000000000002','V163 Specialist'),
  ('16300000-0000-4000-8000-000000000003','V163 Foreign');

insert into public.organizations(id,name,public_slug,created_by,status) values
  ('16300000-0000-4000-8000-000000000101','V163 finance test','v163-finance-test',
    '16300000-0000-4000-8000-000000000001','active'),
  ('16300000-0000-4000-8000-000000000102','V163 foreign test','v163-finance-foreign',
    '16300000-0000-4000-8000-000000000003','active');

insert into public.organization_memberships(
  organization_id,user_id,role,is_bookable,active
) values
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000001','owner',true,true),
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000002','specialist',true,true),
  ('16300000-0000-4000-8000-000000000102','16300000-0000-4000-8000-000000000003','owner',true,true);

insert into public.locations(id,organization_id,name,timezone,is_primary) values
  ('16300000-0000-4000-8000-000000000201','16300000-0000-4000-8000-000000000101',
    'V163 Samara','Europe/Samara',true),
  ('16300000-0000-4000-8000-000000000202','16300000-0000-4000-8000-000000000102',
    'V163 foreign','Europe/Moscow',true);

insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values
  ('16300000-0000-4000-8000-000000000301','16300000-0000-4000-8000-000000000001',
    'V163 service',60,1000,true);

insert into public.bookings(
  id,booking_code,manage_token,request_id,request_fingerprint,
  performer_id,service_id,client_name,client_phone,
  booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,
  status,deposit_amount_rub,payment_status,payment_url,
  organization_id,location_id,booking_scope_source,booking_source
) values
  ('16300000-0000-4000-8000-000000000401','V163-FALLBACK',gen_random_uuid(),
    '16300000-0000-4000-8000-000000000401',repeat('a',64),
    '16300000-0000-4000-8000-000000000001','16300000-0000-4000-8000-000000000301',
    'Fixture fallback','+79990000163',date '2020-01-10',time '10:00',60,1000,1000,
    'confirmed',0,'not_required','',
    '16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000201','team','client_online'),
  ('16300000-0000-4000-8000-000000000402','V163-LEDGER',gen_random_uuid(),
    '16300000-0000-4000-8000-000000000402',repeat('b',64),
    '16300000-0000-4000-8000-000000000001','16300000-0000-4000-8000-000000000301',
    'Fixture ledger','+79990000162',date '2020-01-11',time '11:00',60,1000,1000,
    'confirmed',0,'not_required','',
    '16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000201','team','client_online'),
  ('16300000-0000-4000-8000-000000000403','V163-UNKNOWN',gen_random_uuid(),
    '16300000-0000-4000-8000-000000000403',repeat('c',64),
    '16300000-0000-4000-8000-000000000001','16300000-0000-4000-8000-000000000301',
    'Fixture unknown','+79990000163',date '2020-01-12',time '12:00',60,1000,1000,
    'confirmed',0,'not_required','',
    '16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000201','team','client_online'),
  ('16300000-0000-4000-8000-000000000404','V163-CANCELLED',gen_random_uuid(),
    '16300000-0000-4000-8000-000000000404',repeat('d',64),
    '16300000-0000-4000-8000-000000000001','16300000-0000-4000-8000-000000000301',
    'Fixture cancelled','+79990000164',date '2020-01-13',time '13:00',60,1000,1000,
    'cancelled',0,'not_required','',
    '16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000201','team','client_online'),
  ('16300000-0000-4000-8000-000000000405','V163-NOSHOW',gen_random_uuid(),
    '16300000-0000-4000-8000-000000000405',repeat('e',64),
    '16300000-0000-4000-8000-000000000001','16300000-0000-4000-8000-000000000301',
    'Fixture no-show','+79990000165',date '2020-01-14',time '14:00',60,1000,1000,
    'confirmed',0,'not_required','',
    '16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000201','team','client_online');

insert into public.booking_outcomes(
  booking_id,performer_id,visit_status,payment_method,amount_rub,
  calculated_amount_rub,completion_source,updated_at
) values
  ('16300000-0000-4000-8000-000000000401','16300000-0000-4000-8000-000000000001',
    'completed','transfer',600,1000,'manual','2020-02-01T10:00:00Z'),
  ('16300000-0000-4000-8000-000000000402','16300000-0000-4000-8000-000000000001',
    'completed','transfer',600,1000,'manual','2020-02-11T08:00:00Z'),
  ('16300000-0000-4000-8000-000000000403','16300000-0000-4000-8000-000000000001',
    'completed','card',1000,1000,'manual','2020-01-12T09:00:00Z'),
  ('16300000-0000-4000-8000-000000000404','16300000-0000-4000-8000-000000000001',
    'completed','cash',1000,1000,'manual','2020-01-13T10:00:00Z'),
  ('16300000-0000-4000-8000-000000000405','16300000-0000-4000-8000-000000000001',
    'no_show','transfer',1000,1000,'manual','2020-01-14T11:00:00Z');
set local session_replication_role='origin';

-- Owner enables the existing ledger. v163's trigger seeds only this fixture.
set local role authenticated;
select set_config('request.jwt.claim.sub','16300000-0000-4000-8000-000000000001',true);
select public.set_minuta_finance_enabled_v133(
  '16300000-0000-4000-8000-000000000101',true
);
reset role;

insert into public.financial_accounts(
  id,organization_id,name,account_class,account_type,currency,
  creation_request_id,request_fingerprint,created_by
) values(
  '16300000-0000-4000-8000-000000000501','16300000-0000-4000-8000-000000000101',
  'V163 bank','asset','bank','RUB','16300000-0000-4000-8000-000000000511',repeat('1',64),
  '16300000-0000-4000-8000-000000000001'
);
insert into public.financial_accounts(
  id,organization_id,name,account_class,account_type,currency,system_key,created_by
) values(
  '16300000-0000-4000-8000-000000000502','16300000-0000-4000-8000-000000000101',
  'V163 product revenue','income','product_revenue','RUB','product_revenue',
  '16300000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','16300000-0000-4000-8000-000000000001',true);

do $empty_one_many$
declare v jsonb;
begin
  v:=public.get_minuta_finance_screen_v163(
    '16300000-0000-4000-8000-000000000101',date '2019-12-01',date '2019-12-31'
  );
  if (v->'summary'->>'received_minor')::bigint<>0
     or (v->'summary'->>'expense_minor')::bigint<>0
     or jsonb_array_length(v->'operations')<>0 then
    raise exception 'v163_empty_period_failed';
  end if;

  -- updated_at is in February, but fallback belongs to the January visit day.
  v:=public.get_minuta_finance_screen_v163(
    '16300000-0000-4000-8000-000000000101',date '2020-01-10',date '2020-01-10'
  );
  if (v->'summary'->>'received_minor')::bigint<>60000
     or (v->'summary'->>'services_minor')::bigint<>100000
     or (v->'summary'->>'debt_minor')::bigint<>40000
     or (v->'confidence'->>'completed_visits')::integer<>1
     or (v->'confidence'->>'unposted_payment_visits')::integer<>1
     or (v->'confidence'->>'result_reliable')::boolean
     or jsonb_array_length(v->'operations')<>1
     or v->'operations'->0->>'source_kind'<>'unposted_visit_payment' then
    raise exception 'v163_one_visit_fallback_failed';
  end if;
end
$empty_one_many$;

select public.post_minuta_visit_finance_v129(
  '16300000-0000-4000-8000-000000000101',
  '16300000-0000-4000-8000-000000000402',
  '16300000-0000-4000-8000-000000000501',
  '16300000-0000-4000-8000-000000000601'
);

do $ledger_dedupe$
declare v jsonb;
begin
  -- v129 stores outcome.updated_at (February) on the ledger transaction, but
  -- the projection must keep the posted visit on its January business day.
  v:=public.get_minuta_finance_screen_v163(
    '16300000-0000-4000-8000-000000000101',date '2020-01-11',date '2020-01-11'
  );
  if (v->'summary'->>'received_minor')::bigint<>60000
     or (v->'summary'->>'debt_minor')::bigint<>40000
     or (v->'confidence'->>'ledger_posted_visits')::integer<>1
     or (v->'confidence'->>'unposted_payment_visits')::integer<>0
     or jsonb_array_length(v->'operations')<>1
     or v->'operations'->0->>'kind'<>'income'
     or v->'operations'->0->>'source_kind'<>'visit_payment' then
    raise exception 'v163_ledger_dedupe_failed';
  end if;

  v:=public.get_minuta_finance_screen_v163(
    '16300000-0000-4000-8000-000000000101',date '2020-01-01',date '2020-01-31'
  );
  if (v->'summary'->>'received_minor')::bigint<>120000
     or (v->'summary'->>'services_minor')::bigint<>300000
     or (v->'summary'->>'debt_minor')::bigint<>80000
     or (v->'confidence'->>'completed_visits')::integer<>3
     or (v->'confidence'->>'payment_marked_visits')::integer<>2
     or (v->'confidence'->>'unknown_payment_visits')::integer<>1
     or (v->'confidence'->>'result_reliable')::boolean then
    raise exception 'v163_many_visit_truthfulness_failed';
  end if;
end
$ledger_dedupe$;

do $expense_idempotency$
declare
  v_category uuid;
  v_first jsonb;
  v_replay jsonb;
begin
  select id into v_category from public.organization_finance_categories_v163
  where organization_id='16300000-0000-4000-8000-000000000101'
    and system_key='materials';
  if v_category is null then raise exception 'v163_default_categories_missing'; end if;

  v_first:=public.record_minuta_manual_expense_v163(
    '16300000-0000-4000-8000-000000000101',v_category,
    'V163 supplier','Материалы для работы',12345,
    '16300000-0000-4000-8000-000000000501',date '2020-01-11',
    '16300000-0000-4000-8000-000000000001',
    '16300000-0000-4000-8000-000000000602'
  );
  v_replay:=public.record_minuta_manual_expense_v163(
    '16300000-0000-4000-8000-000000000101',v_category,
    'V163 supplier','Материалы для работы',12345,
    '16300000-0000-4000-8000-000000000501',date '2020-01-11',
    '16300000-0000-4000-8000-000000000001',
    '16300000-0000-4000-8000-000000000602'
  );
  if v_first->>'id' is distinct from v_replay->>'id'
     or not (v_replay->>'replayed')::boolean then
    raise exception 'v163_expense_lost_ack_replay_failed';
  end if;
  begin
    perform public.record_minuta_manual_expense_v163(
      '16300000-0000-4000-8000-000000000101',v_category,
      'V163 supplier','Материалы для работы',12346,
      '16300000-0000-4000-8000-000000000501',date '2020-01-11',
      '16300000-0000-4000-8000-000000000001',
      '16300000-0000-4000-8000-000000000602'
    );
    raise exception 'v163_expense_conflict_not_raised';
  exception when unique_violation then
    if sqlerrm<>'manual_expense_idempotency_conflict' then raise; end if;
  end;
  if (select count(*) from public.financial_manual_expenses_v163
      where organization_id='16300000-0000-4000-8000-000000000101'
        and request_id='16300000-0000-4000-8000-000000000602')<>1 then
    raise exception 'v163_expense_duplicate_row_created';
  end if;
end
$expense_idempotency$;

reset role;

-- Balanced synthetic sale/refund/reversal fixtures exercise the read model
-- without invoking a real sale, inventory movement, payment, or refund.
insert into public.financial_transactions(
  id,organization_id,request_id,request_fingerprint,operation_type,source_type,
  source_id,source_fingerprint,reversal_of,occurred_at,explanation,created_by
) values
  ('16300000-0000-4000-8000-000000000701','16300000-0000-4000-8000-000000000101',
    '16300000-0000-4000-8000-000000000711',repeat('2',64),'commercial_sale','commercial_sale',
    '16300000-0000-4000-8000-000000000721',repeat('3',64),null,'2020-01-15T09:00:00Z','{"fixture":"sale"}',
    '16300000-0000-4000-8000-000000000001'),
  ('16300000-0000-4000-8000-000000000702','16300000-0000-4000-8000-000000000101',
    '16300000-0000-4000-8000-000000000712',repeat('4',64),'commercial_refund','commercial_sale_refund',
    '16300000-0000-4000-8000-000000000722',repeat('5',64),null,'2020-01-16T09:00:00Z','{"fixture":"refund"}',
    '16300000-0000-4000-8000-000000000001'),
  ('16300000-0000-4000-8000-000000000703','16300000-0000-4000-8000-000000000101',
    '16300000-0000-4000-8000-000000000713',repeat('6',64),'reversal','financial_transaction',
    '16300000-0000-4000-8000-000000000702',repeat('7',64),
    '16300000-0000-4000-8000-000000000702','2020-01-17T09:00:00Z','{"fixture":"refund_reversal"}',
    '16300000-0000-4000-8000-000000000001');

insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor) values
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000701',
    '16300000-0000-4000-8000-000000000501','debit',50000),
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000701',
    '16300000-0000-4000-8000-000000000502','credit',50000),
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000702',
    '16300000-0000-4000-8000-000000000502','debit',20000),
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000702',
    '16300000-0000-4000-8000-000000000501','credit',20000),
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000703',
    '16300000-0000-4000-8000-000000000502','credit',20000),
  ('16300000-0000-4000-8000-000000000101','16300000-0000-4000-8000-000000000703',
    '16300000-0000-4000-8000-000000000501','debit',20000);
set constraints all immediate;
set constraints all deferred;

set local role authenticated;
select set_config('request.jwt.claim.sub','16300000-0000-4000-8000-000000000001',true);

do $refund_reversal_net$
declare v jsonb; v_received bigint; v_expense bigint; v_net bigint;
begin
  v:=public.get_minuta_finance_screen_v163(
    '16300000-0000-4000-8000-000000000101',date '2020-01-01',date '2020-01-31',null,100
  );
  v_received:=(v->'summary'->>'received_minor')::bigint;
  v_expense:=(v->'summary'->>'expense_minor')::bigint;
  v_net:=(v->'summary'->>'net_minor')::bigint;
  if v_received<>170000 or v_expense<>12345 or v_net<>157655
     or v_net<>v_received-v_expense then
    raise exception 'v163_net_invariant_failed received=% expense=% net=%',v_received,v_expense,v_net;
  end if;
  if not exists(select 1 from jsonb_array_elements(v->'operations') operation
      where operation->>'kind'='refund' and (operation->>'amount_minor')::bigint=-20000)
     or not exists(select 1 from jsonb_array_elements(v->'operations') operation
      where operation->>'kind'='correction'
        and operation->>'source_kind'='sale_refund'
        and (operation->>'amount_minor')::bigint=20000) then
    raise exception 'v163_refund_reversal_operations_failed';
  end if;

  v:=public.get_minuta_finance_screen_v163(
    '16300000-0000-4000-8000-000000000101',date '2020-01-01',date '2020-01-31',null,1
  );
  if not (v->>'has_more')::boolean or v->'next_cursor' is null
     or jsonb_array_length(v->'operations')<>1 then
    raise exception 'v163_operation_pagination_failed';
  end if;
end
$refund_reversal_net$;

-- Specialist and cross-organization owner cannot read or write this ledger.
select set_config('request.jwt.claim.sub','16300000-0000-4000-8000-000000000002',true);
do $specialist_acl$
begin
  begin
    perform public.get_minuta_finance_screen_v163(
      '16300000-0000-4000-8000-000000000101',date '2020-01-01',date '2020-01-31'
    );
    raise exception 'v163_specialist_read_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'financial_manager_role_required' then raise; end if;
  end;
end
$specialist_acl$;

select set_config('request.jwt.claim.sub','16300000-0000-4000-8000-000000000003',true);
do $cross_org_acl$
declare v_count integer;
begin
  begin
    perform public.get_minuta_finance_screen_v163(
      '16300000-0000-4000-8000-000000000101',date '2020-01-01',date '2020-01-31'
    );
    raise exception 'v163_cross_org_read_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'financial_manager_role_required' then raise; end if;
  end;
  begin
    perform public.initialize_minuta_finance_screen_v163(
      '16300000-0000-4000-8000-000000000101'
    );
    raise exception 'v163_cross_org_write_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'financial_manager_role_required' then raise; end if;
  end;
  select count(*) into v_count from public.financial_manual_expenses_v163
  where organization_id='16300000-0000-4000-8000-000000000101';
  if v_count<>0 then raise exception 'v163_cross_org_rls_leak'; end if;
end
$cross_org_acl$;

reset role;
rollback;

-- Schema remains applied; only isolated fixture data was rolled back.
do $post_test_schema$
begin
  if to_regprocedure(
      'public.get_minuta_finance_screen_v163(uuid,date,date,uuid,integer,timestamp with time zone,text)'
    ) is null
     or to_regclass('public.financial_manual_expenses_v163') is null then
    raise exception 'v163_post_test_schema_missing';
  end if;
end
$post_test_schema$;

select 'financial screen v163 integration: empty/one/many, fallback/dedupe, expense, ACL, refund/reversal, net and rollback/reapply OK' result;
