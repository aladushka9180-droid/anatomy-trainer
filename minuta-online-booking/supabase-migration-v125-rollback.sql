\set ON_ERROR_STOP on

-- Compatibility rollback: the v46 body cannot be restored after v88 made
-- notification_outbox.organization_id mandatory, so retain the safe v88 body.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

create or replace function public.enqueue_booking_created_notification()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  perform public.enqueue_minuta_booking_notification(new.id,'booking_created');
  return new;
end;
$$;
revoke all on function public.enqueue_booking_created_notification() from public,anon,authenticated,service_role;

do $verify$
declare actual text;
begin
  select md5(replace(prosrc,E'\r','')) into actual
  from pg_proc where oid='public.enqueue_booking_created_notification()'::regprocedure;
  if actual<>'a509808937e4eaed2cdd8e7d74995ca9' then
    raise exception using errcode='55000',message='v125_rollback_guard_failed';
  end if;
end $verify$;

notify pgrst,'reload schema';
commit;
