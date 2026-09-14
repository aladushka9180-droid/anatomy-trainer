-- v161: organization-bound personal templates for manual booking messages.
begin;

do $$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_memberships') is null
     or to_regprocedure('public.is_organization_member(uuid)') is null then
    raise exception using errcode='55000',message='v161_message_templates_prerequisites_missing';
  end if;
  if to_regclass('public.provider_message_templates_v161') is not null
     or to_regprocedure('public.get_provider_message_templates_v161(uuid)') is not null
     or to_regprocedure('public.save_provider_message_template_v161(uuid,text,text,bigint,uuid)') is not null then
    raise exception using errcode='55000',message='v161_message_templates_state_not_absent';
  end if;
end $$;

create table public.provider_message_templates_v161 (
  organization_id uuid not null,
  performer_id uuid not null,
  kind text not null check(kind in ('reminder','reschedule','cancellation')),
  body text not null check(char_length(body) between 1 and 4000 and body=btrim(body)),
  version bigint not null default 1 check(version>=1),
  last_idempotency_key uuid not null,
  updated_at timestamptz not null default now(),
  primary key(organization_id,performer_id,kind),
  foreign key(organization_id,performer_id)
    references public.organization_memberships(organization_id,user_id) on delete cascade
);
alter table public.provider_message_templates_v161 enable row level security;
alter table public.provider_message_templates_v161 force row level security;
alter table public.provider_message_templates_v161 owner to postgres;

create policy provider_message_templates_self_read_v161 on public.provider_message_templates_v161
  for select to authenticated using(
    performer_id=(select auth.uid()) and public.is_organization_member(organization_id)
  );
create policy provider_message_templates_self_write_v161 on public.provider_message_templates_v161
  for all to authenticated using(
    performer_id=(select auth.uid()) and public.is_organization_member(organization_id)
  ) with check(
    performer_id=(select auth.uid()) and public.is_organization_member(organization_id)
  );

revoke all on table public.provider_message_templates_v161 from public,anon,authenticated;
grant all on table public.provider_message_templates_v161 to postgres,service_role;

create function public.get_provider_message_templates_v161(p_organization uuid)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_uid uuid:=auth.uid();
  v_templates jsonb;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(
    select 1 from public.organization_memberships membership
    join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
    where membership.organization_id=p_organization and membership.user_id=v_uid and membership.active
  ) then raise exception 'message_template_access_denied' using errcode='42501'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'kind',template.kind,'body',template.body,'version',template.version,'updated_at',template.updated_at
  ) order by array_position(array['reminder','reschedule','cancellation']::text[],template.kind)),'[]'::jsonb)
  into v_templates
  from public.provider_message_templates_v161 template
  where template.organization_id=p_organization and template.performer_id=v_uid;

  return jsonb_build_object('organization_id',p_organization,'performer_id',v_uid,'templates',v_templates);
end $$;
revoke all on function public.get_provider_message_templates_v161(uuid) from public,anon,authenticated;
grant execute on function public.get_provider_message_templates_v161(uuid) to authenticated;
alter function public.get_provider_message_templates_v161(uuid) owner to postgres;

create function public.save_provider_message_template_v161(
  p_organization uuid,p_kind text,p_body text,p_expected_version bigint,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_uid uuid:=auth.uid();
  v_body text:=btrim(coalesce(p_body,''));
  v_row public.provider_message_templates_v161%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_kind is null or p_kind not in ('reminder','reschedule','cancellation')
     or char_length(v_body) not between 1 and 4000
     or p_expected_version is null or p_expected_version<0
     or p_idempotency_key is null then
    raise exception 'message_template_invalid' using errcode='22023';
  end if;
  perform 1 from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id and organization.status='active'
  where membership.organization_id=p_organization and membership.user_id=v_uid and membership.active
  for share of membership;
  if not found then raise exception 'message_template_access_denied' using errcode='42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization::text||':'||v_uid::text||':'||p_kind,160
  ));
  select template.* into v_row from public.provider_message_templates_v161 template
  where template.organization_id=p_organization and template.performer_id=v_uid and template.kind=p_kind
  for update;
  if found then
    if v_row.last_idempotency_key=p_idempotency_key then
      return jsonb_build_object('saved',true,'organization_id',v_row.organization_id,'performer_id',v_row.performer_id,
        'kind',v_row.kind,'body',v_row.body,'version',v_row.version,'updated_at',v_row.updated_at);
    end if;
    if v_row.version<>p_expected_version then
      raise exception 'message_template_version_conflict' using errcode='40001';
    end if;
    update public.provider_message_templates_v161 template
    set body=v_body,version=template.version+1,last_idempotency_key=p_idempotency_key,updated_at=now()
    where template.organization_id=p_organization and template.performer_id=v_uid and template.kind=p_kind
    returning template.* into v_row;
  else
    if p_expected_version<>0 then raise exception 'message_template_version_conflict' using errcode='40001'; end if;
    insert into public.provider_message_templates_v161(organization_id,performer_id,kind,body,last_idempotency_key)
    values(p_organization,v_uid,p_kind,v_body,p_idempotency_key) returning * into v_row;
  end if;

  return jsonb_build_object('saved',true,'organization_id',v_row.organization_id,'performer_id',v_row.performer_id,
    'kind',v_row.kind,'body',v_row.body,'version',v_row.version,'updated_at',v_row.updated_at);
end $$;
revoke all on function public.save_provider_message_template_v161(uuid,text,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.save_provider_message_template_v161(uuid,text,text,bigint,uuid) to authenticated;
alter function public.save_provider_message_template_v161(uuid,text,text,bigint,uuid) owner to postgres;

commit;
