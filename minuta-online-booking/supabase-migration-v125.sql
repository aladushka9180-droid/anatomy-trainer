\set ON_ERROR_STOP on

-- v125 repairs a legacy v46 enqueue function left beside the tenant-aware v88 outbox.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $guard$
declare actual text;
begin
  if to_regclass('public.bookings') is null
     or to_regclass('public.notification_outbox') is null
     or to_regprocedure('public.enqueue_minuta_booking_notification(uuid,text)') is null then
    raise exception using errcode='55000',message='v125_requires_notification_center_v88';
  end if;
  if not exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='notification_outbox'
      and column_name='organization_id' and data_type='uuid' and is_nullable='NO'
  ) then
    raise exception using errcode='55000',message='v125_requires_tenant_outbox';
  end if;
  select md5(replace(prosrc,E'\r','')) into actual
  from pg_proc where oid='public.enqueue_booking_created_notification()'::regprocedure;
  if actual not in (
    '1f1a45095b0926a19d56a6129c04edac', -- legacy v46
    'a509808937e4eaed2cdd8e7d74995ca9'  -- tenant-aware v88
  ) then
    raise exception using errcode='55000',message='v125_enqueue_baseline_drift:'||coalesce(actual,'missing');
  end if;
  if not exists(
    select 1 from pg_trigger
    where tgrelid='public.bookings'::regclass
      and tgname='bookings_enqueue_created_notification'
      and tgfoid='public.enqueue_booking_created_notification()'::regprocedure
      and tgtype=5 and tgenabled='O' and not tgisinternal
  ) then
    raise exception using errcode='55000',message='v125_enqueue_trigger_drift';
  end if;
end $guard$;

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
    raise exception using errcode='55000',message='v125_install_guard_failed';
  end if;
end $verify$;

notify pgrst,'reload schema';
commit;
