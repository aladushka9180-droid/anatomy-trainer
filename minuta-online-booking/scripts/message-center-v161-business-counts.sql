begin transaction isolation level repeatable read read only;
select jsonb_build_object(
  'settings',(select count(*) from public.message_center_settings_v161),
  'supportAgents',(select count(*) from public.message_support_agents_v161),
  'conversations',(select count(*) from public.message_conversations_v161),
  'messages',(select count(*) from public.conversation_messages_v161),
  'systemEvents',(select count(*) from public.conversation_system_events_v161),
  'actions',(select count(*) from public.conversation_message_actions_v161),
  'supportRequests',(select count(*) from public.message_support_requests_v161),
  'attachments',(select count(*) from public.message_attachments_v161),
  'auditEvents',(select count(*) from public.message_audit_events_v161)
);
rollback;
