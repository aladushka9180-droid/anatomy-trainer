begin;

set local search_path = public, pg_catalog;

do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception using errcode = 'P0001', message = 'v77_requires_supabase_vault';
  end if;
  if to_regclass('cron.job') is null then
    raise exception using errcode = 'P0001', message = 'v77_requires_pg_cron';
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception using errcode = 'P0001', message = 'v77_requires_cron_schedule';
  end if;
  -- Vault versions differ in the exact declared argument types while keeping
  -- the same callable create_secret API with optional name and description.
  if to_regproc('vault.create_secret') is null then
    raise exception using errcode = 'P0001', message = 'v77_requires_vault_create_secret';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'minuta_telegram_client_reminder_secret'
  ) then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      'minuta_telegram_client_reminder_secret',
      'Авторизация ежечасного запуска Telegram-напоминаний'
    );
  end if;
end;
$$;

create or replace function public.get_telegram_reminder_secret_hash()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(secret.decrypted_secret, 'UTF8'), 'sha256'),
    'hex'
  )
  from vault.decrypted_secrets secret
  where secret.name = 'minuta_telegram_client_reminder_secret'
  limit 1
$$;

revoke all on function public.get_telegram_reminder_secret_hash() from public, anon, authenticated, service_role;
grant execute on function public.get_telegram_reminder_secret_hash() to service_role;

comment on function public.get_telegram_reminder_secret_hash() is
  'Returns only a SHA-256 hash of the Vault reminder secret to the service-role Edge Function.';

do $$
declare existing_job bigint;
reminder_url text := coalesce(
  nullif(current_setting('minuta.telegram_reminder_url', true), ''),
  'https://cawexmmrqjvothcbgjxr.supabase.co/functions/v1/telegram-client-notify/reminders'
);
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'telegram-client-reminders-hourly';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;

  perform cron.schedule(
    'telegram-client-reminders-hourly',
    '15 * * * *',
    format($job$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-reminder-secret', coalesce((
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'minuta_telegram_client_reminder_secret'
            limit 1
          ), '')
        ),
        body := '{}'::jsonb
      );
    $job$, reminder_url)
  );
end;
$$;

commit;
