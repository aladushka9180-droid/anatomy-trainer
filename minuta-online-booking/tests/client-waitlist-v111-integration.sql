-- TEST DATABASE ONLY. Runner supplies the outer transaction and rolls it back.
create function pg_temp.waitlist_assert(ok boolean, message text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',message; end if; end $$;

do $$
declare actor uuid; service uuid; org uuid; loc uuid; loc2 uuid; other_org uuid; other_loc uuid;
begin
  select s.performer_id,s.id into actor,service from public.services s
    join public.performer_profiles p on p.id=s.performer_id where s.active limit 1;
  perform pg_temp.waitlist_assert(actor is not null,'waitlist_fixture_service_missing');
  insert into public.organizations(name,public_booking_enabled) values('Waitlist test A',true) returning id into org;
  insert into public.organizations(name,public_booking_enabled) values('Waitlist test B',true) returning id into other_org;
  insert into public.locations(organization_id,name) values(org,'Branch A') returning id into loc;
  insert into public.locations(organization_id,name) values(org,'Branch B') returning id into loc2;
  insert into public.locations(organization_id,name) values(other_org,'Other organization') returning id into other_loc;
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable)
    values(org,actor,'specialist',true),(other_org,actor,'specialist',true);
  perform set_config('waitlist.actor',actor::text,true);
  perform set_config('waitlist.service',service::text,true);
  perform set_config('waitlist.org',org::text,true);
  perform set_config('waitlist.loc',loc::text,true);
  perform set_config('waitlist.loc2',loc2::text,true);
  perform set_config('waitlist.other_loc',other_loc::text,true);
  perform set_config('waitlist.slug',(select public_slug from public.organizations where id=org),true);
  perform set_config('waitlist.legacy',md5(coalesce((select string_agg(to_jsonb(r)::text,',' order by r.id) from public.booking_waitlist_requests r),'')),true);
end $$;

set local role anon;
do $$
declare result record; second_result record; desired date := timezone('Europe/Samara',now())::date+1;
begin
  select * into result from public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc')::uuid,
    current_setting('waitlist.service')::uuid,desired,'morning','Waitlist test','79990000111');
  perform pg_temp.waitlist_assert(result.manage_token is not null,'join_failed');
  perform set_config('waitlist.token',result.manage_token::text,true);
  begin
    perform public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc')::uuid,
      current_setting('waitlist.service')::uuid,desired,'evening','Different person','79990000111');
    raise exception 'duplicate_disclosed_token';
  exception when raise_exception then
    if sqlerrm <> 'waitlist_request_already_exists' then raise; end if;
  end;
  select * into second_result from public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc2')::uuid,
    current_setting('waitlist.service')::uuid,desired,'day','Waitlist test','79990000111');
  perform pg_temp.waitlist_assert(result.manage_token<>second_result.manage_token,'branches_collided');
  select * into second_result from public.get_minuta_waitlist_request_v111(result.manage_token);
  perform pg_temp.waitlist_assert(second_result.location_id=current_setting('waitlist.loc')::uuid and second_result.time_period='morning','wrong_scope_or_duplicate_modified');
  perform pg_temp.waitlist_assert(not exists(select 1 from public.get_minuta_waitlist_request_v111(gen_random_uuid())),'invalid_token_visible');
  begin
    perform public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.other_loc')::uuid,
      current_setting('waitlist.service')::uuid,desired,'any','Waitlist test','79990000111');
    raise exception 'foreign_location_accepted';
  exception when raise_exception then if sqlerrm <> 'waitlist_location_unavailable' then raise; end if; end;
  begin
    perform public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc')::uuid,
      gen_random_uuid(),desired,'any','Waitlist test','79990000111');
    raise exception 'foreign_service_accepted';
  exception when raise_exception then if sqlerrm <> 'service_unavailable' then raise; end if; end;
  begin
    perform public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc')::uuid,
      current_setting('waitlist.service')::uuid,desired-2,'any','Waitlist test','79990000111');
    raise exception 'past_date_accepted';
  exception when raise_exception then if sqlerrm <> 'invalid_waitlist_date' then raise; end if; end;
  begin
    perform public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc')::uuid,
      current_setting('waitlist.service')::uuid,desired,'invalid','Waitlist test','79990000111');
    raise exception 'invalid_period_accepted';
  exception when raise_exception then if sqlerrm <> 'invalid_time_period' then raise; end if; end;
  begin perform count(*) from public.organization_waitlist_requests; raise exception 'anon_read_allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select set_config('waitlist.request',(select id::text from public.organization_waitlist_requests where manage_token=current_setting('waitlist.token')::uuid),true);
