#!/usr/bin/env node

const mode = process.argv[2];

const EXPECTED_PRODUCTION_REF = 'cawexmmrqjvothcbgjxr';
const EXPECTED_TEST_REF = 'umazhvvxutnsyuphbhda';
const RESTORE_CONFIRMATION = `RESTORE_${EXPECTED_TEST_REF.toUpperCase()}_FROM_VERIFIED_PRODUCTION_BACKUP`;

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Не задан ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function exactSha(name) {
  const value = required(name).toLowerCase();
  assert(/^[a-f0-9]{40}$/.test(value), `${name} должен быть полным SHA-1 из 40 символов`);
  return value;
}

function connectionIdentity(name) {
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

const exactFiles = new Set([
  '.github/workflows/minuta-crm-server-release.yml',
  'minuta-online-booking/CRM_SERVER_RELEASE.md',
  'minuta-online-booking/client-records-v112-integration.sql',
  'minuta-online-booking/notification-v114-integration-test.ts',
  'minuta-online-booking/notification-v114-static-test.mjs',
  'minuta-online-booking/profitability-v113-static-test.mjs',
  'minuta-online-booking/recovery/rollback-client-records-v112.sql',
  'minuta-online-booking/scripts/crm-server-release-guard.mjs',
  'minuta-online-booking/scripts/crm-server-release-schema-check.sql',
  'minuta-online-booking/supabase-migration-v112.sql',
  'minuta-online-booking/supabase-migration-v113-operational-rollback.sql',
  'minuta-online-booking/supabase-migration-v113-rollback.sql',
  'minuta-online-booking/supabase-migration-v113.sql',
  'minuta-online-booking/supabase-migration-v114-rollback.sql',
  'minuta-online-booking/supabase-migration-v114.sql',
  'minuta-online-booking/telegram-reminder-security-v77-static-test.mjs',
  'minuta-online-booking/telegram-web-auth-v346-static-test.mjs',
  'minuta-online-booking/tests/client-records-pglite-runtime-test.mjs',
  'minuta-online-booking/tests/profitability-v113-pglite-runtime-test.mjs',
  'minuta-online-booking/tests/profitability-v113-schema-check.sql',
  'minuta-online-booking/supabase/TELEGRAM_CLIENT_SETUP.md',
]);

const allowedPrefixes = [
  'minuta-online-booking/supabase/functions/telegram-client-notify/',
  'supabase/functions/notification-dispatcher/',
];

const requiredReleaseFiles = [
  'minuta-online-booking/supabase-migration-v112.sql',
  'minuta-online-booking/supabase-migration-v113.sql',
  'minuta-online-booking/supabase-migration-v114.sql',
  'minuta-online-booking/recovery/rollback-client-records-v112.sql',
  'minuta-online-booking/supabase-migration-v113-rollback.sql',
  'minuta-online-booking/supabase-migration-v114-rollback.sql',
  'minuta-online-booking/supabase/functions/telegram-client-notify/index.ts',
  'supabase/functions/notification-dispatcher/index.ts',
];

try {
  if (mode === 'config') {
    exactSha('MINUTA_RELEASE_SHA');
    exactSha('MINUTA_SERVER_BASE_SHA');
    exactSha('GITHUB_SHA');
    assert(required('GITHUB_REF') === 'refs/heads/main', 'Preprod разрешён только из main');

    const productionRef = required('MINUTA_PRODUCTION_PROJECT_REF').toLowerCase();
    const testRef = required('MINUTA_TEST_PROJECT_REF').toLowerCase();
    assert(productionRef === EXPECTED_PRODUCTION_REF, 'Неожиданный production project ref');
    assert(testRef === EXPECTED_TEST_REF, 'Неожиданный test project ref');
    assert(productionRef !== testRef, 'Production и test project ref совпадают');
    assert(required('MINUTA_TEST_MIGRATION_CONFIRM') === 'MIGRATE_ONLY_ISOLATED_TEST_DATABASE',
      'MINUTA_TEST_MIGRATION_CONFIRM не разрешает тестовую миграцию');
    assert(required('MINUTA_TEST_RESTORE_CONFIRM') === RESTORE_CONFIRMATION,
      'Не получено точное разрешение на перезапись выбранной testDB');

    const productionIdentity = connectionIdentity('SUPABASE_DB_URL');
    const testIdentity = connectionIdentity('MINUTA_TEST_DATABASE_URL');
    assert(productionIdentity.includes(productionRef), 'SUPABASE_DB_URL не соответствует production ref');
    assert(testIdentity.includes(testRef), 'MINUTA_TEST_DATABASE_URL не соответствует test ref');
    assert(!testIdentity.includes(productionRef), 'Test URL содержит production ref');
    assert(productionIdentity !== testIdentity, 'Production и test URL указывают на одну базу');
    console.log('CRM server release config guard: OK');
  } else if (mode === 'tree') {
    const changedFiles = required('MINUTA_CHANGED_FILES')
      .split(/\r?\n/)
      .map(value => value.trim().replaceAll('\\', '/'))
      .filter(Boolean);
    assert(changedFiles.length > 0, 'Server-only diff пуст');
    const rejected = changedFiles.filter(path => !exactFiles.has(path)
      && !allowedPrefixes.some(prefix => path.startsWith(prefix)));
    assert(rejected.length === 0, `В server-only SHA попали запрещённые файлы: ${rejected.join(', ')}`);
    for (const path of requiredReleaseFiles) {
      assert(changedFiles.includes(path), `В server-only diff отсутствует обязательный файл ${path}`);
    }
    assert(!changedFiles.some(path => /(^|\/)(provider|index|booking|my-bookings|waitlist)\.(html|js|css)$/i.test(path)),
      'Server-only SHA содержит пользовательский frontend');
    console.log(`CRM server release tree guard: OK (${changedFiles.length} файлов)`);
  } else {
    throw new Error('Использование: crm-server-release-guard.mjs <config|tree>');
  }
} catch (error) {
  console.error(`CRM server release guard: ОШИБКА — ${error.message}`);
  process.exit(1);
}
