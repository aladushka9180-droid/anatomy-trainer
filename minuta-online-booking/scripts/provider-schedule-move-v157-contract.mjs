#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceRoot = resolve(process.env.MINUTA_V157_SOURCE_ROOT || root);
const readSource = relativePath => readFileSync(join(sourceRoot, relativePath));
const readHarness = relativePath => readFileSync(join(root, relativePath));
const sha256 = value => createHash('sha256').update(value).digest('hex');

const migration = readSource('supabase-migration-v157.sql');
const rollback = readSource('supabase-migration-v157-rollback.sql');
const integration = readSource('tests/provider-schedule-move-v157-integration.sql');
const databaseStatic = readSource('provider-schedule-move-v157-static-test.mjs');
const state = readHarness('scripts/provider-schedule-move-v157-state.sql');
const workflow = readHarness('../.github/workflows/minuta-v157-provider-schedule-move-release.yml');
const restoreWorkflow = readHarness('../.github/workflows/minuta-supabase-restore-drill.yml');

const normalized = migration.toString('utf8').replaceAll('\r\n', '\n');
const sourceHash = name => {
  const declaration = new RegExp(`create\\s+function\\s+public\\.${name}\\s*\\(`, 'i');
  const start = normalized.search(declaration);
  if (start < 0) throw new Error(`v157 function definition is missing: ${name}`);
  const body = /\bas\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1\s*;/i.exec(normalized.slice(start));
  if (!body) throw new Error(`v157 function body is missing: ${name}`);
  return sha256(body[2].replaceAll('\r', ''));
};

const manifest = [
  ['minuta_provider_schedule_snapshot_v157','public.minuta_provider_schedule_snapshot_v157(public.bookings)','none','minuta_provider_schedule_move_snapshot_v157'],
  ['move_minuta_provider_schedule_booking_v157','public.move_minuta_provider_schedule_booking_v157(uuid,uuid,date,time without time zone,uuid,uuid,uuid,date,time without time zone,integer,text)','authenticated','minuta_provider_schedule_move_v157'],
  ['get_minuta_provider_schedule_move_v157','public.get_minuta_provider_schedule_move_v157(uuid)','authenticated','minuta_provider_schedule_move_lookup_v157'],
  ['undo_minuta_provider_schedule_booking_v157','public.undo_minuta_provider_schedule_booking_v157(uuid,uuid)','authenticated','minuta_provider_schedule_move_undo_v157']
];

const functions = manifest.map(([name,signature,access,markerPrefix]) => ({
  signature,
  sourceHash:sourceHash(name),
  access,
  markerPrefix
})).sort((left,right) => left.signature.localeCompare(right.signature));

process.stdout.write(`${JSON.stringify({
  version:'v157',
  table:'public.provider_schedule_moves_v157',
  tableMarkerPrefix:'minuta_provider_schedule_move_v157:sha256=',
  functions,
  migrationSha256:sha256(migration),
  rollbackSha256:sha256(rollback),
  integrationSha256:sha256(integration),
  databaseStaticSha256:sha256(databaseStatic),
  stateSha256:sha256(state),
  workflowSha256:sha256(workflow),
  restoreWorkflowSha256:sha256(restoreWorkflow)
})}\n`);
