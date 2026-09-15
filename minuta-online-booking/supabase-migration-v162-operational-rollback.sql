-- Operational rollback for v162: disable every entry point while preserving all user data.
begin;
set local lock_timeout='10s';
do $$
begin
  if to_regclass('public.message_center_settings_v162') is null then
    raise exception using errcode='55000',message='v162_operational_rollback_requires_schema';
  end if;
  update public.message_center_settings_v162
  set client_chat_enabled=false,support_enabled=false,media_enabled=false,transcription_enabled=false,
    updated_by=null,updated_at=now();
end
$$;
notify pgrst,'reload schema';
commit;
