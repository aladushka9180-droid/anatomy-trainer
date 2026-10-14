-- Loyalty audit fixes F01/F02/F04/F05. Compatible v166 RPC signatures; no row rewrites.
-- Production apply requires the release owner's protected restore/apply/read/rollback/reapply gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
declare actual text; expected record;
begin
  for expected in select * from (values
    ('get_minuta_loyalty_program_role_v166','42b48830369886c68603cc55be240eeb','c11941f09afc6c10793c7c01c0c5d700'),
    ('set_minuta_loyalty_program_v166','162844b1e10afece68d91ee9dae219a8','199d79c41afee0e95f6c8bcfaf34124b'),
    ('reconcile_minuta_loyalty_outcome_v166','2de8023f9a116523d7a1c6170d013515','fbf9780aa91b2cdc018123cece767cc5'),
    ('reconcile_minuta_loyalty_booking_status_v166','bc27ca579aba43630656c8d897f32a3f','e1c97a0d263fe6900e34040212056848'),
    ('get_minuta_loyalty_program_workspace_v166','b27e6b19ee8f10e986349570bd9c9e3a','47eabf7e073997a097c2ce5cd690e124'),
    ('adjust_minuta_loyalty_progress_v166','d44f105e7e2a07a180b8ce8e62963bc9','d44f105e7e2a07a180b8ce8e62963bc9'),
    ('redeem_minuta_loyalty_reward_v166','d8d11b4ad3d10caf03a0d2ffad9ae1d4','d8d11b4ad3d10caf03a0d2ffad9ae1d4'),
    ('get_client_loyalty_program_v166','bf217a5c8eb26b13b72e523406e2ac2b','bf217a5c8eb26b13b72e523406e2ac2b'),
    ('reconcile_minuta_loyalty_booking_v166','fe00568960e80ff93669bcc2315cc87a','fe00568960e80ff93669bcc2315cc87a'),
    ('expire_minuta_loyalty_rewards_v166','1c5f13232aa50c7f922a7f9f257232c6','1c5f13232aa50c7f922a7f9f257232c6')
  ) as definitions(name,baseline,patched) loop
    select md5(regexp_replace(p.prosrc,'[[:space:]]','','g')) into actual
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=expected.name;
    if actual is null or actual not in (expected.baseline,expected.patched) then
      raise exception using errcode='55000',message='loyalty_audit_source_drift',detail=expected.name;
    end if;
  end loop;
end
$guard$;

create or replace function public.get_minuta_loyalty_program_role_v166(p_organization uuid)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=auth.uid() and membership.active;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception using errcode='42501',message='loyalty_program_management_denied';
  end if;
  return v_role;
end $$;

