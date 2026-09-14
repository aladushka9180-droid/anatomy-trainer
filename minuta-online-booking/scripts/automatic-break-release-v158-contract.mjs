#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const sourceRoot = resolve(process.env.MINUTA_V158_SOURCE_ROOT || root);
const readSource = path => readFileSync(join(sourceRoot, path));
const readHarness = path => readFileSync(join(root, path));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const migration = readSource('supabase-migration-v158.sql');
const normalized = migration.toString('utf8').replaceAll('\r\n','\n');
const sourceHash = name => {
  const start = normalized.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`,'i'));
  if (start<0) throw new Error(`v158 function missing: ${name}`);
  const body = /\bas\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1\s*;/i.exec(normalized.slice(start));
  if (!body) throw new Error(`v158 function body missing: ${name}`);
  return sha256(body[2].replaceAll('\r',''));
};
const manifest = [
  ['minuta_booking_buffer_source_snapshot_v158','public.minuta_booking_buffer_source_snapshot_v158(public.bookings,integer)','none','minuta_booking_buffer_source_snapshot_v158'],
  ['minuta_booking_buffer_allows_interval_v158','public.minuta_booking_buffer_allows_interval_v158(uuid,date,time without time zone,integer,uuid)','none','minuta_booking_buffer_allows_interval_v158'],
  ['get_minuta_provider_automatic_breaks_v158','public.get_minuta_provider_automatic_breaks_v158(date)','authenticated','minuta_provider_automatic_breaks_v158'],
  ['release_minuta_provider_automatic_break_v158','public.release_minuta_provider_automatic_break_v158(uuid,date,time without time zone,time without time zone,text)','authenticated','minuta_provider_automatic_break_release_v158'],
  ['minuta_slot_respects_booking_buffer','public.minuta_slot_respects_booking_buffer(uuid,date,time without time zone,integer,uuid)','none','minuta_slot_respects_booking_buffer_v158'],
  ['enforce_minuta_booking_buffer_v101','public.enforce_minuta_booking_buffer_v101()','none','enforce_minuta_booking_buffer_v158']
];
const functions = manifest.map(([name,signature,access,markerPrefix]) => ({ signature,sourceHash:sourceHash(name),access,markerPrefix }))
  .sort((a,b)=>a.signature.localeCompare(b.signature));
const files = [
  'supabase-migration-v158-rollback.sql','automatic-break-release-v158-static-test.mjs',
  'tests/automatic-break-release-v158-integration.sql','tests/automatic-break-release-v158-postgres-concurrency-test.mjs'
];
const hashes = Object.fromEntries(files.map(path=>[path,sha256(readSource(path))]));
hashes['scripts/automatic-break-release-v158-state.sql']=sha256(readHarness('scripts/automatic-break-release-v158-state.sql'));
hashes['../.github/workflows/minuta-v158-automatic-break-release.yml']=sha256(readHarness('../.github/workflows/minuta-v158-automatic-break-release.yml'));
process.stdout.write(`${JSON.stringify({
  version:'v158',
  tables:['public.booking_buffer_release_requests_v158','public.booking_buffer_release_sources_v158'],
  tableMarkerPrefix:'minuta_booking_buffer_release_v158:sha256=',
  functions,
  migrationSha256:sha256(migration),
  files:hashes
})}\n`);
