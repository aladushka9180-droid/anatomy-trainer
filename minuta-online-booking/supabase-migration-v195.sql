begin;
set local search_path = public, extensions, pg_catalog;

-- Additive only: no existing schedules, absences, bookings or settings change.
do $$ begin
  if to_regprocedure('public.get_minuta_schedule_role(uuid)') is null
     or to_regprocedure('public.upsert_minuta_staff_shift(uuid,uuid,uuid,uuid,date,time without time zone,time without time zone,time without time zone,time without time zone,text)') is null then
    raise exception using errcode='P0001', message='v195_requires_v71';
  end if;
end $$;

create table if not exists public.staff_shift_week_copy_receipts (
  organization_id uuid not null references public.organizations(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid references auth.users(id) on delete set null,
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, request_id)
);
alter table public.staff_shift_week_copy_receipts enable row level security;
revoke all on public.staff_shift_week_copy_receipts from public, anon, authenticated;
grant all on public.staff_shift_week_copy_receipts to service_role;

create or replace function public.minuta_shift_week_copy_plan_v195(
  p_organization uuid, p_source_start date, p_target_start date,
  p_performer uuid default null, p_location uuid default null
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text;
  v_rows jsonb;
  v_count integer;
  v_ready integer;
  v_blocked integer;
  v_existing integer;
  v_plan jsonb;
begin
  v_role := public.get_minuta_schedule_role(p_organization);
  if v_role not in ('owner','admin','specialist') then
    raise exception using errcode='42501', message='schedule_copy_denied';
  end if;
  if p_source_start is null or p_target_start is null
     or p_target_start <= p_source_start
     or (p_target_start - p_source_start) % 7 <> 0
     or p_target_start - p_source_start > 366 then
    raise exception using errcode='22023', message='invalid_copy_week_dates';
  end if;
  if v_role='specialist' and p_performer is not null and p_performer<>auth.uid() then
    raise exception using errcode='42501', message='foreign_performer_denied';
  end if;
  if p_performer is not null and not exists (
    select 1 from public.organization_memberships where organization_id=p_organization
      and user_id=p_performer and active and is_bookable
  ) then raise exception using errcode='42501', message='foreign_schedule_scope'; end if;
  if p_location is not null and not exists (
    select 1 from public.locations where id=p_location and organization_id=p_organization and active
  ) then raise exception using errcode='42501', message='foreign_schedule_scope'; end if;

  -- Same serialization key used by v71 shifts, absences and booking writes.
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  with source_rows as (
    select s.*, s.shift_date+(p_target_start-p_source_start) target_date,
      l.name location_name, l.active location_active, l.timezone,
      profile.display_name performer_name,
      coalesce(m.active and m.is_bookable,false) performer_active
    from public.staff_location_shifts s
    join public.locations l on l.id=s.location_id and l.organization_id=s.organization_id
    left join public.organization_memberships m on m.organization_id=s.organization_id and m.user_id=s.performer_id
    left join public.performer_profiles profile on profile.id=s.performer_id
    where s.organization_id=p_organization and s.active
      and s.shift_date between p_source_start and p_source_start+6
      and (p_performer is null or s.performer_id=p_performer)
      and (p_location is null or s.location_id=p_location)
      and (v_role in ('owner','admin') or s.performer_id=auth.uid())
  ), classified as (
    select s.*, case
      when not s.location_active or not s.performer_active then 'inactive_scope'
      when s.target_date < (now() at time zone coalesce(nullif(s.timezone,''),'Europe/Samara'))::date then 'past_date'
      when exists (select 1 from public.staff_absences a where a.organization_id=p_organization
        and a.performer_id=s.performer_id and a.active and s.target_date between a.starts_on and a.ends_on) then 'absence'
      when exists (select 1 from public.staff_location_shifts t where t.active and t.performer_id=s.performer_id
        and t.shift_date=s.target_date and t.organization_id=p_organization and t.location_id=s.location_id
        and t.start_time=s.start_time and t.end_time=s.end_time
        and t.break_start is not distinct from s.break_start and t.break_end is not distinct from s.break_end) then 'existing'
      when exists (select 1 from public.staff_location_shifts t where t.active and t.performer_id=s.performer_id
        and t.shift_date=s.target_date and t.start_time<s.end_time and t.end_time>s.start_time) then 'overlap'
      else 'ready' end status
    from source_rows s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'source_id',id,'source_updated_at',updated_at,'performer_id',performer_id,
    'performer_name',coalesce(performer_name,'Специалист'),'location_id',location_id,'location_name',location_name,
    'source_date',shift_date,'target_date',target_date,'start_time',start_time,'end_time',end_time,
    'break_start',break_start,'break_end',break_end,'status',status
  ) order by target_date,performer_id,start_time,id),'[]'::jsonb),count(*),
    count(*) filter(where status='ready'),count(*) filter(where status not in('ready','existing')),
    count(*) filter(where status='existing')
  into v_rows,v_count,v_ready,v_blocked,v_existing from classified;
  if v_count>500 then raise exception using errcode='54000',message='copy_week_limit'; end if;
  v_plan := jsonb_build_object('organization_id',p_organization,'actor_id',auth.uid(),
    'source_start',p_source_start,'target_start',p_target_start,'performer_id',p_performer,'location_id',p_location,
    'rows',v_rows,'source_count',v_count,'ready_count',v_ready,'blocked_count',v_blocked,
    'existing_count',v_existing,'can_copy',v_count>0 and v_ready>0 and v_blocked=0);
  -- This stamp detects changed previews; it never grants permission. Every
  -- commit recomputes roles, scope and conflicts under the shared v71 lock.
  return v_plan || jsonb_build_object('preview_token',md5(v_plan::text));
