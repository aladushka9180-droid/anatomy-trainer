-- v123: exact-duration provider blocks and optimistic series coordinates.
-- Production schema baseline: read-only capture 34207345085 (2026-09-08).
-- Apply only through the backed-up isolated-test/rollback/reapply release gate.
begin;
do $guard$
declare item record; actual text; definition text; no_condition boolean; boundary integer;
begin
 for item in select * from (values
   ('public.allocate_minuta_booking_resources(uuid)','faa4fe562db1e2678399faa1d735141e'),
   ('public.apply_minuta_booking_policy_snapshot()','866b1948c019b3b9f020a332654eaef3'),
   ('public.assign_booking_client_account()','4b651f11bb57ac8aef1a9fd34fac07b8'),
   ('public.auto_confirm_booking()','781b4f23efc0395d71c8c772f41691aa'),
   ('public.book_appointment(uuid,uuid,date,time without time zone,text,text)','abadc0c81de68738ba6382cd03dda62d'),
   ('public.book_appointment(uuid,date,time without time zone,text,text)','c702ccc52a9a23fb03ad7765b45a1e26'),
   ('public.cancel_minuta_booking_core(uuid,text,text)','a4391b82cc2756e49e86fad9706069c2'),
   ('public.capture_minuta_booking_event_v93()','bd12cd7f9b824336c5800774e946abbf'),
   ('public.enforce_minuta_booking_buffer_v101()','acf0a27849d50096dc136c808507e488'),
   ('public.enforce_minuta_booking_shift()','3882329460222ba2564f2c97dfd634e2'),
   ('public.enqueue_booking_created_notification()','a509808937e4eaed2cdd8e7d74995ca9'),
   ('public.enqueue_minuta_booking_change_notification()','cee858b238120bacab69e9bf7eaebf5f'),
   ('public.enqueue_minuta_booking_notification(uuid,text)','1d8115b20790453ef6cf7f52294e52db'),
   ('public.get_available_slots(uuid,date,date,uuid)','d5ce681b44099abe078660c089b1c0fa'),
   ('public.get_available_slots_v101(uuid,date,date,uuid)','5f07e6287c6ac9a20e368d21ed4ae26c'),
   ('public.initialize_booking_session_item()','80569af26590fb3aff411b6729c14f11'),
   ('public.initialize_booking_session_price()','bb90dd7e91b0239057ab71bf00fdfbba'),
   ('public.minuta_booking_fits_active_shift(uuid,uuid,uuid,date,time without time zone,integer)','d0fe47e4658db5458c66ae2cbdb63e2c'),
   ('public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)','9ba3b4cbaca816439578218c516d9e81'),
   ('public.prevent_minuta_group_event_booking_overlap()','2bff03a9f597ae9310c04bbd1553b525'),
   ('public.protect_minuta_booking_creation_attribution_v92()','f50b313e09f4b946b306493db4311b8e'),
   ('public.protect_minuta_direct_cancellation()','e1452fe04ed579ab10d7af5eeed3bbfb'),
   ('public.provider_book_appointment(uuid,date,time without time zone,text,text)','653390c7c91458eef408e82593f38249'),
   ('public.scope_minuta_booking()','5b1cbb59e0ea69826e50082b0aaf76d3'),
   ('public.set_minuta_booking_creation_attribution_v92()','649eba3a97fa374e76ce6cc8906ffd18'),
   ('public.sync_minuta_booking_resources()','7be4aa3eca3b744df08c16e9630a9616')
 ) expected(signature,source_hash) loop
  select md5(replace(p.prosrc,E'\r','')) into actual from pg_proc p where p.oid=to_regprocedure(item.signature);
  if actual is distinct from item.source_hash then
   raise exception using errcode='55000',message='v123_schema_drift:'||item.signature;
  end if;
 end loop;
 if to_regprocedure('public.enforce_minuta_client_online_booking_block_v119()') is null then
  raise exception using errcode='55000',message='v123_missing_client_online_block_guard';
 end if;
 select md5(replace(p.prosrc,E'\r','')) into actual from pg_proc p
 where p.oid=to_regprocedure('public.manage_minuta_booking_series(uuid,text,text,date,time without time zone)');
 if actual is distinct from '32bed604d520bb6d03568ffbd50f78c1'
  and actual is distinct from md5(E'\n select public.manage_minuta_booking_series_v123_core(p_booking,p_action,p_scope,p_date,p_time,null,null);\n') then
  raise exception using errcode='55000',message='v123_series_baseline_drift';
 end if;
 for item in select * from (values
   ('bookings_assign_client_account','public.assign_booking_client_account()',23,'O'),
   ('bookings_auto_confirm','public.auto_confirm_booking()',23,'O'),
   ('bookings_capture_event_v93','public.capture_minuta_booking_event_v93()',21,'O'),
   ('bookings_enforce_active_shift','public.enforce_minuta_booking_shift()',21,'O'),
   ('bookings_enqueue_change_notification_v88','public.enqueue_minuta_booking_change_notification()',17,'O'),
   ('bookings_enqueue_created_notification','public.enqueue_booking_created_notification()',5,'O'),
   ('bookings_initialize_session_item','public.initialize_booking_session_item()',5,'O'),
   ('bookings_initialize_session_price','public.initialize_booking_session_price()',7,'O'),
   ('bookings_scope_minuta_tenant','public.scope_minuta_booking()',23,'O'),
   ('bookings_sync_minuta_resources','public.sync_minuta_booking_resources()',21,'O'),
   ('bookings_zz_protect_creation_attribution_v92','public.protect_minuta_booking_creation_attribution_v92()',19,'O'),
   ('bookings_zz_set_creation_attribution_v92','public.set_minuta_booking_creation_attribution_v92()',7,'O'),
   ('zy_bookings_client_online_block_v119','public.enforce_minuta_client_online_booking_block_v119()',7,'O'),
   ('zz_bookings_apply_v76_policy','public.apply_minuta_booking_policy_snapshot()',7,'O'),
   ('zz_bookings_buffer_v101','public.enforce_minuta_booking_buffer_v101()',23,'O'),
   ('zz_bookings_group_event_overlap_v86','public.prevent_minuta_group_event_booking_overlap()',23,'O'),
   ('zz_bookings_protect_direct_cancellation_v76','public.protect_minuta_direct_cancellation()',19,'O')
 ) expected(trigger_name,function_signature,trigger_type,enabled) loop
  if not exists(select 1 from pg_trigger t where t.tgrelid='public.bookings'::regclass
   and t.tgname=item.trigger_name and t.tgfoid=to_regprocedure(item.function_signature)
   and t.tgtype=item.trigger_type and t.tgenabled::text=item.enabled and t.tgqual is null) then
   raise exception using errcode='55000',message='v123_trigger_drift:'||item.trigger_name;
  end if;
 end loop;
 for item in select * from (values
   ('booking_outcomes','booking_id','uuid',true),
   ('booking_outcomes','performer_id','uuid',true),
   ('booking_outcomes','visit_status','text',true),
   ('booking_outcomes','payment_method','text',true),
   ('booking_outcomes','amount_rub','int4',true),
   ('booking_outcomes','updated_at','timestamptz',true),
   ('booking_outcomes','actual_duration_minutes','int4',false),
   ('booking_outcomes','calculated_amount_rub','int4',false),
   ('booking_outcomes','completed_performer_id','uuid',false),
   ('booking_outcomes','completion_source','text',true),
   ('bookings','id','uuid',true),
   ('bookings','booking_code','text',true),
   ('bookings','performer_id','uuid',true),
   ('bookings','service_id','uuid',true),
   ('bookings','client_name','text',true),
   ('bookings','client_phone','text',true),
   ('bookings','booking_date','date',true),
   ('bookings','booking_time','time',true),
   ('bookings','status','text',true),
   ('bookings','created_at','timestamptz',true),
   ('bookings','duration_minutes','int4',true),
   ('bookings','slot_start','timestamp',false),
   ('bookings','slot_end','timestamp',false),
   ('bookings','manage_token','uuid',true),
   ('bookings','reschedule_count','int4',true),
   ('bookings','deposit_amount_rub','int4',true),
   ('bookings','payment_status','text',true),
   ('bookings','payment_url','text',true),
   ('bookings','request_id','uuid',false),
   ('bookings','request_fingerprint','text',false),
   ('bookings','client_account_id','uuid',false),
   ('bookings','client_access_eligible_until','timestamptz',false),
   ('bookings','original_price_rub','int4',false),
   ('bookings','total_price_rub','int4',false),
   ('bookings','client_confirmed_at','timestamptz',false),
   ('bookings','organization_id','uuid',true),
   ('bookings','location_id','uuid',true),
   ('bookings','booking_scope_source','text',true),
   ('bookings','color_key','text',true),
   ('bookings','booking_policy_snapshot','jsonb',true),
   ('bookings','payment_due_at','timestamptz',false),
   ('bookings','expired_unpaid_at','timestamptz',false),
   ('bookings','cancellation_reason','text',false),
   ('bookings','refund_status','text',true),
   ('bookings','series_id','uuid',false),
   ('bookings','series_occurrence','int4',false),
   ('bookings','provider_note','text',true),
   ('bookings','booking_source','text',false),
   ('bookings','created_by_user_id','uuid',false),
   ('bookings','created_by_role','text',false),
   ('locations','id','uuid',true),
   ('locations','organization_id','uuid',true),
   ('locations','name','text',true),
   ('locations','timezone','text',true),
   ('locations','address','text',true),
   ('locations','active','bool',true),
   ('locations','is_primary','bool',true),
   ('locations','created_at','timestamptz',true),
   ('locations','updated_at','timestamptz',true),
   ('notification_outbox','id','uuid',true),
   ('notification_outbox','performer_id','uuid',true),
   ('notification_outbox','booking_id','uuid',true),
   ('notification_outbox','event_key','text',true),
   ('notification_outbox','kind','text',true),
   ('notification_outbox','channel','text',true),
   ('notification_outbox','status','text',true),
   ('notification_outbox','attempts','int4',true),
   ('notification_outbox','next_attempt_at','timestamptz',true),
   ('notification_outbox','locked_at','timestamptz',false),
   ('notification_outbox','lock_token','uuid',false),
   ('notification_outbox','last_error_code','text',false),
   ('notification_outbox','last_error','text',false),
   ('notification_outbox','provider_message_id','text',false),
   ('notification_outbox','sent_at','timestamptz',false),
   ('notification_outbox','created_at','timestamptz',true),
   ('notification_outbox','updated_at','timestamptz',true),
   ('notification_outbox','organization_id','uuid',true),
   ('notification_outbox','audience','text',true),
   ('notification_outbox','recipient_key','text',true),
   ('notification_outbox','payload','jsonb',true),
   ('notification_outbox','dispatcher','text',true),
   ('notification_outbox','delivered_at','timestamptz',false),
   ('notification_outbox','delivery_receipt_at','timestamptz',false),
   ('notification_outbox','delivery_receipt_source','text',false),
   ('organization_memberships','organization_id','uuid',true),
   ('organization_memberships','user_id','uuid',true),
   ('organization_memberships','role','text',true),
   ('organization_memberships','is_bookable','bool',true),
   ('organization_memberships','active','bool',true),
   ('organization_memberships','created_by','uuid',false),
   ('organization_memberships','created_at','timestamptz',true),
   ('organization_memberships','updated_at','timestamptz',true),
   ('organizations','id','uuid',true),
   ('organizations','name','text',true),
   ('organizations','public_slug','text',true),
   ('organizations','status','text',true),
   ('organizations','public_booking_enabled','bool',true),
   ('organizations','created_by','uuid',false),
   ('organizations','legacy_performer_id','uuid',false),
   ('organizations','created_at','timestamptz',true),
   ('organizations','updated_at','timestamptz',true),
   ('provider_days_off','id','uuid',true),
   ('provider_days_off','performer_id','uuid',true),
   ('provider_days_off','off_date','date',true),
   ('provider_days_off','all_day','bool',true),
   ('provider_days_off','start_time','time',false),
   ('provider_days_off','end_time','time',false),
   ('provider_days_off','note','text',true),
   ('provider_days_off','created_at','timestamptz',true),
   ('provider_schedule','performer_id','uuid',true),
   ('provider_schedule','weekday','int2',true),
   ('provider_schedule','enabled','bool',true),
   ('provider_schedule','start_time','time',true),
   ('provider_schedule','end_time','time',true),
   ('provider_schedule','break_start','time',false),
   ('provider_schedule','break_end','time',false),
   ('provider_schedule','slot_interval_minutes','int4',true),
   ('services','id','uuid',true),
   ('services','performer_id','uuid',true),
   ('services','name','text',true),
   ('services','duration_minutes','int4',true),
   ('services','price_rub','int4',true),
   ('services','active','bool',true),
   ('services','created_at','timestamptz',true)
 ) expected(table_name,column_name,type_name,not_null) loop
  if not exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||item.table_name)
   and a.attname=item.column_name and not a.attisdropped
   and a.atttypid=to_regtype(item.type_name) and a.attnotnull=item.not_null) then
   raise exception using errcode='55000',message='v123_column_drift:'||item.table_name||'.'||item.column_name;
  end if;
 end loop;
 -- Unknown row triggers can introduce unreviewed side effects; do not bypass them.
 if (select count(*) from pg_trigger where tgrelid='public.bookings'::regclass and not tgisinternal)<>18 then
  raise exception using errcode='55000',message='v123_unknown_booking_trigger';
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.bookings'::regclass
  and conname='bookings_performer_active_no_overlap' and contype='x')
 or not exists(select 1 from pg_constraint where conrelid='public.booking_resource_allocations'::regclass
  and conname='booking_resources_active_no_overlap' and contype='x') then
  raise exception using errcode='55000',message='v123_overlap_constraints_required';
 end if;
 -- Keep the existing HTTP destination/headers opaque and unchanged. Only a
 -- sentinel-phone WHEN is added; no credentials are materialized in source/logs.
 select pg_get_triggerdef(t.oid),t.tgqual is null into definition,no_condition from pg_trigger t
 where t.tgrelid='public.bookings'::regclass and t.tgname='new_booking_telegram'
  and t.tgfoid=to_regprocedure('supabase_functions.http_request()')
  and t.tgtype=5 and t.tgenabled='O';
 if definition is null then raise exception using errcode='55000',message='v123_webhook_trigger_drift'; end if;
 boundary:=position(' EXECUTE FUNCTION ' in definition);
 if boundary=0 then raise exception using errcode='55000',message='v123_webhook_format_drift'; end if;
 if not no_condition then
  if right(left(definition,boundary-1),length(' WHEN ((new.client_phone <> ''0000000000''::text))'))<>' WHEN ((new.client_phone <> ''0000000000''::text))' then
   raise exception using errcode='55000',message='v123_webhook_condition_drift';
  end if;
 else
  definition:=left(definition,boundary-1)||' WHEN (new.client_phone <> ''0000000000'')'||substr(definition,boundary);
  execute 'drop trigger new_booking_telegram on public.bookings';
  execute definition;
 end if;
