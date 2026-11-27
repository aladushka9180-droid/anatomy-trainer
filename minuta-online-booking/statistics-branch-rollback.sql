begin;
drop function if exists public.get_minuta_statistics_branch_candidate(uuid,date,date,uuid,uuid,text,integer,jsonb);
drop function if exists public.minuta_statistics_branch_scope_candidate(uuid,date,date,uuid,uuid);
commit;
