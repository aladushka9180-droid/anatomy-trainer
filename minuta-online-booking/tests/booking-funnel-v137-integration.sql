begin;
do $prepare$
declare v_org uuid:=gen_random_uuid(); v_slug text; v_service uuid; v_performer uuid; v_other_slug text; v_session uuid:=gen_random_uuid();
begin
  select service.id,service.performer_id into v_service,v_performer
  from public.services service where service.active order by service.id limit 1;
  if v_service is null then raise exception 'v137_test_requires_bookable_service'; end if;
  v_slug:='v137-source-'||replace(v_org::text,'-','');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled)
  values(v_org,'V137 isolated source',v_slug,'active',true);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
  values(v_org,v_performer,'owner',true,true);
  v_other_slug:='v137-other-'||replace(gen_random_uuid()::text,'-','');
  insert into public.organizations(name,public_slug,status,public_booking_enabled)
  values('V137 isolated other',v_other_slug,'active',true);
  perform set_config('minuta.v137.org',v_org::text,true);
  perform set_config('minuta.v137.slug',v_slug,true);
  perform set_config('minuta.v137.service',v_service::text,true);
  perform set_config('minuta.v137.other_slug',v_other_slug,true);
  perform set_config('minuta.v137.session',v_session::text,true);
end
$prepare$;

set local role anon;
do $anon_test$
begin
  if not public.track_public_booking_funnel_event(current_setting('minuta.v137.slug'),current_setting('minuta.v137.session')::uuid,'page_opened',null,null,
    'campaign','primetime_external_test','embed','booking_widget','general',null,'htmlpreview.github.io') then raise exception 'v137_general_source_event_rejected'; end if;
  if not public.track_public_booking_funnel_event(current_setting('minuta.v137.slug'),current_setting('minuta.v137.session')::uuid,'service_selected',current_setting('minuta.v137.service')::uuid,null,
    'campaign','primetime_external_test','embed','booking_widget','service',null,'htmlpreview.github.io') then raise exception 'v137_valid_service_event_rejected'; end if;
  if public.track_public_booking_funnel_event(current_setting('minuta.v137.other_slug'),gen_random_uuid(),'service_selected',current_setting('minuta.v137.service')::uuid) then raise exception 'v137_cross_tenant_service_event_accepted'; end if;
  if public.track_public_booking_funnel_event(current_setting('minuta.v137.slug'),gen_random_uuid(),'service_selected',gen_random_uuid()) then raise exception 'v137_missing_service_event_accepted'; end if;
end
$anon_test$;
reset role;

do $verify$
begin
  if not exists(select 1 from public.booking_funnel_events event
    where event.organization_id=current_setting('minuta.v137.org')::uuid
      and event.session_id=current_setting('minuta.v137.session')::uuid and event.event_name='page_opened'
      and event.source_kind='campaign' and event.utm_source='primetime_external_test'
      and event.utm_medium='embed' and event.utm_campaign='booking_widget' and event.utm_content='general'
      and event.referrer_host='htmlpreview.github.io') then raise exception 'v137_source_attribution_not_persisted'; end if;
end
$verify$;
rollback;
