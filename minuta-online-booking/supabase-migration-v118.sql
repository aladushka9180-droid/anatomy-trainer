begin;

set local search_path = pg_catalog, public, extensions;

do $$ begin
  if to_regprocedure('public.get_public_minuta_catalog_v4(text)') is null
     or to_regprocedure('public.is_organization_member(uuid)') is null
     or to_regprocedure('public.has_organization_role(uuid,text[])') is null then
    raise exception using errcode='P0001',message='v118_requires_v65_and_v71';
  end if;
end $$;

create table if not exists public.organization_client_page_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  theme_key text not null default 'sage',
  headline_key text not null default 'massage-time',
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint organization_client_page_theme_key_check check (theme_key in (
    'sage','nordic','warm','graphite','lavender','luxury','loft','eco','hitech','japandi',
    'midnight','mono','desert','rose','botanical','burgundy','coastal','pearl','butter',
    'celadon','snow-leopard','apricot-tiger','golden-cheetah','pearl-zebra','noir-safari'
  )),
  constraint organization_client_page_headline_key_check check (headline_key in (
    'massage-time','care','beauty','booking'
  ))
);

alter table public.organization_client_page_settings enable row level security;
revoke all on public.organization_client_page_settings from public,anon,authenticated,service_role;
grant select on public.organization_client_page_settings to authenticated;
grant all on public.organization_client_page_settings to service_role;

drop policy if exists organization_client_page_settings_member_read on public.organization_client_page_settings;
create policy organization_client_page_settings_member_read
  on public.organization_client_page_settings for select to authenticated
  using (public.is_organization_member(organization_id));

create or replace function public.get_minuta_client_page_settings_v118(p_organization uuid)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if not public.is_organization_member(p_organization) then
    raise exception using errcode='42501',message='organization_read_denied';
  end if;
  if not exists(select 1 from public.organizations where id=p_organization and status='active') then
    raise exception using errcode='P0002',message='organization_not_found';
  end if;

  select jsonb_build_object(
    'organization_id',p_organization,
    'theme_key',coalesce(settings.theme_key,'sage'),
    'headline_key',coalesce(settings.headline_key,'massage-time'),
    'updated_at',settings.updated_at
  ) into v_result
  from (select 1) seed
  left join public.organization_client_page_settings settings
    on settings.organization_id=p_organization;
  return v_result;
end $$;

create or replace function public.set_minuta_client_page_settings_v118(
  p_organization uuid,
  p_theme_key text,
  p_headline_key text
) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_theme text:=lower(btrim(coalesce(p_theme_key,'')));
  v_headline text:=lower(btrim(coalesce(p_headline_key,'')));
  v_row public.organization_client_page_settings%rowtype;
begin
  if v_actor is null then
    raise exception using errcode='42501',message='authentication_required';
  end if;
  if not public.has_organization_role(p_organization,array['owner']::text[]) then
    raise exception using errcode='42501',message='organization_owner_required';
  end if;
  if v_theme not in (
    'sage','nordic','warm','graphite','lavender','luxury','loft','eco','hitech','japandi',
    'midnight','mono','desert','rose','botanical','burgundy','coastal','pearl','butter',
    'celadon','snow-leopard','apricot-tiger','golden-cheetah','pearl-zebra','noir-safari'
  ) or v_headline not in ('massage-time','care','beauty','booking') then
    raise exception using errcode='22023',message='client_page_settings_invalid';
  end if;

  perform 1 from public.organizations where id=p_organization and status='active' for update;
  if not found then
    raise exception using errcode='P0002',message='organization_not_found';
  end if;

  insert into public.organization_client_page_settings(
    organization_id,theme_key,headline_key,updated_at,updated_by
  ) values(
    p_organization,v_theme,v_headline,clock_timestamp(),v_actor
  ) on conflict(organization_id) do update set
    theme_key=excluded.theme_key,
    headline_key=excluded.headline_key,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by
  returning * into v_row;

  return jsonb_build_object(
    'organization_id',v_row.organization_id,
    'theme_key',v_row.theme_key,
    'headline_key',v_row.headline_key,
    'updated_at',v_row.updated_at
  );
end $$;

create or replace function public.get_public_minuta_catalog_v5(p_slug text)
returns jsonb language sql stable security definer set search_path to '' as $$
  with base as (
    select public.get_public_minuta_catalog_v4(p_slug) as catalog
  ), public_organization as (
    select organization.id
    from public.organizations organization
    where organization.public_slug=lower(trim(coalesce(p_slug,'')))
      and organization.status='active'
      and organization.public_booking_enabled
  )
  select case when base.catalog is null then null else base.catalog || jsonb_build_object(
    'client_page',jsonb_build_object(
      'theme_key',coalesce(settings.theme_key,'sage'),
      'headline_key',coalesce(settings.headline_key,'massage-time')
    )
  ) end
  from base
  left join public_organization organization on true
  left join public.organization_client_page_settings settings
    on settings.organization_id=organization.id;
$$;

revoke all on function public.get_minuta_client_page_settings_v118(uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_client_page_settings_v118(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.get_public_minuta_catalog_v5(text) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_client_page_settings_v118(uuid) to authenticated;
grant execute on function public.set_minuta_client_page_settings_v118(uuid,text,text) to authenticated;
grant execute on function public.get_public_minuta_catalog_v5(text) to anon,authenticated;

notify pgrst,'reload schema';
commit;
