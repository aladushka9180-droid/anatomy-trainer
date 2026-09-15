-- ISOLATED TEST DATABASE ONLY. Apply through v155 and v162 before running.
begin;

create or replace function pg_temp.v162_assert(ok boolean,label text)
returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'v162_assert:%',label; end if;
end $$;

select pg_temp.v162_assert((select count(*)=13 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname like '%\_v162' escape '\' and c.relkind='r'
    and obj_description(c.oid,'pg_class')='minuta_message_center_v162'),'exact_tables');
select pg_temp.v162_assert(not exists(select 1 from public.message_center_settings_v162
  where client_chat_enabled or support_enabled or media_enabled or transcription_enabled),'disabled_by_default');
select pg_temp.v162_assert(public.minuta_message_diagnostics_valid_v162(
  '{"app_version":"160","online":true,"last_sync_error_code":null}'::jsonb),'diagnostics_allowlist_accepts');
select pg_temp.v162_assert(not public.minuta_message_diagnostics_valid_v162(
  '{"phone":"+79990000000"}'::jsonb),'diagnostics_allowlist_rejects_pii');
select pg_temp.v162_assert(
  to_regprocedure('public.open_minuta_client_conversation_v162(text,text,uuid)') is not null
  and to_regprocedure('public.get_minuta_client_message_capability_v162(text,text)') is not null
  and to_regprocedure('public.apply_minuta_message_action_v162(text,uuid,text,uuid)') is not null,
  'client_booking_code_contract');
select pg_temp.v162_assert(
  has_function_privilege('anon','public.open_minuta_client_conversation_v162(text,text,uuid)','execute')
  and not has_table_privilege('anon','public.conversation_messages_v162','select')
  and not has_table_privilege('authenticated','public.conversation_messages_v162','select')
  and not has_table_privilege('service_role','public.conversation_messages_v162','select'),
  'rpc_only_acl');
select pg_temp.v162_assert(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname like '%\_v162' escape '\' and c.relkind='r'
    and (not c.relrowsecurity or not c.relforcerowsecurity)),'force_rls');
select pg_temp.v162_assert((select position('conversation.primary_booking_id=new.booking_id' in replace(prosrc,E'\r',''))>0
  and position('client_account_id=booking.client_account_id' in replace(prosrc,E'\r',''))=0 from pg_proc
  where oid='public.capture_minuta_message_booking_event_v162()'::regprocedure),'booking_event_scope_is_exact');
select pg_temp.v162_assert((select position('minuta_message_receipt_v162(v_actor_key,''prepare_action''' in replace(prosrc,E'\r',''))>0
  and position('on conflict(client_session_id,request_id) do update' in replace(prosrc,E'\r',''))=0 from pg_proc
  where oid='public.prepare_minuta_message_action_v162(text,uuid,uuid)'::regprocedure),'prepare_lost_ack_contract');

set local role anon;
do $$ begin
  begin perform 1 from public.conversation_messages_v162 limit 1; raise exception 'direct_table_access_allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
