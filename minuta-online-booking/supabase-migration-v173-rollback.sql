-- Exact schema rollback for the unapplied v173 abuse-guard candidate.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';

do $rollback_guard$
begin
  if to_regclass('public.minuta_abuse_rate_buckets_v173') is null
     or obj_description(to_regclass('public.minuta_abuse_rate_buckets_v173'),'pg_class')
       is distinct from 'minuta_abuse_guard_v173' then
    raise exception using errcode='55000',message='v173_abuse_guard_rollback_state_mismatch';
  end if;
  if exists(
    select 1 from unnest(array[
      'public.minuta_consume_abuse_limit_v173(text,text,integer,integer)',
      'public.guard_minuta_public_booking_v173()',
      'public.guard_minuta_waitlist_v173()',
      'public.guard_minuta_message_v173()'
    ]) as function_name(signature)
    where to_regprocedure(function_name.signature) is null
       or obj_description(to_regprocedure(function_name.signature)::oid,'pg_proc')
         is distinct from 'minuta_abuse_guard_v173'
  ) or exists(
    select 1 from pg_catalog.pg_trigger trigger_row
    where (trigger_row.tgrelid,trigger_row.tgname) in(
      ('public.bookings'::regclass,'bookings_abuse_guard_v173'),
      ('public.organization_waitlist_requests'::regclass,'waitlist_abuse_guard_v173'),
      ('public.conversation_messages_v162'::regclass,'messages_abuse_guard_v173')
    )
      and trigger_row.tgfoid is distinct from
        case trigger_row.tgname
          when 'bookings_abuse_guard_v173' then to_regprocedure('public.guard_minuta_public_booking_v173()')
          when 'waitlist_abuse_guard_v173' then to_regprocedure('public.guard_minuta_waitlist_v173()')
          else to_regprocedure('public.guard_minuta_message_v173()')
        end
  ) then
    raise exception using errcode='55000',message='v173_abuse_guard_rollback_state_mismatch';
  end if;
end
$rollback_guard$;

drop trigger if exists bookings_abuse_guard_v173 on public.bookings;
drop trigger if exists waitlist_abuse_guard_v173 on public.organization_waitlist_requests;
drop trigger if exists messages_abuse_guard_v173 on public.conversation_messages_v162;
drop function public.guard_minuta_public_booking_v173();
drop function public.guard_minuta_waitlist_v173();
drop function public.guard_minuta_message_v173();
drop function public.minuta_consume_abuse_limit_v173(text,text,integer,integer);
drop table public.minuta_abuse_rate_buckets_v173;

notify pgrst,'reload schema';
commit;
