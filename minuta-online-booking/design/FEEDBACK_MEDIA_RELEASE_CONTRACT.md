# Фото и видео обратной связи: контракт безопасного выпуска

Статус: локальный неподключённый frontend v3 и кандидат SQL v116, ожидает независимого QA и выпуска. Production не затронут. Номер проверен в основе d8e174ea (platform461), перед интеграцией проверить снова. Старый draft v2/v111 не используется как сервер. Существующие provider-feedback.js, HTML, CSS, main/cache не изменены этой веткой.

## Поведение формы

- Текстовый черновик живёт в sessionStorage не более суток, отдельно для пользователя и организации. Файлы не копируются в web-storage; при неизвестном результате сохраняется точный payload уже загруженных вложений.
- Только точная пара SQLSTATE/message первого атомарного отказа PostgreSQL снимает pending и возвращает редактирование текста/файлов. Отказ после предыдущего unknown не доказывает отсутствие первой записи. Неизвестный результат или неверный ACK не считаются успехом: lookup и повтор используют прежний request_id и точный payload.
- ACK содержит совпадающие request_id, organization_id и положительный номер обращения. Reset инвалидирует все старые ответы поколением, даже при возврате того же пользователя в ту же организацию.
- Без успешного сохранения pending в sessionStorage create RPC не вызывается. Необоснованные удаления Storage не выполняются. Предпросмотр только локальный, видео без autoplay.
- Сервер возвращает фактические проверенные лимиты. Значение 100 МБ старого черновика не обещается. Изображения декодируются и преобразуются существующим prepareScreenshot; MIME/расширение не означают антивирусную проверку.

## Локальный сервер v3 / v116 (не применён)

- Capability по умолчанию выключена. При включении: version=3, max_files=5, video_bytes=20971520, total_bytes=41943040. Private bucket — 20 МиБ, фото после преобразования — до 4 МиБ, общий запрос — до 40 МиБ. Включение только после release gates.
- reserve_minuta_feedback_upload_v3: actor/request/attachment UUID, имя/MIME/размер; идемпотентная резервация, точное сравнение повторного payload, сериализованный per-actor лимит по количеству и байтам. Путь actor/request/attachment.ext. Возвращает path и uploaded только после проверки Storage metadata. Это защищает от параллельного обхода квоты и позволяет восстановиться после потерянного upload ACK.
- Storage INSERT разрешён только для действующей собственной резервации; никаких browser UPDATE и удаления связанных файлов. Bucket приватный. Лимит bucket не должен превышать глобальный лимит проекта.
- create_minuta_feedback_media_v3 атомарно проверяет организацию/текст/лимиты, блокирует резервации, валидирует фактические metadata, создаёт обращение и связи. Повтор actor+request_id сверяет полный payload и возвращает тот же ACK. Несовпадение — отдельная ошибка, не ложный успех.
- get_my_minuta_feedback_request_v3 принимает request_id и точный payload, проверяет владельца/совпадение, возвращает null либо точный ACK. Старый legacy RPC не используется для повторов, поскольку у него нет идемпотентного контракта.
- Cleanup: сначала атомарно помечает просроченные несвязанные резервации, исключая одновременное создание обращения; затем удаляет только их через Storage API. Не удалять storage.objects через SQL. Связанные вложения и пользовательские обращения не удалять при rollback.
- Отдельный migration target v116, не latest: нельзя попутно применить чужие миграции. Operational rollback выключает capability, сохраняет обращения, ledger, медиа, общий daily-cap trigger, lookup/replay/release и cleanup. Reapply не включает флаг. Это НЕ мгновенная отмена уже начавшейся транзакции или передачи Storage: нужны остановка новых отправок, ожидание in-flight и сверка завершившихся операций. Удаление ledger/связанных файлов не входит в rollback.

## Общий лимит, снятие и блокировки

