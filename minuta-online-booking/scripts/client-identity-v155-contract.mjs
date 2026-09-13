#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceRoot = resolve(process.env.MINUTA_V155_SOURCE_ROOT || root);
const readSource = relativePath => readFileSync(join(sourceRoot, relativePath));
const readHarness = relativePath => readFileSync(join(root, relativePath));
const sha256 = value => createHash('sha256').update(value).digest('hex');

const migration = readSource('supabase-migration-v155.sql');
const rollback = readSource('supabase-migration-v155-rollback.sql');
const integration = readSource('tests/client-identity-v155-integration.sql');
const concurrency = readSource('tests/client-identity-v155-postgres-concurrency-test.mjs');
const databaseStatic = readSource('tests/client-identity-v155-db-static-test.mjs');
const state = readHarness('scripts/client-identity-v155-state.sql');
const counts = readHarness('scripts/client-identity-v155-business-counts.sql');
const workflow = readHarness('../.github/workflows/minuta-v155-client-identity-release.yml');

const manifest = [
  ['assign_booking_client_account', 'public.assign_booking_client_account()', 'service', 'minuta_client_identity_binding_v155', false],
  ['bootstrap_client_access', 'public.bootstrap_client_access(uuid,text)', 'public', 'minuta_client_identity_v155', false],
  ['book_minuta_appointment_with_benefit_v115', 'public.book_minuta_appointment_with_benefit_v115(uuid,text,uuid,uuid,date,time without time zone,text,text,text)', 'public', 'minuta_client_identity_v155', false],
  ['restore_client_session', 'public.restore_client_session(text)', 'public', 'minuta_client_identity_v155', false],
  ['get_client_bookings_v3', 'public.get_client_bookings_v3(text)', 'public', 'minuta_client_identity_v155', false],
  ['submit_booking_review', 'public.submit_booking_review(text,uuid,integer,text)', 'public', 'minuta_client_identity_v155', false],
  ['revoke_client_session', 'public.revoke_client_session(text)', 'public', 'minuta_client_identity_v155', false],
  ['rotate_client_access_code', 'public.rotate_client_access_code(text)', 'public', 'minuta_client_identity_v155', false],
  ['protect_client_identity_immutable_v155', 'public.protect_client_identity_immutable_v155()', 'none', 'minuta_client_identity_v155', true],
  ['resolve_client_identity_session_v155', 'public.resolve_client_identity_session_v155(text)', 'none', 'minuta_client_identity_v155', true],
  ['claim_client_booking_identity_v155', 'public.claim_client_booking_identity_v155(uuid,text)', 'public', 'minuta_client_identity_v155', true],
  ['upgrade_legacy_client_identity_session_v155', 'public.upgrade_legacy_client_identity_session_v155(text,text,text)', 'public', 'minuta_client_identity_v155', true],
  ['issue_client_identity_claim_grant_v155', 'public.issue_client_identity_claim_grant_v155(uuid,uuid,uuid,integer,uuid)', 'staff-service', 'minuta_client_identity_v155', true],
  ['issue_client_identity_sale_claim_v155', 'public.issue_client_identity_sale_claim_v155(uuid,uuid,uuid,integer,uuid,text)', 'staff-service', 'minuta_client_identity_v155', true],
  ['inspect_client_identity_sale_claim_v155', 'public.inspect_client_identity_sale_claim_v155(text,uuid)', 'service', 'minuta_client_identity_v155', true],
  ['consume_client_identity_sale_claim_v155', 'public.consume_client_identity_sale_claim_v155(text,text,uuid)', 'public', 'minuta_client_identity_v155', true],
  ['promote_client_identity_v155', 'public.promote_client_identity_v155(text,text)', 'public', 'minuta_client_identity_v155', true],
  ['begin_client_identity_transfer_v155', 'public.begin_client_identity_transfer_v155(text,text)', 'public', 'minuta_client_identity_v155', true],
  ['approve_client_identity_transfer_v155', 'public.approve_client_identity_transfer_v155(text,text,text)', 'public', 'minuta_client_identity_v155', true],
  ['consume_client_identity_transfer_v155', 'public.consume_client_identity_transfer_v155(text,text,text)', 'public', 'minuta_client_identity_v155', true],
  ['revoke_client_identity_session_v155', 'public.revoke_client_identity_session_v155(text)', 'public', 'minuta_client_identity_v155', true],
  ['get_client_identity_context_v155', 'public.get_client_identity_context_v155(text)', 'public', 'minuta_client_identity_v155', true],
  ['get_client_commerce_v155', 'public.get_client_commerce_v155(text)', 'public', 'minuta_client_identity_v155', true],
  ['reserve_client_benefit_v155', 'public.reserve_client_benefit_v155(uuid,uuid,uuid,uuid,integer,integer)', 'none', 'minuta_client_identity_v155', true],
  ['book_client_with_benefit_v155', 'public.book_client_with_benefit_v155(text,uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer,text,integer,integer)', 'service', 'minuta_client_identity_v155', true],
  ['bump_client_benefit_version_v155', 'public.bump_client_benefit_version_v155()', 'none', 'minuta_client_identity_v155', true],
];

const normalized = migration.toString('utf8').replaceAll('\r\n', '\n');
const sourceHash = name => {
  const declaration = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  const start = normalized.search(declaration);
  if (start < 0) throw new Error(`v155 function definition is missing: ${name}`);
  const body = /\bas\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1\s*;/i.exec(normalized.slice(start));
  if (!body) throw new Error(`v155 function body is missing: ${name}`);
  return sha256(body[2].replaceAll('\r', ''));
};

const functions = manifest.map(([name, signature, access, marker, versionObject]) => ({
  signature,
  sourceHash: sourceHash(name),
  access,
  marker,
  versionObject,
})).sort((left, right) => left.signature.localeCompare(right.signature));

const tables = [
  'public.client_identity_audit_v155',
  'public.client_identity_booking_requests_v155',
  'public.client_identity_claim_grants_v155',
  'public.client_identity_sessions_v155',
  'public.client_identity_transfers_v155',
];

process.stdout.write(`${JSON.stringify({
  version: 'v155',
  markerPrefix: 'minuta_client_identity_v155:sha256=',
  versionObjectCount: 24,
  functions,
  tables,
  migrationSha256: sha256(migration),
  rollbackSha256: sha256(rollback),
  integrationSha256: sha256(integration),
  concurrencySha256: sha256(concurrency),
  databaseStaticSha256: sha256(databaseStatic),
  stateSha256: sha256(state),
  businessCountsSha256: sha256(counts),
  workflowSha256: sha256(workflow),
})}\n`);
