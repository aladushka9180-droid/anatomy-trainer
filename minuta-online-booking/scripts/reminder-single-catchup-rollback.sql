\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
do $rollback$
begin
  if to_regprocedure('public.claim_minuta_notification_outbox_before_catchup_once(text[],integer)') is not null then
    if position('minuta_allow_catchup_reminder_claim' in pg_get_functiondef(
      'public.claim_minuta_notification_outbox(text[],integer)'::regprocedure))=0
      or position('minuta_allow_catchup_reminder_claim' in pg_get_functiondef(
      'public.claim_minuta_notification_test_outbox_v128(uuid,text,text)'::regprocedure))=0 then
      raise exception 'single_catchup_wrapper_changed';
    end if;
    drop function public.claim_minuta_notification_outbox(text[],integer);
    drop function public.claim_minuta_notification_test_outbox_v128(uuid,text,text);
    alter function public.claim_minuta_notification_outbox_before_catchup_once(text[],integer)
      rename to claim_minuta_notification_outbox;
    alter function public.claim_minuta_notification_test_outbox_v128_before_catchup_once(uuid,text,text)
      rename to claim_minuta_notification_test_outbox_v128;
    grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
    grant execute on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text) to service_role;
  end if;
end
$rollback$;
drop function if exists public.minuta_cancel_catchup_reminder_claim(uuid,uuid);
drop function if exists public.minuta_allow_catchup_reminder_claim(uuid,uuid[]);
commit;
