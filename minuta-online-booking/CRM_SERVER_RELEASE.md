# Изолированный server-only выпуск CRM v112–v114

Этот выпуск предназначен только для серверных миграций карточки клиента v112,
себестоимости v113 и доставки уведомлений v114. Он не публикует HTML, CSS,
браузерный JavaScript, service worker, Edge Functions и не активирует функции
организаций. Production-миграция намеренно отсутствует.

## Граница текущего этапа

Workflow `Minuta CRM server preprod v112-v114` выполняет только preproduction:

1. Берёт управляющий workflow из `main`, отдельно извлекает точный server-only
   SHA и проверяет его diff относительно SHA production snapshot. Код тестируемой
   ветки не может подменить управляющий guard.
2. Создаёт зашифрованный backup текущей тестовой базы
   `umazhvvxutnsyuphbhda`, проверяет расшифровку и сохраняет artifact до первой
   записи в testDB.
3. Принимает только свежий успешный artifact workflow
   `Minuta Supabase encrypted backup` с того же release SHA в `main`, проверяет
   GitHub run, SHA-256 и шифрование. Production БД не изменяется и даже не
   используется как источник `pg_dump` в этом workflow.
4. После точного подтверждения и двух маркеров перезаписывает только выбранную
   testDB проверенной production-копией.
5. До восстановления строит явный allowlist архива: прикладная схема `public`
   и только необходимые для её внешних ключей записи `auth.users`. Управляемые
   схемы и очереди `cron`, `vault`, `net`, `storage`, webhook-конфигурация и иные
   внешние endpoints в restore-list не попадают. Если состав архива нельзя
   доказать до `pg_restore`, этап останавливается без изменения testDB.
6. Применяет v112 → v113 → v114, проверяет схему и тестовые контракты, включая
   cleanup-worker и полный PGlite lifecycle незавершённой загрузки, выполняет
   v114 compatibility rollback → v113 destructive rollback → v112
   non-destructive rollback, затем повторно применяет v112 → v113 → v114.

Rollback v112 и v114 намеренно не возвращает схему к v111: v112 сохраняет
закрытые файлы и метаданные, v114 сохраняет очередь и доказательства доставки.
Проверка подтверждает именно безопасное отключение и повторное применение.

## Обязательные входы и защита

- `release_sha` — полный SHA отдельной server-only ветки; он намеренно может
  отличаться от `main` и не должен содержать CRM frontend;
- `server_base_sha` — полный SHA `main`, с которого сделан production backup и
  от которого ответвлён server-only набор;
- `production_backup_run_id` — успешный backup-run на `release_sha`, не старше
  шести часов; `head_sha` этого запуска обязан равняться `server_base_sha`, а не
  `release_sha`;
- `test_restore_confirm` — точная строка
  `RESTORE_UMAZHVVXUTNSYUPHBHDA_FROM_VERIFIED_PRODUCTION_BACKUP`.

Repository secrets: `BACKUP_ENCRYPTION_PASSWORD`, `MINUTA_TEST_DATABASE_URL`,
`SUPABASE_DB_URL`. Variables: `MINUTA_PRODUCTION_PROJECT_REF`,
`MINUTA_TEST_PROJECT_REF`, `MINUTA_TEST_MIGRATION_CONFIRM`.

До запуска в testDB должны существовать обе записи:

```sql
insert into minuta_migration_guard.target(project_ref,allow_migrations)
values ('umazhvvxutnsyuphbhda',true)
on conflict(project_ref) do update set allow_migrations=excluded.allow_migrations;

insert into minuta_restore_guard.target(project_ref,allow_destructive_restore)
values ('umazhvvxutnsyuphbhda',true)
on conflict(project_ref) do update
set allow_destructive_restore=excluded.allow_destructive_restore;
```

Если маркер, ref, подтверждение, backup, checksum, allowlist restore или полный
replay не подтверждены, workflow прекращается. Он не содержит обхода. Тесты
server-only набора не читают и не требуют CRM HTML/CSS/браузерный JavaScript.

Production cron, Vault, HTTP-очереди и Storage metadata не копируются даже во
временно отключённом виде. Нужные Storage-объекты тесты создают синтетически и
откатывают в рамках тестовой транзакции. Это schema/runtime preprod, а не E2E
production cron или реальная доставка уведомления.

## Что остаётся после preprod

Зашифрованные test-before и production-source artifacts с checksum хранятся
35 дней. Незашифрованные dumps существуют только в `$RUNNER_TEMP`, удаляются
через trap и не попадают в логи или репозиторий.

Production migration, deploy Edge Functions, создание рабочего dispatcher cron,
`/cutover-ready`, активация организаций и реальные сообщения выполняются только
отдельным последующим гейтом после явного `BACKUP_VERIFIED`. До этого production
остаётся на прежнем состоянии.
