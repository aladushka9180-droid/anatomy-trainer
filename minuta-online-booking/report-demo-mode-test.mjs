import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const html = read('provider.html');
const provider = read('provider.js');
const organization = read('organization.js');
const styles = read('styles.css');

assert.match(html, /data-report-source="own"[^>]*>Мои данные</, 'Нет выбора собственных данных');
assert.match(html, /data-report-source="demo"[^>]*>Демо-режим</, 'Нет выбора демо-режима');
assert.match(provider, /REPORT_DEMO_SLUG = 'minuta-demo-statistics'/, 'Не закреплена изолированная демо-организация');
assert.match(provider, /function reportOrganizationId\(\)[\s\S]*?reportOrganization\(\)\?\.id/, 'Источник отчёта не определяется отдельно');
assert.match(provider, /get_minuta_team_analytics'[\s\S]*?p_organization:organizationId/, 'Командная статистика не получает выбранную организацию');
assert.match(provider, /get_minuta_staff_report_bookings_v97'[\s\S]*?p_organization:organizationId/, 'Записи отчёта не получают выбранную организацию');
assert.match(provider, /reportDataSource === 'demo' && reportPeriod === 'month'[\s\S]*?reportPeriod = 'quarter'/, 'Демо-режим не открывает период с заполненными данными');
assert.match(provider, /function reportUsesScopedBookings\(\)[\s\S]*?reportDataSource === 'demo' \|\| reportCanViewTeam/, 'Демо-режим всё ещё зависит от статистики текущей организации');
assert.match(provider, /function loadSelectedReportData\(\)[\s\S]*?loadReportScopedBookings/, 'Демо-записи не загружаются сразу после выбора режима');
assert.match(provider, /function bookingSourceItems\(\)[\s\S]*?reportScopedBookingsState\.rows[\s\S]*?: allBookings/, 'Демо-журнал не использует изолированные учебные записи');
assert.match(provider, /function openReportBookings[\s\S]*?prepareDemoBookingContext\(\)[\s\S]*?setProviderView\('bookings'\)/, 'Детализация демо-статистики не открывает учебный журнал');
assert.match(provider, /if \(reportChartDate\)[\s\S]*?prepareDemoBookingContext\(reportChartDate\.dataset\.reportDate\)[\s\S]*?setProviderView\('bookings'\)/, 'День на демо-графике не открывает соответствующие записи');
assert.match(provider, /function requireBookingWrites\(\)[\s\S]*?bookingUsesDemoData\(\)[\s\S]*?только для просмотра/, 'Демо-журнал не защищён от изменений');
assert.match(html, /id="bookingDemoNotice"[\s\S]*?Просмотр не изменяет ваши настоящие записи[\s\S]*?id="showOwnBookings"/, 'В демо-журнале нет понятного обозначения и возврата к своим записям');
assert.match(styles, /booking-demo-mode[\s\S]*?#newBookingButton[\s\S]*?#mobileNewBookingButton/, 'Кнопки изменения не скрыты в демо-журнале');
assert.match(provider, /if \(period === 'all'\)[\s\S]*?reportDataSource === 'demo'[\s\S]*?today\.getMonth\(\) - 3/, 'Весь период демо-режима вычисляется по личным записям');
assert.match(provider, /Учебные обезличенные данные за три месяца — ваши записи не изменяются/, 'Нет пояснения о безопасности демо-режима');
assert.match(organization, /function getOrganizations\(\)[\s\S]*?organizations\.map/, 'Контроллер не отдаёт безопасный список доступных организаций');
assert.match(styles, /@media\(max-width:760px\)\{\.report-data-source\{grid-template-columns:1fr/, 'Выбор источника не адаптирован для телефона');

console.log('report demo mode checks passed');
