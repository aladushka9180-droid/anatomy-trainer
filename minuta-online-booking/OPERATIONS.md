# Эксплуатация Minuta

## Безопасный порядок выпуска версии 47

1. Сделать резервную копию базы или убедиться, что последняя ежедневная копия успешно создана.
2. В SQL Editor рабочего проекта Supabase последовательно применить отсутствующие миграции до `supabase-migration-v45.sql` включительно. `v45` добавляет таблицы и политики портфолио, закрытый bucket `portfolio-images` и RPC изменения порядка; существующие услуги и записи не меняет.
3. Настроить защитный маркер отдельной тестовой базы по [SAFE_RELEASE.md](SAFE_RELEASE.md), запустить `Minuta safe release gate` в режиме `test-migration` и проверить v46–v47 только там.
4. Дождаться успешного `Minuta booking integration test`. До production не применять v46 без Telegram-секретов и не применять v47 до выбора платёжного провайдера и sandbox-проверки.
5. Опубликовать совместимый фронтенд версии 47: при отсутствии v46 панель серверной очереди скрыта, ручной WhatsApp продолжает работать.
6. Запустить `Minuta production health`, затем `Minuta safe release gate` в режиме `observe-production` на 30–60 минут.

Если миграция `v45` ещё не применена, публикация останавливается: портфолио зависит от этой схемы.

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
