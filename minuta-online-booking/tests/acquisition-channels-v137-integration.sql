begin;

do $prepare$
declare
  v_org uuid:=gen_random_uuid();
  v_other_org uuid:=gen_random_uuid();
  v_user uuid;
  v_yandex_session uuid:=gen_random_uuid();
  v_google_session uuid:=gen_random_uuid();
  v_slug text;
begin
  select membership.user_id into v_user
  from public.organization_memberships membership
  where membership.active order by membership.created_at limit 1;
  if v_user is null then raise exception 'd11_test_requires_active_membership'; end if;

  v_slug:='d11-maps-'||replace(v_org::text,'-','');
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled)
  values(v_org,'D11 maps isolated',v_slug,'active',true);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active)
  values(v_org,v_user,'owner',true,true);
  insert into public.organizations(id,name,public_slug,status,public_booking_enabled)
  values(v_other_org,'D11 other isolated','d11-other-'||replace(v_other_org::text,'-',''),'active',true);

  perform set_config('minuta.d11.org',v_org::text,true);
  perform set_config('minuta.d11.other_org',v_other_org::text,true);
  perform set_config('minuta.d11.user',v_user::text,true);
  perform set_config('minuta.d11.slug',v_slug,true);
  perform set_config('minuta.d11.yandex_session',v_yandex_session::text,true);
  perform set_config('minuta.d11.google_session',v_google_session::text,true);
end
$prepare$;

set local role anon;
do $track$
begin
  if not public.track_public_booking_funnel_event(
    current_setting('minuta.d11.slug'),current_setting('minuta.d11.yandex_session')::uuid,'page_opened',null,null,
    'search','yandex','maps','maps_booking_general','general',null,null
  ) then raise exception 'd11_yandex_page_open_rejected'; end if;
  if not public.track_public_booking_funnel_event(
    current_setting('minuta.d11.slug'),current_setting('minuta.d11.google_session')::uuid,'page_opened',null,null,
    'search','google','maps','maps_booking_general','general',null,null
  ) then raise exception 'd11_google_page_open_rejected'; end if;
  if not public.track_public_booking_funnel_event(
    current_setting('minuta.d11.slug'),current_setting('minuta.d11.yandex_session')::uuid,'page_opened',null,null,
    'campaign','tampered','shared_link','tampered','tampered',null,null
  ) then raise exception 'd11_yandex_replay_rejected'; end if;
end
$track$;
reset role;

insert into public.booking_funnel_events(
  organization_id,session_id,event_name,source_kind,utm_source,utm_medium,utm_campaign,utm_content
) values(
  current_setting('minuta.d11.org')::uuid,current_setting('minuta.d11.yandex_session')::uuid,
  'booking_created','search','yandex','maps','maps_booking_general','general'
);
insert into public.booking_funnel_events(
  organization_id,session_id,event_name,source_kind,utm_source,utm_medium,utm_campaign,utm_content
) values(
  current_setting('minuta.d11.other_org')::uuid,gen_random_uuid(),
  'page_opened','search','yandex','maps','maps_booking_general','general'
);

select set_config('request.jwt.claim.sub',current_setting('minuta.d11.user'),true);
set local role authenticated;
do $verify$
declare
  v_report jsonb;
  v_yandex jsonb;
  v_google jsonb;
begin
  v_report:=public.get_minuta_utm_funnel_v107(
    current_setting('minuta.d11.org')::uuid,current_date,current_date
  );
  if (v_report#>>'{totals,visitors}')::integer<>2 then raise exception 'd11_total_visitors_mismatch: %',v_report; end if;
  if (v_report#>>'{totals,bookings}')::integer<>1 then raise exception 'd11_total_bookings_mismatch: %',v_report; end if;
  select value into v_yandex from jsonb_array_elements(v_report->'rows') value where value->>'utm_source'='yandex';
  select value into v_google from jsonb_array_elements(v_report->'rows') value where value->>'utm_source'='google';
  if v_yandex is null or (v_yandex->>'visitors')::integer<>1 or (v_yandex->>'bookings')::integer<>1 then
    raise exception 'd11_yandex_conversion_mismatch: %',v_report;
  end if;
  if v_google is null or (v_google->>'visitors')::integer<>1 or (v_google->>'bookings')::integer<>0 then
    raise exception 'd11_google_conversion_mismatch: %',v_report;
  end if;
  if exists(select 1 from jsonb_array_elements(v_report->'rows') value where value->>'utm_source'='tampered') then
    raise exception 'd11_replay_changed_first_source: %',v_report;
  end if;
end
$verify$;
reset role;

rollback;
