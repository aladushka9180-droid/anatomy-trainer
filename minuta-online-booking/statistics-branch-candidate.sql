-- S10 additive SOURCE candidate. No migration number, no production admission.
-- Existing functions/tables/readers remain untouched. All delegates latest legacy RPCs.
begin;
create or replace function public.minuta_statistics_branch_scope_candidate(p_org uuid,p_start date,p_end date,p_performer uuid,p_location uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; effective uuid;
begin
 if actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
 if p_org is null or p_start is null or p_end is null or p_end<p_start or p_end-p_start>3661 then raise exception using errcode='22023',message='invalid_branch_scope'; end if;
 select m.role into actor_role from public.organization_memberships m join public.organizations o on o.id=m.organization_id and o.status='active' where m.organization_id=p_org and m.user_id=actor and m.active;
 if actor_role is null then raise exception using errcode='42501',message='organization_access_denied'; end if;
 if p_location is not null and not exists(select 1 from public.locations l where l.id=p_location and l.organization_id=p_org and l.active) then raise exception using errcode='42501',message='branch_access_denied'; end if;
 -- Existing membership has no independent branch ACL; same active-org location policy as v191.
 effective:=p_performer;
 if actor_role not in ('owner','admin') then
  if p_performer is not null and p_performer<>actor then raise exception using errcode='42501',message='staff_report_access_denied'; end if;
  effective:=actor;
 end if;
 return jsonb_build_object('actor_id',actor,'role',actor_role,'organization_id',p_org,'location_id',p_location,'start',p_start,'end',p_end,'performer_id',effective);
end $$;
revoke all on function public.minuta_statistics_branch_scope_candidate(uuid,date,date,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.get_minuta_statistics_branch_candidate(
 p_organization uuid,p_start date,p_end date,p_performer uuid,p_location uuid,p_source text,
 p_limit integer default 1000,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scope jsonb; actor uuid:=auth.uid(); actor_role text; effective uuid; data jsonb; response jsonb;
 offset_value integer:=0; available_minutes_value bigint; configured integer; total integer; rows_value jsonb; settings public.organization_retention_settings%rowtype;
 selected_payroll_period uuid; period_count integer; legacy_before_time timestamptz; legacy_before_key text;
begin
 scope:=public.minuta_statistics_branch_scope_candidate(p_organization,p_start,p_end,p_performer,p_location);
 actor_role:=scope->>'role'; effective:=(scope->>'performer_id')::uuid;
 if p_location is not null and p_end-p_start>3660 then raise exception using errcode='22023',message='invalid_branch_range'; end if;
 if p_source is null or p_source not in ('bookings','imported','availability','team','finance','retention','history','utm') or p_limit is null or p_limit<1 or p_limit>1000 then raise exception using errcode='22023',message='invalid_branch_source'; end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or (p_cursor->'scope') is distinct from scope or (p_cursor->>'source') is distinct from p_source then raise exception using errcode='22023',message='stale_branch_cursor'; end if;
  if coalesce(p_cursor->>'offset','') !~ '^[0-9]{1,6}$' then raise exception using errcode='22023',message='invalid_branch_cursor'; end if;
  offset_value:=(p_cursor->>'offset')::integer;
  if offset_value>100000 then raise exception using errcode='22023',message='invalid_branch_cursor'; end if;
  legacy_before_time:=(p_cursor->'legacy'->>'occurred_at')::timestamptz; legacy_before_key:=p_cursor->'legacy'->>'event_key';
 end if;
 -- All stays an envelope over existing contracts; no historical aggregates are recomputed.
 if p_location is null then
  case p_source
   when 'bookings' then data:=public.get_minuta_staff_report_bookings_v97(p_organization,p_start,p_end,p_performer,p_limit,offset_value);
   when 'imported' then data:=public.get_minuta_report_export_imported_history(p_organization,p_start,p_end,p_performer,null,'masked',p_limit,offset_value);
   when 'availability' then data:=public.get_minuta_staff_report_availability(p_organization,p_start,p_end,p_performer);
   when 'team' then data:=public.get_minuta_team_analytics(p_organization,p_start,p_end);
   when 'finance' then data:=public.get_minuta_finance_screen_v163(p_organization,p_start,p_end,p_performer,least(p_limit,100),legacy_before_time,legacy_before_key);
   when 'retention' then data:=public.get_minuta_retention_workspace(p_organization);
   when 'history' then data:=public.get_minuta_booking_events_v97(p_organization,p_start,p_end,least(p_limit,500),offset_value);
   when 'utm' then data:=public.get_minuta_utm_funnel_v107(p_organization,p_start,p_end);
  end case;
 else
  case p_source
   when 'bookings' then
    data:=public.get_minuta_report_export_bookings(p_organization,p_start,p_end,effective,p_location,'masked',p_limit,offset_value);
    -- Opaque identity is mandatory for masked statistics; legacy contact paths are unchanged.
    select coalesce(jsonb_agg(value || jsonb_build_object('is_report_export',true)),'[]'::jsonb) into rows_value from jsonb_array_elements(data->'bookings');
    data:=data || jsonb_build_object('bookings',rows_value,'can_view_team',actor_role in ('owner','admin'));
   when 'imported' then data:=jsonb_build_object('bookings','[]'::jsonb,'has_more',false,'unassigned_history','excluded_for_branch');
   when 'availability' then
    if not exists(select 1 from public.organization_shift_settings s where s.organization_id=p_organization and s.enabled) then
     return jsonb_build_object('contract','s10-branch-v1','scope',scope,'source',p_source,'available',false,'data',null,'reason','weekly_schedule_has_no_location');
    end if;
    select count(*) into total from public.organization_memberships m where m.organization_id=p_organization and m.active and m.is_bookable and (effective is null or m.user_id=effective);
    select count(distinct s.performer_id) into configured from public.staff_location_shifts s join public.organization_memberships m on m.organization_id=s.organization_id and m.user_id=s.performer_id and m.active and m.is_bookable where s.organization_id=p_organization and s.location_id=p_location and s.active and s.shift_date between p_start and p_end and (effective is null or s.performer_id=effective);
    with scheduled as (
     select s.* from public.staff_location_shifts s join public.organization_memberships m on m.organization_id=s.organization_id and m.user_id=s.performer_id and m.active and m.is_bookable
     where s.organization_id=p_organization and s.location_id=p_location and s.active and s.shift_date between p_start and p_end and (effective is null or s.performer_id=effective)
    ), intervals as (
     select s.id,s.performer_id,tsmultirange(tsrange(s.shift_date+s.start_time,s.shift_date+s.end_time,'[)')) - coalesce((
      select range_agg(blocked.blocked_range) from (
       select tsrange(s.shift_date+s.break_start,s.shift_date+s.break_end,'[)') blocked_range where s.break_start is not null and s.break_end is not null
       union all select tsrange(s.shift_date+s.start_time,s.shift_date+s.end_time,'[)') where exists(select 1 from public.staff_absences a where a.organization_id=p_organization and a.performer_id=s.performer_id and a.active and s.shift_date between a.starts_on and a.ends_on)
       union all select case when o.all_day then tsrange(s.shift_date+s.start_time,s.shift_date+s.end_time,'[)') else tsrange(s.shift_date+o.start_time,s.shift_date+o.end_time,'[)') end
        from public.provider_days_off o where o.performer_id=s.performer_id and o.off_date=s.shift_date and (o.all_day or o.start_time is not null and o.end_time is not null and o.end_time>o.start_time)
      ) blocked),'{}'::tsmultirange) windows from scheduled s
    ) select coalesce(sum(extract(epoch from(upper(piece)-lower(piece)))/60),0)::bigint into available_minutes_value from intervals cross join lateral unnest(windows) piece;
    data:=jsonb_build_object('organization_id',p_organization,'performer_id',effective,'available_minutes',available_minutes_value,'configured_performers',configured,'total_performers',total,'complete',true,'completeness_version',2,'schedule_source','staff_location_shifts');
   when 'team' then
    if actor_role not in ('owner','admin') then data:=jsonb_build_object('can_view_team',false,'performers','[]'::jsonb);
    else
     select count(*),min(p.id::text)::uuid into period_count,selected_payroll_period from public.payroll_periods p where p.organization_id=p_organization and p.location_id=p_location and p.starts_on=p_start and p.ends_on=p_end and p.status in ('approved','paid');
     if period_count<>1 then selected_payroll_period:=null; end if;
     with completed as (
      select b.id,coalesce(o.completed_performer_id,b.performer_id) performer_id,
       coalesce('account:'||b.client_account_id::text,nullif(public.minuta_report_export_client_key(p_organization,b.client_phone),'')) client_key,
       greatest(coalesce(o.actual_duration_minutes,b.duration_minutes,0),0) minutes,greatest(coalesce(o.amount_rub,0),0) revenue
      from public.bookings b join public.booking_outcomes o on o.booking_id=b.id
      where b.organization_id=p_organization and b.location_id=p_location and b.booking_date between p_start and p_end and b.status<>'cancelled' and o.visit_status='completed'
       and (effective is null or coalesce(o.completed_performer_id,b.performer_id)=effective)
     ) select coalesce(jsonb_agg(jsonb_build_object('performer_id',m.performer_id,'performer_name',coalesce(profile.display_name,'Специалист'),
      'completed_visits',m.visits,'unique_clients',m.clients,'worked_minutes',m.minutes,'revenue_rub',m.revenue,
      'payroll_rub',case when selected_payroll_period is null then null else coalesce((select sum(i.payroll_rub) from public.payroll_items i where i.period_id=selected_payroll_period and i.performer_id=m.performer_id),0)+coalesce((select sum(a.amount_rub) from public.payroll_adjustments a where a.period_id=selected_payroll_period and a.performer_id=m.performer_id),0) end) order by m.revenue desc,m.performer_id),'[]'::jsonb) into rows_value
     from (select performer_id,count(*) visits,count(distinct client_key) clients,sum(minutes) minutes,sum(revenue) revenue from completed group by performer_id) m left join public.performer_profiles profile on profile.id=m.performer_id;
     data:=jsonb_build_object('can_view_team',true,'organization_id',p_organization,'performers',rows_value,'payroll_period_id',selected_payroll_period,'payroll_available',selected_payroll_period is not null);
    end if;
   when 'finance' then
    if actor_role not in ('owner','admin') then raise exception using errcode='42501',message='finance_access_denied'; end if;
    return jsonb_build_object('contract','s10-branch-v1','scope',scope,'source',p_source,'available',false,'data',null,'reason','ledger_expenses_have_no_location_attribution');
   when 'retention' then
    if actor_role not in ('owner','admin') then raise exception using errcode='42501',message='retention_access_denied'; end if;
    select * into settings from public.organization_retention_settings where organization_id=p_organization;
    with stats as (
     select b.client_account_id,max(b.booking_date) filter(where o.visit_status='completed') last_visit_on,count(*) filter(where o.visit_status='completed') completed_visits,
      bool_or(b.status<>'cancelled' and b.booking_date+b.booking_time>=timezone('Europe/Samara',now())) has_upcoming_in_location
     from public.bookings b left join public.booking_outcomes o on o.booking_id=b.id
     where b.organization_id=p_organization and b.location_id=p_location and b.client_account_id is not null
     group by b.client_account_id
    ) select coalesce(jsonb_agg(jsonb_build_object('client_account_id',s.client_account_id,'client_name',latest.client_name,'client_phone','',
      'last_visit_on',s.last_visit_on,'completed_visits',s.completed_visits,'has_upcoming_in_location',s.has_upcoming_in_location,
      'has_upcoming_in_organization',upcoming.present,'consent_status',coalesce(consent.status,'unknown'),'last_sent_at',sent.last_sent_at,
      'eligible',coalesce(settings.enabled,false) and coalesce(consent.status='granted',false) and s.last_visit_on is not null and not upcoming.present
       and s.last_visit_on<=current_date-coalesce(settings.inactivity_days,45) and (sent.last_sent_at is null or sent.last_sent_at<=now()-make_interval(days=>coalesce(settings.cooldown_days,90)))) order by s.client_account_id),'[]'::jsonb) into rows_value
    from stats s join lateral(select b.client_name from public.bookings b where b.organization_id=p_organization and b.location_id=p_location and b.client_account_id=s.client_account_id order by b.booking_date desc,b.booking_time desc,b.id desc limit 1) latest on true
    left join public.client_marketing_consents consent on consent.organization_id=p_organization and consent.client_account_id=s.client_account_id
    left join lateral(select max(d.sent_at) last_sent_at from public.retention_deliveries d where d.organization_id=p_organization and d.client_account_id=s.client_account_id and d.status='sent') sent on true
    cross join lateral(select exists(select 1 from public.bookings b where b.organization_id=p_organization and b.client_account_id=s.client_account_id and b.status<>'cancelled' and b.booking_date+b.booking_time>=timezone('Europe/Samara',now())) present) upcoming;
    data:=jsonb_build_object('organization_id',p_organization,'current_role',actor_role,'clients',rows_value,'consent_scope','organization','cooldown_scope','organization','upcoming_eligibility_scope','organization',
     'enabled',coalesce(settings.enabled,false),'inactivity_days',coalesce(settings.inactivity_days,45),'cooldown_days',coalesce(settings.cooldown_days,90),
     'deliveries',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'client_account_id',d.client_account_id,'status',d.status,'sent_at',d.sent_at,'prepared_at',d.prepared_at)) from public.retention_deliveries d join public.bookings b on b.id=d.last_booking_id and b.organization_id=d.organization_id where d.organization_id=p_organization and b.location_id=p_location),'[]'::jsonb),
     'unattributed_delivery_count',(select count(*) from public.retention_deliveries d left join public.bookings b on b.id=d.last_booking_id and b.organization_id=d.organization_id where d.organization_id=p_organization and b.id is null));
   else return jsonb_build_object('contract','s10-branch-v1','scope',scope,'source',p_source,'available',false,'data',null,'reason','auxiliary_reader_has_no_proven_branch_attribution');
  end case;
 end if;
 response:=jsonb_build_object('contract','s10-branch-v1','scope',scope,'source',p_source,'available',true,'data',data,'next_cursor',null);
 if coalesce((data->>'has_more')::boolean,false) then response:=response || jsonb_build_object('next_cursor',jsonb_build_object('scope',scope,'source',p_source,'offset',data->'next_offset')); end if;
 if p_source='finance' and data->'next_cursor' is not null and data->'next_cursor'<>'null'::jsonb then response:=response || jsonb_build_object('next_cursor',jsonb_build_object('scope',scope,'source',p_source,'offset',0,'legacy',data->'next_cursor')); end if;
 return response;
end $$;
revoke all on function public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb) to authenticated;
commit;
