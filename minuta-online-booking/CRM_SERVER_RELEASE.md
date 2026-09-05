# Изолированный server-only выпуск CRM v112–v114

## Текущее состояние: запуск восстановления заблокирован

`minuta-crm-server-release.yml` — НЕ готовый исполняемый выпуск. Job отключён
через `if: false`: прежний полный restore непригоден для безопасного теста.
Ниже описан целевой порядок, а не факт его выполнения. Не включать job простой
заменой условия: сначала заменить полный restore на проверенный manifest,
исключить исходящие данные, восстановить ограниченные ACL и проверить зависимости
вне public. `session_replication_role=replica` не блокирует ALWAYS/event triggers.

Проверено 2026-09-05:

- Production backup: Actions run `33976747499`, success, SHA `9452128916ef1e4b265401578893749782b2e84a`.
- Test backup + read-only preflight: `33977568656`, success, SHA `964b326be78d63cdbb79b7dcbd285dd007aa264a`.
- Зашифрованная копия testDB, checksum и журнал: artifact `crm-testdb-before-33977568656`, хранение 35 дней.
- Тестовая схема неполная (в частности, нет inventory tables); migration marker есть,
  restore marker отсутствует. Никакие данные в testDB ещё не перезаписаны.
- Через dashboard подтверждено отсутствие Edge Functions в тестовом проекте.
- Изолированные CRM-проверки и настоящая PostgreSQL concurrency-проверка: `33976959385`, success.

Разрешение пользователя относится к перезаписи названной testDB после backup.
Перенос и обезличивание рабочих клиентских/складских данных следует согласовать
отдельно до выборочного восстановления. Production migration всё ещё требует
нового `BACKUP_VERIFIED` после теста миграции и отката.

Этот выпуск предназначен только для серверных миграций карточки клиента v112,
себестоимости v113 и доставки уведомлений v114. Он не публикует HTML, CSS,
браузерный JavaScript, service worker, Edge Functions и не активирует функции
организаций. Production-миграция намеренно отсутствует.

## Граница текущего этапа

Целевой workflow `Minuta CRM server preprod v112-v114` должен выполнять только preproduction:

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
