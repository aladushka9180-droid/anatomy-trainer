import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(html, /id="saveSchedule"[^>]*hidden disabled/, 'Кнопка сохранения должна быть скрыта без изменений');
assert.match(html, /id="scheduleSaveState"[^>]*hidden>Сохранено</, 'Статус сохранения должен быть скрыт в спокойном состоянии');
assert.match(html, /<details class="schedule-week-editor" id="scheduleWeekEditor" open>/, 'Обычная неделя должна быть раскрыта по умолчанию');
assert.match(html, /<details class="weekly-schedule-details" id="weeklyScheduleDetails">/, 'Подробные дни недели не свёрнуты');
assert.match(html, /id="weeklyScheduleSummary"/, 'Нет краткой сводки недельного графика');
assert.match(html, /Применить часы/, 'Основное действие быстрой настройки названо неоднозначно');
assert.match(html, /<details class="schedule-date-editor" id="monthlyScheduleEditor">/, 'Изменения по датам не свёрнуты по умолчанию');
assert.match(html, /id="dateExceptionsSummary">Исключений нет</, 'Нет краткого количества изменений по датам');
assert.match(html, /<div class="day-off-editor day-off-editor-inline" id="dayOffEditor" hidden>/, 'Форма частичного закрытия не должна дублировать основное действие');
assert.doesNotMatch(html, /Закрыть день или часть времени/, 'Дублирующее действие частичного закрытия осталось в интерфейсе');
assert.match(html, /class="schedule-disclosure-control"[^>]*><b><\/b>/, 'У сворачиваемых блоков нет понятной подписи состояния');
assert.match(html, /<details class="schedule-help-disclosure">[\s\S]*aria-label="Как формируется доступность">\?/, 'Техническое объяснение не спрятано под справкой');
assert.doesNotMatch(html, /class="panel days-off-panel"/, 'Исключения дублируются отдельной панелью');

assert.match(provider, /function updateWeeklyScheduleSummary\(/, 'Краткая сводка графика не обновляется');
assert.match(provider, /function setScheduleDirty\(value = true\)/, 'Нет единого состояния несохранённых изменений');
assert.match(provider, /button\.disabled = busy \|\| !writesAllowed \|\| !scheduleDirty/, 'Кнопка сохранения не учитывает доступ и изменения');
assert.match(provider, /button\.hidden = !busy && \(!writesAllowed \|\| !scheduleDirty\)/, 'Кнопка сохранения не скрывается без изменений');
assert.match(provider, /status\.hidden = !busy && writesAllowed && !scheduleDirty/, 'Спокойное состояние сохранения создаёт лишний визуальный шум');
assert.match(provider, /if \(status\.textContent !== nextText\) status\.textContent = nextText/, 'Статус сохранения повторно изменяет DOM и может зациклить MutationObserver');
assert.match(provider, /function setScheduleSaveError\(/, 'Ошибки сохранения не имеют отдельного состояния');
assert.match(provider, /Изменено на другом устройстве/, 'Нет понятного сообщения о конфликте параллельных изменений');
assert.match(provider, /<strong>\$\{day\}<\/strong><i aria-hidden="true"><\/i><span class="sr-only">\$\{status\}<\/span>/, 'Ячейки месяца должны показывать статус точкой, сохраняя доступность для скринридера');
assert.doesNotMatch(provider, /<strong>\$\{day\}<\/strong><small>\$\{status\}<\/small>/, 'В каждой дате повторяется лишняя подпись статуса');
assert.match(provider, /\$\('#dayOffEditor'\)\.hidden = false/, 'Переход к частичному закрытию не показывает форму');
assert.match(provider, /\$\('#dayOffEditor'\)\.hidden = true/, 'Форма исключения не скрывается после завершения действия');
assert.match(provider, /data-monthly-schedule-action="restore"/, 'Нет действия возврата к обычному графику');
assert.match(provider, /function restoreMonthlyScheduleDate\(/, 'Возврат к обычному графику не реализован');
assert.match(provider, /summary\.textContent = count \?/, 'Количество изменений по датам не обновляется');
assert.match(provider, /class="days-off-empty"/, 'Пустой список исключений всё ещё занимает большую карточку');

assert.match(styles, /\.schedule-settings-layout \{[^}]*grid-template-columns:minmax\(0,1040px\)[^}]*max-width:1040px/, 'Раздел не собран в одну читаемую колонку');
assert.match(styles, /\.monthly-schedule-day \{[^}]*min-height:44px/, 'Даты месяца имеют маленькую область касания');
assert.match(styles, /\.monthly-schedule-day>i \{[^}]*border-radius:50%/, 'Статус даты не представлен компактной точкой');
assert.match(styles, /\.schedule-quick-setup \{[^}]*border:0[^}]*background:transparent/, 'Быстрая настройка сохраняет лишнюю вложенную карточку');
assert.match(styles, /\.weekly-schedule-details>summary[^}]*min-height:48px/, 'Свёрнутая недельная сводка не имеет компактного управления');
assert.match(styles, /\.days-off-empty \{[^}]*padding:11px 2px 0/, 'Пустое состояние исключений осталось слишком большим');
assert.match(styles, /\.schedule-quick-presets button \{[^}]*min-height:44px/, 'Шаблоны недели имеют маленькую область касания');
assert.match(styles, /\.schedule-help-disclosure>summary \{[^}]*width:44px[^}]*height:44px/, 'Справка имеет маленькую область касания');
assert.match(styles, /@media \(max-width:980px\)[\s\S]*\.monthly-schedule-day \{ min-height:44px/, 'Даты месяца имеют маленькую область касания на телефоне');
assert.match(styles, /\.provider-view\[data-provider-panel="schedule"\] #saveSchedule \{[^}]*position:fixed[^}]*bottom:calc\(82px/, 'Сохранение не остаётся доступным над мобильной навигацией');
assert.match(styles, /var\(--theme-(?:line|surface|accent|muted|ink)/, 'Новые элементы не наследуют выбранную тему');

console.log('Schedule UX checks passed.');