select set_config('request.jwt.claim.sub',current_setting('waitlist.actor'),true);
set local role authenticated;
select pg_temp.waitlist_assert((select count(*)=2 from public.organization_waitlist_requests where organization_id=current_setting('waitlist.org')::uuid),'specialist_read_failed');
select pg_temp.waitlist_assert(public.set_minuta_waitlist_status_v111(current_setting('waitlist.request')::uuid,'contacted')='contacted','specialist_update_failed');
reset role;

update public.organization_memberships set active=false where organization_id=current_setting('waitlist.org')::uuid;
set local role authenticated;
select pg_temp.waitlist_assert(not exists(select 1 from public.organization_waitlist_requests where organization_id=current_setting('waitlist.org')::uuid),'inactive_member_read');
do $$ begin
  perform public.set_minuta_waitlist_status_v111(current_setting('waitlist.request')::uuid,'booked');
  raise exception 'inactive_member_update';
exception when raise_exception then if sqlerrm <> 'waitlist_request_unavailable' then raise; end if; end $$;
reset role;
update public.organization_memberships set active=true,role='admin' where organization_id=current_setting('waitlist.org')::uuid;
set local role authenticated;
select pg_temp.waitlist_assert((select count(*)=2 from public.organization_waitlist_requests where organization_id=current_setting('waitlist.org')::uuid),'admin_read_failed');
select pg_temp.waitlist_assert(public.set_minuta_waitlist_status_v111(current_setting('waitlist.request')::uuid,'waiting')='waiting','admin_update_failed');
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
select pg_temp.waitlist_assert(not exists(select 1 from public.organization_waitlist_requests where organization_id=current_setting('waitlist.org')::uuid),'outsider_read');
do $$ begin
  perform public.set_minuta_waitlist_status_v111(current_setting('waitlist.request')::uuid,'booked');
  raise exception 'outsider_update';
exception when raise_exception then if sqlerrm <> 'waitlist_request_unavailable' then raise; end if; end $$;
reset role;

update public.organization_memberships set is_bookable=false where organization_id=current_setting('waitlist.org')::uuid;
set local role anon;
do $$ begin
  perform public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc')::uuid,
    current_setting('waitlist.service')::uuid,timezone('Europe/Samara',now())::date+2,'any','Waitlist test','79990000111');
  raise exception 'non_bookable_performer_accepted';
exception when raise_exception then if sqlerrm <> 'service_unavailable' then raise; end if; end $$;
reset role;
update public.organizations set public_booking_enabled=false where id=current_setting('waitlist.org')::uuid;
set local role anon;
do $$ begin
  perform public.join_minuta_waitlist_v111(current_setting('waitlist.slug'),current_setting('waitlist.loc')::uuid,
    current_setting('waitlist.service')::uuid,timezone('Europe/Samara',now())::date+2,'any','Waitlist test','79990000111');
  raise exception 'private_organization_accepted';
exception when raise_exception then if sqlerrm <> 'waitlist_location_unavailable' then raise; end if; end $$;
reset role;

-- Called after the rollback is applied: clients must still be able to cancel.
create function pg_temp.check_waitlist_rollback() returns void language plpgsql as $$ begin
  perform pg_temp.waitlist_assert(not has_function_privilege('anon','public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text)','EXECUTE'),'rollback_did_not_block_join');
  perform pg_temp.waitlist_assert((select count(*)=2 from public.organization_waitlist_requests where organization_id=current_setting('waitlist.org')::uuid),'rollback_lost_data');
  perform pg_temp.waitlist_assert(public.cancel_minuta_waitlist_request_v111(current_setting('waitlist.token')::uuid)='cancelled','rollback_cancel_failed');
  perform pg_temp.waitlist_assert(public.cancel_minuta_waitlist_request_v111(current_setting('waitlist.token')::uuid)='cancelled','cancel_not_idempotent');
  perform pg_temp.waitlist_assert(current_setting('waitlist.legacy')=md5(coalesce((select string_agg(to_jsonb(r)::text,',' order by r.id) from public.booking_waitlist_requests r),'')),'legacy_data_changed');
end $$;
