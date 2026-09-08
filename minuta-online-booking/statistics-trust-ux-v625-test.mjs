import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const html = read('provider.html');
const provider = read('provider.js');
const ux = read('provider-ux.css');
const statisticsUx = ux.slice(ux.indexOf('/* Statistics: compact'));

function declaration(name) {
  const start = provider.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Не найдена функция ${name}`);
  const brace = provider.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < provider.length; index += 1) {
    const char = provider[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return provider.slice(start, index + 1);
  }
  throw new Error(`Не удалось извлечь ${name}`);
}

assert.ok(html.indexOf('id="reportDataSource"') < html.indexOf('id="reportFilterToggle"'), 'Демо-режим снова спрятан внутри фильтров');
assert.equal((html.match(/class="report-primary-metric"/g) || []).length, 1, 'Основной показатель должен быть один');
assert.match(html, /report-command-metrics[\s\S]*Отмечено полученным[\s\S]*Состоялось[\s\S]*Загрузка/, 'Первый экран не содержит три главных показателя');
assert.match(html, /<details class="report-analytics-details"[\s\S]*Подробная аналитика/, 'Вторичная аналитика не убрана в раскрываемый блок');
assert.match(html, /Полнота оплат[\s\S]*менее чем для 80%/, 'Не объяснён порог доверия к оценке');
assert.match(ux, /report-command-metrics\s*\{[\s\S]*grid-template-columns:1\.35fr repeat\(2,minmax\(0,1fr\)\)/, 'Три KPI не собраны в компактную сетку');
assert.match(ux, /@media\(max-width:760px\)[\s\S]*report-primary-metric[\s\S]*grid-column:1\/-1/, 'Главный KPI не выделен на мобильном экране');
assert.match(ux, /report-actions-toggle\s*\{[^}]*order:initial/, 'Кнопка раскрытия рекомендаций снова оказывается выше главной рекомендации');
assert.match(html, /id="reportHeatmapLegend"[\s\S]*Меньше[\s\S]*Больше/, 'У тепловой карты нет понятной шкалы интенсивности');
assert.match(ux, /report-heatmap-legend[\s\S]*linear-gradient\([^)]*var\(--theme-accent\)/, 'Шкала спроса не использует цвет текущей темы');
assert.doesNotMatch(statisticsUx, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'Новая статистика содержит цвет вне переменных темы');

const parseLocalIsoDate = value => new Date(`${value}T00:00:00`);
const localIsoDate = value => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const reportQueryWindows = new Function('parseLocalIsoDate', 'localIsoDate', `${declaration('reportQueryWindows')}; return reportQueryWindows;`)(parseLocalIsoDate, localIsoDate);
const windows = reportQueryWindows({ start:'2010-01-01', end:'2026-09-08' });
assert.ok(windows.length > 1, 'Вся история не разбивается на безопасные серверные интервалы');
assert.equal(windows[0].start, '2010-01-01');
assert.equal(windows.at(-1).end, '2026-09-08');
windows.forEach(window => assert.ok((parseLocalIsoDate(window.end) - parseLocalIsoDate(window.start)) / 86400000 <= 3600, 'Интервал превышает серверный предел'));

const makeClientMetrics = ({ allBookings, importedBookingHistory = [] }) => new Function(
  'allBookings', 'importedBookingHistory', 'parseLocalIsoDate',
  `const reportDataSource='own'; const reportScopedBookingsState={status:'idle',rows:[]};
   const reportUsesScopedBookings=()=>false; const reportOrganizationId=()=> 'org';
   const isScheduleBlock=()=>false; const reportCompletedItems=items=>items;
   const reportClientIdentity=item=>'phone:'+item.client_phone;
   ${declaration('reportClientMetrics')}; return reportClientMetrics;`
)(allBookings, importedBookingHistory, parseLocalIsoDate);
const visits = [
  { id:'first', organization_id:'org', booking_date:'2026-09-02', booking_time:'10:00', client_phone:'79990000000', client_had_previous:false },
  { id:'second', organization_id:'org', booking_date:'2026-09-05', booking_time:'10:00', client_phone:'79990000000', client_had_previous:true }
];
let clients = makeClientMetrics({ allBookings:visits })(visits, { start:'2026-09-01', end:'2026-09-30' });
assert.equal(clients.newClients, 1, 'Поздний визит ошибочно превращает нового клиента в повторного');
assert.equal(clients.returningClients, 0);
visits[0].client_had_previous = true;
clients = makeClientMetrics({ allBookings:visits })(visits, { start:'2026-09-01', end:'2026-09-30' });
assert.equal(clients.returningClients, 1, 'Реальный повторный клиент не распознаётся');

assert.match(provider, /const paymentCoverageSufficient = paymentCoverage === null \|\| paymentCoverage >= 80/, 'Оценка бизнеса не защищена порогом полноты оплат');
assert.match(provider, /hasHealthData = [^\n]*paymentCoverageSufficient/, 'Неполные оплаты всё ещё могут дать ложную общую оценку');
assert.match(provider, /booking_date >= todayIso[\s\S]*visit_status === 'scheduled'[\s\S]*!bookingIsCompleted/, 'Прогноз не учитывает оставшиеся записи текущего дня');
assert.match(provider, /function reportDrilldownScope[\s\S]*performer:[\s\S]*organization:[\s\S]*source:/, 'Переход из статистики теряет область отчёта');
assert.match(provider, /payment-unknown[\s\S]*MinutaReportReconciliation\.paymentUnknown/, 'Нет перехода к визитам с неизвестной оплатой');
assert.match(provider, /paymentKnownVisits[\s\S]*Оплата не указана[\s\S]*Нет данных/, 'Услуги с неизвестной оплатой всё ещё выглядят как нулевая выручка');
assert.match(provider, /function ensureReportRetention[\s\S]*ensureOrganizationFeature\('retentionPanel'\)/, 'Возврат клиентов не загружается по требованию');
assert.match(provider, /range\.end >= reportTodayIso\(\)[\s\S]*Заполнить свободные часы/, 'Прошлые периоды всё ещё получают несвоевременную рекомендацию заполнять часы');
assert.match(provider, /showLeader = rankedRows\.length > 1/, 'Один сотрудник всё ещё объявляется лидером');
assert.doesNotMatch(provider, /percent === null \? \(minutes \? 18 : 4\)/, 'Все непустые ячейки спроса снова имеют одинаковую яркость');

const heatmapScale = new Function(`${declaration('reportHeatmapScale')}; return reportHeatmapScale;`)();
const heatmapIntensity = new Function(`${declaration('reportHeatmapIntensity')}; return reportHeatmapIntensity;`)();
assert.equal(heatmapScale([30, 600, 900, 1200, 10000]), 1200, 'Единичный выброс делает остальную карту слишком бледной');
const heatLevels = [0, 30, 600, 1200].map(value => heatmapIntensity(value, 1200));
assert.ok(heatLevels.every((value, index) => index === 0 || value > heatLevels[index - 1]), 'Яркость не растёт вместе со спросом');
assert.ok(heatLevels.at(-1) <= 58, 'Максимальная подсветка может ухудшить контраст текста');

console.log('Statistics trust and compact UX checks passed.');
