import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import probe, {
  assertFreshScope, exactTransactionBody, FRESH_SCOPE_FIELDS, O19_SOURCE_SHA256,
} from './loyalty-preview-full-restore-probe.mjs';

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const hash = text => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const ids = {
  org: '00000000-0000-4000-8000-000000000010',
  ownerActor: '00000000-0000-4000-8000-000000000001',
  adminActor: '00000000-0000-4000-8000-000000000002',
  specialistActor: '00000000-0000-4000-8000-000000000003',
  clientAccount: '00000000-0000-4000-8000-000000000020',
};

test('O19 apply and rollback sources are exact and keep only their SQL bodies', () => {
  for (const [kind, name] of [
    ['apply', 'supabase-candidate-loyalty-adjustment-preview.sql'],
    ['rollback', 'supabase-candidate-loyalty-adjustment-preview-rollback.sql'],
  ]) {
    const sql = source(name);
    assert.equal(hash(sql), O19_SOURCE_SHA256[kind]);
    const body = exactTransactionBody(sql, O19_SOURCE_SHA256[kind]);
    assert.ok(!body.startsWith('begin;'));
    assert.ok(!body.endsWith('commit;'));
    assert.match(body, /set local search_path=public,extensions,pg_catalog;/);
    assert.match(body, /notify pgrst,'reload schema';/);
  }
  assert.match(source('supabase-candidate-loyalty-adjustment-preview.sql'),
    /create function public\.preview_minuta_loyalty_adjustment_v166/);
  assert.match(source('supabase-candidate-loyalty-adjustment-preview.sql'),
    /create function public\.confirm_minuta_loyalty_adjustment_v166/);
});

test('transaction wrapper parser refuses modified sources and preserves internal begin', () => {
  const sql = 'begin;\ncreate function f() returns void as $$ begin null; end $$ language plpgsql;\ncommit;\n';
  assert.match(exactTransactionBody(sql.replaceAll('\n', '\r\n'), hash(sql)),
    /\$\$ begin null; end \$\$/);
  assert.throws(() => exactTransactionBody(sql.replace('null;', 'select 1;'), hash(sql)),
    /source hash mismatch/);
  const unwrapped = 'select 1;';
  assert.throws(() => exactTransactionBody(unwrapped, hash(unwrapped)),
    /transaction framing changed/);
});

test('fresh-scope guard rejects every occupied or missing field', () => {
  const empty = Object.fromEntries(FRESH_SCOPE_FIELDS.map(field => [field, false]));
  assert.doesNotThrow(() => assertFreshScope(empty));
  for (const field of FRESH_SCOPE_FIELDS) {
    assert.throws(() => assertFreshScope({ ...empty, [field]: true }),
      new RegExp(field));
    const missing = { ...empty };
    delete missing[field];
    assert.throws(() => assertFreshScope(missing), new RegExp(field));
  }
});

test('probe refuses a missing outer transaction before calling fixture seed', async () => {
  const calls = [];
  let seeded = false;
  const db = { query: async sql => {
    calls.push(sql);
    throw Object.assign(new Error('SAVEPOINT can only be used in transaction blocks'),
      { code: '25P01' });
  } };
  await assert.rejects(probe(db, { ...ids, seedSyntheticFixture: async () => { seeded = true; } }),
    { code: '25P01' });
  assert.equal(seeded, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^savepoint o19_full_restore_[a-f0-9]{32}$/);
});
