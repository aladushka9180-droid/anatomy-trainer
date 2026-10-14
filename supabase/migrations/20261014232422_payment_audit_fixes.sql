-- Payment audit F01/F02/F05. Apply only via the release owner's protected DB gates.
-- Order: migration -> new refund handler -> frontend. Old refund handler fails closed.
-- Does not enable payment settings, install credentials, or call a provider.
begin;
alter table public.payment_provider_refunds add column if not exists first_provider_request_at timestamptz;
-- Existing unknown operations may already have reached the provider. Use a
-- conservative lower bound; never extend their retry window on first claim.
update public.payment_provider_refunds set first_provider_request_at=created_at
where first_provider_request_at is null and status in ('creating','pending');

create or replace function public.get_minuta_payment_workspace(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_role text; v_setting public.organization_payment_provider_settings%rowtype;
begin
  v_role:=public.require_minuta_payment_role(p_organization,auth.uid(),array['owner','admin']);
  select * into v_setting from public.organization_payment_provider_settings setting
  where setting.organization_id=p_organization;
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'settings',jsonb_build_object(
      'enabled',coalesce(v_setting.enabled,false),'provider','yookassa',
      'environment',coalesce(v_setting.environment,'test'),
      'fiscalization_enabled',coalesce(v_setting.fiscalization_enabled,false),
      'taxation',v_setting.taxation,'vat_code',v_setting.vat_code,'payment_mode',v_setting.payment_mode
    ),
    'recent_attempts',coalesce((select jsonb_agg(row.payload order by row.created_at desc,row.id desc)
      from (select attempt.created_at,attempt.id,jsonb_build_object(
          'id',attempt.id,'booking_id',attempt.booking_id,'amount_minor',attempt.amount_minor,
          'currency',attempt.currency,'status',attempt.status,'captured_amount_minor',attempt.captured_amount_minor,
          'refunded_amount_minor',attempt.refunded_amount_minor,'environment',attempt.environment,
          'reserved_refund_amount_minor',balance.reserved_minor,
          'refundable_amount_minor',greatest(0,attempt.captured_amount_minor-attempt.refunded_amount_minor-balance.reserved_minor),
          'refund_in_progress',balance.in_progress,
          'created_at',attempt.created_at,'updated_at',attempt.updated_at,'last_error_code',attempt.last_error_code
        ) payload from public.payment_provider_attempts attempt
        left join lateral (
          select coalesce(sum(refund.amount_minor),0)::bigint reserved_minor,count(*)>0 in_progress
          from public.payment_provider_refunds refund
          where refund.attempt_id=attempt.id and refund.organization_id=p_organization
            and refund.status in ('creating','pending')
        ) balance on true
        where attempt.organization_id=p_organization order by attempt.created_at desc,attempt.id desc limit 50) row),'[]'::jsonb),
    'recent_refunds',coalesce((select jsonb_agg(row.payload order by row.created_at desc,row.id desc)
      from (select refund.created_at,refund.id,jsonb_build_object(
          'id',refund.id,'attempt_id',refund.attempt_id,'amount_minor',refund.amount_minor,
          'currency',refund.currency,'status',refund.status,'reason',refund.reason,
          'created_at',refund.created_at,'updated_at',refund.updated_at,'last_error_code',refund.last_error_code
        ) payload from public.payment_provider_refunds refund
        where refund.organization_id=p_organization order by refund.created_at desc,refund.id desc limit 50) row),'[]'::jsonb),
    'recent_reconciliations',coalesce((select jsonb_agg(row.payload order by row.checked_at desc,row.id desc)
      from (select reconciliation.checked_at,reconciliation.id,jsonb_build_object(
          'object_kind',reconciliation.object_kind,'attempt_id',reconciliation.attempt_id,
          'refund_id',reconciliation.refund_id,'provider_status',reconciliation.provider_status,
          'amount_minor',reconciliation.amount_minor,'currency',reconciliation.currency,
          'source',reconciliation.source,'outcome',reconciliation.outcome,
          'error_code',reconciliation.error_code,'checked_at',reconciliation.checked_at
        ) payload from public.payment_provider_reconciliations reconciliation
        where reconciliation.organization_id=p_organization
        order by reconciliation.checked_at desc,reconciliation.id desc limit 50) row),'[]'::jsonb)
  );
