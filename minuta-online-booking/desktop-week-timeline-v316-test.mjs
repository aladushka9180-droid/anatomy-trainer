import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(provider, /function calendarWeekTimelineBounds[\s\S]*scheduleRows[\s\S]*duration_minutes/, 'Границы недельной шкалы не учитывают график и длительность записей');
assert.match(provider, /function calendarWeekTimelineMarkup[\s\S]*calendar-week-day-stage[\s\S]*calendar-week-timeline-grid/, 'Нет общего недельного таймлайна');
assert.match(provider, /calendar-week-booking[\s\S]*data-open-booking/, 'Записи недельного таймлайна нельзя открыть');
assert.match(provider, /calendar-week-mobile-list/, 'Для телефона не сохранён компактный список дней');
assert.match(styles, /\.calendar-week-timeline-grid \{[^}]*grid-template-columns:64px repeat\(7,minmax\(150px,1fr\)\)[^}]*min-width:1114px/, 'Колонки недели не получили достаточную ширину');
assert.match(styles, /\.calendar-week-day-stage \{[^}]*background-image:repeating-linear-gradient/, 'Нет единой временной сетки по дням');
assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.calendar-week-timeline \{ display:none; \}[\s\S]*\.calendar-week-mobile-list \{ display:grid; \}/, 'Мобильная версия не переключается на компактный список');
assert.match(styles, /data-provider-theme="luxury"[\s\S]*\.calendar-week-booking/, 'Недельная сетка не оформлена для темы Люкс');

console.log('Desktop week timeline v316 checks passed.');
