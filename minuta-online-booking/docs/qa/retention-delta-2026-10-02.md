# Возврат клиентов — кандидат новой дельты

Основа: `cb17f0cf24b621f1307be166559371c9bd6306b0` (принятый v1055). Исполнитель владеет только retention controller, новым scoped CSS и соответствующими isolated tests/docs. ROOT единолично интегрирует, назначает версии и публикует. На рабочем сайте выполнено 0 из 4; осталось 4.

## Реализовано

- Подписи 45/90 точно обозначают последний завершённый визит и последнюю ручную отметку отправки. Сохранение сообщает успех только после подтверждения RPC; debounce/confirmation/owner-admin правила сохранены.
- Выбор только eligible клиентов без существующего prepared-delivery; select-all с indeterminate, счётчик, одно основное действие с числом и склонением. Обычное чтение/повтор того же scope сохраняет выбор с отсечением по свежим данным. Actor/org/role/session change очищает выбор и временные тексты.
- Общий runner держит один activeWrite/writing token на всю последовательность; mutate(single) сохранён как обёртка. Перед каждым RPC проверяет requireWrites, tenant, роль и текущую actor/session/revision. Ошибка/unknown/stale прекращают остаток; authoritative workspace перечитывается. Подтверждённые фактические тексты при read error доступны только в прежнем scope, с копированием и без действий записи; успешное чтение снова источник истины.
- Clipboard получает полный message_snapshot. «Скопировано» появляется только после fulfilled и актуального scope; rejection даёт повтор, метка сбрасывается через 2,5 секунды. Copy не вызывает finish/sent. Согласие, WhatsApp, ручная отметка и отмена остаются второстепенными действиями.
- Desktop preview открыт сразу справа. Клиенты и подготовленные сообщения идут последовательно на всю ширину. Контурные glyphs взяты из текущего ui-icons; короткие заголовки и фактические счётчики. Scoped CSS не затрагивает соседние панели.

## Проверено изолированно

`tests/retention-delta-browser-test.mjs`: 14 сценариев в native DOM, реальные клики на synthetic данных, все внешние запросы блокируются. 390/760/1440: 2 из 3 → 2 последовательных prepare → 2 новых snapshots, третий доступен; prepared/ineligible/consent сохранены; double-click; полный URL; pending/fulfilled/rejected/retry/reset clipboard; ручные disclosures; сохранение фокуса; desktop preview; последовательная композиция; без overflow и перекрытия соседних блоков.

Edge proof: partial failure третьего из четырёх + read failure сохраняет два acknowledged snapshots, не вызывает четвёртый RPC; восстановление сохраняет оставшиеся выбранные. Unknown второго prepare перечитывает его фактический draft, retry его не пересоздаёт. Organization/session/actor/role/write availability непосредственно перед вторым RPC останавливают пачку; pending organization применяется одним чтением. Scope change не объявляет clipboard успех старой сессии. Пустые/ineligible данные и пустой factual snapshot не создают ложного копирования. Saving/Saved/Error проверены с удержанным ответом, успешным ответом и сбоем RPC; параметры 45/90 сохранены.

Ближайшие проверки: retention-context-recovery 31/31; commerce-soft helper 5/5; A10 390/760/1440; native context recovery 10/10; retention-v83-static; client-url-redirect. Изменённые A10/context browser selectors соответствуют новому выбору+batch, прежняя семантика проверок сохранена. Исходный 31-case VM fixture и SQL не менялись.

Артефакты исполнителя: `outputs/retention-next/{CHECKS.json,fixture.html,retention-390.png,retention-760.png,retention-1440.png}` в чате координатора. Это synthetic proof, а не production acceptance. Визуально просмотрены все три ширины: текущая внутренняя оценка 8/10 по ясности, скорости, иерархии, компактности и соответствию основе. Авторизованный живой экран/реальные ресурсы и UI в целевой среде принимает ROOT.

## Следующий шаг ROOT

Подключить `retention-soft-ui.css` после `commerce-soft-ui.css` в provider HTML и включить в соответствующий precache; согласовать version query для lazy `retention-management.js`, обновить общий SW/site-update. Shared файлы, SQL и CI этим исполнителем не менялись. Для CI добавить новый browser gate рядом с существующими retention browser checks, используя тот же Playwright runtime/channel. На интегрированном дереве запустить целевые проверки и обязательный redirect, затем CI/Pages и целевой live экран.

Для live проверить реальные настройки и композицию без изменения рабочих данных. Нельзя создавать записи/согласия/сообщения ради доказательства. Если на рабочем экране нет подходящих тестовых данных, взаимодействия признаются доказанными только изолированно, live сценарий остаётся открытым gate. Никаких production RPC, SQL, внешних сообщений, секретов или публикации исполнителем не выполнено.