create or replace function public.set_minuta_loyalty_program_v166(
  p_organization uuid,p_enabled boolean,p_goal_visits integer,p_reward_kind text,
  p_reward_value integer,p_reward_title text,p_reward_terms text,p_validity_days integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_existing public.loyalty_program_history_v166%rowtype;
  v_rule public.loyalty_program_rules_v166%rowtype; v_version integer;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  if v_role is distinct from 'owner' then raise exception using errcode='42501',message='owner_required'; end if;
  if p_request_id is null or p_enabled is null then
    raise exception using errcode='22023',message='invalid_loyalty_program_request';
  end if;
  if p_enabled and (
    p_goal_visits not between 2 and 100
    or p_reward_kind not in ('percent','fixed','text')
    or char_length(btrim(coalesce(p_reward_title,''))) not between 2 and 120
    or char_length(coalesce(p_reward_terms,''))>500
    or (p_validity_days is not null and p_validity_days not between 1 and 730)
    or (p_reward_kind='percent' and p_reward_value not between 1 and 10000)
    or (p_reward_kind='fixed' and p_reward_value not between 1 and 10000000)
    or (p_reward_kind='text' and p_reward_value is not null)
  ) then raise exception using errcode='22023',message='invalid_loyalty_program_rule'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,16600));
  select * into v_existing from public.loyalty_program_history_v166
  where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_existing.details->>'enabled' is distinct from p_enabled::text
       or (p_enabled and (
         (v_existing.details->>'goal_visits')::integer is distinct from p_goal_visits
         or v_existing.details->>'reward_kind' is distinct from p_reward_kind
         or nullif(v_existing.details->>'reward_value','')::integer is distinct from p_reward_value
         or v_existing.details->>'reward_title' is distinct from btrim(p_reward_title)
         or v_existing.details->>'reward_terms' is distinct from btrim(coalesce(p_reward_terms,''))
         or nullif(v_existing.details->>'validity_days','')::integer is distinct from p_validity_days
       )) then raise exception using errcode='23505',message='loyalty_program_request_conflict'; end if;
    return v_existing.details||jsonb_build_object('recovered',true);
  end if;

  insert into public.loyalty_program_settings_v166(organization_id,enabled,enabled_at,enabled_by)
  values(p_organization,p_enabled,case when p_enabled then now() end,case when p_enabled then auth.uid() end)
  on conflict(organization_id) do update set
    enabled=excluded.enabled,
    enabled_at=case when excluded.enabled and not public.loyalty_program_settings_v166.enabled then now()
      else public.loyalty_program_settings_v166.enabled_at end,
    enabled_by=case when excluded.enabled and not public.loyalty_program_settings_v166.enabled then auth.uid()
      else public.loyalty_program_settings_v166.enabled_by end,
    updated_at=now();

  if p_enabled then
    select * into v_rule from public.loyalty_program_rules_v166
    where organization_id=p_organization and active for update;
    if v_rule.id is null
       or v_rule.goal_visits<>p_goal_visits or v_rule.reward_kind<>p_reward_kind
       or v_rule.reward_value is distinct from p_reward_value
       or v_rule.reward_title<>btrim(p_reward_title)
       or v_rule.reward_terms<>btrim(coalesce(p_reward_terms,''))
       or v_rule.validity_days is distinct from p_validity_days then
      update public.loyalty_program_rules_v166 set active=false where organization_id=p_organization and active;
      select coalesce(max(version),0)+1 into v_version from public.loyalty_program_rules_v166 where organization_id=p_organization;
      insert into public.loyalty_program_rules_v166(
        organization_id,version,goal_visits,reward_kind,reward_value,reward_title,reward_terms,
        validity_days,request_id,created_by
      ) values(
        p_organization,v_version,p_goal_visits,p_reward_kind,p_reward_value,btrim(p_reward_title),
        btrim(coalesce(p_reward_terms,'')),p_validity_days,p_request_id,auth.uid()
      ) returning * into v_rule;
    end if;
  else
    select * into v_rule from public.loyalty_program_rules_v166
    where organization_id=p_organization order by version desc limit 1;
  end if;

  insert into public.loyalty_program_history_v166(
    organization_id,rule_id,event_type,request_id,details,actor_id
  ) values(
    p_organization,v_rule.id,case when p_enabled then
      case when v_rule.request_id=p_request_id and v_rule.version>1 then 'rule_changed' else 'program_enabled' end
      else 'program_disabled' end,p_request_id,
    jsonb_build_object(
      'organization_id',p_organization,'enabled',p_enabled,'rule_id',v_rule.id,
      'goal_visits',case when p_enabled then p_goal_visits end,
      'reward_kind',case when p_enabled then p_reward_kind end,
      'reward_value',case when p_enabled then p_reward_value end,
      'reward_title',case when p_enabled then btrim(p_reward_title) end,
      'reward_terms',case when p_enabled then btrim(coalesce(p_reward_terms,'')) end,
      'validity_days',case when p_enabled then p_validity_days end,
      'existing_cycles_keep_rules',true,'recovered',false
    ),auth.uid()
  );
  return jsonb_build_object('organization_id',p_organization,'enabled',p_enabled,'rule_id',v_rule.id,
    'existing_cycles_keep_rules',true,'recovered',false);
end $$;

create or replace function public.reconcile_minuta_loyalty_outcome_v166()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  -- A repeated outcome write is not a new completion event.
  if tg_op='UPDATE' and old.visit_status is not distinct from new.visit_status then return new; end if;
  perform public.reconcile_minuta_loyalty_booking_v166(new.booking_id);
  return new;
end $$;

create or replace function public.reconcile_minuta_loyalty_booking_status_v166()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  -- Booking edits may reconcile an existing award, but never backfill an old completion.
  if exists(select 1 from public.loyalty_program_visits_v166 where booking_id=new.id) then
    perform public.reconcile_minuta_loyalty_booking_v166(new.id);
  end if;
  return new;
end $$;

