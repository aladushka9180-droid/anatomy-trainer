-- Schema rollback for v161 is permitted only before any message-center business data exists.
begin;
set local lock_timeout='10s';
do $$
declare v_table regclass;
begin
  foreach v_table in array array[
    to_regclass('public.message_center_settings_v161'),to_regclass('public.message_support_agents_v161'),
    to_regclass('public.message_conversations_v161'),to_regclass('public.message_participants_v161'),
    to_regclass('public.conversation_messages_v161'),to_regclass('public.conversation_system_events_v161'),
    to_regclass('public.conversation_message_actions_v161'),to_regclass('public.message_action_confirmations_v161'),
    to_regclass('public.message_read_receipts_v161'),to_regclass('public.message_attachments_v161'),
    to_regclass('public.message_support_requests_v161'),to_regclass('public.message_idempotency_receipts_v161'),
    to_regclass('public.message_audit_events_v161')
  ] loop
    if v_table is null or obj_description(v_table,'pg_class') is distinct from 'minuta_message_center_v161' then
      raise exception using errcode='55000',message='v161_schema_rollback_requires_exact_schema';
    end if;
  end loop;
end
$$;

do $$
declare v_count bigint;
begin
  select
    (select count(*) from public.message_center_settings_v161)+
    (select count(*) from public.message_support_agents_v161)+
    (select count(*) from public.message_conversations_v161)+
    (select count(*) from public.message_participants_v161)+
    (select count(*) from public.conversation_messages_v161)+
    (select count(*) from public.conversation_system_events_v161)+
    (select count(*) from public.conversation_message_actions_v161)+
    (select count(*) from public.message_action_confirmations_v161)+
    (select count(*) from public.message_read_receipts_v161)+
    (select count(*) from public.message_attachments_v161)+
    (select count(*) from public.message_support_requests_v161)+
    (select count(*) from public.message_idempotency_receipts_v161)+
    (select count(*) from public.message_audit_events_v161)
  into v_count;
  if v_count<>0 then raise exception using errcode='55000',message='v161_schema_rollback_blocked_business_data'; end if;
end
$$;

drop trigger if exists booking_events_message_timeline_v161 on public.booking_events;
drop trigger if exists conversation_messages_immutable_v161 on public.conversation_messages_v161;
drop trigger if exists conversation_system_events_immutable_v161 on public.conversation_system_events_v161;
drop trigger if exists message_audit_events_immutable_v161 on public.message_audit_events_v161;
do $$
declare v_item record;v_expected text[]:=array[
  'apply_minuta_message_action_v161','capture_minuta_message_booking_event_v161',
  'claim_minuta_support_request_v161','get_minuta_client_message_capability_v161',
  'get_minuta_client_message_timeline_v161','get_minuta_message_capability_v161',
  'get_minuta_provider_message_timeline_v161','get_minuta_support_message_timeline_v161',
  'list_minuta_client_conversations_v161','list_minuta_provider_conversations_v161',
  'list_minuta_support_requests_v161','mark_minuta_client_message_read_v161',
  'mark_minuta_provider_message_read_v161','minuta_mark_message_read_core_v161',
  'minuta_message_booking_sha256_v161','minuta_message_client_can_access_v161',
  'minuta_message_client_identity_v161','minuta_message_diagnostics_valid_v161',
  'minuta_message_ensure_booking_participants_v161','minuta_message_next_sequence_v161',
  'minuta_message_provider_can_access_v161','minuta_message_provider_role_v161',
  'minuta_message_receipt_v161','minuta_message_support_can_access_v161',
  'minuta_message_timeline_core_v161','minuta_send_message_core_v161',
  'open_minuta_client_conversation_v161','open_minuta_client_support_v161',
  'open_minuta_provider_conversation_v161','open_minuta_provider_support_v161',
  'prepare_minuta_message_action_v161','propose_minuta_message_action_v161',
  'protect_minuta_message_immutable_v161','send_minuta_client_message_v161',
  'send_minuta_provider_message_v161','send_minuta_support_message_v161',
  'set_minuta_message_center_settings_v161','set_minuta_support_agent_v161'
];
begin
  if exists(select 1 from unnest(v_expected) expected(name) where 1<>(select count(*)
    from pg_catalog.pg_proc procedure_row join pg_catalog.pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname='public' and procedure_row.proname=expected.name
      and obj_description(procedure_row.oid,'pg_proc')='minuta_message_center_v161')) or exists(
    select 1 from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname='public' and obj_description(procedure_row.oid,'pg_proc')='minuta_message_center_v161'
      and not procedure_row.proname=any(v_expected)
  ) then raise exception using errcode='55000',message='v161_schema_rollback_requires_exact_functions'; end if;
  for v_item in select procedure_row.oid::regprocedure signature
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row on namespace_row.oid=procedure_row.pronamespace
    where namespace_row.nspname='public' and procedure_row.proname=any(v_expected)
      and obj_description(procedure_row.oid,'pg_proc')='minuta_message_center_v161'
  loop
    execute format('drop function %s',v_item.signature);
  end loop;
end
$$;
drop table public.message_audit_events_v161;
drop table public.message_idempotency_receipts_v161;
drop table public.message_support_requests_v161;
drop table public.message_attachments_v161;
drop table public.message_read_receipts_v161;
drop table public.message_action_confirmations_v161;
drop table public.conversation_message_actions_v161;
drop table public.conversation_system_events_v161;
drop table public.conversation_messages_v161;
drop table public.message_participants_v161;
drop table public.message_conversations_v161;
drop table public.message_support_agents_v161;
drop table public.message_center_settings_v161;
notify pgrst,'reload schema';
commit;
