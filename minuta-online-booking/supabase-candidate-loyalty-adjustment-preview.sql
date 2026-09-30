begin;
set local search_path=public,extensions,pg_catalog;

-- Candidate only. Assign a migration number after checking the integration base.
-- This is additive: existing v166 clients and reward/cycle writers stay intact.
create function public.preview_minuta_loyalty_adjustment_v166(
  p_organization uuid,p_client_account uuid,p_delta integer
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  v_role text; v_account public.loyalty_program_accounts_v166%rowtype;
  v_rule public.loyalty_program_rules_v166%rowtype;
  v_before integer; v_after integer;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  if p_delta is null or p_delta=0 or p_delta not between -100 and 100 then
    raise exception using errcode='22023',message='invalid_loyalty_progress_adjustment';
  end if;
  if not exists(select 1 from public.bookings
    where organization_id=p_organization and client_account_id=p_client_account) then
    raise exception using errcode='42501',message='loyalty_client_not_in_organization';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_client_account::text,16602));
  if not coalesce((select enabled from public.loyalty_program_settings_v166
    where organization_id=p_organization),false) then
    raise exception using errcode='55000',message='loyalty_program_disabled';
  end if;
  select * into v_account from public.loyalty_program_accounts_v166
    where organization_id=p_organization and client_account_id=p_client_account;
  if v_account.id is null then
    select * into v_rule from public.loyalty_program_rules_v166
      where organization_id=p_organization and active;
    v_before:=0;
  else
    select * into v_rule from public.loyalty_program_rules_v166 where id=v_account.current_rule_id;
    select v_account.manual_progress+count(*)::integer into v_before
      from public.loyalty_program_visits_v166 visit
      where visit.account_id=v_account.id and visit.cycle_number=v_account.cycle_number
        and visit.reversed_at is null;
  end if;
  if v_rule.id is null then
    raise exception using errcode='55000',message='loyalty_rule_missing';
  end if;
  v_after:=v_before+p_delta;
  return jsonb_build_object(
    'before',v_before,'after',v_after,'delta',p_delta,
    'goal_visits',v_rule.goal_visits,'rule_id',v_rule.id,
    'cycle_number',coalesce(v_account.cycle_number,1),
    'allowed',v_after between 0 and v_rule.goal_visits,
    'reaches_goal',v_after=v_rule.goal_visits
  );
end $$;
revoke all on function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.preview_minuta_loyalty_adjustment_v166(uuid,uuid,integer) to authenticated;

create function public.confirm_minuta_loyalty_adjustment_v166(
  p_organization uuid,p_client_account uuid,p_delta integer,p_reason text,p_request_id uuid,
  p_expected_before integer,p_expected_cycle integer,p_expected_rule uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text; v_existing public.loyalty_program_history_v166%rowtype;
  v_preview jsonb; v_result jsonb; v_actual public.loyalty_program_history_v166%rowtype;
begin
  v_role:=public.get_minuta_loyalty_program_role_v166(p_organization);
  if p_request_id is null or p_expected_before is null or p_expected_cycle is null
     or p_expected_rule is null then
    raise exception using errcode='22023',message='invalid_loyalty_adjustment_confirmation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text||':'||p_client_account::text,16602));
  select * into v_existing from public.loyalty_program_history_v166
    where organization_id=p_organization and request_id=p_request_id;
  if v_existing.id is not null then
    -- The v166 writer validates the original request and returns its durable result.
    return public.adjust_minuta_loyalty_progress_v166(
      p_organization,p_client_account,p_delta,p_reason,p_request_id);
  end if;
  -- Booking reconciliation also locks this row before crediting a visit.
  perform 1 from public.loyalty_program_accounts_v166
    where organization_id=p_organization and client_account_id=p_client_account for update;
  v_preview:=public.preview_minuta_loyalty_adjustment_v166(
    p_organization,p_client_account,p_delta);
  if (v_preview->>'before')::integer<>p_expected_before
     or (v_preview->>'cycle_number')::integer<>p_expected_cycle
     or (v_preview->>'rule_id')::uuid<>p_expected_rule then
    raise exception using errcode='55000',message='loyalty_adjustment_preview_stale';
  end if;
  if not (v_preview->>'allowed')::boolean then
    raise exception using errcode='22023',message='invalid_loyalty_progress_result';
  end if;
  v_result:=public.adjust_minuta_loyalty_progress_v166(
    p_organization,p_client_account,p_delta,p_reason,p_request_id);
  select * into v_actual from public.loyalty_program_history_v166
    where organization_id=p_organization and request_id=p_request_id;
  if v_actual.progress_after<>(v_preview->>'after')::integer
     or v_actual.rule_id<>(v_preview->>'rule_id')::uuid then
    raise exception using errcode='55000',message='loyalty_adjustment_preview_stale';
  end if;
  return v_result;
end $$;
revoke all on function public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.confirm_minuta_loyalty_adjustment_v166(uuid,uuid,integer,text,uuid,integer,integer,uuid)
  to authenticated;

notify pgrst,'reload schema';
commit;
