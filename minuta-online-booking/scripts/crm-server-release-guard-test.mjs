#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./crm-server-release-guard.mjs', import.meta.url));
const baseEnv = {
  ...process.env,
  MINUTA_RELEASE_SHA: '1111111111111111111111111111111111111111',
  MINUTA_SERVER_BASE_SHA: '2222222222222222222222222222222222222222',
  GITHUB_SHA: '3333333333333333333333333333333333333333',
  GITHUB_REF: 'refs/heads/main',
  MINUTA_PRODUCTION_PROJECT_REF: 'cawexmmrqjvothcbgjxr',
  MINUTA_TEST_PROJECT_REF: 'umazhvvxutnsyuphbhda',
  MINUTA_TEST_MIGRATION_CONFIRM: 'MIGRATE_ONLY_ISOLATED_TEST_DATABASE',
  MINUTA_TEST_RESTORE_CONFIRM: 'RESTORE_UMAZHVVXUTNSYUPHBHDA_FROM_VERIFIED_PRODUCTION_BACKUP',
  SUPABASE_DB_URL: 'postgresql://postgres:secret@db.cawexmmrqjvothcbgjxr.supabase.co:5432/postgres',
  MINUTA_TEST_DATABASE_URL: 'postgresql://postgres.umazhvvxutnsyuphbhda:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
};

const requiredTree = [
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

function run(mode, overrides = {}) {
  return spawnSync(process.execPath, [guard, mode], {
    encoding: 'utf8',
    env: {...baseEnv, ...overrides},
  });
}

function expectPass(label, mode, overrides = {}) {
  const result = run(mode, overrides);
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
}

function expectFail(label, mode, overrides, message) {
  const result = run(mode, overrides);
  assert.notEqual(result.status, 0, `${label}: guard unexpectedly passed`);
  assert.match(result.stderr, message, `${label}: unexpected diagnostic`);
  assert.doesNotMatch(result.stderr, /secret/i, `${label}: diagnostic leaked connection credentials`);
}

expectPass('exact project configuration', 'config');
expectFail('wrong test ref', 'config', {MINUTA_TEST_PROJECT_REF: 'other-test'}, /Неожиданный test project ref/);
expectFail('production URL reused for test', 'config', {
  MINUTA_TEST_DATABASE_URL: baseEnv.SUPABASE_DB_URL,
}, /точной привязки host\/username/);
expectFail('project ref substring in pooler username is rejected', 'config', {
  MINUTA_TEST_DATABASE_URL: 'postgresql://postgres.umazhvvxutnsyuphbhda-extra:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres',
}, /точной привязки host\/username/);
expectFail('lookalike direct host is rejected', 'config', {
  MINUTA_TEST_DATABASE_URL: 'postgresql://postgres:secret@db.umazhvvxutnsyuphbhda.supabase.co.evil.invalid:5432/postgres',
}, /точной привязки host\/username/);
expectFail('unexpected database is rejected', 'config', {
  MINUTA_TEST_DATABASE_URL: 'postgresql://postgres.umazhvvxutnsyuphbhda:secret@aws-0-eu-central-1.pooler.supabase.com:6543/template1',
}, /базу \/postgres/);
expectFail('unexpected port is rejected', 'config', {
  MINUTA_TEST_DATABASE_URL: 'postgresql://postgres.umazhvvxutnsyuphbhda:secret@aws-0-eu-central-1.pooler.supabase.com:7777/postgres',
}, /недопустимый порт/);
expectFail('restore phrase is mandatory', 'config', {
  MINUTA_TEST_RESTORE_CONFIRM: 'RESTORE_TEST',
}, /точное разрешение/);
expectFail('only main can orchestrate preprod', 'config', {
  GITHUB_REF: 'refs/heads/codex/crm-server',
}, /только из main/);
expectFail('short release SHA is rejected', 'config', {
  MINUTA_RELEASE_SHA: '779bdda',
}, /полным SHA-1/);
expectFail('release must differ from its base', 'config', {
  MINUTA_SERVER_BASE_SHA: baseEnv.MINUTA_RELEASE_SHA,
}, /совпадает с server base SHA/);

expectPass('server migrations, cleanup worker and lifecycle test', 'tree', {
  MINUTA_CHANGED_FILES: requiredTree.join('\n'),
});
expectFail('frontend JavaScript is rejected', 'tree', {
  MINUTA_CHANGED_FILES: [...requiredTree, 'minuta-online-booking/provider.js'].join('\n'),
}, /запрещённые файлы/);
expectFail('unknown workflow is rejected', 'tree', {
  MINUTA_CHANGED_FILES: [...requiredTree, '.github/workflows/unsafe.yml'].join('\n'),
}, /запрещённые файлы/);
expectFail('cleanup worker cannot be omitted', 'tree', {
  MINUTA_CHANGED_FILES: requiredTree.filter(path => !path.endsWith('/handler.ts')).join('\n'),
}, /отсутствует обязательный файл/);
expectFail('lifecycle test cannot be omitted', 'tree', {
  MINUTA_CHANGED_FILES: requiredTree.filter(path => !path.includes('client-record-lifecycle')).join('\n'),
}, /отсутствует обязательный файл/);

console.log('CRM server release guard tests: PASS');
