\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regprocedure('public.add_minuta_payroll_adjustment(uuid,uuid,uuid,integer,text,uuid)') is null
    or to_regprocedure('public.get_minuta_loyalty_workspace(uuid)') is null then
    raise exception 'v121_test_requires_v121';
  end if;
end;
$$;

select set_config('minuta.v121_owner',(select legacy_performer_id::text from public.organizations
  where legacy_performer_id is not null and status='active' order by id limit 1),true);
select set_config('minuta.v121_org',(select id::text from public.organizations
  where legacy_performer_id=current_setting('minuta.v121_owner')::uuid),true);
select set_config('minuta.v121_client',(select booking.client_account_id::text from public.bookings booking
  where booking.organization_id=current_setting('minuta.v121_org')::uuid and booking.client_account_id is not null
    and not exists(select 1 from public.loyalty_promo_redemptions redemption where redemption.booking_id=booking.id)
  order by booking.created_at desc limit 1),true);
select set_config('minuta.v121_booking',(select booking.id::text from public.bookings booking
  where booking.organization_id=current_setting('minuta.v121_org')::uuid
    and booking.client_account_id=current_setting('minuta.v121_client')::uuid
    and not exists(select 1 from public.loyalty_promo_redemptions redemption where redemption.booking_id=booking.id)
  order by booking.created_at desc limit 1),true);

do $$
begin
  if nullif(current_setting('minuta.v121_owner',true),'') is null
    or nullif(current_setting('minuta.v121_client',true),'') is null
    or not exists(select 1 from public.organization_memberships where organization_id=current_setting('minuta.v121_org')::uuid
      and user_id=current_setting('minuta.v121_owner')::uuid and active and role in ('owner','admin')) then
    raise exception 'v121_test_requires_owner_and_client_booking';
  end if;
end;
$$;

insert into public.organization_payroll_settings(organization_id,enabled,enabled_at,enabled_by)
values(current_setting('minuta.v121_org')::uuid,true,now(),current_setting('minuta.v121_owner')::uuid)
on conflict(organization_id) do update set enabled=true;

insert into public.payroll_periods(id,organization_id,name,starts_on,ends_on,status,total_payroll_rub)
values('00000000-0000-4000-8000-000000121001',current_setting('minuta.v121_org')::uuid,
  'V121 idempotency fixture','1901-01-01','1901-01-01','draft',0);

select set_config('request.jwt.claim.sub',current_setting('minuta.v121_owner'),true);
set local role authenticated;
select set_config('minuta.v121_first',public.add_minuta_payroll_adjustment(
  current_setting('minuta.v121_org')::uuid,'00000000-0000-4000-8000-000000121001',
  current_setting('minuta.v121_owner')::uuid,500,'V121 exact retry',
  '00000000-0000-4000-8000-000000121002')::text,true);
select set_config('minuta.v121_second',public.add_minuta_payroll_adjustment(
  current_setting('minuta.v121_org')::uuid,'00000000-0000-4000-8000-000000121001',
  current_setting('minuta.v121_owner')::uuid,500,'V121 exact retry',
  '00000000-0000-4000-8000-000000121002')::text,true);

do $$
begin
  if current_setting('minuta.v121_first')::jsonb<>current_setting('minuta.v121_second')::jsonb
    or (select count(*) from public.payroll_adjustments
      where organization_id=current_setting('minuta.v121_org')::uuid
        and request_id='00000000-0000-4000-8000-000000121002')<>1
    or (select count(*) from public.payroll_audit_log where action='payroll_adjustment_added'
      and details->>'request_id'='00000000-0000-4000-8000-000000121002')<>1
    or (select total_payroll_rub from public.payroll_periods where id='00000000-0000-4000-8000-000000121001')<>500 then
    raise exception 'v121_payroll_exact_retry_failed';
  end if;
  begin
    perform public.add_minuta_payroll_adjustment(
      current_setting('minuta.v121_org')::uuid,'00000000-0000-4000-8000-000000121001',
      current_setting('minuta.v121_owner')::uuid,501,'V121 changed retry',
      '00000000-0000-4000-8000-000000121002');
    raise exception 'v121_payroll_conflict_was_allowed';
  exception when unique_violation then
    if sqlerrm<>'payroll_adjustment_idempotency_conflict' then raise; end if;
  end;
  if not (public.get_minuta_payroll_workspace(current_setting('minuta.v121_org')::uuid,'1901-01-01','1901-01-01')
    ->'adjustments' @> '[{"request_id":"00000000-0000-4000-8000-000000121002"}]'::jsonb) then
    raise exception 'v121_payroll_workspace_request_id_missing';
  end if;
