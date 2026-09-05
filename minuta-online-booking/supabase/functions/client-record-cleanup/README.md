# Очистка незавершённых файлов карточки клиента

`client-record-cleanup` — серверный worker для записей `v112`, загрузка которых не была завершена более семи дней назад. Он не принимает идентификатор или путь файла от вызывающей стороны и всегда работает только с результатом защищённых RPC:

- `claim_expired_minuta_client_records(p_limit integer, p_execute boolean)`;
- `finish_expired_minuta_client_record(p_id uuid)`.

Worker проверяет строгий путь `organizationUUID/entryUUID.ext`, требует совпадения `entryUUID` с `id` и удаляет объект только из фиксированного bucket `minuta-client-records`. Идентификаторы, пути, ключи и другие персональные данные не записываются в логи и не возвращаются в ответе.

## Настройка

Необходимы secrets:

- `CLIENT_RECORD_CLEANUP_SECRET` — отдельный случайный секрет только для заголовка `x-worker-secret`;
- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY` либо `SUPABASE_SECRET_KEYS` с ключом `default`.

Секреты задаются вручную через Supabase Dashboard или CLI. Значения не должны попадать в Git, frontend-конфигурацию или журналы.

```bash
supabase secrets set CLIENT_RECORD_CLEANUP_SECRET=...
supabase functions deploy client-record-cleanup --no-verify-jwt
```

Эти команды приведены как инструкция: текущая задача worker не развёртывает, расписание не создаёт и реальные файлы не удаляет.

## Запуск и расписание

Endpoint принимает только `POST`. Без тела или с `{"execute":false}` выполняется dry-run: возвращается только число кандидатов. Реальное удаление требует явного `{"execute":true}`. `limit` ограничен диапазоном `1–100`.

`execute:true` работает в две фазы. Первый подход только ставит `expired_at` кандидатам старше 7 дней и не возвращает путь. Удаление разрешается не раньше чем через 1 час: следующий claim получает просроченные строки, после чего worker вызывает Storage и завершает metadata. Этот час — предохранитель от гонки с поздним завершением загрузки.

После тестовой миграции сначала вручную выполнить dry-run. Затем в Supabase Cron или внешнем защищённом планировщике создать как минимум почасовой `POST` к Edge Function с `x-worker-secret`; начинать с `execute:false`. Переключать расписание на `execute:true` можно только после проверки выборки и отдельной release-настройки. Никакое расписание этим каталогом автоматически не создаётся.

При ошибке Storage metadata не завершается. При ошибке финального RPC помеченная запись остаётся доступной следующему claim; повторное удаление отсутствующего объекта безопасно, после чего metadata может быть завершена.

## Тест

```bash
deno test minuta-online-booking/supabase/functions/client-record-cleanup/handler_test.ts
```

Тесты используют dependency injection и не обращаются к production, Storage или реальной БД.
