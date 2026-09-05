begin;
do $$ begin
  if (select count(*) from vault.secrets where name in ('minuta_project_url','minuta_publishable_key','minuta_notification_dispatcher_secret'))<>3 then
    raise exception 'dispatcher_vault_configuration_missing';
  end if;
  if exists(select 1 from cron.job where jobname='minuta-notification-dispatcher') then
    raise exception 'dispatcher_cron_already_exists';
  end if;
end $$;
select cron.schedule('minuta-notification-dispatcher','* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='minuta_project_url') || '/functions/v1/notification-dispatcher',
    headers := jsonb_build_object('content-type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='minuta_publishable_key'),
      'x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='minuta_notification_dispatcher_secret')),
    body := '{"limit":20}'::jsonb, timeout_milliseconds := 10000);
$job$);
commit;
