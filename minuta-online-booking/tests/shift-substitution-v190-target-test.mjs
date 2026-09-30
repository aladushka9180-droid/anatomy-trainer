import assert from 'node:assert/strict';
import test from 'node:test';
import { assertA04RestoreServer, validateA04TargetEnv } from './shift-substitution-v190-target.mjs';

const runId = '0f352a9c-16ba-4bc4-9e71-f8774e463d7b';
const restored = {
  MINUTA_A04_EPHEMERAL_CONFIRM:'FULL_RESTORE_NETWORK_NONE',
  MINUTA_TEST_DATABASE_URL:'postgresql://fixture@127.0.0.1:55432/a04-shifts-full-restore',
  MINUTA_TEST_PROJECT_REF:'a04-shifts-full-restore',
  MINUTA_A04_RESTORE_RUN_ID:runId,
  MINUTA_A04_RESTORE_PORT:'55432'
};

test('empty schema mode preserves its existing target identity', () => {
  const target = validateA04TargetEnv({
    MINUTA_A04_EPHEMERAL_CONFIRM:'SCHEMA_ONLY_EMPTY_DATABASE',
    MINUTA_TEST_DATABASE_URL:'postgresql://fixture@localhost/a04-shifts-fixture',
    MINUTA_TEST_PROJECT_REF:'a04-shifts-fixture'
  });
  assert.equal(target.restore, false);
});

test('full restore URL, confirmation, nonce and ephemeral port fail closed', () => {
  assert.equal(validateA04TargetEnv(restored).restore, true);
  for (const change of [
    { MINUTA_A04_EPHEMERAL_CONFIRM:'SCHEMA_ONLY_EMPTY_DATABASE' },
    { MINUTA_TEST_DATABASE_URL:'postgresql://fixture@db.example.invalid:55432/a04-shifts-full-restore' },
    { MINUTA_TEST_DATABASE_URL:'postgresql://fixture@localhost:55432/a04-shifts-full-restore' },
    { MINUTA_TEST_DATABASE_URL:'postgresql://fixture@127.0.0.1:55432/postgres' },
    { MINUTA_TEST_DATABASE_URL:'postgresql://fixture@127.0.0.1:5432/a04-shifts-full-restore' },
    { MINUTA_TEST_DATABASE_URL:'postgresql://fixture@127.0.0.1:55432/a04-shifts-full-restore?host=remote' },
    { MINUTA_A04_RESTORE_PORT:'5432' },
    { MINUTA_A04_RESTORE_RUN_ID:'' }
  ]) assert.throws(() => validateA04TargetEnv({ ...restored, ...change }));
});

test('server identity and marker must both match without accepting SQL NULL', async () => {
  const target = validateA04TargetEnv(restored);
  const server = { database:target.database,server_address:'127.0.0.1',client_address:'127.0.0.1',
    server_port:target.port,in_recovery:false,server_version:170011 };
  const query = (row, present=1) => async (sql, params) => {
    if (sql.includes('a04_full_restore_marker')) {
      assert.deepEqual(params, [runId,target.database]);
      return { rows:[{ present }] };
    }
    return { rows:[row] };
  };
  await assertA04RestoreServer(query(server), target);
  for (const row of [
    { ...server,server_address:null },
    { ...server,client_address:null },
    { ...server,server_address:'192.0.2.1' },
    { ...server,server_port:5432 },
    { ...server,database:'postgres' },
    { ...server,server_version:160000 }
  ]) await assert.rejects(assertA04RestoreServer(query(row), target));
  await assert.rejects(assertA04RestoreServer(query(server, 0), target));
  await assert.rejects(assertA04RestoreServer(async () => { throw new Error('marker absent'); }, target));
});
