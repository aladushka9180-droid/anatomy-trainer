# Eldion Pro — общий период статистики v1061

## Цель
Довести согласованный критерий общего периода статистики до живой приёмки: один диапазон для Обзора, Денег, остальных вкладок и детализаций, включая импортированные визиты и операции до первого визита. Основной аудит70/84, осталось14; исходные дополнительныеUI4/4. Статистика3/4, последний критерий пока открыт; новые UI не повышают основной счёт без его критериев.

## Сделано
На свежем main2474f254 (v1060) ROOT интегрировал67add75a+7e240ceb; общий provider hook принадлежит ROOT18549. Подтверждённые финансовые границы передаются общему reportRange; ранние импортированные визиты сохраняются. Контекст actor/session/source/org/role/master/end и pending/stale/reset защищён, неизвестная история не выдаётся за полную. Версии HTML/provider/precache/cache/site-update согласованы1061. Нет SQL, новых данных, платежей или сообщений.

## Проверено
ROOT независимо прочитал runtime и причинные regression: propagation28/28 (прежнее дерево20FAIL), shared6/6, прежние allbounds20/20 и scenarios7/7. На итоговом дереве PASS finance static3, provider/UI browser, auditUI/loader browser, startup63files3795980bytes в прежнем budget3799094 и isolated realSW1060→1061/offline exactbytes. Browser overview390/760/1440 PASS после exactf7ae8caf fixture reportTodayIso, прежниеassertions сохранены; причинныйREDpageerror записан отдельно. Итог15scopedgates и syntax3/3/diffPASS.

## Текущий этап
Own branch codex/statistics-v1061. ROOT единственный shared/versions/CI/main/Pro publisher/browser владелец. Кандидат пока не опубликован, live остаётся1060/statistics3/4. retention_delta Sol/high передал исправленный fixture и завершён. organization_review Sol/high передал read-only calendar restore recipe и завершён. Непроверенные prerequisites сохранены отдельными блокерами.

## Следующие шаги
ROOT fixture review/finalscopedPASS, freshmain, finalredirect передpush, exactPRCI/обычныйmerge/mainCI/Pages/точныеpublicbytes, затем индивидуальный live общийпериод390/760/1440 и детали/вкладки на существующих данных. Дополнительные role/physicalAndroid доказательства сохраняют ограничения.

## Зафиксированные решения
ROOT Astra/xhigh; до2исполнителей в отдельныхcopies/nonoverlap. v1060 уже опубликован и принят: stats3/4, отдельный portfolioCSSfix1/1. Исходное portfolio3/6, Org/Hours/Retention5/11, payment/resources/benefits/loyalty2/4 сохраняются. Native CI и остальные gates не ослаблять; повторять только затронутое после изменений.

## Ограничения и блокеры
Calendar0/2 и client live0/2 требуют свежей закрытой копии и полного actual applicable SupabasePG17/AuthStorage/roles/ACL restore, rollback/cleanup/ROOT до двух условно разрешённых функций. Private logical-v2/bridge интегрированы, но actualrestore не выполнен. Exportv191 не повторять. Старые no-owner/auth-placeholders/frozenexportdrill не являются fullrestore. После authentication_failed неизменныйsecret не повторять. Реальные данные/платежи/сообщения/секреты/доступы/удаление/productionrestore отдельно gated. IsolatedPWA не physicalAndroid. Goal неcomplete, heartbeatACTIVE; чужие изменения/отказы обязательных проверок сохранять.