end $guard$;


-- Scoped to an active service owned by the authenticated performer.
-- p_location is explicit; no implicit cross-organization fallback is permitted.
create or replace function public.minuta_block_slot_valid_v123(
 p_organization uuid,p_location uuid,p_service uuid,p_date date,p_time time,p_duration integer
) returns boolean language plpgsql volatile security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid(); v_schedule public.provider_schedule%rowtype; v_zone text; v_end timestamp;
begin
 if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
 if p_duration is null or p_duration not between 1 and 480 or p_date is null or p_time is null
   or extract(second from p_time)<>0 then return false; end if;
 select location.timezone into v_zone from public.locations location
 join public.organizations organization on organization.id=location.organization_id and organization.status='active'
 join public.organization_memberships member on member.organization_id=organization.id and member.user_id=v_actor
  and member.active and member.is_bookable
 join public.services service on service.id=p_service and service.performer_id=v_actor and service.active
 where location.id=p_location and location.organization_id=p_organization and location.active;
 if v_zone is null then return false; end if;
 begin
  perform pg_catalog.timezone(v_zone,p_date::timestamp);
 exception when invalid_parameter_value then
  return false;
 end;
 v_end:=p_date+p_time+make_interval(mins=>p_duration);
 if p_date+p_time<=timezone(v_zone,now()) or p_date>timezone(v_zone,now())::date+730 or v_end>p_date+1 then return false; end if;
 select * into v_schedule from public.provider_schedule
 where performer_id=v_actor and weekday=extract(isodow from p_date)::integer;
 -- No guessed schedule or technical-service duration fallback.
 if not found or not v_schedule.enabled or v_schedule.start_time is null or v_schedule.end_time is null
  or p_time<v_schedule.start_time or v_end>p_date+v_schedule.end_time then return false; end if;
 if v_schedule.break_start is not null and v_schedule.break_end is not null
  and tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+v_schedule.break_start,p_date+v_schedule.break_end,'[)') then return false; end if;
 if exists(select 1 from public.provider_days_off d where d.performer_id=v_actor and d.off_date=p_date
  and (d.all_day or d.start_time is null or d.end_time is null
   or tsrange(p_date+p_time,v_end,'[)')&&tsrange(p_date+d.start_time,p_date+d.end_time,'[)'))) then return false; end if;
 if exists(select 1 from public.bookings b where b.performer_id=v_actor and b.status<>'cancelled'
  and tsrange(p_date+p_time,v_end,'[)')&&tsrange(b.booking_date+b.booking_time,
   b.booking_date+b.booking_time+make_interval(mins=>b.duration_minutes),'[)')) then return false; end if;
 if not coalesce(public.minuta_booking_fits_active_shift(p_organization,p_location,v_actor,p_date,p_time,p_duration),false)
  then return false; end if;
 if exists(select 1 from public.group_booking_events event where event.organization_id=p_organization
  and event.location_id=p_location and event.performer_id=v_actor and event.event_date=p_date
  and event.status in ('published','closed')
  and tsrange(p_date+p_time,v_end,'[)')&&tsrange(event.event_date+event.start_time,
   event.event_date+event.start_time+make_interval(mins=>event.duration_minutes),'[)')) then return false; end if;
 -- Match allocation requirements without mutating or reserving resources. The
 -- existing allocation trigger remains authoritative under its advisory locks.
 if exists(select 1 from public.service_resource_requirements requirement
  join public.resource_groups resource_group on resource_group.id=requirement.group_id
   and resource_group.organization_id=requirement.organization_id
  where requirement.organization_id=p_organization and requirement.service_id=p_service and requirement.active
   and (not resource_group.active or requirement.quantity>(select count(*) from public.resources resource
    where resource.organization_id=p_organization and resource.location_id=p_location
     and resource.group_id=requirement.group_id and resource.active
     and not exists(select 1 from public.booking_resource_allocations allocation
      where allocation.resource_id=resource.id and allocation.booking_status='active'
       and tsrange(p_date+p_time,v_end,'[)')&&tsrange(allocation.starts_at,allocation.ends_at,'[)'))))) then return false; end if;
 return coalesce(public.minuta_slot_respects_booking_buffer(p_service,p_date,p_time,p_duration,null),false);
