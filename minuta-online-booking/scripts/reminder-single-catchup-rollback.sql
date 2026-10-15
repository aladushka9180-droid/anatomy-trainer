\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
do $rollback$
declare v_fingerprint jsonb;
begin
  if to_regprocedure('public.claim_minuta_notification_outbox_before_catchup_once(text[],integer)') is not null then
    if to_regclass('public.minuta_catchup_install_state') is null then
      raise exception 'single_catchup_wrapper_changed';
    end if;
    select jsonb_object_agg(procedure.oid::regprocedure::text,to_jsonb(procedure)) into v_fingerprint
    from pg_proc procedure where procedure.oid in(
      to_regprocedure('public.claim_minuta_notification_outbox(text[],integer)'),
      to_regprocedure('public.claim_minuta_notification_test_outbox_v128(uuid,text,text)'),
      to_regprocedure('public.claim_minuta_notification_outbox_before_catchup_once(text[],integer)'),
      to_regprocedure('public.claim_minuta_notification_test_outbox_v128_before_catchup_once(uuid,text,text)'),
      to_regprocedure('public.minuta_allow_catchup_reminder_claim(uuid,uuid[],jsonb)'),
      to_regprocedure('public.minuta_cancel_catchup_reminder_claim(uuid,uuid)'));
    if not exists(select 1 from public.minuta_catchup_install_state state
      where state.installed and state.fingerprint=v_fingerprint) then
      raise exception 'single_catchup_wrapper_changed';
    end if;
    if exists(select 1 from pg_class relation
      cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) privilege
      where relation.oid='public.minuta_catchup_install_state'::regclass
        and privilege.grantee<>relation.relowner) then
      raise exception 'single_catchup_manifest_acl';
    end if;
    drop function public.claim_minuta_notification_outbox(text[],integer);
    drop function public.claim_minuta_notification_test_outbox_v128(uuid,text,text);
    alter function public.claim_minuta_notification_outbox_before_catchup_once(text[],integer)
      rename to claim_minuta_notification_outbox;
    alter function public.claim_minuta_notification_test_outbox_v128_before_catchup_once(uuid,text,text)
      rename to claim_minuta_notification_test_outbox_v128;
    grant execute on function public.claim_minuta_notification_outbox(text[],integer) to service_role;
    grant execute on function public.claim_minuta_notification_test_outbox_v128(uuid,text,text) to service_role;
  elsif to_regclass('public.minuta_catchup_install_state') is not null
    or to_regprocedure('public.minuta_allow_catchup_reminder_claim(uuid,uuid[],jsonb)') is not null
    or to_regprocedure('public.minuta_cancel_catchup_reminder_claim(uuid,uuid)') is not null then
    raise exception 'single_catchup_partial_install';
  end if;
end
$rollback$;
drop function if exists public.minuta_cancel_catchup_reminder_claim(uuid,uuid);
drop function if exists public.minuta_allow_catchup_reminder_claim(uuid,uuid[],jsonb);
drop table if exists public.minuta_catchup_install_state;
commit;
