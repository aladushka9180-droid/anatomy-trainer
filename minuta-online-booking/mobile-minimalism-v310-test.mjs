import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

for (const id of ['reportFilterToggle', 'reportFilterSummary', 'reportFilterContent', 'reportImportMethod']) {
  assert.match(html, new RegExp(`id="${id}"`), `Нет элемента мобильной статистики ${id}`);
}
assert.ok(html.indexOf('class="report-view-tabs"') < html.indexOf('id="reportCommandCenter"'), 'Разделы статистики должны быть доступны до большого обзора');
assert.doesNotMatch(html, /id="reportShowTeam"/, 'Отдельная кнопка «Вся команда» дублирует фильтр сотрудника');

assert.match(provider, /function setReportFiltersExpanded[\s\S]*aria-expanded/, 'Мобильные фильтры нельзя раскрыть и свернуть');
assert.match(provider, /function updateReportFilterSummary[\s\S]*reportPeriodName\(\)[\s\S]*reportPerformerName\(\)/, 'На закрытом фильтре не видны выбранные параметры');
assert.match(provider, /reportPeriodLabel'\)\.textContent = `\$\{reportDateText[\s\S]*обновлено/, 'Краткая подпись периода не обновляется');
assert.doesNotMatch(provider, /reportPeriodLabel'\)\.textContent =[^\n]*прежнего журнала/, 'Техническая информация импорта снова перегружает фильтры');
assert.match(provider, /data-report-actions-toggle[\s\S]*Рекомендации · \$\{visibleActions\.length\}/, 'Дополнительные рекомендации не сворачиваются');

assert.match(styles, /\.report-filter-toggle \{ display:none; \}/, 'Десктоп не должен показывать лишнюю кнопку фильтров');
assert.match(styles, /@media \(max-width:640px\)[\s\S]*\.report-filter-toggle \{ display:flex;[\s\S]*\.report-filter-content \{ display:none;[\s\S]*\.report-filters\.is-open \.report-filter-content \{ display:grid;/, 'На телефоне фильтры не стали компактными');
assert.match(styles, /\.report-command-metrics article:nth-child\(2\),\.report-command-metrics article:nth-child\(3\) \{ display:none; \}/, 'Вторичные KPI всё ещё занимают первый экран телефона');
assert.match(styles, /\.report-smart-actions \.report-smart-action:nth-of-type\(n\+2\) \{ display:none; \}/, 'Дополнительные рекомендации не скрыты на телефоне');
assert.match(styles, /\.report-smart-actions \.report-smart-action \{ display:none;/, 'Рекомендации должны открываться по запросу на телефоне');
assert.match(styles, /\.report-summary article:first-child \{ display:none; \}/, 'Выручка дублируется в мобильном обзоре');
assert.match(styles, /\.report-insight \{ display:none!important; \}/, 'Главная рекомендация дублируется в мобильном обзоре');
assert.match(styles, /\.report-view-tabs button\.active,\.report-data-source button\.active,\.report-mini-toggle button\.active,\.report-team-controls button\.active \{[^}]*var\(--theme-accent-contrast/, 'Активные элементы статистики не используют контраст темы');
assert.match(styles, /\.schedule-settings-layout,\.schedule-settings-layout>\.panel[^{]*\{[^}]*box-sizing:border-box/, 'Панели графика могут выходить за экран телефона');

console.log('Mobile minimalism v310 checks passed.');
