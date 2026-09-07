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

do $$
begin
  if nullif(current_setting('minuta.v121_owner',true),'') is null
    or not exists(select 1 from public.organization_memberships where organization_id=current_setting('minuta.v121_org')::uuid
      and user_id=current_setting('minuta.v121_owner')::uuid and active and role in ('owner','admin')) then
    raise exception 'v121_test_requires_owner';
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
reset role;

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

set local role authenticated;
do $$
declare v_workspace jsonb; v_definition text;
begin
  v_workspace:=public.get_minuta_loyalty_workspace(current_setting('minuta.v121_org')::uuid);
  select pg_get_functiondef('public.get_minuta_loyalty_workspace(uuid)'::regprocedure) into v_definition;
  if jsonb_typeof(v_workspace->'ledger')<>'array'
    or jsonb_typeof(v_workspace->'promo_redemptions')<>'array'
    or position('''request_id'',redemption.request_id' in v_definition)=0
    or position('''request_id'',entry.request_id' in v_definition)=0 then
    raise exception 'v121_loyalty_workspace_contract_missing';
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
