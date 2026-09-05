begin;
-- Non-destructive rollback: stop new scoped requests. Existing requests remain
-- readable/cancellable/manageable; do not delete clients' data or legacy RPCs.
revoke execute on function public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
