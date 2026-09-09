\set ON_ERROR_STOP on

begin;
set local search_path = pg_catalog, public, extensions;

revoke all on function public.save_minuta_client_identity_v134(uuid,text,text,text)
  from public,anon,authenticated,service_role;
drop function if exists public.save_minuta_client_identity_v134(uuid,text,text,text);

-- Keep the safe owner-folder avatar constraint: profile edits already performed may
-- legitimately retain an older private storage path and must stay readable.

notify pgrst,'reload schema';
commit;
