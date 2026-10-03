// Offline renderer only. It never connects, restores, dispatches or applies SQL.
// Production execution still requires the owner's full CURRENT recovery gate.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const sources = Object.freeze([
  Object.freeze({ version: 'v186', phase: 'apply', file: 'supabase-migration-v186.sql', sha256: '4b744d779b6acd9e365c6239c75a63a0d885572051f196288211d4ccc86c4c45' }),
  Object.freeze({ version: 'v187', phase: 'apply', file: 'supabase-migration-v187.sql', sha256: '05f4c6f2fff3d66e5bdc1018dc71d6ec0eeafb3e878784d4092eaeea7d50055a' }),
  Object.freeze({ version: 'v187', phase: 'rollback', file: 'supabase-migration-v187-rollback.sql', sha256: '3d9f8b399460995b16f62f745750cd7058129ccfe0ab131c87c2f95bbacf9031' }),
  Object.freeze({ version: 'v186', phase: 'rollback', file: 'supabase-migration-v186-rollback.sql', sha256: 'ac196802a201ac37f8e5cc52849dcc6c5d58805df0fb6cf5e8e1111bc5b43a53' }),
]);
const readSource = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

export function verifySources(read = readSource) {
  return sources.map(source => {
    const sql = read(source.file).replace(/\r\n/g, '\n');
    assert.equal(createHash('sha256').update(sql).digest('hex'), source.sha256,
      'catalog SQL must equal its pinned tested Git blob');
    assert.equal((sql.match(/^begin;$/gm) || []).length, 1);
    assert.equal((sql.match(/^commit;$/gm) || []).length, 1);
    assert.match(sql, /\ncommit;\n?$/);
    return { ...source, sql };
  });
}

export function buildTransaction(phase, read = readSource) {
  assert.ok(['apply', 'rollback'].includes(phase), 'unsupported catalog operation');
  const selected = verifySources(read).filter(source => source.phase === phase);
  // Preserve all migration statements and rollback ledger guards. Strip only
  // their pinned outer wrappers so failure in either migration aborts both.
  const body = selected.map(source =>
    `-- ${source.file} sha256=${source.sha256}\n` +
    source.sql.replace(/^begin;$/m, '').replace(/^commit;$/m, '')
  ).join('\n');
  return `-- Candidate v186/v187 ${phase}; recovery and execution gates are external.\n` +
    `begin;\nset local lock_timeout='5s';\nset local statement_timeout='5min';\n` +
    `${body}\ncommit;\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [phase, destination, ...extra] = process.argv.slice(2);
    assert.equal(extra.length, 0);
    if (phase === 'verify') {
      assert.equal(destination, undefined);
      verifySources();
      console.log('v186/v187 pinned SQL sources: PASS; no database action');
    } else {
      assert.ok(destination, 'destination required');
      writeFileSync(destination, buildTransaction(phase), { flag: 'wx', mode: 0o600 });
    }
  } catch {
    console.error('catalog SQL rendering refused; no database action');
    process.exitCode = 1;
  }
}
