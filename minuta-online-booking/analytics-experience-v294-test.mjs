import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./provider.html', import.meta.url), 'utf8');
const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const worker = readFileSync(new URL('./sw.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./supabase-migration-v103.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('./supabase-migration-v103-rollback.sql', import.meta.url), 'utf8');

for (const id of ['reportHeroRevenue', 'reportPlanProgress', 'reportForecast', 'reportHeroUtilization', 'reportHealthDetails', 'reportDataQuality']) {
  assert.match(html, new RegExp(`id="${id}"`), `Отсутствует ключевой элемент аналитики ${id}`);
}
for (const view of ['overview', 'money', 'clients', 'team']) {
  assert.match(html, new RegExp(`data-report-view="${view}"`), `Отсутствует представление статистики ${view}`);
}
assert.match(html, /id="reportGoalsDialog"[\s\S]*id="reportGoalRevenue"[\s\S]*id="reportGoalUtilization"[\s\S]*id="reportGoalRepeat"[\s\S]*id="reportGoalCancellation"/, 'Цели бизнеса собраны не полностью');
assert.match(provider, /function normalizeAnalyticsGoals[\s\S]*revenue_rub[\s\S]*utilization_percent[\s\S]*repeat_percent[\s\S]*cancellation_percent/, 'Цели не нормализуются перед сохранением');
assert.match(provider, /analytics_goals:displayPreferences\.analytics_goals/, 'Изменение оформления может стереть цели статистики');
assert.match(provider, /analytics_goals_by_scope:displayPreferences\.analytics_goals_by_scope/, 'Цели организаций могут стереться при изменении оформления');
assert.match(provider, /function reportGoalsScopeKey[\s\S]*organization:/, 'Цели статистики не изолированы по организации');
assert.match(provider, /weekdaySamples[\s\S]*pipeline[\s\S]*confidence/, 'Прогноз не учитывает дни недели, будущие записи и уверенность');
assert.match(provider, /function reportHeatmapAvailability[\s\S]*function renderReportHeatmap[\s\S]*bookedMinutes[\s\S]*percentages/, 'Тепловая карта не нормализуется по доступному времени');
assert.match(provider, /availableComponents\.reduce[\s\S]*totalWeight/, 'Оценка бизнеса не перенормирует доступные компоненты');
assert.doesNotMatch(provider, /utilizationPercent === null \? 60/, 'Неизвестная загрузка не должна подменяться оценкой 60');
assert.match(provider, /reportAvailabilityState\.complete/, 'Неполный график команды может ошибочно считаться полной доступностью');
assert.match(provider, /completeness_version/, 'Клиент доверяет старой неточной проверке полноты графика');
assert.match(migration, /count\(distinct schedule\.weekday\)=7[\s\S]*'completeness_version',2/, 'v103 не доказывает полноту семи дней графика');
assert.match(rollback, /create or replace function public\.get_minuta_staff_report_availability/, 'Для v103 отсутствует рабочий откат');
assert.match(provider, /const visitTarget = Math\.max\(0, 100 - goals\.cancellation_percent\)/, 'Цель отмен не влияет на пульс бизнеса');
assert.match(provider, /function reportDataQualityMetrics[\s\S]*outcomeCoverage[\s\S]*identityCoverage[\s\S]*sourceCoverage/, 'Нет отдельной проверки качества данных');
assert.match(provider, /actual_duration_minutes \|\| 0/, 'Качество фактической длительности подменено плановой длительностью');
assert.match(provider, /data-report-action="\$\{item\.action\}"/, 'Рекомендации используют небезопасные HTML-действия');
assert.match(provider, /function handleReportAction[\s\S]*action === 'quality'[\s\S]*action === 'debt'[\s\S]*action === 'lost'/, 'Типизированные действия рекомендаций обрабатываются не полностью');
assert.match(provider, /scopedStatus === 'loading'[\s\S]*scopedStatus === 'failed'/, 'Ошибка или загрузка отчёта снова может выглядеть как подтверждённый ноль');
assert.match(provider, /if \(error\) \{ renderAnalytics\(\); notify/, 'Ошибка scoped-отчёта не отрисовывается сразу');
assert.match(provider, /if \(bookingUsesDemoData\(\)\) prepareDemoBookingContext\(reportChartDate\.dataset\.reportDate\)/, 'Демо-график не открывает изолированные учебные записи');
assert.match(provider, /function bookingSourceItems\(\)[\s\S]*?reportScopedBookingsState\.rows[\s\S]*?: allBookings/, 'Демо-график может смешать учебные и реальные записи');
assert.doesNotMatch(provider, /data-report-heatmap-date=/, 'Агрегированная тепловая карта не должна обещать неточный переход на одну дату');
assert.match(styles, /#analyticsView\[data-report-tab="overview"\][\s\S]*data-report-tab="money"[\s\S]*data-report-tab="clients"[\s\S]*data-report-tab="team"/, 'Минималистичные представления не переключаются стилями');
assert.match(styles, /report-periods[\s\S]*overflow-x:auto[\s\S]*scroll-snap-type/, 'Периоды не помещаются безопасно на телефоне');
assert.match(styles, /@media \(max-width:640px\)[\s\S]*report-command-metrics[\s\S]*grid-template-columns:1fr 1fr/, 'Ключевые показатели не адаптированы к телефону');
assert.match(worker, /v362/, 'Кэш приложения не обновлён для новой статистики');

assert.match(migration, /^--[^\n]*\nbegin;[\s\S]*commit;\s*$/i, 'v103 must be atomic');
assert.match(rollback, /^--[^\n]*\nbegin;[\s\S]*commit;\s*$/i, 'v103 rollback must be atomic');
assert.match(provider, /const importedSource = reportDataSource === 'demo' \? \[\] : importedBookingHistory\.filter/, 'demo analytics must not mix real imported history');
assert.match(styles, /@media \(max-width:640px\)[\s\S]*\.report-view-tabs \{ position:sticky;[\s\S]*safe-area-inset-top/, 'mobile analytics tabs must remain reachable without covering the safe area');

console.log('analytics experience v362 checks passed');