end $$;
revoke all on function public.minuta_block_slot_valid_v123(uuid,uuid,uuid,date,time,integer) from public,anon,authenticated,service_role;

create or replace function public.get_provider_block_slots_v123(
 p_organization uuid,p_location uuid,p_service uuid,p_date date,p_duration integer
) returns table(booking_date date,booking_time time) language plpgsql volatile security definer set search_path to '' as $$
declare v_minute integer; v_first integer; v_last integer;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication_required'; end if;
 if p_duration is null or p_duration not between 1 and 480 then raise exception using errcode='22023',message='invalid_block_duration'; end if;
 select ceil(extract(epoch from start_time)/60)::integer,
  floor(extract(epoch from end_time)/60)::integer-p_duration into v_first,v_last
 from public.provider_schedule where performer_id=auth.uid() and weekday=extract(isodow from p_date)::integer and enabled;
 if not found or v_first is null or v_last is null or v_first>v_last then return; end if;
 -- Minute-precise intervals; no technical service duration used to prefilter.
 for v_minute in v_first..v_last loop
  if public.minuta_block_slot_valid_v123(p_organization,p_location,p_service,p_date,
    (time '00:00'+make_interval(mins=>v_minute))::time,p_duration) then
   booking_date:=p_date;booking_time:=(time '00:00'+make_interval(mins=>v_minute))::time;return next;
  end if;
 end loop;
