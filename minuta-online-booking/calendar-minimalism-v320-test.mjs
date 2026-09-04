import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(provider, /const limit = view === 'month' \? 2 : items\.length/, 'Месяц показывает слишком много записей внутри одной даты');
assert.match(provider, /class="calendar-overview-count">\$\{escapeHtml\(monthCount\)\}/, 'В мобильном месяце нет краткого счётчика записей');
assert.match(provider, /cardHeight < 54 \? ' is-compact' : ''/, 'Короткие записи недели не получают компактную разметку');
assert.match(styles, /\.calendar-week-axis \.calendar-week-time:first-child \{ transform:translateY\(2px\); \}/, 'Первая отметка времени недели обрезается');
assert.match(styles, /\.calendar-week-axis \.calendar-week-time:last-child \{ transform:translateY\(calc\(-100% - 2px\)\); \}/, 'Последняя отметка времени недели обрезается');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-grid \{[^}]*gap:0;[^}]*border:1px/, 'Месяц не собран в единую спокойную сетку');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-day \{[^}]*min-height:96px;[^}]*border-radius:0;[^}]*box-shadow:none/, 'Ячейки месяца остались громоздкими');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-booking \{[^}]*min-height:24px;[^}]*border-left:2px[^}]*background:transparent/, 'Записи месяца остались перегруженными карточками');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-day\.is-placeholder \{ visibility:hidden;[^}]*border-color:transparent!important;[^}]*background:transparent!important;/, 'Пустые дни соседнего месяца выглядят как рабочие даты');
assert.match(styles, /\.calendar-overview-day\.is-today \.calendar-overview-date strong \{[^}]*color:var\(--theme-accent-contrast,#fff\)/, 'Сегодняшняя дата не учитывает контраст выбранной темы');
assert.match(styles, /\.schedule-view-title \.view-title-actions \.compact-button \{ width:auto; margin-top:0; \}/, 'Компактные действия шапки растягиваются на всю ширину');
assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.calendar-overview-month \.calendar-overview-day \{ min-height:72px;[\s\S]*\.calendar-overview-month \.calendar-overview-date \{ min-height:66px;[\s\S]*\.calendar-overview-month \.calendar-overview-count \{ display:block;[\s\S]*\.calendar-overview-month \.calendar-overview-items \{ display:none; \}/, 'Мобильный месяц не сведён к одной крупной кнопке дня со счётчиком');
assert.match(styles, /@media \(min-width:761px\) and \(max-width:1100px\)[\s\S]*\.calendar-overview-month \.calendar-overview-booking span \{ display:none; \}/, 'На средней ширине названия записей продолжают бессмысленно обрезаться');
assert.match(styles, /data-provider-theme="eco"[^}]*\.calendar-overview-month \.calendar-overview-grid \{[^}]*gap:7px;[^}]*border:0;[^}]*background:transparent;/, 'Месяц Эко всё ещё выглядит как тяжёлая таблица');
assert.match(styles, /data-provider-theme="eco"[^}]*\.calendar-overview-month \.calendar-overview-date \{[^}]*min-height:28px;[^}]*border-bottom:0;/, 'Дата в месяце Эко сохраняет лишнюю разделительную линию');
assert.match(styles, /data-provider-theme="eco"[^}]*\.calendar-overview-month \.calendar-overview-booking \{[^}]*min-height:27px;[^}]*background:rgba\(114,129,93,\.075\);/, 'Записи месяца Эко не получили спокойное компактное оформление');

console.log('Calendar minimalism v338 checks passed.');
