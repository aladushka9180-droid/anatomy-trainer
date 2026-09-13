#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const migration = readFileSync(new URL('supabase-migration-v154.sql', root));
const rollback = readFileSync(new URL('supabase-migration-v154-rollback.sql', root));
const integration = readFileSync(new URL('tests/booking-lookup-v154-integration.sql', root));
const workflow = readFileSync(new URL('../.github/workflows/minuta-v154-booking-lookup-release.yml', root));

const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalized = migration.toString('utf8').replaceAll('\r\n', '\n');
const declaration = /create\s+or\s+replace\s+function\s+public\.lookup_primetime_booking_request_v154\s*\(/i;
const start = normalized.search(declaration);
if (start < 0) throw new Error('v154 lookup definition is missing');
const bodyMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1\s*;/i.exec(normalized.slice(start));
if (!bodyMatch) throw new Error('v154 lookup body is missing');
const sourceHash = sha256(bodyMatch[2].replaceAll('\r', ''));

for (const [name, buffer] of [
  ['migration', migration],
  ['rollback', rollback],
  ['integration', integration],
  ['workflow', workflow],
]) {
  if (buffer.length === 0) throw new Error(`${name} is empty`);
}

const migrationText = migration.toString('utf8');
const rollbackText = rollback.toString('utf8');
if ((migrationText.match(new RegExp(sourceHash, 'g')) ?? []).length !== 2) {
  throw new Error('v154 migration source hash is not pinned twice');
}
if ((rollbackText.match(new RegExp(sourceHash, 'g')) ?? []).length !== 1) {
  throw new Error('v154 rollback source hash is not pinned');
}

process.stdout.write(`${JSON.stringify({
  version: 'v154',
  functionName: 'lookup_primetime_booking_request_v154',
  signature: 'public.lookup_primetime_booking_request_v154(uuid)',
  markerPrefix: 'minuta_booking_lookup_v154:sha256=',
  credentialKey: 'booking_lookup_v154',
  header: 'x-primetime-booking-lookup-key',
  headerSecretPattern: '^[0-9a-f]{64}$',
  executeRoles: ['anon'],
  sourceHash,
  migrationSha256: sha256(migration),
  rollbackSha256: sha256(rollback),
  integrationSha256: sha256(integration),
  workflowSha256: sha256(workflow),
})}\n`);
