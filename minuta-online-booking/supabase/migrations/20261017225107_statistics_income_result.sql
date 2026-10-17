-- Expand-only candidate. No historical payments are posted by this migration.
-- Existing v106/v129 readers and writers are preserved. ROOT owns deployment.
begin;

create or replace function public.get_minuta_visit_payment_capabilities_v1(p_organization uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_zone text;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  select timezone into v_zone from public.locations where organization_id=p_organization and active order by is_primary desc,id limit 1;
  v_zone:=coalesce(v_zone,'Europe/Samara');
  return jsonb_build_object('schema','minuta-visit-payment-v1','organization_id',p_organization,
    'enabled',coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false),
    'today',(now() at time zone v_zone)::date,'timezone',v_zone,
    'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'type',account_type) order by name,id)
      from public.financial_accounts where organization_id=p_organization and active and account_type in('cash','bank')),'[]'::jsonb));
end $$;

create or replace function public._post_minuta_visit_payment_v1(
  p_organization uuid,p_booking uuid,p_destination_account uuid,p_request_id uuid,
  p_paid_on date,p_expected_fingerprint text,p_outcome_request_fingerprint text default null
)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_timezone text;
  v_actor uuid;
  v_source record;
  v_destination public.financial_accounts%rowtype;
  v_receivable uuid;
  v_revenue uuid;
  v_request_fingerprint text;
  v_existing public.financial_transactions%rowtype;
  v_transaction uuid;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_booking is null or p_request_id is null or p_paid_on is null then
    raise exception using errcode='22023',message='invalid_financial_visit_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':booking:'||p_booking::text,129));
  perform 1 from public.bookings where id=p_booking and organization_id=p_organization for update;
  perform 1 from public.booking_outcomes where booking_id=p_booking for update;
  select * into v_source from public.minuta_financial_booking_source_v129(p_organization,p_booking);
  select timezone into v_timezone from public.locations where organization_id=p_organization and active order by is_primary desc,id limit 1;
  v_timezone:=coalesce(v_timezone,'Europe/Samara');
  if p_paid_on<date '2000-01-01' or p_paid_on>(now() at time zone v_timezone)::date then
    raise exception using errcode='22023',message='invalid_payment_date';
  end if;
  if p_expected_fingerprint is not null and p_expected_fingerprint is distinct from v_source.source_fingerprint then
    raise exception using errcode='40001',message='visit_payment_source_changed';
  end if;
  if v_source.blocked_reason is not null then
    raise exception using errcode='55000',message=v_source.blocked_reason;
  end if;

  if v_source.received_minor>0 then
    if p_destination_account is null then
      raise exception using errcode='22023',message='destination_account_required';
    end if;
    select * into v_destination from public.financial_accounts
    where id=p_destination_account and organization_id=p_organization and active for update;
    if not found or (v_source.payment_method='cash' and v_destination.account_type<>'cash')
       or (v_source.payment_method='transfer' and v_destination.account_type<>'bank') then
      raise exception using errcode='22023',message='destination_account_type_mismatch';
    end if;
  elsif p_destination_account is not null then
    raise exception using errcode='22023',message='unpaid_visit_must_not_select_cash_account';
  end if;

  select id into v_receivable from public.financial_accounts
    where organization_id=p_organization and system_key='receivable' and active;
  select id into v_revenue from public.financial_accounts
    where organization_id=p_organization and system_key='service_revenue' and active;
  if v_receivable is null or v_revenue is null then
    raise exception using errcode='55000',message='financial_system_accounts_missing';
  end if;

  v_request_fingerprint:=public.minuta_financial_sha256_v129(jsonb_build_array(
    p_organization,p_request_id,'visit_service',p_booking,v_source.source_fingerprint,p_destination_account,p_paid_on,p_outcome_request_fingerprint
  ));
  select * into v_existing from public.financial_transactions
  where organization_id=p_organization and request_id=p_request_id for update;
  perform 1 from public.organization_finance_settings where organization_id=p_organization for update;
  v_actor:=public.require_minuta_financial_manager_v129(p_organization);
  if not coalesce((select enabled from public.organization_finance_settings where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='finance_disabled';
  end if;
  if v_existing.id is not null then
    if v_existing.request_fingerprint<>v_request_fingerprint then
      raise exception using errcode='23505',message='financial_transaction_idempotency_conflict';
    end if;
    return jsonb_build_object('id',v_existing.id,'organization_id',p_organization,
      'request_id',p_request_id,'source_fingerprint',v_existing.source_fingerprint,'replayed',true);
  end if;
  if exists(
    select 1 from public.financial_transactions txn
    where txn.organization_id=p_organization
      and txn.operation_type='visit_service'
      and txn.source_type='booking_outcome' and txn.source_id=p_booking
      and not exists(select 1 from public.financial_transactions reversal
        where reversal.organization_id=p_organization and reversal.reversal_of=txn.id)
  ) then
    raise exception using errcode='23505',message='financial_visit_already_posted';
  end if;

  insert into public.financial_transactions(
    organization_id,request_id,request_fingerprint,operation_type,source_type,source_id,
    source_fingerprint,occurred_at,explanation,created_by
  ) values(
    p_organization,p_request_id,v_request_fingerprint,'visit_service','booking_outcome',p_booking,
    v_source.source_fingerprint,(p_paid_on::timestamp at time zone v_timezone),
    jsonb_build_object(
      'schema','minuta-financial-explanation-v1','source_kind','booking_outcome',
      'payment_date',p_paid_on,'date_precision','day',
      'outcome_request_fingerprint',p_outcome_request_fingerprint,
      'outcome',(select to_jsonb(o) from public.booking_outcomes o where o.booking_id=p_booking),
      'source_id',p_booking,'source_updated_at',v_source.source_updated_at,
      'evidence_kind','staff_recorded','visit_status','completed',
      'completion_source','manual','payment_method',v_source.payment_method,
      'service_value_minor',v_source.service_value_minor,'received_minor',v_source.received_minor,
      'debt_minor',v_source.debt_minor,'currency','RUB'
    ),v_actor
  ) returning id into v_transaction;
  if v_source.received_minor>0 then
    insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
    values(p_organization,v_transaction,p_destination_account,'debit',v_source.received_minor);
  end if;
  if v_source.debt_minor>0 then
    insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
    values(p_organization,v_transaction,v_receivable,'debit',v_source.debt_minor);
  end if;
  insert into public.financial_postings(organization_id,transaction_id,account_id,side,amount_minor)
  values(p_organization,v_transaction,v_revenue,'credit',v_source.service_value_minor);

  return jsonb_build_object('id',v_transaction,'organization_id',p_organization,
    'request_id',p_request_id,'source_fingerprint',v_source.source_fingerprint,
    'service_value_minor',v_source.service_value_minor,'received_minor',v_source.received_minor,
    'debt_minor',v_source.debt_minor,'currency','RUB','replayed',false);
end
$$;


-- This helper has no client grants; public RPCs perform their own context checks.
revoke all on function public._post_minuta_visit_payment_v1(uuid,uuid,uuid,uuid,date,text,text) from public,anon,authenticated,service_role;

create or replace function public.post_minuta_unposted_visit_payment_v1(
  p_organization uuid,p_booking uuid,p_destination_account uuid,p_request_id uuid,
  p_paid_on date,p_expected_fingerprint text)
returns jsonb language plpgsql security definer set search_path to '' as $$
begin
  if p_expected_fingerprint is null or p_expected_fingerprint!~'^[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='visit_payment_source_required';
  end if;
  return public._post_minuta_visit_payment_v1(p_organization,p_booking,p_destination_account,p_request_id,p_paid_on,p_expected_fingerprint,null);
end $$;

create or replace function public.save_minuta_visit_payment_v1(
  p_booking uuid,p_payment_method text,p_amount_rub integer,p_actual_duration_minutes integer,
  p_paid_on date,p_destination_account uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_org uuid; v_actor uuid; v_fp text; v_existing public.financial_transactions%rowtype; v_outcome jsonb; v_receipt jsonb;
begin
  if p_booking is null or p_request_id is null or p_payment_method not in('cash','transfer') or p_amount_rub is null or p_amount_rub<=0 then
    raise exception using errcode='22023',message='invalid_visit_payment';
  end if;
  select organization_id into v_org from public.bookings where id=p_booking;
  if v_org is null then raise exception using errcode='42501',message='financial_manager_role_required'; end if;
  if auth.uid() is null or not public.has_organization_role(v_org,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':financial-ledger',129));
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||p_request_id::text,129));
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':booking:'||p_booking::text,129));
  perform 1 from public.bookings where id=p_booking and organization_id=v_org for update;
  v_actor:=public.require_minuta_financial_manager_v129(v_org);
  v_fp:=public.minuta_financial_sha256_v129(jsonb_build_array(v_org,p_booking,p_payment_method,p_amount_rub,p_actual_duration_minutes,p_paid_on,p_destination_account));
  select * into v_existing from public.financial_transactions where organization_id=v_org and request_id=p_request_id for update;
  if v_existing.id is not null then
    if v_existing.explanation->>'outcome_request_fingerprint' is distinct from v_fp then
      raise exception using errcode='23505',message='financial_transaction_idempotency_conflict';
    end if;
    if not coalesce((select enabled from public.organization_finance_settings where organization_id=v_org),false) then
      raise exception using errcode='55000',message='finance_disabled';
    end if;
    return jsonb_build_object('outcome',v_existing.explanation->'outcome','id',v_existing.id,'organization_id',v_org,'replayed',true);
  end if;
  v_outcome:=public.save_minuta_booking_outcome_v106(p_booking,'completed',p_payment_method,p_amount_rub,p_actual_duration_minutes,'manual');
  v_receipt:=public._post_minuta_visit_payment_v1(v_org,p_booking,p_destination_account,p_request_id,p_paid_on,null,v_fp);
  return v_receipt||jsonb_build_object('outcome',v_outcome);