end $$;
revoke all on function public.get_provider_block_slots_v123(uuid,uuid,uuid,date,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_provider_block_slots_v123(uuid,uuid,uuid,date,integer) to authenticated;

create or replace function public.create_provider_block_v123(
 p_organization uuid,p_location uuid,p_service uuid,p_date date,p_time time,p_duration integer,
 p_request_id uuid,p_title text default 'Перерыв',p_note text default ''
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_actor uuid:=auth.uid(); v_existing public.bookings%rowtype; v_id uuid; v_code text;
 v_previous_org text:=current_setting('minuta.booking_organization',true);
 v_previous_location text:=current_setting('minuta.booking_location',true);
begin
 if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
 if p_request_id is null or p_organization is null or p_location is null or p_service is null
  or p_date is null or p_time is null or p_duration is null or p_duration not between 1 and 480
  or char_length(trim(coalesce(p_title,''))) not between 2 and 80
  or char_length(coalesce(p_note,''))>1000 then raise exception using errcode='22023',message='invalid_block_payload'; end if;
 -- Request lock -> performer/date lock shared with provider_book_appointment,
 -- book_appointment and v101. Existing tenant/shift/resource triggers stay on.
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,12301));
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||p_date::text,0));
 -- Team rescheduling takes the organization lock before the day lock. Never
 -- wait on that reverse edge while holding a day lock: abort/retry safely.
 if not pg_try_advisory_xact_lock(hashtextextended(p_organization::text,7100)) then
  raise exception using errcode='40001',message='block_schedule_changed';
 end if;
 select * into v_existing from public.bookings where id=p_request_id;
 if found then
  if v_existing.performer_id<>v_actor or v_existing.organization_id<>p_organization or v_existing.location_id<>p_location
   or v_existing.service_id<>p_service or v_existing.booking_date<>p_date or v_existing.booking_time<>p_time
   or v_existing.duration_minutes<>p_duration or v_existing.client_phone<>'0000000000'
   or v_existing.client_name<>trim(p_title) or coalesce(v_existing.provider_note,'')<>coalesce(p_note,'')
   or v_existing.status='cancelled' then raise exception using errcode='23505',message='block_request_conflict'; end if;
  return jsonb_build_object('booking_id',v_existing.id,'booking_code',v_existing.booking_code,
   'duration_minutes',v_existing.duration_minutes,'replayed',true,'payment_required',false,'notifications_suppressed',true);
 end if;
 if not public.minuta_block_slot_valid_v123(p_organization,p_location,p_service,p_date,p_time,p_duration)
  then raise exception using errcode='23P01',message='block_slot_unavailable'; end if;
 v_code:='MIN-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,10));
 perform set_config('minuta.booking_organization',p_organization::text,true);
 perform set_config('minuta.booking_location',p_location::text,true);
 insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,
  booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,provider_note)
 values(p_request_id,v_code,gen_random_uuid(),v_actor,p_service,trim(p_title),'0000000000',p_date,p_time,p_duration,0,0,'new',0,'not_required','',p_note)
 returning id into v_id;
 update public.bookings set original_price_rub=0,total_price_rub=0,deposit_amount_rub=0,payment_status='not_required',
  payment_url='',payment_due_at=null,expired_unpaid_at=null,refund_status='not_required',
  booking_policy_snapshot=coalesce(booking_policy_snapshot,'{}'::jsonb)||jsonb_build_object('schedule_block',true,'payment_suppressed',true)
 where id=v_id;
 -- Atomic suppression: no queued item becomes visible to dispatcher before commit.
 delete from public.notification_outbox where booking_id=v_id;
 perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
 perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
 return jsonb_build_object('booking_id',v_id,'booking_code',v_code,'duration_minutes',p_duration,
  'payment_required',false,'notifications_suppressed',true);
