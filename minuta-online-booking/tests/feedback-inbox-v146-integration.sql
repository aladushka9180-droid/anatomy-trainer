\set ON_ERROR_STOP on

begin;

do $$
declare
  v_owner uuid:='00000000-0000-4000-8000-000000014601';
  v_admin uuid:='00000000-0000-4000-8000-000000014602';
  v_specialist uuid:='00000000-0000-4000-8000-000000014603';
  v_outsider uuid:='00000000-0000-4000-8000-000000014604';
  v_org uuid:='00000000-0000-4000-8000-000000014610';
  v_foreign_org uuid:='00000000-0000-4000-8000-000000014611';
  v_owner_feedback uuid:='00000000-0000-4000-8000-000000014620';
  v_specialist_feedback uuid:='00000000-0000-4000-8000-000000014621';
  v_payload jsonb;
begin
  if to_regprocedure('public.get_minuta_feedback_inbox_v146(uuid)') is null
     or to_regprocedure('public.set_minuta_feedback_status_v146(uuid,uuid,text)') is null then
    raise exception 'v146_functions_missing';
  end if;
  if has_function_privilege('anon','public.get_minuta_feedback_inbox_v146(uuid)','EXECUTE')
     or has_function_privilege('service_role','public.get_minuta_feedback_inbox_v146(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_minuta_feedback_inbox_v146(uuid)','EXECUTE')
     or has_function_privilege('anon','public.set_minuta_feedback_status_v146(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('service_role','public.set_minuta_feedback_status_v146(uuid,uuid,text)','EXECUTE')
     or not has_function_privilege('authenticated','public.set_minuta_feedback_status_v146(uuid,uuid,text)','EXECUTE') then
    raise exception 'v146_execute_acl_invalid';
  end if;

  perform set_config('session_replication_role','replica',true);
  insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values
    (v_owner,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','v146-owner@example.invalid',now(),'{}','{}',now(),now()),
    (v_admin,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','v146-admin@example.invalid',now(),'{}','{}',now(),now()),
    (v_specialist,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','v146-specialist@example.invalid',now(),'{}','{}',now(),now()),
    (v_outsider,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','v146-outsider@example.invalid',now(),'{}','{}',now(),now());
  perform set_config('session_replication_role','origin',true);

  insert into public.organizations(id,name,public_slug,created_by)
  values(v_org,'V146 Test Organization','v146-test-organization',v_owner),
        (v_foreign_org,'V146 Foreign Organization','v146-foreign-organization',v_outsider);
  insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by)
  values(v_org,v_owner,'owner',true,true,v_owner),
        (v_org,v_admin,'admin',false,true,v_owner),
        (v_org,v_specialist,'specialist',true,true,v_owner),
        (v_foreign_org,v_outsider,'owner',true,true,v_outsider);
  insert into public.product_feedback(id,reporter_user_id,organization_id,kind,message,expected_result,page_path,client_version,device_summary,status)
  values(v_owner_feedback,v_owner,v_org,'problem','Owner feedback message','Expected owner result','/provider.html','test','desktop','new'),
        (v_specialist_feedback,v_specialist,v_org,'suggestion','Specialist feedback message',null,'/provider.html','test','mobile','in_review'),
        ('00000000-0000-4000-8000-000000014622',v_outsider,v_foreign_org,'problem','Foreign feedback message',null,'/provider.html','test','desktop','new');

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  v_payload:=public.get_minuta_feedback_inbox_v146(v_org);
  if not (v_payload->>'can_manage')::boolean or jsonb_array_length(v_payload->'items')<>2
     or (v_payload->'items'->0) ? 'reporter_user_id' then raise exception 'v146_owner_inbox_invalid'; end if;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  v_payload:=public.get_minuta_feedback_inbox_v146(v_org);
  if not (v_payload->>'can_manage')::boolean or jsonb_array_length(v_payload->'items')<>2 then
    raise exception 'v146_admin_inbox_invalid';
  end if;
  v_payload:=public.set_minuta_feedback_status_v146(v_org,v_owner_feedback,'resolved');
  if (v_payload->>'status')<>'resolved' then raise exception 'v146_admin_status_update_invalid'; end if;

  perform set_config('request.jwt.claim.sub',v_specialist::text,true);
  v_payload:=public.get_minuta_feedback_inbox_v146(v_org);
  if (v_payload->>'can_manage')::boolean or jsonb_array_length(v_payload->'items')<>1
     or (v_payload->'items'->0->>'id')::uuid<>v_specialist_feedback then
    raise exception 'v146_specialist_scope_invalid';
  end if;
  begin
    perform public.set_minuta_feedback_status_v146(v_org,v_specialist_feedback,'closed');
    raise exception 'v146_specialist_status_update_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'feedback_status_access_denied' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',v_outsider::text,true);
  begin
    perform public.get_minuta_feedback_inbox_v146(v_org);
    raise exception 'v146_foreign_inbox_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'feedback_inbox_access_denied' then raise; end if;
  end;
  begin
    perform public.set_minuta_feedback_status_v146(v_org,v_owner_feedback,'closed');
    raise exception 'v146_foreign_status_update_accepted';
  exception when insufficient_privilege then
    if sqlerrm<>'feedback_status_access_denied' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub',v_owner::text,true);
  begin
    perform public.set_minuta_feedback_status_v146(v_org,v_owner_feedback,'invalid');
    raise exception 'v146_invalid_status_accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'invalid_feedback_status' then raise; end if;
  end;
end $$;

rollback;
