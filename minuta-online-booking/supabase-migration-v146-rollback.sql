\set ON_ERROR_STOP on

-- Test/recovery rollback only. Feedback rows and their statuses are retained.
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';

drop function if exists public.set_minuta_feedback_status_v146(uuid,uuid,text);
drop function if exists public.get_minuta_feedback_inbox_v146(uuid);

notify pgrst,'reload schema';
commit;