end;
$$;
reset role;

insert into public.client_loyalty_accounts(organization_id,client_account_id,balance_points,lifetime_earned)
values(current_setting('minuta.v121_org')::uuid,current_setting('minuta.v121_client')::uuid,20,20)
on conflict(organization_id,client_account_id) do update set balance_points=greatest(public.client_loyalty_accounts.balance_points,20);
select set_config('minuta.v121_account',(select id::text from public.client_loyalty_accounts
  where organization_id=current_setting('minuta.v121_org')::uuid and client_account_id=current_setting('minuta.v121_client')::uuid),true);

insert into public.loyalty_ledger(organization_id,account_id,client_account_id,event_type,points_delta,balance_after,request_id,reason,actor_id)
values
  (current_setting('minuta.v121_org')::uuid,current_setting('minuta.v121_account')::uuid,current_setting('minuta.v121_client')::uuid,
    'manual_adjustment',10,20,'00000000-0000-4000-8000-000000121010','V121 manual fixture',current_setting('minuta.v121_owner')::uuid),
  (current_setting('minuta.v121_org')::uuid,current_setting('minuta.v121_account')::uuid,current_setting('minuta.v121_client')::uuid,
    'redemption',-5,15,'00000000-0000-4000-8000-000000121011','V121 redemption fixture',current_setting('minuta.v121_owner')::uuid);

insert into public.loyalty_promotions(id,organization_id,code,kind,value,valid_from,valid_until,active,created_by)
values('00000000-0000-4000-8000-000000121012',current_setting('minuta.v121_org')::uuid,
  'V121PROMO','fixed',1,current_date,current_date,true,current_setting('minuta.v121_owner')::uuid);
insert into public.loyalty_promo_redemptions(
  organization_id,promotion_id,booking_id,client_account_id,request_id,original_amount_rub,discount_rub,final_amount_rub,actor_id
) values(
  current_setting('minuta.v121_org')::uuid,'00000000-0000-4000-8000-000000121012',current_setting('minuta.v121_booking')::uuid,
  current_setting('minuta.v121_client')::uuid,'00000000-0000-4000-8000-000000121013',100,1,99,
  current_setting('minuta.v121_owner')::uuid
);

set local role authenticated;
do $$
declare v_workspace jsonb;
begin
  v_workspace:=public.get_minuta_loyalty_workspace(current_setting('minuta.v121_org')::uuid);
  if not (v_workspace->'ledger' @> '[{"request_id":"00000000-0000-4000-8000-000000121010","event_type":"manual_adjustment"}]'::jsonb)
    or not (v_workspace->'ledger' @> '[{"request_id":"00000000-0000-4000-8000-000000121011","event_type":"redemption"}]'::jsonb)
    or not (v_workspace->'promo_redemptions' @> '[{"request_id":"00000000-0000-4000-8000-000000121013"}]'::jsonb) then
    raise exception 'v121_loyalty_request_id_missing';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000121099',true);
do $$
begin
  begin
    perform public.get_minuta_loyalty_workspace(current_setting('minuta.v121_org')::uuid);
    raise exception 'v121_loyalty_unauthorized_was_allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

delete from public.payroll_audit_log where details->>'request_id'='00000000-0000-4000-8000-000000121002';
delete from public.payroll_adjustments where request_id='00000000-0000-4000-8000-000000121002';
delete from public.payroll_periods where id='00000000-0000-4000-8000-000000121001';

rollback;
