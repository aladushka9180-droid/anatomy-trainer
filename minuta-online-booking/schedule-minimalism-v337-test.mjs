import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(html, /id="saveSchedule"[^>]*disabled/, 'Кнопка сохранения должна быть неактивна без изменений');
assert.match(html, /id="scheduleSaveState"[^>]*>Сохранено</, 'Нет короткого состояния сохранения');
assert.match(html, /<details class="weekly-schedule-details" id="weeklyScheduleDetails">/, 'Подробные дни недели не свёрнуты');
assert.match(html, /id="weeklyScheduleSummary"/, 'Нет краткой сводки недельного графика');
assert.match(html, /<details class="day-off-editor" id="dayOffEditor">/, 'Форма исключения не свёрнута');

assert.match(provider, /function updateWeeklyScheduleSummary\(/, 'Краткая сводка графика не обновляется');
assert.match(provider, /function setScheduleDirty\(value = true\)/, 'Нет единого состояния несохранённых изменений');
assert.match(provider, /button\.disabled = busy \|\| !writesAllowed \|\| !scheduleDirty/, 'Кнопка сохранения не учитывает доступ и изменения');
assert.match(provider, /if \(status\.textContent !== nextText\) status\.textContent = nextText/, 'Статус сохранения повторно изменяет DOM и может зациклить MutationObserver');
assert.match(provider, /<strong>\$\{day\}<\/strong><i aria-hidden="true"><\/i><span class="sr-only">\$\{status\}<\/span>/, 'Ячейки месяца должны показывать статус точкой, сохраняя доступность для скринридера');
assert.doesNotMatch(provider, /<strong>\$\{day\}<\/strong><small>\$\{status\}<\/small>/, 'В каждой дате повторяется лишняя подпись статуса');
assert.match(provider, /\$\('#dayOffEditor'\)\.open = true/, 'Переход к частичному закрытию не раскрывает форму');
assert.match(provider, /\$\('#dayOffEditor'\)\.open = false/, 'Успешно добавленная форма исключения не сворачивается');
assert.match(provider, /class="days-off-empty"/, 'Пустой список исключений всё ещё занимает большую карточку');

assert.match(styles, /\.monthly-schedule-day \{[^}]*min-height:44px/, 'Даты месяца всё ещё слишком высокие');
assert.match(styles, /\.monthly-schedule-day>i \{[^}]*border-radius:50%/, 'Статус даты не представлен компактной точкой');
assert.match(styles, /\.schedule-quick-setup \{[^}]*border-block:1px[^}]*background:transparent/, 'Быстрая настройка сохраняет лишнюю вложенную карточку');
assert.match(styles, /\.weekly-schedule-details>summary[^}]*min-height:48px/, 'Свёрнутая недельная сводка не имеет компактного управления');
assert.match(styles, /\.days-off-empty \{[^}]*padding:11px 2px 0/, 'Пустое состояние исключений осталось слишком большим');
assert.match(styles, /@media \(max-width:440px\)[\s\S]*\.monthly-schedule-day \{ min-height:42px/, 'Месячный график не уплотнён на телефоне');
assert.match(styles, /var\(--theme-(?:line|surface|accent|muted|ink)/, 'Новые элементы не наследуют выбранную тему');

console.log('Schedule minimalism v337 checks passed.');