end $$;
revoke all on function public.minuta_shift_week_copy_plan_v195(uuid,date,date,uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.preview_minuta_staff_shift_week_copy(
  p_organization uuid,p_source_start date,p_target_start date,p_performer uuid default null,p_location uuid default null
) returns jsonb language sql security definer set search_path to '' as $$
  select public.minuta_shift_week_copy_plan_v195(p_organization,p_source_start,p_target_start,p_performer,p_location);
$$;
revoke all on function public.preview_minuta_staff_shift_week_copy(uuid,date,date,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.preview_minuta_staff_shift_week_copy(uuid,date,date,uuid,uuid) to authenticated;

create or replace function public.copy_minuta_staff_shift_week(
  p_organization uuid,p_source_start date,p_target_start date,p_performer uuid,p_location uuid,
  p_preview_token text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_role text;
  v_fingerprint text;
  v_receipt public.staff_shift_week_copy_receipts%rowtype;
  v_plan jsonb;
  v_row jsonb;
  v_created uuid[] := '{}';
  v_id uuid;
  v_result jsonb;
begin
  v_role:=public.get_minuta_schedule_role(p_organization);
  if v_role not in ('owner','admin','specialist') then raise exception using errcode='42501',message='schedule_copy_denied'; end if;
  if p_request_id is null or p_preview_token is null then raise exception using errcode='22023',message='copy_preview_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization::text,7100));
  v_fingerprint:=md5(jsonb_build_array(p_organization,p_source_start,p_target_start,p_performer,p_location,p_preview_token)::text);
  select * into v_receipt from public.staff_shift_week_copy_receipts
    where organization_id=p_organization and request_id=p_request_id;
  if found then
    if v_receipt.actor_id is distinct from auth.uid() or v_receipt.request_fingerprint<>v_fingerprint then
      raise exception using errcode='22023',message='copy_request_mismatch';
    end if;
    return v_receipt.result || jsonb_build_object('replayed',true);
  end if;
  v_plan:=public.minuta_shift_week_copy_plan_v195(p_organization,p_source_start,p_target_start,p_performer,p_location);
  if v_plan->>'preview_token'<>p_preview_token then raise exception using errcode='40001',message='copy_preview_stale'; end if;
  if not (v_plan->>'can_copy')::boolean then raise exception using errcode='23P01',message='copy_week_not_ready'; end if;
  for v_row in select value from jsonb_array_elements(v_plan->'rows') where value->>'status'='ready'
  loop
    -- Delegate to the established writer: same authorization, absence,
    -- exclusion constraint, booking checks and audit semantics as one shift.
    v_id:=public.upsert_minuta_staff_shift(p_organization,null,(v_row->>'location_id')::uuid,
      (v_row->>'performer_id')::uuid,(v_row->>'target_date')::date,
      (v_row->>'start_time')::time,(v_row->>'end_time')::time,
      (v_row->>'break_start')::time,(v_row->>'break_end')::time,'');
    v_created:=array_append(v_created,v_id);
  end loop;
  v_result:=jsonb_build_object('organization_id',p_organization,'request_id',p_request_id,
    'source_start',p_source_start,'target_start',p_target_start,'created_count',cardinality(v_created),
    'existing_count',(v_plan->>'existing_count')::integer,'created_ids',to_jsonb(v_created),'replayed',false);
  insert into public.staff_shift_week_copy_receipts(organization_id,request_id,actor_id,request_fingerprint,result)
    values(p_organization,p_request_id,auth.uid(),v_fingerprint,v_result);
  perform public.write_minuta_schedule_audit(p_organization,'shift_week_copied',p_request_id,
    jsonb_build_object('source_start',p_source_start,'target_start',p_target_start,
      'created_count',cardinality(v_created),'existing_count',(v_plan->>'existing_count')::integer));
  return v_result;
end $$;
revoke all on function public.copy_minuta_staff_shift_week(uuid,date,date,uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.copy_minuta_staff_shift_week(uuid,date,date,uuid,uuid,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
