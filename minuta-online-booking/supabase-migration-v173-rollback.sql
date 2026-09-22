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