end $$;

create or replace function public.prepare_yookassa_payment(p_manage_token uuid,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_booking public.bookings%rowtype; v_setting public.organization_payment_provider_settings%rowtype;
  v_attempt public.payment_provider_attempts%rowtype; v_service_name text; v_amount bigint;
begin
  if p_manage_token is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='invalid_payment_request';
  end if;
  select booking.* into v_booking from public.bookings booking where booking.manage_token=p_manage_token;
  if not found then raise exception using errcode='P0002',message='booking_unavailable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.id::text,8701));
  select booking.* into v_booking from public.bookings booking
  where booking.manage_token=p_manage_token for update;
  if not found then raise exception using errcode='P0002',message='booking_unavailable'; end if;
  select * into v_setting from public.organization_payment_provider_settings setting
  where setting.organization_id=v_booking.organization_id;
  v_amount:=v_booking.deposit_amount_rub::bigint*100;
  perform pg_advisory_xact_lock(hashtextextended(v_booking.organization_id::text||':'||p_idempotency_key::text,8702));
  select * into v_attempt from public.payment_provider_attempts attempt
  where attempt.organization_id=v_booking.organization_id and attempt.idempotency_key=p_idempotency_key for update;
  if found then
    if v_attempt.booking_id is distinct from v_booking.id or v_attempt.amount_minor is distinct from v_amount
      or v_attempt.currency is distinct from 'RUB' or v_attempt.environment is distinct from v_setting.environment then
      raise exception using errcode='23505',message='payment_idempotency_conflict';
    end if;
    -- Recover this exact confirmed operation before rejecting a new payment.
    -- A different key still follows the normal paid/expired/disabled guards.
    if v_attempt.status='succeeded' and v_attempt.provider_payment_id is not null
      and v_attempt.captured_amount_minor=v_attempt.amount_minor then
  select service.name into v_service_name from public.services service where service.id=v_booking.service_id;
  return jsonb_build_object(
    'mode','yookassa','enabled',true,'attempt_id',v_attempt.id,'organization_id',v_booking.organization_id,
    'booking_id',v_booking.id,'booking_code',v_booking.booking_code,'environment',v_attempt.environment,
    'idempotency_key',v_attempt.idempotency_key,'amount_minor',v_attempt.amount_minor,
    'currency',v_attempt.currency,'status',v_attempt.status,
    'provider_payment_id',v_attempt.provider_payment_id,'confirmation_url',v_attempt.confirmation_url,
    'client_phone',v_booking.client_phone,'service_name',coalesce(v_service_name,'Услуга'),
    'fiscalization_enabled',v_setting.fiscalization_enabled,'taxation',v_setting.taxation,
    'vat_code',v_setting.vat_code,'payment_mode',v_setting.payment_mode
  );
    end if;
  end if;
  if v_booking.status='cancelled' or v_booking.deposit_amount_rub<=0 then
    raise exception using errcode='P0001',message='booking_payment_not_available';
  end if;
  if v_booking.payment_status is distinct from 'pending' then
    raise exception using errcode='P0001',message='booking_payment_not_pending';
  end if;
  if v_booking.payment_due_at is not null and v_booking.payment_due_at<=now() then
    raise exception using errcode='P0001',message='booking_payment_expired';
  end if;
  if not coalesce(v_setting.enabled,false) then
    return jsonb_build_object(
      'mode','legacy_link','enabled',false,'booking_id',v_booking.id,
      'fallback_url',case when coalesce(v_booking.payment_url,'')~*'^https://' then v_booking.payment_url else null end
    );
  end if;
  if v_attempt.id is null then
    -- A browser may lose its local request id after navigation or a crash. Reuse
    -- the one open provider operation for this exact booking instead of creating
    -- a second YooKassa payment with a fresh idempotence key.
    select * into v_attempt from public.payment_provider_attempts attempt
    where attempt.booking_id=v_booking.id and attempt.amount_minor=v_amount
      and attempt.environment=v_setting.environment and attempt.status in ('creating','pending')
    order by attempt.created_at desc limit 1 for update;
  end if;
  if v_attempt.id is null then
    if exists(select 1 from public.payment_provider_attempts attempt
      where attempt.booking_id=v_booking.id and attempt.status='succeeded'
        and attempt.captured_amount_minor>attempt.refunded_amount_minor) then
      raise exception using errcode='P0001',message='booking_already_paid';
    end if;
    insert into public.payment_provider_attempts(
      organization_id,booking_id,environment,idempotency_key,amount_minor
    ) values(v_booking.organization_id,v_booking.id,v_setting.environment,p_idempotency_key,v_amount)
    returning * into v_attempt;
  end if;
  select service.name into v_service_name from public.services service where service.id=v_booking.service_id;
  return jsonb_build_object(
    'mode','yookassa','enabled',true,'attempt_id',v_attempt.id,'organization_id',v_booking.organization_id,
    'booking_id',v_booking.id,'booking_code',v_booking.booking_code,'environment',v_attempt.environment,
    'idempotency_key',v_attempt.idempotency_key,'amount_minor',v_attempt.amount_minor,
    'currency',v_attempt.currency,'status',v_attempt.status,
    'provider_payment_id',v_attempt.provider_payment_id,'confirmation_url',v_attempt.confirmation_url,
    'client_phone',v_booking.client_phone,'service_name',coalesce(v_service_name,'Услуга'),
    'fiscalization_enabled',v_setting.fiscalization_enabled,'taxation',v_setting.taxation,
    'vat_code',v_setting.vat_code,'payment_mode',v_setting.payment_mode
  );
exception when unique_violation then
  raise exception using errcode='P0001',message='payment_attempt_in_progress';
end $$;

create or replace function public.prepare_yookassa_refund(
  p_organization uuid,p_attempt uuid,p_amount_minor bigint,p_request_id uuid,p_reason text,p_actor uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_attempt public.payment_provider_attempts%rowtype;
  v_refund public.payment_provider_refunds%rowtype; v_reserved bigint; v_setting public.organization_payment_provider_settings%rowtype;
  v_phone text; v_service_name text; v_booking uuid;
begin
  v_role:=public.require_minuta_payment_role(p_organization,p_actor,array['owner','admin']);
  if p_request_id is null or coalesce(p_amount_minor,0)<100 or char_length(btrim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception using errcode='22023',message='invalid_refund_request';
  end if;
  select attempt.booking_id into v_booking from public.payment_provider_attempts attempt
  where attempt.id=p_attempt and attempt.organization_id=p_organization;
  if v_booking is null then raise exception using errcode='P0001',message='payment_not_refundable'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_booking::text,8701));
  perform pg_advisory_xact_lock(hashtextextended(p_attempt::text,8703));
  select * into v_attempt from public.payment_provider_attempts attempt
  where attempt.id=p_attempt and attempt.organization_id=p_organization for update;
  if not found or v_attempt.status<>'succeeded' or v_attempt.provider_payment_id is null then
    raise exception using errcode='P0001',message='payment_not_refundable';
  end if;
  select * into v_setting from public.organization_payment_provider_settings setting
  where setting.organization_id=p_organization and setting.enabled;
  if not found then raise exception using errcode='P0001',message='yookassa_not_enabled'; end if;
  select * into v_refund from public.payment_provider_refunds refund
  where refund.organization_id=p_organization and refund.request_id=p_request_id for update;
  if found then
    if v_refund.attempt_id<>p_attempt or v_refund.amount_minor<>p_amount_minor then
      raise exception using errcode='23505',message='refund_idempotency_conflict';
    end if;
  else
    select * into v_refund from public.payment_provider_refunds refund
    where refund.attempt_id=p_attempt and refund.status in ('creating','pending')
    order by refund.created_at desc limit 1 for update;
    if found and v_refund.amount_minor<>p_amount_minor then
      raise exception using errcode='55000',message='refund_in_progress';
    end if;
  end if;
  if v_refund.id is null then
    select coalesce(sum(refund.amount_minor),0) into v_reserved
    from public.payment_provider_refunds refund
    where refund.attempt_id=p_attempt and refund.status='succeeded';
    if v_reserved+p_amount_minor>v_attempt.captured_amount_minor then
      raise exception using errcode='P0001',message='refund_amount_exceeds_available';
    end if;
    if v_attempt.captured_amount_minor-(v_reserved+p_amount_minor) between 1 and 99 then
      raise exception using errcode='P0001',message='refund_remainder_below_minimum';
    end if;
    insert into public.payment_provider_refunds(
      organization_id,attempt_id,request_id,amount_minor,reason,requested_by
    ) values(p_organization,p_attempt,p_request_id,p_amount_minor,btrim(p_reason),p_actor)
    returning * into v_refund;
    insert into public.payment_provider_audit_log(organization_id,actor_id,action,subject_id,details)
    values(p_organization,p_actor,'refund_requested',v_refund.id,
      jsonb_build_object('attempt_id',p_attempt,'amount_minor',p_amount_minor));
  end if;
  select booking.client_phone,service.name into v_phone,v_service_name
  from public.bookings booking join public.services service on service.id=booking.service_id
  where booking.id=v_attempt.booking_id;
  return jsonb_build_object(
    'refund_id',v_refund.id,'organization_id',p_organization,'attempt_id',p_attempt,
    'request_id',v_refund.request_id,
    -- Old handlers must stop before POST; the new handler claims dispatch below.
    'status',case when v_refund.status='creating' and v_refund.provider_refund_id is null
      then 'dispatch_required' else v_refund.status end,'amount_minor',v_refund.amount_minor,
    'currency',v_refund.currency,'provider_payment_id',v_attempt.provider_payment_id,
    'provider_refund_id',v_refund.provider_refund_id,
    'environment',v_attempt.environment,'client_phone',v_phone,'service_name',coalesce(v_service_name,'Услуга'),
    'fiscalization_enabled',v_setting.fiscalization_enabled,'taxation',v_setting.taxation,
    'vat_code',v_setting.vat_code,'payment_mode',v_setting.payment_mode
  );
end $$;

create or replace function public.claim_yookassa_refund_dispatch(p_refund uuid,p_request_id uuid,p_actor uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_refund public.payment_provider_refunds%rowtype; v_now timestamptz; v_expires timestamptz;
begin
  select * into v_refund from public.payment_provider_refunds where id=p_refund for update;
  if not found then raise exception using errcode='P0002',message='refund_unavailable'; end if;
  perform public.require_minuta_payment_role(v_refund.organization_id,p_actor,array['owner','admin']);
  if v_refund.request_id is distinct from p_request_id or v_refund.status<>'creating'
    or v_refund.provider_refund_id is not null then
    raise exception using errcode='55000',message='refund_not_dispatchable';
  end if;
  v_now:=clock_timestamp();
  if v_refund.first_provider_request_at is null then
    update public.payment_provider_refunds set first_provider_request_at=v_now where id=p_refund
    returning * into v_refund;
  end if;
  -- Leave five minutes for execution/network delays inside the provider's 24h
  -- guarantee. Expiry never frees the reservation or generates a new key.
  v_expires:=v_refund.first_provider_request_at+interval '23 hours 55 minutes';
  return jsonb_build_object('refund_id',v_refund.id,'request_id',v_refund.request_id,
    'allowed',v_now<v_expires,'first_provider_request_at',v_refund.first_provider_request_at,'expires_at',v_expires);
end $$;
revoke all on function public.claim_yookassa_refund_dispatch(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_yookassa_refund_dispatch(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
