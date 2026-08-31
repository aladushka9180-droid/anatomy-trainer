import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pages = ['index.html', 'provider.html', 'booking.html', 'privacy.html'];
const version = '42';

for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /Content-Security-Policy/, `${page}: нет политики безопасности`);
  assert.doesNotMatch(html, /v=(?:38|39|40|41)/, `${page}: осталась старая версия ресурсов`);
  for (const match of html.matchAll(/(?:src|href)="([^"#?]+)(?:\?[^"#]*)?"/g)) {
    const reference = match[1];
    if (/^(?:https?:|mailto:|tel:)/.test(reference)) continue;
    assert.ok(existsSync(join(root, reference)), `${page}: отсутствует ${reference}`);
  }
}

for (const page of ['index.html', 'provider.html', 'booking.html']) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /vendor\/supabase-2\.112\.4\.min\.js/, `${page}: SDK Supabase не закреплён локально`);
  assert.match(html, /integrity="sha384-/, `${page}: нет контроля целостности SDK`);
  assert.match(html, new RegExp(`reliability\\.js\\?v=${version}`), `${page}: не подключён слой надёжности`);
  assert.doesNotMatch(html, /https:\/\/\*\.supabase\.co/, `${page}: CSP разрешает любой проект Supabase`);
}

const sdk = readFileSync(join(root, 'vendor', 'supabase-2.112.4.min.js'));
assert.equal(createHash('sha384').update(sdk).digest('base64'), 'yiVMs0R/Jyz7OhoXa/DsEMUSBLjEhr/QJta2ONO+zB6I8/GmNg/7AUFrZmAJV7KV', 'Контрольная сумма локального SDK не совпадает');

const provider = readFileSync(join(root, 'provider.js'), 'utf8');
assert.match(provider, /postgres_changes/, 'Кабинет не подписан на изменения записей');
assert.match(provider, /saveProviderCache\('bookings'/, 'Записи не сохраняются для офлайн-просмотра');
assert.match(provider, /setInterval\(\(\) =>/, 'Нет резервной периодической синхронизации');
assert.match(provider, /sessionIsCurrent/, 'Нет защиты от ответов старой пользовательской сессии');
assert.match(provider, /requiredResults\.every\(result => result\?\.ok\)/, 'Запись разрешается без полной синхронизации');
assert.match(provider, /removePrefix\(`provider:\$\{userId\}:`\)/, 'Кэш клиента не очищается при выходе');
assert.match(provider, /bookings-v2/, 'Новый обезличенный кэш не отделён от старого PII-кэша');
assert.match(provider, /client_name: 'Клиент', client_phone: ''/, 'Офлайн-кэш записей содержит данные клиента');
assert.match(provider, /booking_policies/, 'Кабинет не загружает правила отмены и предоплаты');
assert.match(provider, /notification_templates/, 'Шаблоны уведомлений не синхронизируются с сервером');
assert.match(provider, /set_booking_payment_status/, 'Нет управления статусом предоплаты');
assert.match(provider, /\[5, 10, 30, 40, 60, 90, 120/, 'Редактор услуги не поддерживает длительность 5 и 10 минут');

const providerHtml = readFileSync(join(root, 'provider.html'), 'utf8');
assert.match(providerHtml, /id="serviceDuration"[^>]*>[\s\S]*?<option value="5">5 мин<\/option>[\s\S]*?<option value="10">10 мин<\/option>/, 'В форме новой услуги нет длительности 5 и 10 минут');

const worker = readFileSync(join(root, 'sw.js'), 'utf8');
assert.match(worker, new RegExp(`CACHE_PREFIX.*massage-izhevsk-`), 'Service Worker не использует собственный префикс кэша');
assert.match(worker, new RegExp(`v${version}`), 'Версия Service Worker не совпадает');
for (const asset of ['styles.css', 'config.js', 'reliability.js', 'app.js', 'provider.js', 'booking.js']) {
  assert.match(worker, new RegExp(`${asset.replace('.', '\\.')}\\?v=${version}`), `Service Worker не кэширует ${asset}`);
}
assert.match(worker, /event\.request\.mode === 'navigate'/, 'Навигация не отделена от статических ресурсов');
assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)/, 'Service Worker может удалить чужие кэши');
assert.match(worker, /!new URL\(request\.url\)\.search/, 'Навигация с секретными параметрами может попасть в кэш');

const app = readFileSync(join(root, 'app.js'), 'utf8');
assert.doesNotMatch(app, /minuta-last-booking-url/, 'Секретная ссылка сохраняется в localStorage');
assert.match(app, /validateCurrentSelection/, 'Выбранное время не перепроверяется после восстановления связи');

const booking = readFileSync(join(root, 'booking.js'), 'utf8');
assert.match(booking, /booking\.html#token=/, 'Токен управления не переносится из query-параметра во fragment');
assert.match(booking, /loadBooking\(\{ silent: true \}\)/, 'Не проверяется результат неопределённой операции');
assert.match(booking, /get_booking_management/, 'Клиент не получает серверные правила отмены и переноса');
assert.match(booking, /cancel_too_late/, 'Клиентский интерфейс не обрабатывает срок отмены');

const migration = readFileSync(join(root, 'supabase-migration-v41.sql'), 'utf8');
assert.match(migration, /create table if not exists public\.booking_policies/, 'Нет серверного хранения правил записи');
assert.match(migration, /reschedule_limit_reached/, 'Лимит переносов не проверяется сервером');
assert.match(migration, /cancel_too_late/, 'Срок отмены не проверяется сервером');
assert.match(migration, /payment_url_template/, 'Предоплата не подключена к правилам записи');

const durationMigration = readFileSync(join(root, 'supabase-migration-v42.sql'), 'utf8');
assert.match(durationMigration, /duration_minutes >= 5/, 'Сервер не разрешает услуги длительностью 5 минут');

const reliability = readFileSync(join(root, 'reliability.js'), 'utf8');
assert.match(reliability, /removeItem\('minuta-last-booking-url'\)/, 'Старый секретный токен не очищается');
assert.match(reliability, /removeExpired/, 'Нет автоматического удаления просроченного офлайн-кэша');

console.log('minuta-online-booking smoke test: OK');
