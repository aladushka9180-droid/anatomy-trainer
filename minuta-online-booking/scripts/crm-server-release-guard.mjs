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

function connectionIdentity(name, projectRef) {
  let url;
  try {
    url = new URL(required(name));
  } catch {
    throw new Error(`${name} не является корректной строкой подключения`);
  }
  assert(['postgres:', 'postgresql:'].includes(url.protocol), `${name} должен использовать PostgreSQL`);
  assert(Boolean(url.hostname) && Boolean(url.username) && Boolean(url.pathname.replaceAll('/', '')), `${name} неполон`);
  const hostname = url.hostname.toLowerCase();
  const username = decodeURIComponent(url.username).toLowerCase();
  const database = decodeURIComponent(url.pathname).replace(/^\/+/, '').toLowerCase();
  const port = url.port || '5432';
  const direct = hostname === `db.${projectRef}.supabase.co` && username === 'postgres';
  const pooler = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pooler\.supabase\.com$/.test(hostname)
    && username === `postgres.${projectRef}`;
  assert(direct || pooler, `${name} не имеет точной привязки host/username к ожидаемому project ref`);
  assert(database === 'postgres', `${name} должен указывать на базу /postgres`);
  assert(['5432', '6543'].includes(port), `${name} использует недопустимый порт`);
  return [
    hostname,
    port,
    username,
    database,
  ].join('|');
}

const exactFiles = new Set([
  'minuta-online-booking/client-records-v112-integration.sql',
  'minuta-online-booking/notification-v114-integration-test.ts',
  'minuta-online-booking/recovery/rollback-client-records-v112.sql',
  'minuta-online-booking/supabase-migration-v112.sql',
  'minuta-online-booking/supabase-migration-v113-operational-rollback.sql',
  'minuta-online-booking/supabase-migration-v113-rollback.sql',
  'minuta-online-booking/supabase-migration-v113.sql',
  'minuta-online-booking/supabase-migration-v114-rollback.sql',
  'minuta-online-booking/supabase-migration-v114.sql',
  'minuta-online-booking/tests/client-records-pglite-runtime-test.mjs',
  'minuta-online-booking/tests/client-record-postgres-concurrency-test.sh',
  'minuta-online-booking/tests/client-record-postgres-fixture.mjs',
  'minuta-online-booking/tests/crm-integration-client-record-lifecycle-pglite-test.mjs',
  'minuta-online-booking/tests/profitability-v113-pglite-runtime-test.mjs',
  'minuta-online-booking/tests/profitability-v113-schema-check.sql',
]);

const allowedPrefixes = [
  'minuta-online-booking/supabase/functions/client-record-cleanup/',
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
  'minuta-online-booking/tests/crm-integration-client-record-lifecycle-pglite-test.mjs',
  'minuta-online-booking/supabase/functions/client-record-cleanup/handler.ts',
  'minuta-online-booking/supabase/functions/client-record-cleanup/handler_test.ts',
  'minuta-online-booking/supabase/functions/client-record-cleanup/index.ts',
  'minuta-online-booking/supabase/functions/telegram-client-notify/index.ts',
  'supabase/functions/notification-dispatcher/index.ts',
];

try {
  if (mode === 'config') {
    const releaseSha = exactSha('MINUTA_RELEASE_SHA');
    const baseSha = exactSha('MINUTA_SERVER_BASE_SHA');
    exactSha('GITHUB_SHA');
    assert(releaseSha !== baseSha, 'Release SHA совпадает с server base SHA');
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

    const productionIdentity = connectionIdentity('SUPABASE_DB_URL', productionRef);
    const testIdentity = connectionIdentity('MINUTA_TEST_DATABASE_URL', testRef);
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
    assert(!changedFiles.some(path => /\.(?:html|css)$/i.test(path)
      || /^minuta-online-booking\/(?:provider|index|booking|my-bookings|waitlist|client-records|profitability-management|notification-center)\.js$/i.test(path)),
      'Server-only SHA содержит пользовательский frontend');
    console.log(`CRM server release tree guard: OK (${changedFiles.length} файлов)`);
  } else {
    throw new Error('Использование: crm-server-release-guard.mjs <config|tree>');
  }
} catch (error) {
  console.error(`CRM server release guard: ОШИБКА — ${error.message}`);
  process.exit(1);
}
