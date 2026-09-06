#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = read('..', '.github/workflows/minuta-v118-safe-release.yml');
const migration = read('supabase-migration-v118.sql');
const rollback = read('supabase-migration-v118-rollback.sql');
const integration = read('tests/client-page-settings-v118-integration.sql');
const errors = [];

requireText(workflow, 'workflow_dispatch:', 'workflow must be manual');
forbid(workflow, /\n\s+(?:push|schedule|pull_request):/, 'workflow must not have automatic triggers');
requireText(workflow, 'contents: read', 'contents permission must be read-only');
requireText(workflow, 'actions: read', 'actions permission must be read-only');
[
  'test-v118:',
  'validate-production-v118:',
  'apply-production-v118:',
  'observe-production-v118:',
  'APPLY_V118_TO_PRODUCTION',
  'test "$INPUT_COMMIT_SHA" = "$GITHUB_SHA"',
  'minuta-supabase-backup.yml',
  'backup_run_id',
  'test_run_id',
  'validation_run_id',
  'default_transaction_read_only=on',
  'v118-production-observation',
].forEach(token => requireText(workflow, token, `workflow is missing ${token}`));

const testJob = job('test-v118');
ordered(testJob, [
  'supabase-migration-v118.sql',
  'client-page-settings-v118-integration.sql',
  'supabase-migration-v118-rollback.sql',
  'supabase-migration-v118.sql',
], 'test job must execute apply -> integration -> rollback -> reapply');
requireText(testJob, 'migration-config-guard.mjs', 'test job must guard the isolated database');
requireText(testJob, 'rollback;', 'test job must discard its temporary fixture transaction');
forbid(testJob, /delete from public\.organizations/i, 'test job must not trigger last-owner protection during cleanup');

const applyJob = job('apply-production-v118');
for (const token of ['BACKUP_RUN_ID', 'TEST_RUN_ID', 'VALIDATION_RUN_ID', 'download-artifact@', 'sha256sum', 'environment: minuta-production']) {
  requireText(applyJob, token, `production apply is missing ${token}`);
}
forbid(applyJob, /supabase-migration-v(?:10[0-9]|11[0-7])\.sql/, 'v118 workflow must not reapply older migrations');

for (const block of [job('validate-production-v118'), job('observe-production-v118')]) {
  requireText(block, 'default_transaction_read_only=on', 'production validation and observation must be read-only');
}

for (const token of [
  'create table if not exists public.organization_client_page_settings',
  'get_minuta_client_page_settings_v118',
  'set_minuta_client_page_settings_v118',
  'get_public_minuta_catalog_v5',
  "has_organization_role(p_organization,array['owner']::text[])",
  'enable row level security',
]) requireText(migration.toLowerCase(), token.toLowerCase(), `migration is missing ${token}`);

forbid(rollback, /drop\s+table/i, 'v118 rollback must retain organization settings');
for (const token of ['get_public_minuta_catalog_v5', 'set_minuta_client_page_settings_v118', 'get_minuta_client_page_settings_v118']) {
  requireText(rollback, token, `rollback is missing ${token}`);
}
for (const token of ['check_client_page_v118_rollback', 'check_client_page_v118_reapply']) {
  requireText(integration, token, `integration test is missing ${token}`);
}

if (errors.length) {
  console.error('v118 release contract failed:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}
console.log('v118 release contract: OK');

function read(...parts) {
  return readFileSync(resolve(root, 'minuta-online-booking', ...parts), 'utf8');
}

function requireText(text, token, message) {
  if (!text.includes(token)) errors.push(message);
}

function forbid(text, pattern, message) {
  if (pattern.test(text)) errors.push(message);
}

function job(name) {
  const match = new RegExp(`^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [a-zA-Z][a-zA-Z0-9-]*:|(?![\\s\\S]))`, 'm').exec(workflow);
  if (!match) {
    errors.push(`workflow is missing job ${name}`);
    return '';
  }
  return match[0];
}

function ordered(text, tokens, message) {
  let offset = -1;
  for (const token of tokens) {
    offset = text.indexOf(token, offset + 1);
    if (offset < 0) {
      errors.push(message);
      return;
    }
  }
}
