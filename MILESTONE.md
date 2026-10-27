# Eldion Pro — индивидуальный тариф визита

## Цель
Реализовать согласованную цену минуты конкретного визита с сохранением пяти исходных критериев. В целевой среде выполнено 0 из 5; осталось 5. Текущий независимый этап: структурный frozen CREATE/SERIES/history DTO поверх общего расчёта и проверенного Source scheduled-edit v197; managed CREATE writer остаётся открытым.

## Сделано
Принят выбранный Source item PRO_VISIT_TERMS_ATOMIC_CREATE_SERIES_HISTORY_SOURCE_NEXT_20261028 в рамках прежнего поручения человека, без новой operational authority. Добавлен pure creation envelope с прежним canonical, стабильным root/occurrence mapping, exact primary/session/revision DTO predicate и JSON restore. Нет нового retry owner, storage или wiring форм. Отдельный документ: docs/qa/PRO_VISIT_CREATE_CONTRACT.md.
Создан отдельный worktree и ветка codex/pro-visit-terms-20261028-r1 от свежего origin/main 68feda8c8. Модуль расчёта и снимка с JSON черновика/очереди и совместимым fingerprint сохранён в draft PR136. Добавлены Source v197 read/CAS-edit RPC, отдельные immutable receipts, exact primary/session revision, расширение CHECK ревизии до одной минуты, guarded pre-write rollback и отдельный PostgreSQL17 CI. Старые RPC, формы и общая композиция PR134 сохранены. Единственный владелец интеграции/выпуска — КААРДИНАТОР для мастеров 2.

## Проверено
Новая Source-дельта: 11 адресных групп PASS. Независимое review нашло два P2 (унаследованный/неизвестный receipt shape и sparse arrays); два regression воспроизвели 9PASS/2FAIL до исправления, после closed own-data/plain-object и dense-array guards все11 PASS. Результат повторного review — PASS_SOURCE_ONLY, без открытых findings. Прежние Source197/16+4/CI15 на head5751af8f не менялись и не запускались повторно. Конкретный текущий CI head хранится в реестре координатора.
Прочитаны AGENTS.md, прежний MILESTONE, исходные требования и план интеграции тарифа; origin/main подтверждён прежним. В предыдущем head 8 pure-групп и 13 CI checks прошли. Новый Source-контракт: 10 PGlite-групп PASS (exact ноль/мин1, add-ons, retry/CAS, late revision, transactional failure, scope/bounds, каталог/lineage), rollback6/6 PASS. Три P2 независимого review исправлены: полная primary metadata, NOWAIT против lock inversion v156, A→B→A не возрождает receipt; четвёртый P2 — defaults/constraints/index drift отката — также закрыт с regression. Повторное review без открытых findings. Четыре native PostgreSQL17 проверки включены в отдельный workflow; результаты конкретного head проверяются по PR136 и сохраняются координатором отдельно от кода. Рабочие данные и backend не использовались.

## Текущий этап
В draft PR136 подготовлены Source edit197 и новый структурный creation/series/history контракт. Новая дельта не является atomic SQL CREATE или whole-stand Supabase квалификацией. Формы/provider.js/CORE не менялись; actual browser/PWA и целевая приёмка остаются 0/5.

## Следующие шаги
Сохранять результаты конкретных review/CI и следующую границу в каноническом реестре координатора. Для managed CREATE нужны current provider6/trigger/permissions/whole-state входы и защищённые original full-copy/restore/SQL ворота; публичные v44/v131/v79 их не заменяют. Затем реализовать один atomic create/series/history writer и один-snapshot wiring без новых UNKNOWN/request IDs, интегрировать, выпустить и пройти все пять целевых критериев. Новый pure envelope не выдаётся за выполнение всего Source item.

## Зафиксированные решения
Пять целевых критериев: (1) создание/редактирование, итог и окончание, (2) exact сохранение и загрузка тарифа/длительности/суммы, (3) черновик/повтор/серия/прошлый визит/offline без потери и дублей, (4) интеграция/CI/публикация/390–760–1440, (5) настоящий кабинет и установленное приложение. Целочисленные рубли; начальная ставка из настоящей услуги; одна минута/ноль точные. Смена услуги берёт цену новой услуги — прямой ответ пользователя. Повтор/серия копируют исходную ставку с явным последующим редактированием — обратимое решение координатора по standing safechoice, не прямой ответ на второй вопрос. UNKNOWN не становится успехом. Source v197 ограничен редактированием; после первой receipt или min1 revision автоматический rollback запрещён ради сохранности данных.

## Ограничения и блокеры
Полная исходная копия 1/3 и рабочая приёмка PR134 0/9 остаются отдельными воротами. V197 не применён; full current managed state/trigger/restore квалификация, create/series/history и UI интеграция отсутствуют. Старые once/HOLD/capture и закрытую R48 не запускать. Рабочие данные, Auth/Storage, SQL, отправки, оплаты и публикация этим Source-этапом не затрагиваются.
