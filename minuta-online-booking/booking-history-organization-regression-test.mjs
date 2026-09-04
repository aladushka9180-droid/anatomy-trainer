import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provider = readFileSync(new URL('./provider.js', import.meta.url), 'utf8');
const clientImport = readFileSync(new URL('./client-import.js', import.meta.url), 'utf8');

const reportRange = provider.match(/function reportRange\(period = reportPeriod\) \{[\s\S]*?\n\}/)?.[0] || '';
const reportBookings = provider.match(/function reportBookings\(range = reportRange\(\)\) \{[\s\S]*?\n\}/)?.[0] || '';
const completedItems = provider.match(/function reportCompletedItems\(items\) \{[\s\S]*?\n\}/)?.[0] || '';
const importController = provider.match(/const clientImportController =[\s\S]*?clientImportController\.bind\(\);/)?.[0] || '';
const organizationSwitch = provider.match(/onActiveOrganizationChange: organization => \{[\s\S]*?\n  \}/)?.[0] || '';
const buildClients = provider.match(/function buildClients\(\) \{[\s\S]*?\n\}/)?.[0] || '';

assert.ok(reportRange, 'Не найдена логика выбора периода статистики');
assert.match(
  reportRange,
  /\[\.\.\.liveSource,\s*\.\.\.importedBookingHistory\]/,
  'Период «Всё время» должен начинаться с самой ранней обычной или импортированной записи'
);
assert.doesNotMatch(reportRange, /3659\s*\*\s*86400000/, 'Период «Всё время» не должен искусственно растягиваться на десять лет');
assert.match(reportRange, /reportScopedBookingsState\.status === 'ready'[\s\S]*reportScopedBookingsState\.rows[\s\S]*allBookings/, 'Для «Всё время» должна использоваться фактически доступная история организации');
assert.match(provider, /function reportDataQueryRange\(range\)[\s\S]*reportPeriod !== 'all' \|\| reportDataSource === 'demo'[\s\S]*start:'2000-01-01'/, 'Техническая выборка «Всё время» должна охватывать историю всей команды, не меняя отображаемый период');
assert.match(provider, /async function loadReportScopedBookings\(range, performerId\)[\s\S]*?range = reportDataQueryRange\(range\);/);
assert.match(provider, /async function loadReportTeamAnalytics\(range\)[\s\S]*?range = reportDataQueryRange\(range\);/);

assert.ok(reportBookings, 'Не найдена выборка записей для статистики');
assert.match(
  reportBookings,
  /const source = \[\.\.\.liveSource,\s*\.\.\.importedBookingHistory\]/,
  'Импортированная история должна участвовать в статистике'
);
assert.match(
  reportBookings,
  /String\(item\.organization_id\) === String\(organizationId\)/,
  'Статистика импортированной истории должна быть изолирована по активной организации'
);

assert.ok(completedItems, 'Не найдена логика завершённых визитов');
assert.match(completedItems, /bookingOutcome\(item\)\.visit_status === 'completed'/);
assert.match(importController, /booking_outcomes:\{\s*visit_status:'completed'/);
assert.match(importController, /amount_rub:Number\(item\.price_rub \|\| 0\)/);
assert.match(importController, /completion_source:'imported'/);
assert.match(importController, /renderAnalytics\(\)/, 'Загрузка истории должна сразу обновлять статистику');

assert.ok(organizationSwitch, 'Не найден обработчик смены активной организации');
assert.match(
  organizationSwitch,
  /selectedClientPhone = ''/,
  'При смене организации выбранный клиент должен быть сброшен до загрузки новых данных'
);
assert.match(
  organizationSwitch,
  /importedClients = \[\][\s\S]*importedBookingHistory = \[\]/,
  'При смене организации импортированные клиенты и история должны очищаться синхронно'
);
assert.match(
  organizationSwitch,
  /clientImportController\.setOrganization\(organization\?\.public_slug === REPORT_DEMO_SLUG \? null : organization\)/,
  'Импорт должен загружаться только для рабочей, а не демонстрационной организации'
);
assert.match(buildClients, /belongsToActiveOrganization/, 'Клиентская картотека должна фильтровать записи по активной организации');
assert.match(buildClients, /Boolean\(booking\?\.organization_id\)/, 'Записи без organization_id не должны попадать в чужую организацию');
assert.match(clientImport, /const organizationId = organization\?\.id \|\| ''/);
assert.match(clientImport, /const requestIsCurrent = \(\) => currentRevision === revision && organization\?\.id === organizationId/);
assert.ok((clientImport.match(/if \(!requestIsCurrent\(\)\) return \{ ok:false,optional:true,stale:true \}/g) || []).length >= 3, 'Поздний ответ прежней организации не должен перезаписать клиентов и историю');

console.log('booking history organization isolation and analytics regression checks passed');