exception when others then
 perform set_config('minuta.booking_organization',coalesce(v_previous_org,''),true);
 perform set_config('minuta.booking_location',coalesce(v_previous_location,''),true);
 raise;
end $$;
revoke all on function public.create_provider_block_v123(uuid,uuid,uuid,date,time,integer,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_provider_block_v123(uuid,uuid,uuid,date,time,integer,uuid,text,text) to authenticated;

create or replace function public.manage_minuta_booking_series_v123_core(
  p_booking uuid,
  p_action text,
  p_scope text default 'one',
  p_date date default null,
  p_time time without time zone default null,
  p_expected_date date default null,
  p_expected_time time without time zone default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := auth.uid();
  v_anchor public.bookings%rowtype;
  v_delta interval;
  v_locked_series uuid;
  v_ids uuid[];
  v_target record;
  v_affected jsonb := '[]'::jsonb;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if p_booking is null or p_action not in ('cancel', 'reschedule')
     or p_scope not in ('one', 'following', 'all') then
    raise exception using errcode = '22023', message = 'invalid_series_action';
  end if;

  select booking.* into v_anchor
  from public.bookings booking
  where booking.id = p_booking;

  if not found then
    raise exception using errcode = 'P0001', message = 'booking_not_found';
  end if;
  if v_anchor.performer_id <> v_actor then
    raise exception using errcode = '42501', message = 'booking_access_denied';
  end if;
  if v_anchor.series_id is null or v_anchor.series_occurrence is null then
    raise exception using errcode = 'P0001', message = 'booking_not_in_series';
  end if;
  if v_anchor.status = 'cancelled'
     or v_anchor.booking_date < current_date
     or exists (
       select 1 from public.booking_outcomes outcome
       where outcome.booking_id = v_anchor.id
         and outcome.visit_status <> 'scheduled'
     ) then
    raise exception using errcode = 'P0001', message = 'series_booking_not_actionable';
  end if;

  v_locked_series:=v_anchor.series_id;
  perform pg_advisory_xact_lock(hashtextextended(v_locked_series::text, 7901));

  select
    array_agg(booking.id order by booking.series_occurrence),
    coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', booking.id,
      'occurrence', booking.series_occurrence
    ) order by booking.series_occurrence), '[]'::jsonb)
  into v_ids, v_affected
  from public.bookings booking
  left join public.booking_outcomes outcome on outcome.booking_id = booking.id
  where booking.series_id = v_anchor.series_id
    and booking.performer_id = v_actor
    and booking.status <> 'cancelled'
    and booking.booking_date >= current_date
    and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
    and (
      (p_scope = 'one' and booking.id = v_anchor.id)
      or (p_scope = 'following' and booking.series_occurrence >= v_anchor.series_occurrence)
      or p_scope = 'all'
    );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'series_has_no_actionable_bookings';
  end if;

  -- Ядро отмены v76 берёт такой же lock до блокировки строки. Получаем lock
  -- каждой записи заранее и по порядку, чтобы групповая операция не могла
  -- образовать взаимную блокировку с одиночной отменой.
  for v_target in
    select booking.id
    from public.bookings booking
    where booking.id = any(v_ids)
    order by booking.series_occurrence, booking.id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_target.id::text, 7302));
  end loop;

  perform 1
  from public.bookings booking
  where booking.id = any(v_ids)
  order by booking.series_occurrence, booking.id
  for update;

  perform 1
  from public.booking_outcomes outcome
  where outcome.booking_id = any(v_ids)
  order by outcome.booking_id
  for update;

  -- Re-read only after the existing series -> ordered booking locks -> rows sequence.
  select booking.* into v_anchor from public.bookings booking where booking.id=p_booking;
  if not found or v_anchor.performer_id<>v_actor or v_anchor.series_id is distinct from v_locked_series or v_anchor.status='cancelled'
    or v_anchor.booking_date<current_date or exists(select 1 from public.booking_outcomes outcome
      where outcome.booking_id=v_anchor.id and outcome.visit_status<>'scheduled') then
    raise exception using errcode='40001',message='series_anchor_changed';
  end if;
  if (p_expected_date is null)<>(p_expected_time is null) then
    raise exception using errcode='22023',message='invalid_expected_series_anchor';
  end if;
  if p_expected_date is not null and (v_anchor.booking_date is distinct from p_expected_date
    or v_anchor.booking_time is distinct from p_expected_time) then
    raise exception using errcode='40001',message='series_anchor_changed';
  end if;

  -- Повторяем выбор после ожидания блокировок: отменённая или завершённая
  -- параллельным запросом запись не должна попасть в групповую операцию.
  select
    array_agg(booking.id order by booking.series_occurrence),
    coalesce(jsonb_agg(jsonb_build_object(
      'booking_id', booking.id,
      'occurrence', booking.series_occurrence
    ) order by booking.series_occurrence), '[]'::jsonb)
  into v_ids, v_affected
  from public.bookings booking
  left join public.booking_outcomes outcome on outcome.booking_id = booking.id
  where booking.series_id = v_anchor.series_id
    and booking.performer_id = v_actor
    and booking.status <> 'cancelled'
    and booking.booking_date >= current_date
    and coalesce(outcome.visit_status, 'scheduled') = 'scheduled'
    and (
      (p_scope = 'one' and booking.id = v_anchor.id)
      or (p_scope = 'following' and booking.series_occurrence >= v_anchor.series_occurrence)
      or p_scope = 'all'
    );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'series_has_no_actionable_bookings';
  end if;

  if p_action = 'cancel' then
    for v_target in
      select booking.id
      from public.bookings booking
      where booking.id = any(v_ids)
      order by booking.series_occurrence
    loop
      perform public.cancel_minuta_booking_core(v_target.id, 'provider', 'always_full');
    end loop;
  else
    if p_date is null or p_time is null then
      raise exception using errcode = '22023', message = 'series_reschedule_target_required';
    end if;
    v_delta := (p_date + p_time) - (v_anchor.booking_date + v_anchor.booking_time);

    if exists (
      select 1
      from public.bookings booking
      where booking.id = any(v_ids)
        and (
          ((booking.booking_date + booking.booking_time + v_delta)::date < current_date)
          or ((booking.booking_date + booking.booking_time + v_delta)::date > current_date + 730)
        )
    ) then
      raise exception using errcode = '22023', message = 'series_reschedule_out_of_range';
    end if;

    -- Положительный сдвиг идёт с конца серии, отрицательный — с начала.
    -- Так старые окна следующих элементов освобождаются до переноса соседей.
    for v_target in
      select booking.id
      from public.bookings booking
      where booking.id = any(v_ids)
      order by
        case when v_delta >= interval '0 seconds' then booking.booking_date + booking.booking_time end desc,
        case when v_delta < interval '0 seconds' then booking.booking_date + booking.booking_time end asc,
        booking.id
    loop
      update public.bookings booking
      set booking_date = (booking.booking_date + booking.booking_time + v_delta)::date,
          booking_time = (booking.booking_date + booking.booking_time + v_delta)::time
      where booking.id = v_target.id
        and booking.performer_id = v_actor;
    end loop;
  end if;

  return jsonb_build_object(
    'series_id', v_anchor.series_id,
    'action', p_action,
    'scope', p_scope,
    'affected_count', array_length(v_ids, 1),
    'affected', v_affected
  );
