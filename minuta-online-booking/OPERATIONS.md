# Эксплуатация Minuta

## Безопасный порядок выпуска v64

1. Синхронизировать рабочую ветку с `origin/main` и зафиксировать SHA выпуска.
2. Запустить статические тесты, включая проверку дублей и порядка миграций.
3. Настроить защитный маркер отдельной тестовой базы по [SAFE_RELEASE.md](SAFE_RELEASE.md) и запустить `Minuta safe release gate` в режиме `test-migration`.
4. Проверить в тестовой базе: чужая запись не удаляется, запись с отзывом возвращает `review_protected`, обычная запись удаляется вместе со связанными платёжными событиями, а количество остальных записей не меняется.
5. Убедиться, что свежая production-копия успешно создана и прошла контроль восстановления. Если backup workflow пропущен или завершился ошибкой, production-миграцию не запускать.
6. Применить `supabase-migration-v64.sql` последней. Старые миграции v41–v63 не редактировать и не запускать в произвольном порядке.
7. Запустить `Minuta production health`, затем `Minuta safe release gate` в режиме `observe-production` на 30–60 минут.

На Free Plan штатные копии Supabase недоступны. Исключение допускается только для миграции, которая не меняет таблицы и данные: сохранить точное определение изменяемой функции и ACL, записать количества и хеши идентификаторов, выполнить новую функцию внутри транзакции с `ROLLBACK`, затем применить её и повторно сверить показатели. Для любых изменений таблиц или данных эта замена резервной копии запрещена.

## Мониторинг

Workflow `.github/workflows/minuta-production-health.yml` каждые пять минут проверяет (до трёх попыток с паузой 20 секунд, чтобы краткий сетевой сбой не создавал ложную тревогу):

- доступность страниц клиента, кабинета и управления записью;
- загрузку всех JavaScript, CSS и локальных изображений, на которые ссылаются страницы;
- чтение активной услуги из Supabase;
- доступность публичных таблиц карточек и фотографий портфолио;
- ответы RPC свободных окон и управления записью;
- доступность сервиса входа Supabase, версию опубликованных ресурсов и наличие шестипараметровой RPC `v43` без вызова SQL-функции и без создания записи.

Проверка ничего не записывает в базу: сигнатура `v43` проверяется заведомо невалидным UUID, который PostgREST отклоняет при приведении типа до выполнения функции. Конфигурация Supabase читается с опубликованного `config.js`, поэтому мониторинг проверяет именно тот проект, к которому подключён рабочий сайт. Для Telegram-уведомлений добавить в GitHub Actions secrets:

- `TELEGRAM_BOT_TOKEN` — токен отдельного бота мониторинга;
- `TELEGRAM_CHAT_ID` — идентификатор личного чата или служебной группы.

Без этих секретов проверка всё равно работает, но при сбое уведомление только фиксируется в журнале GitHub Actions.

## Зашифрованные резервные копии

Workflow `.github/workflows/minuta-supabase-backup.yml` ежедневно создаёт дамп PostgreSQL, проверяет его оглавление, шифрует OpenPGP/AES-256, выполняет контрольную расшифровку и побайтное сравнение. Основная копия, её SHA-256 и JSON-журнал успешности сохраняются вне репозитория в S3-совместимом хранилище. Для каждого объекта workflow требует Object Lock в режиме `COMPLIANCE` минимум на 30 дней и после загрузки проверяет размер и дату удержания через `head-object`. В GitHub Actions дополнительно хранится вторичная зашифрованная копия 35 дней. Незашифрованные файлы существуют только во временной папке runner и удаляются до завершения job.

Нужны secrets:

