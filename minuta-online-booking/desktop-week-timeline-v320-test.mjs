import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(provider, /function calendarWeekTimelineBounds[\s\S]*scheduleRows[\s\S]*duration_minutes/, 'Границы недельной шкалы не учитывают график и длительность записей');
assert.match(provider, /function calendarWeekTimelineMarkup[\s\S]*calendar-week-day-stage[\s\S]*calendar-week-timeline-grid/, 'Нет общего недельного таймлайна');
assert.match(provider, /calendar-week-booking[\s\S]*data-open-booking/, 'Записи недельного таймлайна нельзя открыть');
assert.match(provider, /calendar-week-mobile-list/, 'Для телефона не сохранён компактный список дней');
assert.match(styles, /\.calendar-week-timeline-grid \{[^}]*grid-template-columns:56px repeat\(7,minmax\(138px,1fr\)\)[^}]*min-width:1022px/, 'Колонки недели не получили адаптивную ширину');
assert.match(styles, /\.calendar-week-timeline \{[^}]*overflow-x:auto;[^}]*overflow-y:clip;[^}]*content-visibility:visible!important;[^}]*contain:none!important;/, 'Недельная сетка может получить лишнюю внутреннюю вертикальную прокрутку');
assert.match(styles, /\.calendar-week-day-stage \{[^}]*background-image:repeating-linear-gradient/, 'Нет единой временной сетки по дням');
assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.calendar-week-timeline \{ display:none; \}[\s\S]*\.calendar-week-mobile-list \{ display:grid; \}/, 'Мобильная версия не переключается на компактный список');
assert.match(styles, /data-provider-theme="luxury"[\s\S]*\.calendar-week-booking/, 'Недельная сетка не оформлена для темы Люкс');
assert.match(styles, /\.calendar-week-booking\.color-mint[\s\S]*\.calendar-week-booking\.status-no-show/, 'Цвета и статусы записей потеряны в недельном календаре');
assert.match(styles, /schedule-card:has\(#providerBookings\.calendar-overview\)[^}]*grid-template-columns:minmax\(0,1fr\)/, 'Компоновка Split сужает недельный календарь');

const stackSource = provider.match(/function stackWeekTimelineItems\(items, gap = 3\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(stackSource, 'Нет защиты коротких записей от визуального перекрытия');
const stackWeekTimelineItems = Function(`${stackSource}; return stackWeekTimelineItems;`)();
const shortItems = [0, 5, 15, 30].map((minute, index) => ({ top:minute * 1.1, visualTop:minute * 1.1, height:30, index }));
stackWeekTimelineItems(shortItems);
for (let index = 1; index < shortItems.length; index += 1) {
  assert.ok(shortItems[index].visualTop >= shortItems[index - 1].visualTop + shortItems[index - 1].height + 3, 'Короткие записи перекрываются и блокируют нажатия');
}

console.log('Desktop week timeline v365 checks passed.');
