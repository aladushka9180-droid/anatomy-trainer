import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('./supabase-migration-v77.sql', import.meta.url), 'utf8');
const rollback = fs.readFileSync(new URL('./recovery/rollback-telegram-reminder-security-v77.sql', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('./supabase/functions/telegram-client-notify/index.ts', import.meta.url), 'utf8');

assert.match(migration, /minuta_telegram_client_reminder_secret/);
assert.match(migration, /x-reminder-secret/);
assert.match(migration, /get_telegram_reminder_secret_hash/);
assert.match(migration, /revoke all on function public\.get_telegram_reminder_secret_hash\(\) from public, anon, authenticated, service_role/);
assert.match(migration, /grant execute on function public\.get_telegram_reminder_secret_hash\(\) to service_role/);
assert.match(edge, /get_telegram_reminder_secret_hash/);
assert.match(edge, /x-reminder-secret/);
assert.match(edge, /MAX_JSON_BYTES/);
assert.match(rollback, /cron\.unschedule/);
assert.match(rollback, /drop function if exists public\.get_telegram_reminder_secret_hash\(\)/);

console.log('Telegram reminder security v77 static test: OK');
