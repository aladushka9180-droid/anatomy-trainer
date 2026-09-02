begin;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'telegram-client-reminders-hourly';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end;
$$;

drop function if exists public.get_telegram_reminder_secret_hash();

-- Секрет намеренно остаётся в Vault: откат отключает напоминания, но не
-- возвращает публичный неавторизованный endpoint и не раскрывает секрет.

commit;