exception
  when exclusion_violation or unique_violation then
    raise exception using errcode = 'P0001', message = 'series_slot_unavailable';
end;
$$;

revoke all on function public.manage_minuta_booking_series_v123_core(uuid,text,text,date,time,date,time) from public,anon,authenticated,service_role;
create or replace function public.manage_minuta_booking_series(
 p_booking uuid,p_action text,p_scope text default 'one',p_date date default null,p_time time default null
) returns jsonb language sql security definer set search_path to '' as $$
 select public.manage_minuta_booking_series_v123_core(p_booking,p_action,p_scope,p_date,p_time,null,null);
$$;
-- Preserve v79 callers while new editors explicitly reject stale coordinates.
create or replace function public.manage_minuta_booking_series_v123(
 p_booking uuid,p_action text,p_scope text,p_date date,p_time time,p_expected_date date,p_expected_time time
) returns jsonb language plpgsql security definer set search_path to '' as $$
begin
 if p_expected_date is null or p_expected_time is null then raise exception using errcode='22023',message='expected_series_anchor_required'; end if;
 return public.manage_minuta_booking_series_v123_core(p_booking,p_action,p_scope,p_date,p_time,p_expected_date,p_expected_time);
end $$;
revoke all on function public.manage_minuta_booking_series(uuid,text,text,date,time) from public,anon,authenticated,service_role;
grant execute on function public.manage_minuta_booking_series(uuid,text,text,date,time) to authenticated;
revoke all on function public.manage_minuta_booking_series_v123(uuid,text,text,date,time,date,time) from public,anon,authenticated,service_role;
grant execute on function public.manage_minuta_booking_series_v123(uuid,text,text,date,time,date,time) to authenticated;
notify pgrst,'reload schema';
commit;
