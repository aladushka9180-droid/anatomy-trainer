# D03: offline preflight для managed Auth и Storage

Этот набор файлов ничего не восстанавливает и не подключается к Supabase. Он
проверяет подготовленные в защищённом временном каталоге доказательства перед
отдельным управляемым restore drill. Успешный журнал означает только, что
offline-контракт выполнен; непосредственно перед первой внешней записью цель
нужно проверить повторно.

## Обязательная изоляция

- Цель — новый одноразовый recovery-проект. Project ref цели не совпадает ни с
  production, ни с общей migration/CRM test-базой.
- У цели нет активных задач и неизвестных данных. Допустимы только пустая цель
  либо ресурсы текущего запуска с префиксом `primetime-d03-<runId>-`, полностью
  перечисленные в fixture allowlist.
- В отдельном guard для текущего запуска присутствует ровно одна строка с
  project ref, purpose `disposable-d03-recovery`, SHA-256 одноразового nonce,
  отдельными разрешениями Auth, Storage и cleanup и сроком не более 24 часов.
- В offline-процесс не передаются URL баз, service-role ключи, access tokens,
  пароль backup или S3/AWS credentials. Скрипт завершится отказом, если увидит
  такие переменные окружения.

## Входные файлы

1. `authorization.json`: run ID, точный commit SHA, SHA-256 nonce, три разных
   project ref и четыре точные opt-in фразы из
   `d03-managed-recovery-contract.json`.
2. `target-report.json`: сформированный доверенным read-only preflight отчёт,
   наблюдение не старше 15 минут, workflow/commit/collector provenance,
   доказательства read-only DB/Auth/Storage, connection identity, guard и
   агрегированная инвентаризация. Нельзя создавать его вручную из предположений.
3. `auth-export.json`: только `users`, `identities`, `mfaFactors` и необходимые
   `tenantLinks` по allowlist из `d03-auth-storage-contract.json`. Sessions,
   refresh/one-time tokens, MFA challenges, password hashes, OTP, secrets и
   credential-поля запрещены. MFA-факторы допускаются только `unverified`.
4. `storage-export.json` и каталог `objects`: buckets, политики, object metadata
   и сами байты. Каждый обычный файл должен находиться внутри каталога; symlink
   и выход через `..` запрещены.

Target report должен быть получен под `BEGIN READ ONLY` и включать только числа,
не строки записей. Минимальная инвентаризация: business rows; users, identities,
MFA factors, sessions, refresh tokens, one-time tokens и MFA challenges; buckets,
objects и суммарные байты. Отдельно read-only API-проверка подтверждает отсутствие
активных Auth/Storage операций. Любой неизвестный ресурс блокирует продолжение.

## Запуск

Запускать только в приватном временном каталоге с пустым окружением внешних
секретов:

```text
node minuta-online-booking/scripts/d03-managed-recovery-preflight.mjs preflight \
  authorization.json target-report.json auth-export.json storage-export.json \
  objects storage-manifest.json redacted-journal.json
```

Оба выходных файла создаются эксклюзивно и никогда не перезаписываются.
`storage-manifest.json` содержит object metadata, размер и SHA-256 каждого файла;
это приватный артефакт восстановления. `redacted-journal.json` содержит только
счётчики, агрегированные хеши и доказательства отсутствия записей.

## Внешний managed drill после успешного offline preflight

1. В защищённом GitHub environment с ручным approval заново подтвердить свежий
   backup и точный release SHA, project ref/connection identity, guard, пустоту
   цели, отсутствие активных задач и отсутствие совпадений Auth IDs/providers,
   bucket IDs и object paths.
2. Использовать отдельные target-only DB/Auth/Storage credentials. Production
   credentials разрешены только read-only export-задаче и не передаются restore.
3. Импортировать Auth поддерживаемым провайдером способом только по allowlist.
   Пароли и активные сессии не переносить; для тестовой личности создать новый
   пароль внутри recovery-проекта, MFA пройти заново.
4. Восстановить buckets и политики, затем файлы без `upsert` и overwrite.
   Немедленно сверить размер и SHA-256 каждого объекта с приватным manifest.
5. Проверить вход тестовой личности, tenant ACL/RLS, запрет чужих данных,
   скачивание выборки файлов и отсутствие записей в production/shared test.
6. Создать обезличенный журнал с run IDs, counts и hashes. Не включать email,
   phone, user/provider/organization IDs, object paths, секреты или полные URL.
7. Удалить одноразовый recovery-проект, проверить отсутствие цели и уничтожить
   временные plaintext export/manifest. Если cleanup не подтверждён, drill нельзя
   считать завершённым.

Нельзя использовать общий `MINUTA_TEST_PROJECT_REF`: в нём уже выполняются
миграционные и CRM-тесты, поэтому его содержимое не является одноразовым D03
контуром.
