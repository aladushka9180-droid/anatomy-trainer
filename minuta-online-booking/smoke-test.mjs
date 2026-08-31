import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pages = ['index.html', 'provider.html', 'booking.html', 'privacy.html'];
const version = '46';

for (const page of pages) {
  const html = readFileSync(join(root, page), 'utf8');
  assert.match(html, /Content-Security-Policy/, `${page}: нет политики безопасности`);
  assert.doesNotMatch(html, /v=(?:38|39|40|41|42|43|44)/, `${page}: осталась старая версия ресурсов`);
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
assert.match(provider, /\[5, 10, 20, 30, 40, 60, 90, 120, 180/, 'Редактор услуги не поддерживает полный список длительностей');
assert.match(provider, /weekStartFor/, 'Лента дат не строит календарную неделю');
assert.match(provider, /dataDateShift|dataset\.dateShift/, 'Нет перехода между неделями');
assert.match(provider, /SCHEDULE_DATE_KEY/, 'Выбранная дата не сохраняется после обновления страницы');
assert.match(provider, /SCHEDULE_FOLLOW_TODAY_KEY/, 'Сохранённое «Сегодня» не следует за новым календарным днём');
assert.match(provider, /SCHEDULE_FILTER_KEY/, 'Фильтр расписания не сохраняется после обновления страницы');
assert.match(provider, /timeZone: 'Europe\/Samara'/, 'Расписание не использует часовой пояс места оказания услуг');
assert.match(provider, /scrollIntoView/, 'Активная дата не прокручивается в видимую область на мобильном');
assert.match(provider, /setAttribute\('aria-pressed'/, 'Состояние фильтров не передаётся средствам доступности');
assert.match(provider, /preparePortfolioImage/, 'Фотографии портфолио не обрабатываются перед загрузкой');
assert.match(provider, /canvas\.toBlob\(resolve, 'image\/webp'/, 'Фотографии портфолио не преобразуются в WebP без EXIF');
assert.match(provider, /reorder_portfolio_items/, 'Порядок портфолио не синхронизируется с сервером');
assert.match(provider, /data-portfolio-card/, 'Карточки портфолио нельзя перетаскивать на ПК');
assert.match(provider, /data-portfolio-move="up"/, 'Для мобильного нет кнопок изменения порядка портфолио');
assert.match(provider, /consent_confirmed_at/, 'Согласие клиента не сохраняется для портфолио');

const providerHtml = readFileSync(join(root, 'provider.html'), 'utf8');
assert.match(providerHtml, /id="serviceDuration"[^>]*>[\s\S]*?<option value="20">20 мин<\/option>[\s\S]*?<option value="180">180 мин<\/option>/, 'В форме новой услуги нет длительности 20 и 180 минут');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
assert.match(styles, /\.service-creator-dialog select:focus\s*\{[^}]*box-shadow:none/, 'Выбор длительности сохраняет лишнее двойное выделение');
assert.match(providerHtml, /id="scheduleDatePicker"[^>]*type="date"/, 'В расписании нет выбора даты через календарь');
assert.match(providerHtml, /data-date-shift="-7"[\s\S]*data-date-shift="7"/, 'В расписании нет навигации по неделям');
assert.match(providerHtml, /data-provider-panel="portfolio"/, 'В кабинете нет раздела портфолио');
assert.match(providerHtml, /id="portfolioSessions"[^>]*min="1"[^>]*max="999"/, 'Нельзя указать количество проведённых сеансов');
assert.match(providerHtml, /id="portfolioBeforeFile"[^>]*accept="image\/jpeg,image\/png,image\/webp"/, 'Нет выбора фотографии «До»');
assert.match(providerHtml, /id="portfolioAfterFile"[^>]*accept="image\/jpeg,image\/png,image\/webp"/, 'Нет выбора фотографии «После»');
assert.match(providerHtml, /id="portfolioConsent"/, 'Публикация не требует подтверждения согласия клиента');

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
assert.match(app, /p_request_id: attempt\.requestId/, 'Запись создаётся без идентификатора идемпотентности');
assert.match(app, /Проверить результат/, 'После неопределённого ответа нельзя безопасно проверить результат');
assert.match(app, /bookingFingerprint/, 'Изменение параметров не отделяет новую попытку записи от повтора');
assert.match(app, /sessionStorage\.setItem\(BOOKING_ATTEMPT_KEY/, 'Повтор после перезагрузки страницы теряет идентификатор запроса');
assert.doesNotMatch(app, /sessionStorage\.setItem\([^\n]*(?:clientName|clientPhone)/, 'Персональные данные попадают в sessionStorage');
assert.match(app, /loadPublicPortfolio/, 'Публичное портфолио не загружается');
assert.match(app, /createSignedUrl\(photo\.storage_path/, 'Публичные фотографии не используют временные ссылки');
assert.match(app, /После \$\{count\} \$\{word\}/, 'Количество сеансов не выводится на фотографии «После»');

const index = readFileSync(join(root, 'index.html'), 'utf8');
assert.match(index, /id="portfolioSection"/, 'На публичной странице нет раздела портфолио');

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

const idempotencyMigration = readFileSync(join(root, 'supabase-migration-v43.sql'), 'utf8');
assert.match(idempotencyMigration, /add column if not exists request_id uuid/, 'В записях нет идентификатора идемпотентности');
assert.match(idempotencyMigration, /create unique index if not exists idx_bookings_request_id/, 'Идентификатор идемпотентности не защищён уникальным индексом');
assert.match(idempotencyMigration, /pg_advisory_xact_lock\(hashtextextended\('booking-request:/, 'Повторные запросы не сериализуются на сервере');
assert.match(idempotencyMigration, /message = 'request_conflict'/, 'Повтор идентификатора с изменёнными данными не отклоняется');
assert.match(idempotencyMigration, /public\.book_appointment\(uuid, uuid, date, time without time zone, text, text\)/, 'Новая RPC-функция не опубликована для клиента');

const immutableRequestMigration = readFileSync(join(root, 'supabase-migration-v44.sql'), 'utf8');
assert.match(immutableRequestMigration, /add column if not exists request_fingerprint text/, 'Исходный запрос не получает неизменяемый отпечаток');
assert.match(immutableRequestMigration, /booking\.request_fingerprint/, 'Повтор сравнивается с изменяемыми полями записи');
assert.doesNotMatch(immutableRequestMigration, /v_existing_(?:service|date|time|name|phone)/, 'Повтор всё ещё зависит от изменяемого состояния записи');
assert.match(immutableRequestMigration, /request_fingerprint ~ '\^\[0-9a-f\]\{64\}\$'/, 'Формат серверного отпечатка не ограничен');
assert.match(app, /clearBookingAttempt\(\);\s*\n\s*\$\('#bookingFlow'\)/, 'Подтверждённая запись оставляет попытку в sessionStorage');

const portfolioMigration = readFileSync(join(root, 'supabase-migration-v45.sql'), 'utf8');
assert.match(portfolioMigration, /create table if not exists public\.portfolio_items/, 'Нет серверного хранения карточек портфолио');
assert.match(portfolioMigration, /create table if not exists public\.portfolio_photos/, 'Нет серверного хранения метаданных фотографий');
assert.match(portfolioMigration, /portfolio_publication_requires_consent/, 'Сервер разрешает публикацию без согласия клиента');
assert.match(portfolioMigration, /'portfolio-images',[\s\S]*false,[\s\S]*8388608/, 'Хранилище портфолио не является закрытым или не ограничивает размер');
assert.match(portfolioMigration, /array\['image\/webp'\]/, 'Хранилище принимает файлы с лишними метаданными');
assert.match(portfolioMigration, /portfolio_objects_public_select/, 'Нет ограниченного публичного чтения опубликованных фотографий');
assert.match(portfolioMigration, /create or replace function public\.reorder_portfolio_items/, 'Нет серверного изменения порядка портфолио');

const privacy = readFileSync(join(root, 'privacy.html'), 'utf8');
assert.match(privacy, /Фотографии «до» и «после» публикуются[^.]+согласия клиента/, 'В политике не описано согласие на публикацию работ');
assert.match(privacy, /EXIF и геометки/, 'В политике не описано удаление метаданных фотографий');

const reliability = readFileSync(join(root, 'reliability.js'), 'utf8');
assert.match(reliability, /removeItem\('minuta-last-booking-url'\)/, 'Старый секретный токен не очищается');
assert.match(reliability, /removeExpired/, 'Нет автоматического удаления просроченного офлайн-кэша');

const productionHealth = readFileSync(join(root, 'production-health-check.mjs'), 'utf8');
assert.match(productionHealth, /`\\\$\{CACHE_PREFIX\}v\$\{expectedVersion\}`/, 'Production health ожидает неверное имя кэша Service Worker');

console.log('minuta-online-booking smoke test: OK');
