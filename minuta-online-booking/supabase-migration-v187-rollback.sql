-- Schema rollback only before any request is accepted. Otherwise keep the replay ledger.
begin;

do $$ begin
  if exists(select 1 from public.service_catalog_requests_v187) then
    raise exception using errcode='55000',message='v187_service_requests_must_be_preserved';
  end if;
end $$;

drop function if exists public.save_minuta_service_catalog_draft_v187(uuid,uuid,uuid,text,text,integer,integer,boolean);
drop function if exists public.get_minuta_service_catalog_draft_v187(uuid,uuid);
drop function if exists public.minuta_service_catalog_etag_v187(uuid);
drop table if exists public.service_catalog_requests_v187;

commit;
