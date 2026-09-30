import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import probe, { exactTransactionBody, O08_SOURCE_SHA256 } from './shift-coverage-full-restore-probe.mjs';

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const hash = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

test('probe pins both exact O08 sources and removes only their transaction framing', () => {
  for (const [kind, name] of [
    ['apply', 'supabase-candidate-shift-coverage.sql'],
    ['rollback', 'supabase-candidate-shift-coverage-rollback.sql'],
  ]) {
    const sql = source(name);
    assert.equal(hash(sql), O08_SOURCE_SHA256[kind]);
    const body = exactTransactionBody(sql, O08_SOURCE_SHA256[kind]);
    assert.ok(!body.startsWith('begin;'));
    assert.ok(!body.endsWith('commit;'));
    assert.match(body, /set local search_path=public,extensions,pg_catalog;/);
    assert.match(body, /notify pgrst,'reload schema';/);
  }
  assert.match(source('supabase-candidate-shift-coverage-rollback.sql'),
    /disable_branch_shifts_before_coverage_rollback/);
});

test('framing helper keeps an internal PL/pgSQL begin and refuses edits', () => {
  const sql = 'begin;\ncreate function f() returns void as $$ begin null; end $$ language plpgsql;\ncommit;\n';
  const digest = hash(sql);
  assert.match(exactTransactionBody(sql.replaceAll('\n', '\r\n'), digest),
    /\$\$ begin null; end \$\$/);
  assert.throws(() => exactTransactionBody(sql.replace('null;', 'select 1;'), digest),
    /source hash mismatch/);
  const unwrapped = 'create function f() returns void as $$ begin null; end $$ language plpgsql;';
  assert.throws(() => exactTransactionBody(unwrapped, hash(unwrapped)),
    /transaction framing changed/);
});

test('probe requires the caller transaction before reading or writing restored data', async () => {
  const calls = [];
  const outsideTransaction = { query: async sql => {
    calls.push(sql);
    throw Object.assign(new Error('SAVEPOINT can only be used in transaction blocks'), { code: '25P01' });
  } };
  const ids = {
    org: '00000000-0000-4000-8000-000000000010',
    actor: '00000000-0000-4000-8000-000000000001',
    location: '00000000-0000-4000-8000-000000000020',
    adminActor: '00000000-0000-4000-8000-000000000002',
    specialistActor: '00000000-0000-4000-8000-000000000003',
  };
  await assert.rejects(probe(outsideTransaction, ids), { code: '25P01' });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^savepoint o08_full_restore_[a-f0-9]{32}$/);
});
