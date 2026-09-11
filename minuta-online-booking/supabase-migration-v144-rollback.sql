\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

-- Disable the v144 application surface without deleting import journals,
-- exact before/after snapshots or already imported business data.
drop function if exists public.preview_minuta_provider_transfer_v144(uuid,text,text,jsonb,uuid,text);
drop function if exists public.apply_minuta_provider_transfer_v144(uuid,uuid);
drop function if exists public.rollback_minuta_provider_transfer_v144(uuid,uuid);
drop function if exists public.get_minuta_provider_transfer_journal_v144(uuid,integer);
drop function if exists public.export_minuta_provider_transfer_data_v144(uuid,text,integer,integer);
drop function if exists public.purge_expired_minuta_provider_transfer_previews_v144(integer);
drop function if exists public.minuta_provider_transfer_target_hash_v144(uuid,text,text,jsonb);
drop function if exists public.canonicalize_minuta_provider_transfer_v144(text,jsonb);

do $$
begin
  if to_regclass('public.provider_data_transfer_batches') is not null then
    update public.provider_data_transfer_batches
    set status='expired',staged_payload=null,updated_at=now()
    where status='previewed';
  end if;
end $$;

-- The private tables and the source identity index are intentionally retained.
-- Reapplying v144 restores the endpoints without losing rollback evidence.
commit;
