# Единый диспетчер уведомлений

`notification-dispatcher` обрабатывает только строки `notification_outbox` с
`dispatcher = 'unified'`. Старый `process-notifications` ограничен миграцией
v88 строками `legacy_provider_telegram`, поэтому два воркера не забирают одну
работу.

## Безопасное состояние после установки

- Общий переключатель каждой организации выключен.
- Все десять сочетаний получателя (`provider`/`client`) и канала выключены.
- Без `NOTIFICATION_DISPATCHER_SECRET` функция отвечает `503 not_configured`.
- Если не настроен ни один адаптер, функция отвечает `503 not_configured` и не
  забирает строки из очереди.
- Клиент без подтверждённого адреса не забирается воркером: событие остаётся
  «в очереди» без ложной ошибки и без расхода попыток. Устаревшие события
  отменяются до захвата.
- `sent` означает только «канал принял отправку». Надпись «доставлено» появляется
  только при `delivered_at`, записанном по подтверждённой квитанции канала.
- Сетевой timeout Telegram считается неоднозначным результатом: событие получает
  `telegram_delivery_unknown` и не повторяется автоматически. Истёкшая Telegram
  lease также переводится в этот карантин; обычный UI retry для неё заблокирован.

## Секреты

Обязателен `NOTIFICATION_DISPATCHER_SECRET` длиной не менее 32 случайных байт.
Его значение передаётся планировщиком только в `x-worker-secret`.

Telegram использует `TELEGRAM_BOT_TOKEN`. Для прежнего одиночного кабинета
поддержан ограниченный fallback `TELEGRAM_CHAT_ID` + `TELEGRAM_PERFORMER_ID`.
Остальные адреса получателей записывает только service-role RPC
`upsert_minuta_notification_endpoint`; браузер не имеет доступа к таблице с
адресами.

Email, SMS, MAX и push подключаются к выбранным шлюзам следующими парами:

- `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_TOKEN`, опционально `EMAIL_SENDER`;
- `SMS_PROVIDER_URL`, `SMS_PROVIDER_TOKEN`, опционально `SMS_SENDER`;
- `MAX_PROVIDER_URL`, `MAX_PROVIDER_TOKEN`, опционально `MAX_SENDER`;
- `PUSH_PROVIDER_URL`, `PUSH_PROVIDER_TOKEN`, опционально `PUSH_SENDER`.

URL шлюза обязан быть HTTPS. Диспетчер передаёт шлюзу `Idempotency-Key`, равный
неизменяемому `event_key`, и не записывает токены или адреса получателей в ответ
и журнал ошибок.

## Планировщик

В production нужен ровно один Supabase Cron с именем
`minuta-notification-dispatcher`, вызывающий `notification-dispatcher` раз в минуту.
URL проекта, publishable key и `NOTIFICATION_DISPATCHER_SECRET` хранятся только в
Supabase Vault. Вызов передаёт `x-worker-secret` и JSON `{"limit":20}`. Перед включением
каналов dry-run обязан вернуть `claimed: 0` без ошибок. Во время постепенного
перехода `telegram-client-reminders-hourly` продолжает обслуживать только ещё не
активированные организации.

После применения v114 развернуть `notification-dispatcher` и переходную версию
`telegram-client-notify`, затем создать replacement-задачу:

```sql
select cron.schedule(
  'minuta-notification-dispatcher',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='minuta_project_url')
      || '/functions/v1/notification-dispatcher',
    headers := jsonb_build_object(
      'content-type','application/json',
      'apikey',(select decrypted_secret from vault.decrypted_secrets where name='minuta_publishable_key'),
      'x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='minuta_notification_dispatcher_secret')
    ),
    body := '{"limit":20}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
```

Секреты `minuta_project_url`, `minuta_publishable_key` и
`minuta_notification_dispatcher_secret` должны существовать заранее; их значения
в SQL и журнал не выводить. Проверка cutover перед миграцией:

```sql
select jobid,jobname,schedule,active,
  command ilike '%/functions/v1/notification-dispatcher%' as correct_target
from cron.job
where jobname in ('minuta-notification-dispatcher','telegram-client-reminders-hourly')
order by jobname;
```

До первой активации ожидаются одна активная replacement-задача с расписанием
`* * * * *` и legacy-задача. Unified worker не забирает Telegram-клиентов без записи
в `notification_v114_organization_cutovers`; переходный legacy worker перед каждой
отправкой проверяет обратное условие. Поэтому одна организация принадлежит только
одному пути.

## Безопасный откат v114

`minuta-online-booking/supabase-migration-v114-rollback.sql` выполняет совместимый
откат функций v88, но намеренно сохраняет очередь, попытки, endpoints, delivery evidence,
добавленные столбцы и v114 RPC для уже работающего dispatcher. Он не включает каналы,
не создаёт отправки и не возвращает устаревший `/reminders` cron.

Порядок: проверить текущие cutover-записи и обе cron-задачи; применить rollback;
повторить проверку. Rollback не меняет маршруты: для уже активированных организаций
требует работающий replacement, а при оставшихся legacy-организациях — работающий
legacy cron. Для возврата снова применить v114 — миграция идемпотентно восстановит
усиленные функции и subscription trigger без удаления данных. Пока действует rollback,
новые activation-запросы отклоняются с `v114_cutover_paused_by_rollback`, а уже
зафиксированная маршрутизация продолжает работать.

## Переключение без дублей

До включения организационного канала нужно:

1. Применить v114: она создаёт routing-таблицу, но никого не активирует и не
   отключает legacy cron.
2. Развернуть обе Edge Function и создать replacement cron.
3. Записать подтверждённые адреса получателей через service-role RPC.
4. Для Telegram мастеру отключить старый Database Webhook на
   `telegram-booking-notify`, если он отправляет события таблицы `bookings`.
5. Выполнить защищённый `POST /telegram-client-notify/cutover-ready` с прежним
   `x-reminder-secret`. Ответ `dry_run:true`, `worker_version:v114`, `sent:0`
   подтверждает, что переходный legacy bridge уже развёрнут; отметка действует 15 минут.
6. Для одной организации явно включить client/telegram и общий переключатель.
7. Выполнить авторизованный dry-run dispatcher с телом
   `{"dry_run":true,"channels":["telegram"],"activate_organization":"UUID"}`.
   Только реально готовый v114 worker вызовет activation RPC; запрос ничего не
   ставит в очередь и не отправляет.
8. Убедиться, что ответ содержит `claimed:0`, `sent:0`, `cutover.activated:true`.
   После этого unified worker обслуживает организацию, а legacy worker её пропускает.
9. Повторить по организациям. Activation последней legacy-организации атомарно
   удалит `telegram-client-reminders-hourly`, но только при активном replacement.
10. Наблюдать `notification_delivery_attempts` не менее 30 минут.

Для legacy cutover перед фактическим `sendMessage` создаётся серверная lease под
блокировкой организации. Activation либо видит эту lease и отклоняется, либо успевает
первой, после чего legacy claim запрещён. `sending` и `unknown` блокируют cutover,
пока неоднозначный результат не будет расследован.

Exactly-once для Telegram не заявляется: Bot API не принимает идемпотентный ключ.
Выбран безопасный режим без автоматического повтора после timeout, потери ответа,
сбоя ACK или истечения lease. Это снижает риск дубля, но оставляет оператору
неоднозначное событие, которое может потребовать сверки с Telegram перед ручным
решением. Для остальных шлюзов используется `Idempotency-Key=event_key`.
