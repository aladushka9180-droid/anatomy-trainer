import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { exactO24TransactionBody, O24_SQL_SHA256, probe } from './inventory-item-catalog-full-restore-probe.mjs';

const source = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('exact pinned apply and rollback SQL parse without their transaction wrapper', () => {
  for (const [name, hash] of [
    ['inventory-item-catalog-candidate.sql',O24_SQL_SHA256.apply],
    ['inventory-item-catalog-rollback.sql',O24_SQL_SHA256.rollback]
  ]) {
    const body = exactO24TransactionBody(source(name),hash);
    assert.ok(body.includes('public.'));
    assert.doesNotMatch(body,/^begin;|^commit;/im);
    assert.equal(exactO24TransactionBody(source(name).replaceAll('\r\n','\n'),hash),body);
    assert.throws(()=>exactO24TransactionBody(source(name)+'-- changed',hash));
  }
  assert.throws(()=>exactO24TransactionBody('begin;\nselect 1;\ncommit;\n',O24_SQL_SHA256.apply));
});

test('probe has no connection, commit or production target access', async () => {
  assert.equal(typeof probe,'function');
  await assert.rejects(probe({query(){throw new Error('must not query');}}), /attestation/);
  const code = readFileSync(new URL('./inventory-item-catalog-full-restore-probe.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/new Client\(|\.connect\(|\b(?:fetch|https?)\s*\(/);
  assert.doesNotMatch(code,/db\.query\(['"`]commit\b/i);
  assert.match(code,/rollback to savepoint/);
  assert.match(code,/release savepoint/);
  assert.match(code,/inet_server_addr\(\)/);
});

test('identity preflight rejects remote, socket NULL, wrong database and unprivileged callers before writes', async () => {
  const safe = { database:'o24-inventory-full-restore',server_address:'127.0.0.1',
    client_address:'127.0.0.1',server_port:25432,version:170011,recovery:false,privileged:true };
  for (const row of [
    { ...safe,server_address:'192.0.2.2' },{ ...safe,client_address:null },
    { ...safe,database:'postgres' },{ ...safe,server_port:5432 },{ ...safe,version:160000 },
    { ...safe,recovery:true },{ ...safe,privileged:false }
  ]) {
    let calls=0;
    const db={query:async()=>{calls+=1;return {rows:[row]};}};
    await assert.rejects(probe(db,{attested:true,expectedDatabase:safe.database,expectedPort:25432}));
    assert.equal(calls,1,'identity failure must precede savepoint and fixture');
  }
});
