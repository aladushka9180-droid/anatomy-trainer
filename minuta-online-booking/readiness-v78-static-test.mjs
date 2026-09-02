import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('./supabase-migration-v78.sql', import.meta.url), 'utf8');
const provider = await readFile(new URL('./provider.js', import.meta.url), 'utf8');
const health = await readFile(new URL('./production-health-check.mjs', import.meta.url), 'utf8');

assert.match(migration, /alter table public\.services replica identity full/i, 'Удаление услуги не передаёт владельца в Realtime');
assert.match(migration, /pg_publication_tables[\s\S]*supabase_realtime[\s\S]*services/i, 'Таблица услуг не подключается к Realtime безопасно и повторяемо');
assert.match(provider, /SERVICE_SYNC_INTERVAL_MS = 30000/, 'Резервная синхронизация между устройствами выполняется слишком редко');
assert.match(provider, /resetPasswordForEmail[\s\S]*redirectTo:/, 'Восстановление пароля не содержит обратную ссылку');
assert.match(health, /external\?\.email[\s\S]*disable_signup/, 'Production-проверка не контролирует email-вход и регистрацию');
for (const rpc of ['provider_delete_service', 'invite_minuta_member', 'accept_minuta_invitation']) {
  assert.match(health, new RegExp(`probeProtectedRpc\\('${rpc}'`), `Production-проверка не контролирует ${rpc}`);
}

console.log('readiness v78 static test: OK');
