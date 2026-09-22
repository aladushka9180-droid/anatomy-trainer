\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=pg_catalog,public,extensions;

do $$ begin
  if exists(select 1 from public.client_result_retention_audit)
     or exists(select 1 from public.client_result_assets where keep_from_cleanup)
     or exists(select 1 from public.client_result_assets where retention_delete_started_at is not null) then
    raise exception using errcode='P0001',message='v171_rollback_blocked_retention_state_exists';
  end if;
end $$;

drop function if exists public.get_minuta_client_results_v171(uuid,text,integer);
drop function if exists public.get_minuta_client_result_v171(uuid,uuid);
drop function if exists public.set_minuta_client_result_media_keep_v171(uuid,boolean);
drop function if exists public.claim_minuta_client_result_retention_v171(integer,boolean);
drop function if exists public.authorize_minuta_client_result_retention_delete_v171(uuid,uuid);
drop function if exists public.finish_minuta_client_result_retention_v171(uuid,uuid);
drop function if exists public.cancel_minuta_client_result_retention_v171(uuid,uuid);
drop trigger if exists client_result_assets_retention_visit_v171 on public.client_result_assets;
drop function if exists public.set_client_result_retention_visit_v171();
drop index if exists public.client_result_assets_retention_v171_idx;
drop table if exists public.client_result_retention_audit;
drop table if exists public.client_result_retention_policy;
alter table public.client_result_assets
  drop column if exists retention_cleanup_attempted_at,
  drop column if exists retention_delete_started_at,
  drop column if exists retention_claimed_at,
  drop column if exists retention_claim_token,
  drop column if exists retention_keep_updated_by,
  drop column if exists retention_keep_updated_at,
  drop column if exists retention_visit_date,
  drop column if exists keep_from_cleanup;
notify pgrst,'reload schema';
commit;
