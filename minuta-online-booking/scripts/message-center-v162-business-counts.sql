begin transaction isolation level repeatable read read only;
select jsonb_build_object(
  'settings',(select count(*) from public.message_center_settings_v162),
  'supportAgents',(select count(*) from public.message_support_agents_v162),
  'conversations',(select count(*) from public.message_conversations_v162),
  'messages',(select count(*) from public.conversation_messages_v162),
  'systemEvents',(select count(*) from public.conversation_system_events_v162),
  'actions',(select count(*) from public.conversation_message_actions_v162),
  'supportRequests',(select count(*) from public.message_support_requests_v162),
  'attachments',(select count(*) from public.message_attachments_v162),
  'auditEvents',(select count(*) from public.message_audit_events_v162)
);
rollback;
