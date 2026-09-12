\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
set local search_path=public,extensions,pg_catalog;

do $$ begin
  if to_regclass('public.product_feedback') is null
     or to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null then
    raise exception using errcode='P0001',message='v146_feedback_prerequisites_missing';
  end if;
end $$;

create or replace function public.get_minuta_feedback_inbox_v146(p_organization uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_role text;
  v_items jsonb;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select membership.role into v_role
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_actor and membership.active
  limit 1;
  if v_role is null then raise exception using errcode='42501',message='feedback_inbox_access_denied'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',feedback.id,
    'request_number',feedback.request_number,
    'kind',feedback.kind,
    'message',feedback.message,
    'expected_result',feedback.expected_result,
    'page_path',feedback.page_path,
    'client_version',feedback.client_version,
    'device_summary',feedback.device_summary,
    'has_screenshot',feedback.screenshot_path is not null,
    'status',feedback.status,
    'created_at',feedback.created_at,
    'updated_at',feedback.updated_at
  ) order by feedback.created_at desc,feedback.request_number desc),'[]'::jsonb)
  into v_items
  from (
    select item.*
    from public.product_feedback item
    where item.organization_id=p_organization
      and (v_role in ('owner','admin') or item.reporter_user_id=v_actor)
    order by item.created_at desc,item.request_number desc
    limit 100
  ) feedback;

  return jsonb_build_object(
    'organization_id',p_organization,
    'current_role',v_role,
    'can_manage',v_role in ('owner','admin'),
    'items',v_items
  );
end;
$$;
revoke all on function public.get_minuta_feedback_inbox_v146(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_feedback_inbox_v146(uuid) to authenticated;

create or replace function public.set_minuta_feedback_status_v146(
  p_organization uuid,
  p_feedback uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid:=auth.uid();
  v_result public.product_feedback%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_status not in ('new','in_review','planned','resolved','closed') then
    raise exception using errcode='22023',message='invalid_feedback_status';
  end if;
  if not exists(
    select 1
    from public.organization_memberships membership
    join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
    where membership.organization_id=p_organization and membership.user_id=v_actor
      and membership.active and membership.role in ('owner','admin')
  ) then raise exception using errcode='42501',message='feedback_status_access_denied'; end if;

  update public.product_feedback feedback
  set status=p_status,updated_at=now()
  where feedback.id=p_feedback and feedback.organization_id=p_organization
  returning feedback.* into v_result;
  if v_result.id is null then raise exception using errcode='P0002',message='feedback_not_found'; end if;

  return jsonb_build_object(
    'request_number',v_result.request_number,
    'status',v_result.status,
    'updated_at',v_result.updated_at
  );
end;
$$;
revoke all on function public.set_minuta_feedback_status_v146(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.set_minuta_feedback_status_v146(uuid,uuid,text) to authenticated;

do $$ begin
  if to_regprocedure('public.get_minuta_feedback_inbox_v146(uuid)') is null
     or to_regprocedure('public.set_minuta_feedback_status_v146(uuid,uuid,text)') is null
     or not has_function_privilege('authenticated','public.get_minuta_feedback_inbox_v146(uuid)','EXECUTE')
     or has_function_privilege('anon','public.get_minuta_feedback_inbox_v146(uuid)','EXECUTE')
     or has_function_privilege('service_role','public.get_minuta_feedback_inbox_v146(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.set_minuta_feedback_status_v146(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('anon','public.set_minuta_feedback_status_v146(uuid,uuid,text)','EXECUTE')
     or has_function_privilege('service_role','public.set_minuta_feedback_status_v146(uuid,uuid,text)','EXECUTE') then
    raise exception using errcode='P0001',message='v146_feedback_postcondition_failed';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
