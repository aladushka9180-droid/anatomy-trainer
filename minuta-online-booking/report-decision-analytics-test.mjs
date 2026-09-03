import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const html = read('provider.html');
const provider = read('provider.js');
const styles = read('styles.css');

for (const id of ['reportDecisionTitle', 'reportServicesList', 'reportSourceDonut', 'reportOutcomeBar', 'reportDecisionInsight']) {
  assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `Блок ${id} должен быть единственным`);
}

assert.match(html, /Что влияет на результат/, 'Нет единого блока управленческой структуры');
assert.match(html, /data-report-service-metric="revenue"[\s\S]*data-report-service-metric="visits"/, 'Нет переключения услуг между выручкой и визитами');
assert.match(html, /Как созданы записи/, 'Источник записи назван неоднозначно');
assert.doesNotMatch(html, /Источник всех записей/, 'Старый дублирующий блок источников остался на странице');
assert.match(html, /Результат записей/, 'Нет распределения записей по результату');

assert.match(provider, /let reportServiceMetric = 'revenue'/, 'Не хранится выбранный показатель услуг');
assert.match(provider, /const outcomes = \[[\s\S]*key:'completed'[\s\S]*key:'no-show'/, 'Результаты записей считаются не по всем основным состояниям');
assert.match(provider, /conic-gradient\(var\(--theme-accent\)/, 'Кольцевая диаграмма источников не строится из данных');
assert.match(provider, /function openReportBookings\([\s\S]*reportDataSource === 'demo'[\s\S]*setProviderView\('bookings'\)/, 'Переход из показателя в реальные записи небезопасен для демо-режима');
assert.match(provider, /bookingSourceFilter !== 'all' && reportBookingSource\(item\) !== bookingSourceFilter/, 'Переход по способу создания не фильтрует журнал');

assert.match(styles, /\.report-decision-grid\s*\{[^}]*grid-template-columns:/, 'Новый блок не получил сетку');
assert.match(styles, /\.report-donut::after\s*\{/, 'Кольцевая диаграмма не оформлена');
assert.match(styles, /@media \(max-width:760px\)[\s\S]*\.report-decision-grid,\.report-business-grid\s*\{[^}]*grid-template-columns:1fr/, 'Новый блок не складывается в одну колонку на телефоне');

console.log('Report decision analytics checks passed');
