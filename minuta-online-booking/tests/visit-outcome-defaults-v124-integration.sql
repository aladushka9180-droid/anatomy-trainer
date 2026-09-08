\set ON_ERROR_STOP on

do $$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef('public.process_minuta_auto_completed_visits_v106(integer)'::regprocedure) into definition;
  if not exists(
       select 1 from information_schema.columns
       where table_schema='public' and table_name='booking_policies'
         and column_name='auto_complete_payment_method' and data_type='text' and is_nullable='NO'
     )
     or not exists(
       select 1 from pg_constraint
       where conrelid='public.booking_policies'::regclass
         and conname='booking_policies_auto_complete_payment_method_check' and convalidated
     )
     or position('policy.auto_complete_payment_method' in definition)=0
     or position('case when v_payment=''unpaid'' then 0 else v_value end' in definition)=0
     or has_function_privilege('authenticated','public.process_minuta_auto_completed_visits_v106(integer)','EXECUTE') then
    raise exception 'v124_integration_contract_failed';
  end if;
end $$;

begin;
do $$
declare performer uuid;
begin
  select performer_id into performer from public.booking_policies order by performer_id limit 1;
  if performer is not null then
    update public.booking_policies set auto_complete_payment_method='transfer' where performer_id=performer;
    if (select auto_complete_payment_method from public.booking_policies where performer_id=performer)<>'transfer' then
      raise exception 'v124_transfer_setting_failed';
    end if;
    update public.booking_policies set auto_complete_payment_method='unpaid' where performer_id=performer;
    if (select auto_complete_payment_method from public.booking_policies where performer_id=performer)<>'unpaid' then
      raise exception 'v124_unpaid_setting_failed';
    end if;
  end if;
end $$;
rollback;
