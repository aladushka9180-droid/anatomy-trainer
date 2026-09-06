begin;

drop function if exists public.get_public_minuta_catalog_v5(text);
drop function if exists public.set_minuta_client_page_settings_v118(uuid,text,text);
drop function if exists public.get_minuta_client_page_settings_v118(uuid);

do $$ begin
  if to_regclass('public.organization_client_page_settings') is not null then
    execute 'drop policy if exists organization_client_page_settings_member_read on public.organization_client_page_settings';
    execute 'revoke all on public.organization_client_page_settings from public,anon,authenticated,service_role';
    execute 'grant all on public.organization_client_page_settings to service_role';
  end if;
end $$;

-- The table and saved organization choices are intentionally retained. A later
-- forward reapply can restore the API without losing tenant settings.
notify pgrst,'reload schema';
commit;
