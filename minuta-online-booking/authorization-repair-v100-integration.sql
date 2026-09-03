\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regprocedure('public.invite_minuta_member(uuid,text,text,boolean)') is null
     or to_regprocedure('public.get_minuta_booking_events_v97(uuid,date,date,integer,integer)') is null then
    raise exception using errcode='P0001',message='v100_integration_requires_v100';
  end if;
  if not exists (
    select 1
    from public.organizations organization
    join public.organization_memberships membership on membership.organization_id=organization.id
    where organization.status='active' and membership.role='owner' and membership.active
  ) then
    raise exception using errcode='P0001',message='v100_integration_requires_active_owner';
  end if;
end;
$$;

select set_config('minuta.v100_org',(
  select organization.id::text
  from public.organizations organization
  join public.organization_memberships membership on membership.organization_id=organization.id
  where organization.status='active' and membership.role='owner' and membership.active
  order by organization.id,membership.user_id limit 1
),true);
select set_config('minuta.v100_owner',(
  select membership.user_id::text
  from public.organization_memberships membership
  where membership.organization_id=current_setting('minuta.v100_org')::uuid
    and membership.role='owner' and membership.active
  order by membership.user_id limit 1
),true);

set local session_replication_role=replica;
insert into auth.users(
  id,instance_id,aud,role,email,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values(
  '00000000-0000-4000-8000-000000010002',
  '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','v100-foreign-owner@example.invalid',now(),
  '{}'::jsonb,'{}'::jsonb,now(),now()
);
set local session_replication_role=origin;
insert into public.performer_profiles(id,display_name)
values('00000000-0000-4000-8000-000000010002','V100 Foreign Owner');
select set_config('minuta.v100_foreign_org',(
  select id::text from public.organizations
  where legacy_performer_id='00000000-0000-4000-8000-000000010002'
),true);

insert into public.organization_invitations(
  organization_id,email,role,is_bookable,created_by
) values(
  current_setting('minuta.v100_org')::uuid,
  'v100-pending@example.invalid','specialist',true,
  current_setting('minuta.v100_owner')::uuid
) returning id::text as invitation_id \gset v100_
select set_config('minuta.v100_invitation',:'v100_invitation_id',true);

create temporary table v100_watch_tables(name text primary key) on commit drop;
insert into v100_watch_tables(name) values
  ('organization_memberships'),
  ('organization_invitations'),
  ('organization_audit_log'),
  ('resource_groups'),
  ('resource_audit_log'),
  ('organization_benefit_settings'),
  ('benefit_audit_log'),
  ('organization_booking_policy_settings'),
  ('organization_booking_policy_audit_log'),
  ('organization_group_booking_settings'),
  ('group_booking_audit_log'),
  ('organization_loyalty_settings'),
  ('organization_retention_settings'),
  ('retention_audit_log'),
  ('organization_batch_booking_settings'),
  ('booking_batch_audit_log');
create temporary table v100_state_before(
  name text primary key,row_count bigint,row_hash text
) on commit drop;
do $$
declare v_table text;v_count bigint;v_hash text;
begin
  for v_table in select name from v100_watch_tables order by name loop
    execute format(
      'select count(*),md5(coalesce(string_agg(to_jsonb(row_value)::text,E''\n'' order by to_jsonb(row_value)::text),'''')) from public.%I row_value where organization_id=$1',
      v_table
    ) using current_setting('minuta.v100_org')::uuid into v_count,v_hash;
    insert into v100_state_before values(v_table,v_count,v_hash);
  end loop;
end;
$$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000010002',true);
set local role authenticated;
do $$
begin
  begin
    perform public.invite_minuta_member(current_setting('minuta.v100_org')::uuid,'v100-illicit@example.invalid','specialist',true);
    raise exception using errcode='P0001',message='v100_cross_tenant_invite_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'organization_manage_denied' then raise; end if;
  end;
  begin
    perform public.update_minuta_member(current_setting('minuta.v100_org')::uuid,current_setting('minuta.v100_owner')::uuid,'specialist',false,false);
    raise exception using errcode='P0001',message='v100_cross_tenant_member_update_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'organization_manage_denied' then raise; end if;
  end;
  begin
    perform public.cancel_minuta_invitation(current_setting('minuta.v100_invitation')::uuid);
    raise exception using errcode='P0001',message='v100_cross_tenant_invitation_cancel_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'organization_manage_denied' then raise; end if;
  end;
  begin
    perform public.create_minuta_resource_group(current_setting('minuta.v100_org')::uuid,'V100 illicit room','room','');
    raise exception using errcode='P0001',message='v100_cross_tenant_resource_write_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'resource_management_denied' then raise; end if;
  end;
  begin
    perform public.set_minuta_benefits_enabled(current_setting('minuta.v100_org')::uuid,false);
    raise exception using errcode='P0001',message='v100_cross_tenant_benefit_write_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'benefit_management_denied' then raise; end if;
  end;
  begin
    perform public.set_minuta_booking_policies_enabled(current_setting('minuta.v100_org')::uuid,false);
    raise exception using errcode='P0001',message='v100_cross_tenant_booking_policy_write_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'booking_policy_management_denied' then raise; end if;
  end;
  begin
    perform public.set_minuta_group_bookings_enabled(current_setting('minuta.v100_org')::uuid,false);
    raise exception using errcode='P0001',message='v100_cross_tenant_group_booking_write_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'group_booking_management_denied' then raise; end if;
  end;
  begin
    perform public.set_minuta_loyalty_enabled(current_setting('minuta.v100_org')::uuid,false);
    raise exception using errcode='P0001',message='v100_cross_tenant_loyalty_write_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'loyalty_management_denied' then raise; end if;
  end;
  begin
    perform public.save_minuta_retention_settings(
      current_setting('minuta.v100_org')::uuid,false,90,30,
      'V100 безопасное сообщение для клиента: {ссылка}'
    );
    raise exception using errcode='P0001',message='v100_cross_tenant_retention_write_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'retention_manager_required' then raise; end if;
  end;
  begin
    perform public.set_minuta_batch_bookings_enabled(current_setting('minuta.v100_org')::uuid,false,12);
    raise exception using errcode='P0001',message='v100_cross_tenant_batch_booking_write_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'batch_booking_access_denied' then raise; end if;
  end;
  begin
    perform public.get_minuta_booking_events(current_setting('minuta.v100_org')::uuid,current_date-1,current_date,10);
    raise exception using errcode='P0001',message='v100_cross_tenant_event_read_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'event_access_denied' then raise; end if;
  end;
  begin
    perform public.get_minuta_booking_events_v97(current_setting('minuta.v100_org')::uuid,current_date-1,current_date,10,0);
    raise exception using errcode='P0001',message='v100_cross_tenant_event_v97_read_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'event_access_denied' then raise; end if;
  end;
end;
$$;
reset role;

do $$
declare v_table text;v_count bigint;v_hash text;v_before v100_state_before%rowtype;
begin
  for v_table in select name from v100_watch_tables order by name loop
    execute format(
      'select count(*),md5(coalesce(string_agg(to_jsonb(row_value)::text,E''\n'' order by to_jsonb(row_value)::text),'''')) from public.%I row_value where organization_id=$1',
      v_table
    ) using current_setting('minuta.v100_org')::uuid into v_count,v_hash;
    select * into v_before from v100_state_before where name=v_table;
    if v_count is distinct from v_before.row_count or v_hash is distinct from v_before.row_hash then
      raise exception using errcode='P0001',message='v100_cross_tenant_mutation_detected:'||v_table;
    end if;
  end loop;
end;
$$;

-- Event readers must also reject members of organizations that are no longer active.
update public.organizations set status='suspended'
where id=current_setting('minuta.v100_org')::uuid;
select set_config('request.jwt.claim.sub',current_setting('minuta.v100_owner'),true);
set local role authenticated;
do $$
begin
  begin
    perform public.get_minuta_booking_events(current_setting('minuta.v100_org')::uuid,current_date-1,current_date,10);
    raise exception using errcode='P0001',message='v100_suspended_event_read_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'event_access_denied' then raise; end if;
  end;
  begin
    perform public.get_minuta_booking_events_v97(current_setting('minuta.v100_org')::uuid,current_date-1,current_date,10,0);
    raise exception using errcode='P0001',message='v100_suspended_event_v97_read_allowed';
  exception when insufficient_privilege then
    if sqlerrm<>'event_access_denied' then raise; end if;
  end;
end;
$$;
reset role;

select 'authorization repair v100 integration: OK' as result;
rollback;
