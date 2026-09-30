import assert from 'node:assert/strict';

const SCHEMA_CONFIRM = 'SCHEMA_ONLY_EMPTY_DATABASE';
const RESTORE_CONFIRM = 'FULL_RESTORE_NETWORK_NONE';
const SCHEMA_DATABASE = 'a04-shifts-fixture';
const RESTORE_DATABASE = 'a04-shifts-full-restore';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateA04TargetEnv(env) {
  const confirmation = env.MINUTA_A04_EPHEMERAL_CONFIRM;
  assert.ok([SCHEMA_CONFIRM, RESTORE_CONFIRM].includes(confirmation), 'A04 target confirmation missing');
  const restore = confirmation === RESTORE_CONFIRM;
  let endpoint;
  try { endpoint = new URL(env.MINUTA_TEST_DATABASE_URL || 'invalid:'); }
  catch { throw new Error('A04 target URL invalid'); }
  assert.ok(['postgres:', 'postgresql:'].includes(endpoint.protocol), 'A04 target must use PostgreSQL');
  assert.ok(restore ? endpoint.hostname === '127.0.0.1'
    : ['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'A04 target must use loopback');
  assert.ok(endpoint.username, 'A04 target user missing');
  assert.equal(endpoint.search, '', 'A04 target URL options forbidden');
  assert.equal(endpoint.hash, '', 'A04 target URL fragment forbidden');
  const database = restore ? RESTORE_DATABASE : SCHEMA_DATABASE;
  assert.equal(decodeURIComponent(endpoint.pathname), `/${database}`, 'A04 target database mismatch');
  assert.equal(env.MINUTA_TEST_PROJECT_REF, database, 'A04 project ref mismatch');
  if (restore) {
    assert.match(env.MINUTA_A04_RESTORE_RUN_ID || '', UUID, 'A04 restore run ID missing');
    const port = Number(env.MINUTA_A04_RESTORE_PORT);
    assert.ok(Number.isInteger(port) && port >= 20000 && port <= 65535, 'A04 restore port must be ephemeral');
    assert.equal(Number(endpoint.port), port, 'A04 restore port mismatch');
  }
  return { restore, database, port:Number(endpoint.port || 5432), runId:restore ? env.MINUTA_A04_RESTORE_RUN_ID : null };
}

export async function assertA04RestoreServer(query, target) {
  if (!target.restore) return;
  const { rows } = await query(`select current_database() database,
    inet_server_addr()::text server_address,inet_client_addr()::text client_address,
    inet_server_port() server_port,pg_is_in_recovery() in_recovery,
    current_setting('server_version_num')::int server_version`);
  const server = rows[0];
  assert.ok(server, 'A04 server identity missing');
  assert.equal(server.database, target.database, 'A04 connected database mismatch');
  // SQL NULL from a Unix socket must fail closed, just like a non-loopback address.
  assert.equal(server.server_address, '127.0.0.1', 'A04 server is not IPv4 loopback');
  assert.equal(server.client_address, '127.0.0.1', 'A04 client is not IPv4 loopback');
  assert.equal(server.server_port, target.port, 'A04 connected port mismatch');
  assert.equal(server.in_recovery, false, 'A04 target is read-only recovery');
  assert.equal(Math.floor(server.server_version / 10000), 17, 'A04 requires PostgreSQL 17');
  const marker = await query(`select count(*)::int present
    from minuta_migration_guard.a04_full_restore_marker
    where run_id=$1::uuid and project_ref=$2 and database_name=current_database()
      and full_restore_verified is true and network_none_verified is true
      and expires_at>pg_catalog.now()`, [target.runId, target.database]);
  assert.equal(marker.rows[0]?.present, 1, 'A04 full-restore marker missing or stale');
}
