# Обработчик уведомлений Minuta

Функция забирает из `notification_outbox` события `booking_created` и отправляет мастеру сообщение в Telegram. Токен бота и идентификатор чата существуют только в секретах Supabase Edge Functions и никогда не передаются браузеру.

## Что подготовлено

- Миграция `minuta-online-booking/supabase-migration-v46.sql` создаёт очередь, журнал попыток, три серверных RPC (`claim`, `ack`, `fail`) и безопасный RPC ручного повтора владельцем.
- Событие создаётся триггером после вставки записи. Уникальный `event_key` не позволяет поставить одно событие в очередь дважды.
- Временная ошибка возвращает событие в `pending` с задержкой 1, 2, 4, 8… минут (максимум сутки и максимум восемь автоматических попыток). Постоянная ошибка переводит событие в `failed`.
- Зависшее состояние `sending` автоматически освобождается через 15 минут.
- Очередь доставляет сообщения как минимум один раз. Telegram не предоставляет идемпотентный ключ для `sendMessage`, поэтому при редком обрыве связи после принятия сообщения Telegram, но до серверного `ack`, возможен повтор.

## Секреты

Перед включением нужны:

- `TELEGRAM_BOT_TOKEN` — токен от BotFather;
- `TELEGRAM_CHAT_ID` — чат мастера, который предварительно нажал Start у бота;
- `TELEGRAM_PERFORMER_ID` — UUID профиля этого мастера в `performer_profiles`;
- `NOTIFICATION_WORKER_SECRET` — случайная строка не короче 32 байт для вызова воркера.

`TELEGRAM_PERFORMER_ID` обязателен: один экземпляр обработчика забирает только события выбранного мастера, поэтому запись другого зарегистрированного исполнителя никогда не попадёт в чужой Telegram-чат.

`SUPABASE_URL` и серверный ключ Supabase выдаются Edge Functions автоматически. Поддержаны и новые `SUPABASE_SECRET_KEYS`, и прежний `SUPABASE_SERVICE_ROLE_KEY`.

Секреты вводятся через **Supabase Dashboard → Edge Functions → Secrets** либо локальным CLI из файла, который не добавлен в Git:

```sh
supabase secrets set --env-file .env.notifications
```

## Безопасный порядок включения

1. Применить миграцию v46 в тестовой базе.
2. Ввести три секрета тестового окружения.
3. Развернуть функцию: `supabase functions deploy process-notifications`.
4. Один раз вызвать функцию с заголовком `x-worker-secret` и убедиться, что пустая очередь возвращает `claimed: 0`.
5. Создать тестовую запись и проверить одно Telegram-сообщение, состояние `sent` и строку в `notification_delivery_attempts`.
6. Настроить Supabase Cron на POST-вызов функции раз в минуту. URL проекта, publishable key и `NOTIFICATION_WORKER_SECRET` хранить в Supabase Vault; секрет воркера передавать заголовком `x-worker-secret`.
7. Повторить эти действия в production и наблюдать журнал Cron и очередь минимум 30 минут.

Официальная схема планирования — Supabase Cron + `pg_net` + Vault. В Dashboard задача настраивается в **Integrations → Cron**. Функция развёртывается с `verify_jwt = false`, но каждый запрос проверяется собственным секретом постоянного времени; публичный вызов без него получает 401.

Эквивалентная заготовка для SQL Editor (значения `REPLACE_*` вводятся при настройке, в репозиторий не сохраняются):

```sql
select vault.create_secret('https://REPLACE_PROJECT_REF.supabase.co', 'minuta_project_url');
select vault.create_secret('REPLACE_PUBLISHABLE_KEY', 'minuta_publishable_key');
select vault.create_secret('REPLACE_SAME_WORKER_SECRET', 'minuta_notification_worker_secret');

select cron.schedule(
  'minuta-process-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'minuta_project_url')
      || '/functions/v1/process-notifications',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'minuta_publishable_key'),
      'x-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'minuta_notification_worker_secret')
    ),
    body := '{"limit":10}'::jsonb,
    timeout_milliseconds := 10000
  ) as request_id;
  $$
);
```

Остановить задачу можно командой `select cron.unschedule('minuta-process-notifications');`. Имена секретов Vault фиксированы, а сами значения доступны только серверной инфраструктуре.

## Проверка состояния

Мастер видит только свои события благодаря RLS. `claim`, `ack` и `fail` доступны исключительно `service_role`. Из браузера можно вызвать только `retry_notification_outbox` и только для собственной записи в состоянии `failed`; уже отправленное сообщение повторить нельзя.

В production нельзя запускать разрушающие тесты. Для проверки повторов используйте отдельный Supabase-проект и временный Telegram-чат.
