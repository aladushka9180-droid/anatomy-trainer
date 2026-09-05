import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

assert.match(provider, /const limit = view === 'month' \? 2 : items\.length/, 'Месяц показывает слишком много записей внутри одной даты');
assert.match(provider, /\+ ещё \$\{seriesBookingCountLabel\(hiddenCount\)\}/, 'Скрытые записи месяца подписаны непонятно');
assert.match(provider, /class="calendar-overview-count">\$\{escapeHtml\(monthCount\)\}/, 'В мобильном месяце нет краткого счётчика записей');
assert.match(provider, /cardHeight < 54 \? ' is-compact' : ''/, 'Короткие записи недели не получают компактную разметку');
assert.match(styles, /\.calendar-week-axis \.calendar-week-time:first-child \{ transform:translateY\(2px\); \}/, 'Первая отметка времени недели обрезается');
assert.match(styles, /\.calendar-week-axis \.calendar-week-time:last-child \{ transform:translateY\(calc\(-100% - 2px\)\); \}/, 'Последняя отметка времени недели обрезается');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-grid \{[^}]*gap:6px;[^}]*border:0;[^}]*background:transparent/, 'Месяц не разделён на спокойные карточки дней');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-day \{[^}]*min-height:112px;[^}]*border-radius:10px;[^}]*background:var\(--theme-surface/, 'Ячейки месяца не используют единую минималистичную основу');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-booking \{[^}]*min-height:30px;[^}]*border-left:3px[^}]*background:color-mix/, 'Записи месяца не оформлены компактными читаемыми строками');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-booking strong \{[^}]*white-space:normal;[^}]*-webkit-line-clamp:2;/, 'Длинное название записи не переносится на две строки');
assert.match(styles, /\.calendar-overview-month \.calendar-overview-day\.is-placeholder \{ visibility:hidden;[^}]*border-color:transparent!important;[^}]*background:transparent!important;/, 'Пустые дни соседнего месяца выглядят как рабочие даты');
assert.match(styles, /\.calendar-overview-day\.is-today \.calendar-overview-date strong \{[^}]*color:var\(--theme-accent-contrast,#fff\)/, 'Сегодняшняя дата не учитывает контраст выбранной темы');
assert.match(styles, /\.schedule-view-title \.view-title-actions \.compact-button \{ width:auto; margin-top:0; \}/, 'Компактные действия шапки растягиваются на всю ширину');
assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.calendar-overview-month \.calendar-overview-day \{ min-height:68px;[\s\S]*\.calendar-overview-month \.calendar-overview-date \{ min-height:62px;[\s\S]*\.calendar-overview-month \.calendar-overview-count \{ display:block;[\s\S]*\.calendar-overview-month \.calendar-overview-items \{ display:none; \}/, 'Мобильный месяц не сведён к одной крупной кнопке дня со счётчиком');
assert.match(styles, /@media \(min-width:761px\) and \(max-width:1100px\)[\s\S]*\.calendar-overview-month \.calendar-overview-booking span \{ display:block; \}/, 'На средней ширине название записи скрывается');
assert.match(styles, /schedule-card:has\(#providerBookings\.calendar-overview-month\) \.schedule-toolbar \{[^}]*border:0;[^}]*background:transparent;[^}]*box-shadow:none;/, 'В месяце остаётся лишняя тяжёлая панель заголовка');
assert.match(styles, /\.provider-body\[data-provider-theme\] \.calendar-overview-month \.calendar-overview-day \{[^}]*border-color:var\(--theme-line\);[^}]*background:var\(--theme-surface\);[^}]*color:var\(--theme-ink\);/, 'Месяц не наследует палитру выбранной темы');
assert.doesNotMatch(styles, /\.provider-body\[data-provider-theme="[^"]+"\][^{}]*\.calendar-overview-month/, 'Отдельная тема переопределяет структуру месяца');

const themeSource = provider.match(/const PROVIDER_THEME_KEYS = \[([^\]]+)\]/)?.[1] || '';
const themes = [...themeSource.matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.equal(themes.length, 9, 'Проверка месяца должна охватывать все девять тем');

console.log(`Calendar minimalism v394 checks passed across ${themes.length} themes.`);
