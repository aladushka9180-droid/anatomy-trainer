# Изолированный server-only выпуск CRM v112–v114

## Текущий безопасный маршрут (2026-09-05)

Новый маршрут отделён от старого черновика: `minuta-crm-snapshot-prepare.yml`
готовит обезличенную копию в PostgreSQL 17 с `--network none`, а
`minuta-crm-test-restore.yml` сначала выполняет `mode=validate` без записей в БД.
`mode=restore` требует успешный сертификат этой же версии кода с теми же SHA,
архивами и checksum; целевой проект жёстко ограничен `umazhvvxutnsyuphbhda`.

- Обезличивание реального архива: `33980648779`, success, код
  `e4f902d5b2533d71030dd6080f57fe94c82e2b2e`.
- Свежий зашифрованный test backup: `33980953542`, success, main
  `7b98853fbf77762b6e9ed2cb6104df6d32978ae7`.
- Read-only validation: `33982762127`, success, код
  `784e6a5f5e68a7030a20ac9da2b26cd6b6ad7d2f`.
- Restore `33982819513`: success, COMMIT подтверждён 18:08:36 UTC.
  Предыдущая попытка `33982292712` откатилась; исправлено сравнение
  `pg_get_triggerdef` при разных `search_path`, с регрессией в PGlite.
- После восстановления test backup `33983185716`: success, main
  `3a8d6b26223e5efb8dee8bae7ae3ff704f1da2d7`.
- Rehearsal validate `33983795409`: success на `678ada88563f200b804267bfe9d93195bbade4cf`.
- Первый exercise `33983858607` остановлен с SQLSTATE `42830`: v112 COMMIT,
  v113 transaction rollback, v114 не применена. В реальной v69 есть только
  `UNIQUE(id,organization_id,location_id)`; v113 теперь сама создаёт недостающую
  пару `(id,organization_id)`. Исправление и правдивая PGlite fixture: `a34bcda`.
- Read-only проверка testDB: новые v112 settings/entries и объекты бакета пусты;
  cron, outbox и организации с включённой публичной записью — 0.
- Новый backup после частичного применения: `33984056948`, success, main
  `bd7d46e863b4076ecfd238c05d9bd0c36bbc3a91`.

Продолжение выполнено через отдельный pinned v112-only resume guard после нового
backup. Ошибка первого exercise не означала откат уже завершённой v112.

### Проверенный повторный цикл

- Resume validate `33984466230`: success.
- Exercise `33984549873`: success, завершён `2026-09-05T18:37:17Z`.
- Оба запуска используют exact release SHA
  `4e73ff98a2a44e857915356b18a265edb025cfe6` и backup `33984056948`.
- v112 → v113 → v114 применены; обратный rollback v114 → v113 → v112 проверен;
  затем повторное применение всех трёх миграций прошло успешно.
- Количество строк и SHA-256 исходных полей 24 таблиц не изменились относительно
  свежего post-failure backup baseline. Это не ретроспективная fingerprint-проверка
  первого неуспешного exercise; его приватные промежуточные fingerprints удалены.
- Новые функции выключены. Production не изменялась; workers/Edge не развёрнуты,
  физический Storage HTTP и реальные отправки уведомлений не проверялись.
- Runtime на реальной testDB: v112 SQL/RPC/Storage metadata в транзакции с ROLLBACK.
  v113 дополнительно проверена schema assertion; v113/v114 runtime — изолированные
  PGlite/Deno тесты, не live delivery E2E.
- Тестовые данные до первоначального restore восстанавливаются из зашифрованного
  artifact `crm-testdb-before-33980953542`, срок хранения 35 дней от создания.

Текущий checkpoint: testDB на v112–v114, без активации. Production release не
разрешён этим отчётом и требует отдельного согласованного защищённого этапа.

Из копии исключены исходящие webhook definitions, очереди и подключения;
персональные строки и UUID заменены с сохранением связей. Auth импортирует
только синтетические UUID, без credentials. Защищённые обработчики auth/event
сохраняются и проверяются; ACL закрываются до COMMIT. Физические Storage-файлы
не копируются. Production DB, production Edge Functions и рассылки не изменяются.

## Старый объединённый workflow остаётся заблокирован

`minuta-crm-server-release.yml` — НЕ готовый исполняемый выпуск. Job отключён
через `if: false`: прежний полный restore непригоден для безопасного теста.
Ниже описан целевой порядок, а не факт его выполнения. Не включать job простой
заменой условия: сначала заменить полный restore на проверенный manifest,
исключить исходящие данные, восстановить ограниченные ACL и проверить зависимости
вне public. `session_replication_role=replica` не блокирует ALWAYS/event triggers.

Исторические результаты до обезличенного восстановления (не текущее состояние):

- Production backup: Actions run `33976747499`, success, SHA `9452128916ef1e4b265401578893749782b2e84a`.
- Test backup + read-only preflight: `33977568656`, success, SHA `964b326be78d63cdbb79b7dcbd285dd007aa264a`.
- Зашифрованная копия testDB, checksum и журнал: artifact `crm-testdb-before-33977568656`, хранение 35 дней.
- Тестовая схема неполная (в частности, нет inventory tables); migration marker есть,
  restore marker отсутствует. Никакие данные в testDB ещё не перезаписаны.
- Через dashboard подтверждено отсутствие Edge Functions в тестовом проекте.
- Изолированные CRM-проверки и настоящая PostgreSQL concurrency-проверка: `33976959385`, success.

Разрешение пользователя на перезапись названной testDB после backup и отдельное
разрешение на обезличенную копию получены; восстановление завершено выше.
Production migration всё ещё требует
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
