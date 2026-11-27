-- Runs only inside the network-disabled restored copy, under a caller-owned savepoint.
-- Uses existing organization/service relationships; every test write is rolled back.
do $functional$
declare
 owner_id uuid; org_id uuid; client_id uuid; location_id uuid; slug text;
 delta_value integer:=1; preview jsonb; result jsonb; bounds jsonb; source_name text;
 request_id uuid:=gen_random_uuid(); second_request uuid:=gen_random_uuid(); third_request uuid:=gen_random_uuid();
 token_one uuid:=gen_random_uuid(); token_two uuid:=gen_random_uuid(); token_three uuid:=gen_random_uuid();
 offer_one uuid:=gen_random_uuid(); offer_expired uuid:=gen_random_uuid(); offer_busy uuid:=gen_random_uuid(); offer_competitor uuid:=gen_random_uuid();
 adjustment_id uuid:=gen_random_uuid(); template record; slot record; second_slot record; bookings_before bigint;
 expires timestamptz; phone_value text; competitor_phone text; has_slot boolean:=false; stage text:='fixture';
begin
 select m.user_id,m.organization_id into owner_id,org_id
 from public.organization_memberships m join public.organizations o on o.id=m.organization_id
 where m.active and m.role='owner' and o.status='active' and o.public_booking_enabled and coalesce(o.public_slug,'')<>''
 and exists(select 1 from public.bookings b where b.organization_id=m.organization_id)
 order by (select count(*) from public.bookings b where b.organization_id=m.organization_id) desc limit 1;
 if owner_id is null then raise exception 'restored_fixture_owner_unavailable';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 stage:='offers';
 select o.public_slug into slug from public.organizations o where o.id=org_id;
 for template in select distinct b.performer_id,b.service_id,b.location_id
 from public.bookings b join public.services s on s.id=b.service_id and s.active and s.performer_id=b.performer_id
 join public.locations l on l.id=b.location_id and l.organization_id=b.organization_id and l.active and l.timezone='Europe/Samara'
 join public.organization_memberships eligible on eligible.organization_id=b.organization_id and eligible.user_id=b.performer_id and eligible.active and eligible.is_bookable
 where b.organization_id=org_id and b.performer_id is not null loop
  select * into slot from public.get_public_minuta_available_slots_v101(slug,template.location_id,template.service_id,current_date+1,current_date+14) order by booking_date,booking_time limit 1;
  has_slot:=found;exit when has_slot;
 end loop;
 if not has_slot then raise exception 'restored_fixture_free_slot_unavailable';end if;
 expires:=clock_timestamp()+interval '1 hour';
 loop
  phone_value:='79'||lpad(floor(random()*1000000000)::bigint::text,9,'0');
  exit when not exists(select 1 from public.client_accounts a where a.normalized_phone=phone_value)
    and not exists(select 1 from public.bookings b where regexp_replace(coalesce(b.client_phone,''),'[^0-9]','','g')=phone_value)
    and not exists(select 1 from public.organization_waitlist_requests r where r.client_phone=phone_value);
 end loop;
 insert into public.organization_waitlist_requests(id,organization_id,location_id,performer_id,service_id,request_code,manage_token,client_name,client_phone,desired_date,time_period)
 values(request_id,org_id,template.location_id,template.performer_id,template.service_id,'QA-EIGHT-'||request_id,token_one,'ТЕСТ: копия базы',phone_value,slot.booking_date,'any');
 stage:='offer_employee';
 result:=public.get_minuta_waitlist_employee_v196(request_id);
 if result->>'requestId' is distinct from request_id::text or jsonb_array_length(result->'slots')=0 then raise exception 'restored_offer_employee_read_failed';end if;
 select count(*) into bookings_before from public.bookings;
 stage:='offer_create';
 result:=public.create_minuta_waitlist_offer_v196(offer_one,request_id,slot.booking_date,slot.booking_time,expires);
 if result->>'state' is distinct from 'offered' or (select count(*) from public.bookings)<>bookings_before then raise exception 'restored_offer_created_booking_early';end if;
 perform set_config('request.jwt.claim.role','anon',true);perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 stage:='offer_accept';
 result:=public.accept_minuta_waitlist_offer_v196(offer_one,token_one);
 if result->>'state' is distinct from 'accepted' then raise exception 'restored_offer_accept_failed';end if;
 perform public.accept_minuta_waitlist_offer_v196(offer_one,token_one);
 if (select count(*) from public.bookings)<>bookings_before+1 then raise exception 'restored_offer_accept_duplicate';end if;

 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 stage:='offer_expired';
 select * into second_slot from public.get_public_minuta_available_slots_v101(slug,template.location_id,template.service_id,slot.booking_date,slot.booking_date) order by booking_time limit 1;
 if second_slot.booking_date is null then raise exception 'restored_fixture_second_slot_unavailable';end if;
 insert into public.organization_waitlist_requests(id,organization_id,location_id,performer_id,service_id,request_code,manage_token,client_name,client_phone,desired_date,time_period)
 values(second_request,org_id,template.location_id,template.performer_id,template.service_id,'QA-EIGHT-'||second_request,token_two,'ТЕСТ: истечение',phone_value,second_slot.booking_date,'any');
 perform public.create_minuta_waitlist_offer_v196(offer_expired,second_request,second_slot.booking_date,second_slot.booking_time,expires);
 update public.organization_waitlist_offers set expires_at=clock_timestamp()-interval '1 second' where id=offer_expired;
 result:=public.get_minuta_waitlist_offer_v196(offer_expired,token_two);
 if result->>'state' is distinct from 'expired' then raise exception 'restored_offer_expired_label_failed';end if;
 perform set_config('request.jwt.claim.role','anon',true);perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 result:=public.accept_minuta_waitlist_offer_v196(offer_expired,token_two);
 if result->>'state' is distinct from 'expired' or (select count(*) from public.bookings)<>bookings_before+1 then raise exception 'restored_offer_expired_write';end if;

 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 stage:='offer_compete';
 perform public.create_minuta_waitlist_offer_v196(offer_busy,second_request,second_slot.booking_date,second_slot.booking_time,expires);
 loop
  competitor_phone:='79'||lpad(floor(random()*1000000000)::bigint::text,9,'0');
  exit when competitor_phone<>phone_value
    and not exists(select 1 from public.client_accounts a where a.normalized_phone=competitor_phone)
    and not exists(select 1 from public.bookings b where regexp_replace(coalesce(b.client_phone,''),'[^0-9]','','g')=competitor_phone)
    and not exists(select 1 from public.organization_waitlist_requests r where r.client_phone=competitor_phone);
 end loop;
 insert into public.organization_waitlist_requests(id,organization_id,location_id,performer_id,service_id,request_code,manage_token,client_name,client_phone,desired_date,time_period)
 values(third_request,org_id,template.location_id,template.performer_id,template.service_id,'QA-EIGHT-'||third_request,token_three,'ТЕСТ: занятое время',competitor_phone,second_slot.booking_date,'any');
 perform public.create_minuta_waitlist_offer_v196(offer_competitor,third_request,second_slot.booking_date,second_slot.booking_time,expires);
 perform set_config('request.jwt.claim.role','anon',true);perform set_config('request.jwt.claim.sub','',true);perform set_config('request.jwt.claims','{}',true);
 result:=public.accept_minuta_waitlist_offer_v196(offer_competitor,token_three);
 if result->>'state' is distinct from 'accepted' then raise exception 'restored_offer_competing_accept_failed';end if;
 result:=public.accept_minuta_waitlist_offer_v196(offer_busy,token_two);
 if result->>'state' is distinct from 'busy' or (select count(*) from public.bookings)<>bookings_before+2 then raise exception 'restored_offer_busy_slot_not_protected';end if;
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 stage:='loyalty';
 select a.id into client_id from public.client_accounts a where a.normalized_phone=phone_value;
 if client_id is null then
  client_id:=gen_random_uuid();
  insert into public.client_accounts(id,normalized_phone,access_code_hash) values(client_id,phone_value,repeat('0',64));
 end if;
 update public.bookings b set client_account_id=client_id where b.id=(select o.booking_id from public.organization_waitlist_offers o where o.id=offer_one);
 stage:='loyalty';
 stage:='loyalty_settings';
 perform public.set_minuta_loyalty_program_v166(org_id,true,10,'text',null,'ТЕСТ: восстановленная копия',null,null,gen_random_uuid());
 stage:='loyalty_preview';
 preview:=public.preview_minuta_loyalty_adjustment_v166(org_id,client_id,delta_value);
 if not (preview->>'allowed')::boolean then
  delta_value:=greatest(-100,least(100,-(preview->>'before')::integer));
  preview:=public.preview_minuta_loyalty_adjustment_v166(org_id,client_id,delta_value);
 end if;
 if not coalesce((preview->>'allowed')::boolean,false) then raise exception 'restored_fixture_loyalty_progress_unavailable';end if;
 stage:='loyalty_confirm';
 result:=public.confirm_minuta_loyalty_adjustment_v166(org_id,client_id,delta_value,'ТЕСТ: проверка копии',adjustment_id,(preview->>'before')::integer,(preview->>'cycle_number')::integer,(preview->>'rule_id')::uuid);
 perform public.confirm_minuta_loyalty_adjustment_v166(org_id,client_id,delta_value,'ТЕСТ: проверка копии',adjustment_id,(preview->>'before')::integer,(preview->>'cycle_number')::integer,(preview->>'rule_id')::uuid);
 if (select count(*) from public.loyalty_program_history_v166 h where h.organization_id=org_id and h.request_id=adjustment_id)<>1 then raise exception 'restored_loyalty_duplicate_adjustment';end if;
 begin
  perform public.confirm_minuta_loyalty_adjustment_v166(org_id,client_id,delta_value,'ТЕСТ: устаревшая проверка',gen_random_uuid(),999999,(preview->>'cycle_number')::integer,(preview->>'rule_id')::uuid);
  raise exception 'restored_loyalty_stale_preview_accepted';
 exception when sqlstate '55000' then null;end;
 bounds:=public.preview_minuta_loyalty_adjustment_v166(org_id,client_id,100);
 if (bounds->>'allowed')::boolean then bounds:=public.preview_minuta_loyalty_adjustment_v166(org_id,client_id,-100);end if;
 if (bounds->>'allowed')::boolean then raise exception 'restored_loyalty_bounds_not_enforced';end if;
 begin
  perform public.confirm_minuta_loyalty_adjustment_v166(org_id,client_id,(bounds->>'delta')::integer,'ТЕСТ: предел',gen_random_uuid(),(bounds->>'before')::integer,(bounds->>'cycle_number')::integer,(bounds->>'rule_id')::uuid);
  raise exception 'restored_loyalty_out_of_bounds_accepted';
 exception when sqlstate '22023' then null;end;

 stage:='statistics';
 for location_id in select null::uuid union all select l.id from public.locations l where l.organization_id=org_id and l.active limit 2 loop
  foreach source_name in array array['bookings','imported','availability','team','finance','retention','history','utm'] loop
   stage:='statistics_'||source_name||case when location_id is null then '_all' else '_branch' end;
   result:=public.get_minuta_statistics_branch_candidate(org_id,current_date-7,current_date+7,null,location_id,source_name,25,null);
   if result->>'contract' is distinct from 's10-branch-v1'
   or (result#>>'{scope,organization_id}')::uuid is distinct from org_id
   or (result#>>'{scope,location_id}')::uuid is distinct from location_id
   then raise exception 'restored_branch_scope_contract_failed';end if;
  end loop;
 end loop;

exception when others then
 raise exception using errcode='P0001',message='remaining-eight-phase='||stage||' state='||SQLSTATE||' check='||case when SQLERRM=any(array['waitlist_offers_prerequisites_missing','waitlist_offers_existing_object_conflict','waitlist_offer_unavailable','waitlist_offer_booking_binding_invalid','waitlist_offer_request_conflict','invalid_waitlist_offer','waitlist_offer_outside_supported_horizon','service_unavailable','waitlist_offer_slot_busy','waitlist_offer_already_active','waitlist_offer_deadline_elapsed','waitlist_offer_atomic_ack_invalid','loyalty_program_management_denied','invalid_loyalty_progress_adjustment','loyalty_client_not_in_organization','loyalty_program_disabled','loyalty_rule_missing','invalid_loyalty_adjustment_confirmation','loyalty_adjustment_preview_stale','invalid_loyalty_progress_result','authentication_required','invalid_branch_scope','organization_access_denied','branch_access_denied','staff_report_access_denied','invalid_branch_range','invalid_branch_source','stale_branch_cursor','invalid_branch_cursor','finance_access_denied','retention_access_denied','organization_unavailable','service_or_location_unavailable','restored_fixture_owner_unavailable','restored_fixture_free_slot_unavailable','restored_offer_employee_read_failed','restored_offer_created_booking_early','restored_offer_accept_failed','restored_offer_accept_duplicate','restored_fixture_second_slot_unavailable','restored_offer_expired_label_failed','restored_offer_expired_write','restored_offer_competing_accept_failed','restored_offer_busy_slot_not_protected','restored_fixture_loyalty_progress_unavailable','restored_loyalty_duplicate_adjustment','restored_loyalty_stale_preview_accepted','restored_loyalty_bounds_not_enforced','restored_loyalty_out_of_bounds_accepted','restored_branch_scope_contract_failed']) then SQLERRM else 'redacted' end;
end $functional$;
