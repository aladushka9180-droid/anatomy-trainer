import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const [migration, rollback, app, provider, providerHtml, privacy, sw, telegramWorker] = await Promise.all([
  readFile(new URL('supabase-migration-v73.sql', root), 'utf8'),
  readFile(new URL('recovery/rollback-visitor-presence-v73.sql', root), 'utf8'),
  readFile(new URL('app.js', root), 'utf8'),
  readFile(new URL('provider.js', root), 'utf8'),
  readFile(new URL('provider.html', root), 'utf8'),
  readFile(new URL('privacy.html', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('../supabase/functions/telegram-booking-notify/index.ts', root), 'utf8')
]);

assert.match(migration, /visitor_notifications_enabled boolean not null default false/i);
assert.match(migration, /create table if not exists public\.booking_page_visits/i);
assert.match(migration, /alter table public\.booking_page_visits enable row level security/i);
assert.match(migration, /performer_id = \(select auth\.uid\(\)\)/i);
assert.match(migration, /revoke all on table public\.booking_page_visits from public, anon, authenticated/i);
assert.match(migration, /grant execute on function public\.register_public_booking_visit\(text\) to anon, authenticated/i);
assert.match(migration, /created_at >= pg_catalog\.now\(\) - interval '2 minutes'/i);
assert.match(migration, /created_at < pg_catalog\.now\(\) - interval '7 days'/i);
const visitTableDefinition = migration.match(/create table if not exists public\.booking_page_visits[\s\S]+?\n\);/i)?.[0] || '';
assert.doesNotMatch(visitTableDefinition, /visitor_(?:id|session|fingerprint)|client_(?:name|phone)|user_agent|ip_address/i);
assert.match(rollback, /drop table if exists public\.booking_page_visits/i);

assert.match(app, /db\.rpc\('register_public_booking_visit', \{ p_slug: requestedOrganizationSlug \}\)/);
assert.match(app, /if \(state\.organization\) void registerBookingPageVisit\(\)/);
assert.doesNotMatch(app, /register_public_booking_visit[^\n]+(?:client|phone|name|device|fingerprint)/i);

assert.match(providerHtml, /id="visitorNotificationForm"/);
assert.match(providerHtml, /id="visitorNotificationsEnabled"/);
assert.match(providerHtml, /id="visitorNotificationPanel"/);
assert.match(provider, /table: 'booking_page_visits'/);
assert.match(provider, /visitor_notifications_enabled:enabled/);
assert.match(provider, /document\.hidden && 'Notification' in window && Notification\.permission === 'granted'/);
assert.match(provider, /registration\.showNotification\('Минута · новый посетитель'/);
assert.match(provider, /event\.data\?\.type === 'open-provider-view'/);
assert.match(provider, /Новый посетитель смотрит страницу онлайн-записи/);
assert.match(privacy, /Уведомление о посещении страницы/);
assert.match(privacy, /без имени, телефона и идентификатора устройства/);
assert.match(telegramWorker, /payload\.table === "booking_page_visits"/);
assert.match(telegramWorker, /Новый посетитель сайта/);
assert.match(telegramWorker, /x-booking-secret/);
assert.match(sw, /massage-izhevsk-.*v148/s);
assert.match(sw, /addEventListener\('notificationclick'/);

console.log('visitor-presence-v73 static checks passed');
