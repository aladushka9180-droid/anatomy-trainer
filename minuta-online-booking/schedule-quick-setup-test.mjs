import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

for (const id of ['scheduleQuickTitle', 'scheduleQuickStart', 'scheduleQuickEnd', 'scheduleQuickBreak', 'applyQuickSchedule', 'monthlyScheduleDetails']) {
  assert.match(html, new RegExp(`id="${id}"`), `В редакторе графика нет элемента ${id}`);
}

for (const preset of ['weekdays', 'six-days', 'daily', 'custom']) {
  assert.match(html, new RegExp(`data-schedule-quick-preset="${preset}"`), `Нет шаблона графика ${preset}`);
}

for (let weekday = 1; weekday <= 7; weekday += 1) {
  assert.match(html, new RegExp(`data-schedule-quick-day="${weekday}"`), `Нет выбора дня недели ${weekday}`);
}

assert.match(provider, /function applyQuickSchedule\(\)[\s\S]*setScheduleDirty\(true\);[\s\S]*Шаблон применён\. Сохраните изменения\./, 'Быстрый шаблон должен создавать проверяемый черновик, а не отдельное расписание');
assert.doesNotMatch(provider.match(/function applyQuickSchedule\(\)[\s\S]*?\n\}/)?.[0] || '', /db\./, 'Быстрый шаблон не должен сохраняться в обход основной кнопки');
assert.match(provider, /function scheduleRowsFromForm\(\)[\s\S]*slot_interval_minutes/, 'Предпросмотр и сохранение используют разные данные недельного графика');
assert.match(provider, /scheduleDirty \? scheduleRowsFromForm\(\) : scheduleRows/, 'Месяц не показывает ещё не сохранённый недельный черновик');

const monthGridHandler = provider.match(/#monthlyScheduleGrid'\)\.addEventListener\('click',[\s\S]*?\n\}\);/)?.[0] || '';
assert.match(monthGridHandler, /selectedMonthlyScheduleDate = button\.dataset\.monthlyScheduleDate/, 'Нажатие даты не открывает безопасный предпросмотр');
assert.doesNotMatch(monthGridHandler, /toggleMonthlyScheduleDay/, 'Нажатие даты по-прежнему сразу меняет данные');
assert.match(provider, /data-monthly-schedule-action="close"/, 'Нет явного подтверждения полного выходного');
assert.match(provider, /data-monthly-schedule-action="open"/, 'Нет явного подтверждения открытия даты');
assert.match(provider, /data-monthly-schedule-action="partial"/, 'Нет перехода к частичному закрытию дня');
assert.match(provider, /const bookingCount = allBookings\.filter/, 'Карточка даты считает записи не из актуального журнала');
assert.match(provider, /Записи сохранятся\. Изменится только доступность для новых клиентов\./, 'Не объяснено, что существующие записи сохраняются');
assert.match(html, /Обычная неделя → исключение на дату → смена сотрудника в филиале\./, 'Не объяснён порядок источников доступности');
assert.match(html, /data-provider-view="organization">График команды и филиалов/, 'График команды дублируется вместо ссылки на существующий раздел');

assert.match(styles, /\.schedule-quick-presets \{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, 'Шаблоны не собраны в компактную группу');
assert.match(styles, /\.schedule-quick-days \{[^}]*grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/, 'Дни недели не помещаются в одну понятную строку');
assert.match(styles, /\.monthly-schedule-day\.is-selected \{[^}]*outline:3px solid/, 'Выбранная дата не выделяется');
assert.match(styles, /@media \(max-width:980px\)[\s\S]*\.schedule-quick-presets \{ grid-template-columns:1fr 1fr; \}[\s\S]*\.monthly-schedule-details dl \{ grid-template-columns:1fr; \}/, 'Быстрый график и карточка даты не адаптированы для телефона');
assert.match(styles, /var\(--theme-accent/, 'Новые элементы не наследуют акцент выбранной темы');

console.log('Schedule quick setup checks passed.');
