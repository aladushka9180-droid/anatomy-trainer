-- Prepared only. Do not apply to production without a fresh backup, restore rehearsal,
-- rollback verification and separate explicit authorization.
begin;

set local search_path = pg_catalog, public, extensions;

do $$ begin
  if to_regclass('public.organization_client_page_settings') is null
     or to_regprocedure('public.get_public_minuta_catalog_v5(text)') is null
     or to_regprocedure('public.get_minuta_client_page_settings_v118(uuid)') is null
     or to_regprocedure('public.set_minuta_client_page_settings_v118(uuid,text,text)') is null then
    raise exception using errcode='P0001',message='v177_requires_v118_client_page_settings';
  end if;
end $$;

alter table public.organization_client_page_settings
  add column if not exists porcelain_shade text,
  add column if not exists porcelain_character text;

alter table public.organization_client_page_settings
  drop constraint if exists organization_client_page_theme_key_check;
alter table public.organization_client_page_settings
  add constraint organization_client_page_theme_key_check check (theme_key in (
    'sage','nordic','warm','graphite','lavender','luxury','loft','eco','hitech','japandi',
    'midnight','mono','desert','rose','botanical','burgundy','coastal','pearl','butter',
    'celadon','snow-leopard','apricot-tiger','golden-cheetah','pearl-zebra','noir-safari',
    'pink-porcelain'
  ));

alter table public.organization_client_page_settings
  drop constraint if exists organization_client_page_porcelain_options_check;
alter table public.organization_client_page_settings
  add constraint organization_client_page_porcelain_options_check check (
    (theme_key='pink-porcelain'
      and porcelain_shade is not null and porcelain_character is not null
      and porcelain_shade in ('pearl-white','porcelain-white','gentle-pink','petal-pink','pink-accent')
      and porcelain_character in ('pearl','petal','silk'))
    or (theme_key<>'pink-porcelain' and porcelain_shade is null and porcelain_character is null)
  );

-- Keep v118 reader/writer callable for cached clients during the PWA transition.
create or replace function public.get_minuta_client_page_settings_v177(p_organization uuid)
returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare v_settings jsonb;
begin
  v_settings:=public.get_minuta_client_page_settings_v118(p_organization);
  if v_settings->>'theme_key'='pink-porcelain' then
    select v_settings || jsonb_build_object('porcelain',jsonb_build_object(
      'shade',coalesce(settings.porcelain_shade,'gentle-pink'),
      'character',coalesce(settings.porcelain_character,'petal')
    )) into v_settings
    from public.organization_client_page_settings settings
    where settings.organization_id=p_organization;
  end if;
  return v_settings;
end $$;

create or replace function public.set_minuta_client_page_settings_v177(
  p_organization uuid,p_theme_key text,p_headline_key text,
  p_porcelain_shade text default null,p_porcelain_character text default null
) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare
  v_actor uuid:=auth.uid();
  v_theme text:=lower(btrim(coalesce(p_theme_key,'')));
  v_headline text:=lower(btrim(coalesce(p_headline_key,'')));
  v_shade text;
  v_character text;
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
    'celadon','snow-leopard','apricot-tiger','golden-cheetah','pearl-zebra','noir-safari',
    'pink-porcelain'
  ) or v_headline not in ('massage-time','care','beauty','booking') then
    raise exception using errcode='22023',message='client_page_settings_invalid';
  end if;
  if v_theme='pink-porcelain' then
    v_shade:=lower(btrim(coalesce(p_porcelain_shade,'gentle-pink')));
    v_character:=lower(btrim(coalesce(p_porcelain_character,'petal')));
    if v_shade not in ('pearl-white','porcelain-white','gentle-pink','petal-pink','pink-accent')
       or v_character not in ('pearl','petal','silk') then
      raise exception using errcode='22023',message='client_page_porcelain_options_invalid';
    end if;
  end if;

  perform 1 from public.organizations where id=p_organization and status='active' for update;
  if not found then
    raise exception using errcode='P0002',message='organization_not_found';
  end if;

  insert into public.organization_client_page_settings(
    organization_id,theme_key,headline_key,porcelain_shade,porcelain_character,updated_at,updated_by
  ) values(
    p_organization,v_theme,v_headline,v_shade,v_character,clock_timestamp(),v_actor
  ) on conflict(organization_id) do update set
    theme_key=excluded.theme_key,
    headline_key=excluded.headline_key,
    porcelain_shade=excluded.porcelain_shade,
    porcelain_character=excluded.porcelain_character,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by
  returning * into v_row;

  return jsonb_build_object(
    'organization_id',v_row.organization_id,'theme_key',v_row.theme_key,
    'headline_key',v_row.headline_key,'updated_at',v_row.updated_at
  ) || case when v_row.theme_key='pink-porcelain' then jsonb_build_object('porcelain',jsonb_build_object(
    'shade',v_row.porcelain_shade,'character',v_row.porcelain_character
  )) else '{}'::jsonb end;
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
    ) || case when settings.theme_key='pink-porcelain' then jsonb_build_object('porcelain',jsonb_build_object(
      'shade',coalesce(settings.porcelain_shade,'gentle-pink'),
      'character',coalesce(settings.porcelain_character,'petal')
    )) else '{}'::jsonb end
  ) end
  from base
  left join public_organization organization on true
  left join public.organization_client_page_settings settings
    on settings.organization_id=organization.id;
$$;

revoke all on function public.get_minuta_client_page_settings_v177(uuid) from public,anon,authenticated,service_role;
revoke all on function public.set_minuta_client_page_settings_v177(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_minuta_client_page_settings_v177(uuid) to authenticated;
grant execute on function public.set_minuta_client_page_settings_v177(uuid,text,text,text,text) to authenticated;

notify pgrst,'reload schema';
commit;
