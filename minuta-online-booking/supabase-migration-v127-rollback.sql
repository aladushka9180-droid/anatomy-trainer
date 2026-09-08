\set ON_ERROR_STOP on

begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

drop function if exists public.consume_primetime_handoff(text,text);
drop function if exists public.create_primetime_handoff(text);
drop table if exists public.primetime_handoffs;

notify pgrst,'reload schema';
commit;
