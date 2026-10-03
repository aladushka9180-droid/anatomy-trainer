-- Additive rollback: stop new entry points; preserve all old and new data.
begin;
set local lock_timeout='5s';
do $rollback$ declare p regprocedure; begin
  foreach p in array array[
    to_regprocedure('public.create_minuta_waitlist_offer_v196(uuid,uuid,date,time without time zone,timestamptz)'),
    to_regprocedure('public.get_minuta_waitlist_offer_v196(uuid,uuid)'),
    to_regprocedure('public.accept_minuta_waitlist_offer_v196(uuid,uuid)')
  ] loop
    if p is not null then
      if obj_description(p,'pg_proc') is distinct from 'minuta_waitlist_offers_v196' then
        raise exception using errcode='55000',message='waitlist_offers_existing_object_conflict';
      end if;
      execute format('revoke all on function %s from public,anon,authenticated,service_role',p);
    end if;
  end loop;
end $rollback$;
notify pgrst,'reload schema';
commit;