- `SUPABASE_DB_URL` — строка подключения с правом чтения сохраняемых схем;
- `BACKUP_ENCRYPTION_PASSWORD` — отдельный пароль длиной не менее 24 символов, второй экземпляр которого хранится вне GitHub;
- `MINUTA_BACKUP_S3_ENDPOINT`, `MINUTA_BACKUP_S3_BUCKET`, `MINUTA_BACKUP_S3_REGION` — параметры отдельного S3-совместимого хранилища;
- `MINUTA_BACKUP_S3_ACCESS_KEY_ID`, `MINUTA_BACKUP_S3_SECRET_ACCESS_KEY` — ключ с доступом только к backup-bucket;
- опционально `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — уведомление при неуспешном job.

Bucket нужно создать с включёнными Versioning и Object Lock. Отключать Object Lock ради успешного запуска запрещено: отсутствие поддержки неизменяемого срока считается ошибкой копирования. Рекомендуемые repository variables:

- `MINUTA_BACKUP_S3_PREFIX=minuta`;
- `MINUTA_BACKUP_RETENTION_DAYS=35` — защитный скрипт не принимает значение меньше 30;
- `MINUTA_BACKUPS_ENABLED=true` — включать только после успешного ручного запуска.

Успешный запуск создаёт неизменяемые записи `journal/YYYY/MM/minuta-....json` с SHA-256, размером, числом объектов архива, сроком удержания и ссылкой на GitHub Actions. Отсутствие новой записи за сутки означает сбой, даже если старый artifact ещё доступен.

### Ежемесячная проверка восстановления

Workflow `.github/workflows/minuta-supabase-restore-drill.yml` первого числа каждого месяца берёт последнюю копию из внешнего хранилища, требует, чтобы она была не старше 48 часов, сверяет SHA-256, расшифровывает архив и восстанавливает его только в отдельный тестовый проект. Перед `pg_restore --clean` одновременно проверяются разные project ref, разные строки подключения, точная фраза-разрешение и защищённый маркер внутри тестовой базы.

Один раз создать маркер именно в выделенной базе для учебного восстановления:

```sql
create schema if not exists minuta_restore_guard;
revoke all on schema minuta_restore_guard from public, anon, authenticated;
create table if not exists minuta_restore_guard.target (
  project_ref text primary key,
  allow_destructive_restore boolean not null default false
);
insert into minuta_restore_guard.target(project_ref, allow_destructive_restore)
values ('TEST_PROJECT_REF', true)
on conflict (project_ref) do update
set allow_destructive_restore = excluded.allow_destructive_restore;
```

Для drill добавить secret `MINUTA_RESTORE_TEST_DB_URL` и variables:

- `MINUTA_PRODUCTION_PROJECT_REF` — ref рабочего Supabase;
- `MINUTA_RESTORE_TEST_PROJECT_REF` — другой ref выделенного тестового Supabase;
- `MINUTA_RESTORE_CONFIRM=RESTORE_ONLY_ISOLATED_TEST_DATABASE`;
- `MINUTA_RESTORE_DRILL_ENABLED=true` — только после успешного ручного drill.

После восстановления workflow требует наличие таблиц `public.services` и `public.bookings`, минимум одной услуги, записывает количество записей и сохраняет неизменяемый журнал `restore-journal/...` на 365 дней. Если любой guard не проходит, восстановление не начинается.

Потеря `BACKUP_ENCRYPTION_PASSWORD` делает копии невосстановимыми. Смена пароля не расшифровывает старые artifacts, поэтому прежний пароль нужно хранить до истечения их срока.

Скачанный artifact сначала расшифровать и проверить локально, затем восстановить только в отдельную пустую тестовую базу:

```bash
printf '%s' "$BACKUP_ENCRYPTION_PASSWORD" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --output minuta.dump --decrypt minuta-....dump.gpg
pg_restore --list minuta.dump >/dev/null
pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges --dbname="$MINUTA_RESTORE_TEST_DB_URL" minuta.dump
```

Не указывать рабочую базу в `MINUTA_RESTORE_TEST_DB_URL`. Ручное восстановление выполняется по инструкции [RECOVERY.md](RECOVERY.md). Пароль шифрования хранится отдельно от GitHub и S3.

Этот workflow сохраняет только PostgreSQL. Фотографии портфолио находятся в Supabase Storage: `pg_dump` сохранит их метаданные, но не содержимое. Перед активным использованием портфолио нужно настроить отдельное ежедневное копирование объектов bucket `portfolio-images` во внешнее хранилище с версионированием и ежемесячно проверять восстановление одной фотографии вместе с её строками `portfolio_items` и `portfolio_photos`.

## Конкурентный интеграционный тест

Workflow `.github/workflows/minuta-booking-integration.yml` запускается только вручную и только против отдельного Supabase-проекта. Скрипт:

- восемь раз одновременно повторяет одну логическую запись и требует один общий код и токен;
- отправляет восемь разных запросов на одно окно и требует ровно одну успешную запись;
- удаляет созданные тестовые записи через service-role ключ в блоке очистки;
- жёстко отказывается работать с текущим рабочим доменом Supabase.

Нужны secrets `MINUTA_TEST_SUPABASE_URL`, `MINUTA_TEST_ANON_KEY`, `MINUTA_TEST_SERVICE_ROLE_KEY`, `MINUTA_TEST_SERVICE_ID`, `MINUTA_TEST_PROJECT_REF`. Service-role ключ и project ref должны принадлежать только тестовому проекту.

## Реакция на сбой

1. Не перезапускать миграции и не менять данные до определения слоя сбоя: GitHub Pages, статические ресурсы или Supabase RPC.
2. Запустить `node minuta-online-booking/production-health-check.mjs` локально и сравнить результат с журналом workflow.
3. При сбое после выпуска вернуть предыдущий фронтенд. Расширяющие миграции `v43`–`v47` назад не откатывать; ошибку схемы исправлять следующей совместимой миграцией.
4. После исправления прогнать smoke test, интеграционный тест на тестовом проекте и production health.