end $$;

create or replace function public.get_minuta_unposted_visit_payments_v1(
  p_organization uuid,p_start date,p_end date,p_performer uuid default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not public.has_organization_role(p_organization,array['owner','admin']) then
    raise exception using errcode='42501',message='financial_manager_role_required';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>3661 then
    raise exception using errcode='22023',message='invalid_financial_period';
  end if;
  with candidates as (
    select b.id,b.booking_date,s.name service_name,source.*
    from public.bookings b join public.services s on s.id=b.service_id
    join public.booking_outcomes o on o.booking_id=b.id
    cross join lateral public.minuta_financial_booking_source_v129(p_organization,b.id) source
    where b.organization_id=p_organization and b.booking_date between p_start and p_end
      and (p_performer is null or b.performer_id=p_performer)
      and o.visit_status='completed' and o.completion_source='manual' and o.payment_method in('cash','transfer') and o.amount_rub>0
      and source.blocked_reason is null
      and not exists(select 1 from public.financial_transactions t where t.organization_id=p_organization and t.operation_type='visit_service'
        and t.source_type='booking_outcome' and t.source_id=b.id
        and not exists(select 1 from public.financial_transactions r where r.organization_id=p_organization and r.reversal_of=t.id))
  ) select jsonb_build_object('schema','minuta-unposted-visit-payments-v1','organization_id',p_organization,
    'period',jsonb_build_object('start',p_start,'end',p_end),'selected_performer_id',p_performer,
    'total_count',(select count(*) from candidates),'total_minor',coalesce((select sum(received_minor) from candidates),0),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('bookingId',id,'bookingDate',booking_date,'label',service_name,
      'amountMinor',received_minor,'paymentMethod',payment_method,'sourceFingerprint',source_fingerprint,'sourceUpdatedAt',source_updated_at) order by booking_date,id)
      from(select * from candidates order by booking_date,id limit 100) page),'[]'::jsonb)) into v_result;
  return v_result;
end $$;

revoke all on function public.get_minuta_visit_payment_capabilities_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_minuta_unposted_visit_payments_v1(uuid,date,date,uuid) from public,anon,authenticated,service_role;
revoke all on function public.post_minuta_unposted_visit_payment_v1(uuid,uuid,uuid,uuid,date,text) from public,anon,authenticated,service_role;
revoke all on function public.save_minuta_visit_payment_v1(uuid,text,integer,integer,date,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_visit_payment_capabilities_v1(uuid) to authenticated;
grant execute on function public.get_minuta_unposted_visit_payments_v1(uuid,date,date,uuid) to authenticated;
grant execute on function public.post_minuta_unposted_visit_payment_v1(uuid,uuid,uuid,uuid,date,text) to authenticated;
grant execute on function public.save_minuta_visit_payment_v1(uuid,text,integer,integer,date,uuid,uuid) to authenticated;
commit;
