\set ON_ERROR_STOP on
begin;
select set_config('v162.isolated_confirm', :'isolated_confirm', true);

do $guard$
begin
  if current_setting('v162.isolated_confirm',true) is distinct from 'MIGRATE_ONLY_ISOLATED_TEST_DATABASE' then
    raise exception using errcode='42501',message='v162_isolated_reset_confirmation_required';
  end if;
end
$guard$;

truncate table
  public.message_action_confirmations_v162,
  public.message_read_receipts_v162,
  public.message_attachments_v162,
  public.conversation_message_actions_v162,
  public.conversation_system_events_v162,
  public.conversation_messages_v162,
  public.message_participants_v162,
  public.message_support_requests_v162,
  public.message_idempotency_receipts_v162,
  public.message_audit_events_v162,
  public.message_conversations_v162,
  public.message_support_agents_v162,
  public.message_center_settings_v162
restart identity cascade;
commit;
