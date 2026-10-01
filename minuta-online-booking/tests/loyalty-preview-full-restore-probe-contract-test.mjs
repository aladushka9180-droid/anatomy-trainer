import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import probe, {
  assertAttestedTarget, assertFreshScope, assertServerIdentity, exactTransactionBody,
  FRESH_SCOPE_FIELDS, O19_SOURCE_SHA256,
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
const target = { attested: true, expectedDatabase: 'o19-loyalty-full-restore', expectedPort: 6543 };
const connectionParameters = {
  host: '127.0.0.1', database: target.expectedDatabase, port: target.expectedPort,
};
const identity = {
  version: 170006, database: target.expectedDatabase, port: target.expectedPort,
  server_addr: '127.0.0.1', client_addr: '127.0.0.1',
  session_role: true, superuser: true, recovery: false,
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

test('attested target and live PG17 identity fail closed before synthetic seed', async () => {
  const db = { connectionParameters, query: async () => { throw new Error('query must not run'); } };
  assert.doesNotThrow(() => assertAttestedTarget(db, target));
  assert.doesNotThrow(() => assertServerIdentity(identity, target));
  for (const options of [
    { ...target, attested: false }, { ...target, expectedDatabase: 'postgres' },
    { ...target, expectedDatabase: 'other-restore' }, { ...target, expectedPort: 6544 },
  ]) {
    await assert.rejects(probe(db, { ...ids, ...options, seedSyntheticFixture: async () => {
      throw new Error('seed must not run');
    } }), /attestation|required|target|restore|mismatch/i);
  }
  assert.throws(() => assertAttestedTarget({ connectionParameters: {
    ...connectionParameters, host: 'db.example.invalid',
  } }, target), /loopback/);
  for (const bad of [
    { version: 160010 }, { database: 'other-restore' }, { port: 6544 },
    { server_addr: '10.0.0.1' }, { client_addr: '10.0.0.1' },
    { session_role: false }, { superuser: false }, { recovery: true },
  ]) {
    assert.throws(() => assertServerIdentity({ ...identity, ...bad }, target));
  }

  let seeded = false;
  const queried = [];
  const wrongServer = { connectionParameters, query: async sql => {
    queried.push(sql);
    if (sql.startsWith('savepoint ') || sql.startsWith('rollback to savepoint ') ||
        sql.startsWith('release savepoint ')) return { rows: [] };
    if (sql.includes("current_setting('server_version_num')")) {
      return { rows: [{ ...identity, superuser: false }] };
    }
    if (sql.includes('organization_exists')) {
      return { rows: [Object.fromEntries(FRESH_SCOPE_FIELDS.map(field => [field, false]))] };
    }
    throw new Error('unexpected query before seed');
  } };
  await assert.rejects(probe(wrongServer, { ...ids, ...target,
    seedSyntheticFixture: async () => { seeded = true; } }), /rolsuper/);
  assert.equal(seeded, false);
  assert.equal(queried.some(sql => sql.includes('pg_get_functiondef')), false);
});

test('negative debt proof is scoped and discarded before the main rollback sequence', () => {
  const text = readFileSync(new URL('./loyalty-preview-full-restore-probe.mjs', import.meta.url), 'utf8');
  const start = text.indexOf("await db.query('savepoint o19_negative_debt')");
  const setup = text.indexOf('set manual_progress=-1', start);
  const compensation = text.indexOf('[-1, 0, true, false]', setup);
  const rejection = text.indexOf("'invalid_loyalty_progress_result'", compensation);
  const restore = text.indexOf("await db.query('rollback to savepoint o19_negative_debt')", rejection);
  const mainRollback = text.indexOf('await db.query(rollbackSql)', restore);
  assert.ok(start > 0 && setup > start && compensation > setup && rejection > compensation &&
    restore > rejection && mainRollback > restore);
  assert.match(text.slice(start, restore), /where organization_id=\$1 and client_account_id=\$2/);
  assert.match(text.slice(start, restore), /where id=\$1 and organization_id=\$2 and client_account_id=\$3/);
});

test('probe refuses a missing outer transaction before calling fixture seed', async () => {
  const calls = [];
  let seeded = false;
  const db = { connectionParameters, query: async sql => {
    calls.push(sql);
    throw Object.assign(new Error('SAVEPOINT can only be used in transaction blocks'),
      { code: '25P01' });
  } };
  await assert.rejects(probe(db, { ...ids, ...target,
    seedSyntheticFixture: async () => { seeded = true; } }),
    { code: '25P01' });
  assert.equal(seeded, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^savepoint o19_full_restore_[a-f0-9]{32}$/);
});