- Лимит 20 новых обращений за скользящие 24 часа на actor находится в BEFORE INSERT trigger product_feedback. Его проходят и неизменённый legacy v109 RPC, и media v3; сигнатура/ACK legacy сохранены, новый отказ — P0001:feedback_daily_limit. Media replay не INSERT-ит и не расходует лимит. Trigger также действует на privileged INSERT; доверенный администратор не является недоверенным клиентом.
- Actor advisory lock (`feedback-media:<actor>`) общий для trigger/reserve/create/release. Create/release далее берут reservation FOR UPDATE. Cleanup берёт только строки FOR UPDATE SKIP LOCKED, без actor lock. Storage INSERT RLS держит reservation FOR SHARE до окончания SQL INSERT.
- Create выиграл: linked; release=false, cleanup исключает файл даже после потерянного create ACK. Release выиграл: reserved→cleanup; create с этим файлом отклоняется до feedback INSERT. Release cleanup/deleted=true идемпотентно; linked/foreign/missing=false, lease при release не очищается.
- До резервации кнопка «Убрать из обращения» работает локально; после известного reserve ACK вызывает release(request_id,path). Только true удаляет карточку; false/throw/malformed сохраняют файл с честным сообщением. Pending unknown блокирует снятие. При потерянном reserve ACK неизвестный клиенту путь дожидается TTL cleanup.
- Claim выдаёт token на 15 минут для cleanup либо reserved старше 48 часов; повторный claim после lease меняет token, старый finish=false. Cleanup необратим для дальнейшего create/upload. SQL finish — trusted-worker API: отсутствие байтов сам не проверяет и Storage SQL DELETE не выполняет.
- Worker удаляет только точные claimed paths через Storage API, затем отдельно подтверждает отсутствие, затем вызывает finish(path,token). DELETE 200 недостаточно; 403/500/transport probe — failed, не deleted. Логи только агрегатные, без путей/токенов/ключей/сообщений.
- Квоты reserve: 20 новых резерваций за 24 часа, до 25 активных reserved/linked и 200 МиБ, до 5 файлов/40 МиБ на request. Связанные файлы остаются в активной квоте; изменение retention — отдельное решение, автоматического удаления обращений нет.
- SQL row locks не доказывают жизненный цикл Storage байтов вне SQL-транзакции: реальные upload/metadata/cleanup гонки остаются gate. sessionStorage не является межустройственным журналом; после очистки storage или истечения суток клиентский ключ теряется, хотя серверный ledger сохраняется. Нельзя обещать защиту нового обращения после такой потери.

## Локальные доказательства

- `tests/feedback-media-v116-pglite-test.mjs`: actual v109+v116 apply×2, роли/RLS, reserve/metadata/create/replay, mixed legacy/media cap, release/lease/rollback. In-memory PGlite, одно соединение, synthetic Storage tables — НЕ PostgreSQL multi-session и НЕ реальный Storage.
- `tests/feedback-media-cleanup-test.mjs`: worker с synthetic HTTP, точный path, независимая проверка отсутствия, ошибки и stale-token ACK. Никаких реальных удалений.
- `tests/feedback-media-browser-test.mjs`: actual candidate controller, native controls с synthetic HTML/RPC/Storage; double-submit отдельно использует synthetic dispatch. Не полная provider-форма и не production E2E.
- `.github/workflows/minuta-feedback-media.yml`: только изолированные проверки, без credentials, remote SQL/cleanup или включения capability. Отдельный synthetic PostgreSQL concurrency gate готовится владельцем QA; реальный Storage остаётся отдельным gate.

## Приёмка и публикация

Нужны: проверки конкурентных резервов/идемпотентности/ролей/чужих файлов и metadata на тестовой БД; реальные тестовые Storage upload/download/cleanup; сценарии обрыва сети и перезагрузки; мобильная форма. Затем свежий backup → test migration → rollback validation → закреплённый production SHA и отдельное подтверждение → read-only observation. Только после сервера подключить модуль и форму единым frontend-выпуском через владельца публикации.

Документация ограничений: https://supabase.com/docs/guides/storage/uploads/file-limits . Удаление только API: https://supabase.com/docs/guides/storage/management/delete-objects . Эти ссылки не подтверждают текущие настройки конкретного проекта.
