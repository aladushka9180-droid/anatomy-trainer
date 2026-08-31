#!/usr/bin/env node

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Не задан ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function projectRef(name) {
  const value = required(name).toLowerCase();
  assert(/^[a-z0-9-]{6,64}$/.test(value), `${name} имеет недопустимый формат`);
  return value;
}

function postgresUrl(name) {
  let url;
  try {
    url = new URL(required(name));
  } catch {
    throw new Error(`${name} не является корректной строкой подключения`);
  }
  assert(['postgres:', 'postgresql:'].includes(url.protocol), `${name} должен использовать PostgreSQL`);
  assert(Boolean(url.hostname) && Boolean(url.username) && Boolean(url.pathname.replaceAll('/', '')), `${name} неполон`);
  return [
    url.hostname.toLowerCase(),
    decodeURIComponent(url.username).toLowerCase(),
    decodeURIComponent(url.pathname).toLowerCase(),
  ].join('|');
}

try {
  assert(required('MINUTA_TEST_MIGRATION_CONFIRM') === 'MIGRATE_ONLY_ISOLATED_TEST_DATABASE',
    'MINUTA_TEST_MIGRATION_CONFIRM не разрешает миграцию');
  const productionRef = projectRef('MINUTA_PRODUCTION_PROJECT_REF');
  const testRef = projectRef('MINUTA_TEST_PROJECT_REF');
  const testIdentity = postgresUrl('MINUTA_TEST_DATABASE_URL');

  assert(productionRef !== testRef, 'Тестовый project ref совпадает с production');
  assert(testIdentity.includes(testRef), 'MINUTA_TEST_DATABASE_URL не соответствует MINUTA_TEST_PROJECT_REF');
  assert(!testIdentity.includes(productionRef), 'MINUTA_TEST_DATABASE_URL содержит production project ref');
  console.log('Защитная проверка тестовой миграции: OK');
} catch (error) {
  console.error(`Защитная проверка тестовой миграции: ОШИБКА — ${error.message}`);
  process.exit(1);
}
