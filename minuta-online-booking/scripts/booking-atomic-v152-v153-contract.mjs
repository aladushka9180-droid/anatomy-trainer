#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const layers = [
  {
    version: 'v152',
    migration: 'supabase-migration-v152.sql',
    rollback: 'supabase-migration-v152-rollback.sql',
    integration: 'tests/booking-recovery-v152-integration.sql',
    functionName: 'recover_primetime_booking_request_v1',
    signature: 'recover_primetime_booking_request_v1(uuid,uuid,uuid,uuid,date,time without time zone,text,text)',
    markerPrefix: 'minuta_booking_recovery_v152:sha256=',
    executeRoles: ['service_role'],
  },
  {
    version: 'v153',
    migration: 'supabase-migration-v153.sql',
    rollback: 'supabase-migration-v153-rollback.sql',
    integration: 'tests/booking-atomic-create-v153-integration.sql',
    functionName: 'book_minuta_appointment_v2',
    signature: 'book_minuta_appointment_v2(uuid,text,uuid,uuid,date,time without time zone,text,text,integer,integer)',
    markerPrefix: 'minuta_atomic_create_v153:sha256=',
    executeRoles: ['anon', 'authenticated'],
  },
];

const sha256 = value => createHash('sha256').update(value).digest('hex');

function read(relativePath) {
  return readFileSync(new URL(relativePath, root));
}

function functionSource(sqlBuffer, functionName) {
  const sql = sqlBuffer.toString('utf8').replaceAll('\r\n', '\n');
  const declaration = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${functionName}\\s*\\(`, 'i');
  const match = declaration.exec(sql);
  if (!match) throw new Error(`Expected public.${functionName} definition is missing`);
  const bodyMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\1\s*;/i.exec(sql.slice(match.index));
  if (!bodyMatch) throw new Error(`Expected public.${functionName} body is missing`);
  return bodyMatch[2].replaceAll('\r', '');
}

const result = Object.fromEntries(layers.map(layer => {
  const migration = read(layer.migration);
  const rollback = read(layer.rollback);
  const integration = read(layer.integration);
  const migrationText = migration.toString('utf8');
  const rollbackText = rollback.toString('utf8');
  const integrationText = integration.toString('utf8').replaceAll('\r\n', '\n');
  const compactMigration = migrationText.toLowerCase().replace(/\s/g, '');
  const compactRollback = rollbackText.toLowerCase().replace(/\s/g, '');
  const compactSignature = layer.signature.toLowerCase().replace(/\s/g, '');
  if (!migrationText.includes(layer.markerPrefix)) throw new Error(`${layer.version} marker prefix is missing`);
  const grantPrefix = `grantexecuteonfunctionpublic.${compactSignature}to`;
  const grantTargets = layer.executeRoles.length === 2
    ? [layer.executeRoles.join(','), [...layer.executeRoles].reverse().join(',')]
    : [layer.executeRoles[0]];
  if (!grantTargets.some(target => compactMigration.includes(`${grantPrefix}${target}`))) {
    throw new Error(`${layer.version} execute ACL is not exact`);
  }
  if (!compactRollback.includes(`dropfunctionifexistspublic.${compactSignature}`)) {
    throw new Error(`${layer.version} rollback does not target the exact function`);
  }
  if (!/^-- ISOLATED TEST DATABASE ONLY\./.test(integrationText)
      || !/\bbegin\s*;/i.test(integrationText)
      || !/\brollback\s*;\s*$/i.test(integrationText)) {
    throw new Error(`${layer.version} integration is not isolated by rollback`);
  }
  return [layer.version, {
    signature: `public.${layer.signature}`,
    markerPrefix: layer.markerPrefix,
    executeRoles: layer.executeRoles,
    sourceHash: sha256(functionSource(migration, layer.functionName)),
    migrationSha256: sha256(migration),
    rollbackSha256: sha256(rollback),
    integrationSha256: sha256(integration),
  }];
}));

process.stdout.write(`${JSON.stringify(result)}\n`);
