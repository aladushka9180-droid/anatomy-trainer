-- Compatibility rollback: stop v175 writes and restore the v118 public shape.
-- Keep additive columns, expanded theme constraint and saved selections intact.
-- An older UI will display its safe fallback until the v175 UI is restored.
begin;

set local search_path = pg_catalog, public, extensions;

drop function if exists public.set_minuta_client_page_settings_v175(uuid,text,text,text,text);
drop function if exists public.get_minuta_client_page_settings_v175(uuid);

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

notify pgrst,'reload schema';
commit;
