import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('./', import.meta.url);
const [worker, auth, index, booking, app, providerHtml, provider, styles, setup, sw] = await Promise.all([
  readFile(new URL('supabase/functions/telegram-client-notify/index.ts', root), 'utf8'),
  readFile(new URL('telegram-auth.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('booking.html', root), 'utf8'),
  readFile(new URL('app.js', root), 'utf8'),
  readFile(new URL('provider.html', root), 'utf8'),
  readFile(new URL('provider.js', root), 'utf8'),
  readFile(new URL('styles.css', root), 'utf8'),
  readFile(new URL('supabase/TELEGRAM_CLIENT_SETUP.md', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8')
]);

assert.match(worker, /TELEGRAM_AUTH_MAX_AGE_SECONDS = 15 \* 60/, 'Telegram authorization is not time-bounded');
assert.match(worker, /hmacSha256Hex\(await sha256Buffer\(botToken\), parsed\.dataCheckString\)/, 'Telegram authorization signature is not verified with the bot token');
assert.match(worker, /sameHash\(parsed\.hash, expected\)/, 'Telegram authorization signature comparison is not constant-time');
assert.match(worker, /path\.endsWith\("\/auth-config"\)/, 'Telegram login configuration route is missing');
assert.match(worker, /path\.endsWith\("\/authorize"\)/, 'Telegram web authorization route is missing');
assert.match(worker, /client_telegram_subscriptions[\s\S]*?telegram_user_id: auth\.id/, 'Verified Telegram identity is not linked to the client');
assert.match(worker, /sendBookingEvent\(booking, event\)/, 'Confirmation is not sent after Telegram authorization');

assert.match(auth, /request_access:'write'/, 'Telegram does not request permission to send messages');
assert.match(auth, /Telegram\.Login\.auth/, 'Telegram web authorization does not use the official login flow');
assert.match(auth, /manage_token:state\.manageToken, telegram_auth:auth/, 'Telegram login result is not verified by the backend');
assert.match(auth, /Telegram подключён/, 'Connected state is not visible to the client');
assert.match(auth, /Повторять это для следующих записей не придётся/, 'One-time authorization is not explained');
assert.doesNotMatch(auth, /window\.open\([^)]*t\.me/, 'Client is still redirected to a bot chat');
assert.match(app, /notifyTelegramEvent\('confirmation', manageToken\)/, 'Online booking does not trigger a Telegram confirmation for a connected client');
assert.match(provider, /deliverTelegramClientNotification\(createdBooking\.id, 'confirmation'\)/, 'Booking created by the master does not trigger a Telegram confirmation for a connected client');
assert.match(provider, /telegram_client_settings/, 'Master Telegram settings are not stored in protected account metadata');
assert.match(provider, /normalizeTelegramContactUsername/, 'Master Telegram username is not validated');
assert.match(worker, /performerTelegramSettings\(booking\.performer_id\)/, 'Delivery does not load the master notification settings');
assert.match(worker, /text: "Написать мастеру"/, 'Telegram message does not contain direct contact with the master');
assert.match(worker, /reason: "event_disabled"/, 'Disabled notification events are not respected by the worker');

for (const html of [index, booking]) {
  assert.match(html, /script-src 'self' https:\/\/telegram\.org/, 'Telegram login SDK is blocked by CSP');
  assert.match(html, /connect-src[^;]*https:\/\/oauth\.telegram\.org/, 'Telegram authorization is blocked by CSP');
  assert.match(html, /id="(?:telegramConnect|manageTelegramConnect)"[^>]*type="button"/, 'Telegram action is not an in-page button');
  assert.match(html, /Подключить Telegram/, 'Telegram action has no clear label');
  assert.match(html, /запускать бота не нужно/, 'The interface still asks the client to start a bot');
  assert.match(html, /telegram-auth\.js\?v=403/, 'Telegram authorization controller is not loaded');
}

assert.match(styles, /\.telegram-connect-button strong \{ font-size:14px/, 'Telegram action title is too small');
assert.match(styles, /\.telegram-connect-button small \{[^}]*font-size:12px/, 'Telegram action explanation is too small');
assert.match(index, /Можно пропустить — запись всё равно сохранена/, 'Optional Telegram authorization is not explained');
assert.match(provider, /telegramClientSettingsForm/, 'Master Telegram notification settings are not wired');
assert.match(providerHtml, /Бот пишет только клиентам, которые сами подключили Telegram/, 'Telegram settings do not explain who receives notifications');
assert.match(providerHtml, /выбранные уведомления продолжат работать без кнопки связи/, 'Optional master username is not explained');
assert.match(styles, /\.telegram-event-settings \.settings-check input \{[^}]*width:18px!important[^}]*height:18px!important/, 'Telegram event checkboxes can inherit full-size text input styles');
assert.match(styles, /\.telegram-event-settings \.settings-check span \{ display:grid/, 'Telegram event labels are not separated from their descriptions');
assert.match(sw, /'\.\/telegram-auth\.js\?v=403'/, 'Telegram authorization controller is not cached');
assert.match(setup, /\/setdomain/, 'Required BotFather domain setup is not documented');

console.log('Telegram web authorization v400 checks passed');