create or replace function public.get_minuta_loyalty_program_workspace_v166(p_organization uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare v_role text;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  perform public.expire_minuta_loyalty_rewards_v166(p_organization,null);
  return jsonb_build_object(
    'organization_id',p_organization,'current_role',v_role,
    'enabled',coalesce((select enabled from public.loyalty_program_settings_v166 where organization_id=p_organization),false),
    'rule',coalesce((select jsonb_build_object(
      'id',rule.id,'version',rule.version,'goal_visits',rule.goal_visits,'reward_kind',rule.reward_kind,
      'reward_value',rule.reward_value,'reward_title',rule.reward_title,'reward_terms',rule.reward_terms,
      'validity_days',rule.validity_days,'starts_at',rule.starts_at
    ) from public.loyalty_program_rules_v166 rule where rule.organization_id=p_organization and rule.active),'{}'::jsonb),
    'clients',coalesce((select jsonb_agg(jsonb_build_object(
      'id',client.id,'client_name',client.client_name,'client_phone',client.client_phone
    ) order by client.client_name,client.id) from (
      select distinct on (booking.client_account_id) booking.client_account_id id,booking.client_name,booking.client_phone
      from public.bookings booking where booking.organization_id=p_organization and booking.client_account_id is not null
      order by booking.client_account_id,booking.created_at desc
    ) client),'[]'::jsonb),
    'accounts',coalesce((select jsonb_agg(jsonb_build_object(
      'id',account.id,'client_account_id',account.client_account_id,'rule_id',account.current_rule_id,
      'cycle_number',account.cycle_number,'progress',greatest(0,account.manual_progress+(
        select count(*) from public.loyalty_program_visits_v166 visit where visit.account_id=account.id
          and visit.cycle_number=account.cycle_number and visit.reversed_at is null
      )),'goal_visits',rule.goal_visits,'reward_title',rule.reward_title
    ) order by account.updated_at desc,account.id) from public.loyalty_program_accounts_v166 account
      join public.loyalty_program_rules_v166 rule on rule.id=account.current_rule_id
      where account.organization_id=p_organization),'[]'::jsonb),
    'rewards',coalesce((select jsonb_agg(jsonb_build_object(
      'id',reward.id,'client_account_id',reward.client_account_id,'cycle_number',reward.cycle_number,
      'reward_kind',reward.reward_kind,'reward_value',reward.reward_value,'reward_title',reward.reward_title,
      'reward_terms',reward.reward_terms,'status',reward.status,'issued_at',reward.issued_at,
      'expires_at',reward.expires_at,'redeemed_at',reward.redeemed_at,'redeemed_booking_id',reward.redeemed_booking_id
    ) order by reward.issued_at desc,reward.id) from public.loyalty_program_rewards_v166 reward
      where reward.organization_id=p_organization),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object(
      'id',entry.id,'client_account_id',entry.client_account_id,'event_type',entry.event_type,
      'progress_delta',entry.progress_delta,'progress_after',entry.progress_after,'booking_id',entry.booking_id,
      'reward_id',entry.reward_id,'reason',entry.reason,'created_at',entry.created_at
    ) order by entry.id desc) from (select * from public.loyalty_program_history_v166
      where organization_id=p_organization order by id desc limit 100) entry),'[]'::jsonb),
    'stats',jsonb_build_object(
      'issued',(select count(*) from public.loyalty_program_rewards_v166 where organization_id=p_organization),
      'redeemed',(select count(*) from public.loyalty_program_rewards_v166 where organization_id=p_organization and status='redeemed')
    )
  );
end $$;

drop trigger bookings_loyalty_program_v166 on public.bookings;
create trigger bookings_loyalty_program_v166
after update of status,booking_date,booking_time on public.bookings
for each row when(old.status is distinct from new.status
  or old.booking_date is distinct from new.booking_date or old.booking_time is distinct from new.booking_time)
execute function public.reconcile_minuta_loyalty_booking_status_v166();
alter table public.booking_outcomes enable trigger booking_outcomes_loyalty_program_v166;
revoke all on function public.get_minuta_loyalty_program_role_v166(uuid) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_minuta_loyalty_outcome_v166() from public,anon,authenticated,service_role;
revoke all on function public.reconcile_minuta_loyalty_booking_status_v166() from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_loyalty_program_v166(uuid,boolean,integer,text,integer,text,text,integer,uuid) to authenticated;
grant execute on function public.get_minuta_loyalty_program_workspace_v166(uuid) to authenticated;
grant execute on function public.adjust_minuta_loyalty_progress_v166(uuid,uuid,integer,text,uuid) to authenticated;
grant execute on function public.redeem_minuta_loyalty_reward_v166(uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.get_client_loyalty_program_v166(text,uuid) to anon,authenticated;
commit;
