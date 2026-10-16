# Eldion Pro — узкий интерфейс v1093

## Цель
Принять выбранные человеком левое выравнивание автоперерыва и округлый шеврон «Ещё 8 вариантов». ROOT — единственный владелец интеграции и выпуска.

## Сделано
На свежем main6fbc собраны только две CSS-правки: автоперерыв слева с прежним вертикальным центром и оформлением; точные два правила из PR123/ceb2f812 для нативного disclosure. SQL, расчёты и сохранение не менялись.

## Проверено
Автоперерыв: исправлено размещение candidate-style в учебной проверке после body-link; сохранён ordinary40 и добавлен отдельный ordinary60 oracle. Targeted synthetic PASS12 theme/width layouts,20/30/40/60/90мин, прежние fonts/icons/frames/ordinary40 точны; Root просмотрел390/760/1440. Это Source, не авторизованный рабочий экран. PR123 CSS принят по immutable Git, прежние Source20combination proof применяются только к этому exact optional-файлу.

## Текущий этап
Версии HTML/SW/site-update согласованы1093; финальные проверки, независимый peer и CI/публикация ещё впереди. COREcap3799094 сохранён.

## Следующие шаги
Affected redirect/startup/cache и finalpeer → штатные push/CI/merge/Pages → exact public readback. Затем рабочие UI/PWA по каждой правке отдельно.

## Зафиксированные решения
Общая48-path Source-сборка08e1acdc и SQL не входят в этот выпуск. Выбранная ранее Source typography14–16 сохраняется как отдельный обязательный пункт: main14px и approvedSource16px ещё требуют квалификации one-line fit; этот конфликт не скрывается и не блокирует независимые две CSS-правки.

## Ограничения и блокеры
Рабочая приёмка этих двух правок0/2. Установленная PWA и authenticatedBrowser не проверены. Полная DB/Auth/Storage копия и чтение1/3: каталог сохранён, R6spent1/1/HOLD, supported Auth/Storage barrier и same-copy restore/read открыты.
