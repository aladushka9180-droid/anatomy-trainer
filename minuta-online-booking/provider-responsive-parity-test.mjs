import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const [html, css, provider] = await Promise.all([
  readFile(path.join(directory, 'provider.html'), 'utf8'),
  readFile(path.join(directory, 'styles.css'), 'utf8'),
  readFile(path.join(directory, 'provider.js'), 'utf8')
]);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Не найден блок ${startMarker}`);
  return source.slice(start, end);
}

function providerViews(source) {
  return [...source.matchAll(/data-provider-view="([^"]+)"/g)].map(match => match[1]).sort();
}

const desktopNavigation = section(html, '<nav class="provider-nav"', '</nav>');
const mobileDirectory = section(html, '<div class="mobile-more-grid">', '</div>');
const desktopViews = providerViews(desktopNavigation);
const mobileViews = providerViews(mobileDirectory);

assert.deepEqual(mobileViews, desktopViews, 'Мобильный каталог разделов должен повторять все разделы компьютера');
assert.equal(new Set(desktopViews).size, desktopViews.length, 'В компьютерной навигации обнаружены дубли разделов');
for (const view of desktopViews) {
  assert.match(html, new RegExp(`data-provider-panel="${view}"`), `Для раздела ${view} отсутствует общая панель содержимого`);
}

assert.doesNotMatch(html, /mobile-priority-shortcuts/, 'Быстрые ссылки не должны дублировать мобильный каталог разделов');
for (const label of ['Помощник', 'Обновить', 'Клиентам']) {
  assert.match(html, new RegExp(`data-mobile-label="${label}"`), `На телефоне отсутствует видимая подпись «${label}»`);
}

assert.match(provider, /#newBookingButton, #mobileNewBookingButton/, 'Создание записи на телефоне и компьютере должно использовать общий обработчик');
assert.match(provider, /client-badge-label/, 'В мобильной карточке нельзя показать расшифровку важной метки клиента');
assert.match(html, /id="providerDayFocus"[\s\S]*id="providerDayFocusOpen"/, 'На телефоне отсутствует компактная карточка ближайшей записи');
assert.match(provider, /mobileCreate\.hidden = !\['bookings', 'clients'\]\.includes\(view\)/, 'Кнопка создания записи перекрывает посторонние разделы');
assert.match(css, /timeline-booking:not\(\.compact\):not\(\.minute-only\) \.timeline-client-duration\s*\{[^}]*display:none!important/, 'Длительность обычной записи дублируется на телефоне');
assert.match(css, /timeline-booking:not\(\.compact\):not\(\.minute-only\) \.timeline-booking-status\s*\{[^}]*display:inline-flex!important/, 'Статус обычной записи скрыт на телефоне');
assert.match(css, /timeline-booking:not\(\.compact\):not\(\.minute-only\) \.client-badge-label\s*\{[^}]*display:block/, 'Название важной метки клиента скрыто на телефоне');
assert.match(css, /\.service-visibility-toggle span\s*\{[^}]*display:inline/, 'Состояние услуги на телефоне обозначено только непонятным значком');
assert.match(html, /id="analyticsView"\s+data-provider-panel="analytics"/, 'Стили заголовка статистики не привязаны к панели статистики');
assert.match(css, /#analyticsView \.view-title>div:first-child\s*\{[^}]*min-width:max-content/, 'Кнопка отчёта может сжать заголовок статистики');
assert.match(css, /#analyticsView \.view-title h2\s*\{[^}]*overflow-wrap:normal;[^}]*word-break:keep-all;[^}]*white-space:nowrap;[^}]*font-size:24px/, 'Слово «Статистика» может разрываться или не помещаться в заголовке');
assert.match(css, /#analyticsView #exportBookings\s*\{[^}]*width:max-content;[^}]*margin-top:0/, 'Кнопка отчёта растягивается и сжимает заголовок статистики');

console.log(`Provider responsive parity checks passed: ${desktopViews.length} shared sections.`);
