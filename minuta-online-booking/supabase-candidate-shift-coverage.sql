begin;
set local search_path=public,extensions,pg_catalog;

-- Unnumbered O08 candidate. The public date picker exposes today plus 13 days.
do $guard$
begin
  if to_regprocedure('public.set_minuta_branch_shifts_enabled(uuid,boolean)') is null
     or to_regprocedure('public.get_minuta_schedule_role(uuid)') is null
     or to_regclass('public.staff_location_shifts') is null
     or to_regclass('public.organization_shift_settings') is null
     or to_regclass('public.staff_absences') is null
     or to_regclass('public.staff_schedule_audit_log') is null
     or to_regprocedure('public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)') is not null
     or to_regprocedure('public.preview_minuta_shift_coverage(uuid)') is not null then
    raise exception using errcode='55000',message='shift_coverage_prerequisites_or_candidate_state_invalid';
  end if;
end $guard$;

-- Preserve the exact v71 booking check, setting update and schedule audit.
alter function public.set_minuta_branch_shifts_enabled(uuid,boolean)
  rename to set_minuta_branch_shifts_enabled_v71_core;
revoke all on function public.set_minuta_branch_shifts_enabled_v71_core(uuid,boolean)
  from public,anon,authenticated,service_role;

create function public.preview_minuta_shift_coverage(p_organization uuid)
returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  v_role text;
  v_business_now timestamp without time zone:=timezone('Europe/Samara',now());
  v_start date:=v_business_now::date;
  v_end date;
  v_covered jsonb;
  v_missing jsonb;
  v_covered_count integer;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  if v_role<>'owner' then
    raise exception using errcode='42501',message='owner_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  v_end:=v_start+13;
  with days as (
    select generated.day::date as day
    from generate_series(v_start,v_end,interval '1 day') generated(day)
  ), covered as (
    select day from days where exists (
      select 1 from public.staff_location_shifts shift_row
      join public.locations location on location.id=shift_row.location_id
        and location.organization_id=p_organization and location.active
      join public.organization_memberships membership
        on membership.organization_id=p_organization and membership.user_id=shift_row.performer_id
        and membership.active and membership.is_bookable
      cross join lateral (select case when shift_row.shift_date=v_start
        then greatest(shift_row.start_time,v_business_now::time)
        else shift_row.start_time end as remaining_start) remaining
      where shift_row.organization_id=p_organization and shift_row.shift_date=days.day
        and shift_row.active
        and shift_row.end_time>remaining.remaining_start
        and (shift_row.break_start is null or shift_row.break_start>remaining.remaining_start
          or shift_row.break_end<shift_row.end_time)
        and not exists (
          select 1 from public.staff_absences absence
          where absence.organization_id=p_organization and absence.performer_id=shift_row.performer_id
            and absence.active and days.day between absence.starts_on and absence.ends_on
        )
    )
  )
  select coalesce((select jsonb_agg(day order by day) from covered),'[]'::jsonb),
    coalesce((select jsonb_agg(day order by day) from days where not exists
      (select 1 from covered where covered.day=days.day)),'[]'::jsonb)
  into v_covered,v_missing;
  v_covered_count:=jsonb_array_length(v_covered);
  return jsonb_build_object(
    'horizon_start',v_start,'horizon_end',v_end,'horizon_days',14,
    'covered_days',v_covered_count,'missing_dates',v_missing,
    'status',case when v_covered_count=0 then 'zero'
      when v_covered_count=14 then 'full' else 'partial' end,
    'token',md5(v_start::text||':'||v_covered::text)
  );
end $$;
revoke all on function public.preview_minuta_shift_coverage(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.preview_minuta_shift_coverage(uuid) to authenticated;

create function public.set_minuta_branch_shifts_enabled_v2(
  p_organization uuid,p_enabled boolean,p_confirm_partial boolean,p_expected_token text
) returns boolean language plpgsql security definer set search_path to '' as $$
declare v_role text; v_coverage jsonb; v_result boolean;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  if v_role<>'owner' then
    raise exception using errcode='42501',message='owner_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  if p_enabled is true then
    v_coverage:=public.preview_minuta_shift_coverage(p_organization);
    if v_coverage->>'status'='zero' then
      raise exception using errcode='55000',message='shift_coverage_zero';
    end if;
    if v_coverage->>'status'='partial' then
      if p_confirm_partial is distinct from true then
        raise exception using errcode='55000',message='shift_coverage_confirmation_required';
      end if;
      if p_expected_token is distinct from v_coverage->>'token' then
        raise exception using errcode='55000',message='shift_coverage_preview_stale';
      end if;
    end if;
  end if;
  v_result:=public.set_minuta_branch_shifts_enabled_v71_core(p_organization,p_enabled);
  if p_enabled is true and v_coverage->>'status'='partial' then
    perform public.write_minuta_schedule_audit(p_organization,'schedule_partial_coverage_confirmed',p_organization,
      jsonb_build_object('horizon_start',v_coverage->'horizon_start',
        'horizon_end',v_coverage->'horizon_end','covered_days',v_coverage->'covered_days',
        'missing_dates',v_coverage->'missing_dates'));
  end if;
  return v_result;
end $$;
revoke all on function public.set_minuta_branch_shifts_enabled_v2(uuid,boolean,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_branch_shifts_enabled_v2(uuid,boolean,boolean,text) to authenticated;

-- Old clients retain the name and result shape. They can enable fully covered
-- schedules, but cannot silently accept a partial horizon or zero shifts.
create function public.set_minuta_branch_shifts_enabled(p_organization uuid,p_enabled boolean)
returns boolean language sql security definer set search_path to '' as $$
  select public.set_minuta_branch_shifts_enabled_v2(p_organization,p_enabled,false,null);
$$;
revoke all on function public.set_minuta_branch_shifts_enabled(uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_branch_shifts_enabled(uuid,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
