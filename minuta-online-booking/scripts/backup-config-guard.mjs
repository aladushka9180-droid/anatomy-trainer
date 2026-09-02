#!/usr/bin/env node

const mode = process.argv[2];

if (!['backup', 'restore'].includes(mode)) {
  console.error('Использование: node backup-config-guard.mjs <backup|restore>');
  process.exit(2);
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Не задан ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parsePostgresUrl(name) {
  const raw = required(name);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} не является корректной строкой подключения`);
  }
  assert(['postgres:', 'postgresql:'].includes(url.protocol), `${name} должен использовать postgres:// или postgresql://`);
  assert(Boolean(url.hostname), `${name} не содержит имя сервера`);
  assert(Boolean(url.username), `${name} не содержит пользователя`);
  assert(Boolean(url.pathname.replaceAll('/', '')), `${name} не содержит имя базы`);
  return url;
}

function connectionIdentity(url) {
  return [
    url.hostname.toLowerCase(),
    url.port || '5432',
    decodeURIComponent(url.username).toLowerCase(),
    decodeURIComponent(url.pathname).toLowerCase(),
  ].join('|');
}

function validatesProjectRef(name) {
  const value = required(name).toLowerCase();
  assert(/^[a-z0-9-]{6,64}$/.test(value), `${name} имеет недопустимый формат`);
  return value;
}

try {
  const artifactOnly = mode === 'backup' && String(process.env.MINUTA_BACKUP_ARTIFACT_ONLY || '').trim() === 'true';
  if (!artifactOnly) {
    const endpoint = new URL(required('MINUTA_BACKUP_S3_ENDPOINT'));
    assert(endpoint.protocol === 'https:', 'MINUTA_BACKUP_S3_ENDPOINT должен использовать HTTPS');
    assert(!endpoint.username && !endpoint.password, 'Учётные данные нельзя помещать в MINUTA_BACKUP_S3_ENDPOINT');
    assert(!endpoint.search && !endpoint.hash, 'MINUTA_BACKUP_S3_ENDPOINT не должен содержать query или fragment');
    assert(endpoint.pathname === '/' || endpoint.pathname === '', 'MINUTA_BACKUP_S3_ENDPOINT не должен содержать путь');

    const bucket = required('MINUTA_BACKUP_S3_BUCKET');
    assert(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'MINUTA_BACKUP_S3_BUCKET имеет недопустимый формат');
    required('MINUTA_BACKUP_S3_ACCESS_KEY_ID');
    required('MINUTA_BACKUP_S3_SECRET_ACCESS_KEY');
    required('MINUTA_BACKUP_S3_REGION');
  }

  const prefix = required('MINUTA_BACKUP_S3_PREFIX');
  assert(!prefix.startsWith('/') && !prefix.endsWith('/'), 'MINUTA_BACKUP_S3_PREFIX не должен начинаться или заканчиваться символом /');
  assert(!prefix.split('/').includes('..'), 'MINUTA_BACKUP_S3_PREFIX не должен содержать ..');
  assert(!/[\r\n\\]/.test(prefix), 'MINUTA_BACKUP_S3_PREFIX содержит недопустимые символы');

  const retentionDays = Number(required('MINUTA_BACKUP_RETENTION_DAYS'));
  assert(Number.isInteger(retentionDays) && retentionDays >= 30 && retentionDays <= 3650,
    'MINUTA_BACKUP_RETENTION_DAYS должен быть целым числом от 30 до 3650');

  const password = required('BACKUP_ENCRYPTION_PASSWORD');
  assert(password.length >= 24, 'BACKUP_ENCRYPTION_PASSWORD должен содержать не менее 24 символов');
  parsePostgresUrl('SUPABASE_DB_URL');

  if (mode === 'restore') {
    assert(required('MINUTA_RESTORE_CONFIRM') === 'RESTORE_ONLY_ISOLATED_TEST_DATABASE',
      'MINUTA_RESTORE_CONFIRM не разрешает восстановление');

    const productionRef = validatesProjectRef('MINUTA_PRODUCTION_PROJECT_REF');
    const testRef = validatesProjectRef('MINUTA_RESTORE_TEST_PROJECT_REF');
    assert(productionRef !== testRef, 'Производственный и тестовый project ref совпадают');

    const production = parsePostgresUrl('SUPABASE_DB_URL');
    const restore = parsePostgresUrl('MINUTA_RESTORE_TEST_DB_URL');
    const productionIdentity = connectionIdentity(production);
    const restoreIdentity = connectionIdentity(restore);

    assert(productionIdentity !== restoreIdentity, 'Тестовая и производственная строки подключения указывают на одну базу');
    assert(productionIdentity.includes(productionRef), 'SUPABASE_DB_URL не соответствует MINUTA_PRODUCTION_PROJECT_REF');
    assert(restoreIdentity.includes(testRef), 'MINUTA_RESTORE_TEST_DB_URL не соответствует MINUTA_RESTORE_TEST_PROJECT_REF');
    assert(!restoreIdentity.includes(productionRef), 'Тестовая строка подключения содержит project ref production');
  }

  console.log(`Защитная проверка конфигурации ${mode}: OK`);
} catch (error) {
  console.error(`Защитная проверка конфигурации ${mode}: ОШИБКА — ${error.message}`);
  process.exit(1);
}
