// Real multi-connection PostgreSQL only; never point this at production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
execFileSync(process.execPath,[fileURLToPath(new URL('scripts/migration-config-guard.mjs',root))],{stdio:'inherit'});
const pg = await import(process.env.MINUTA_PG_MODULE
  ? pathToFileURL(process.env.MINUTA_PG_MODULE).href
  : 'pg');
const Client = pg.Client || pg.default?.Client;
assert.equal(typeof Client, 'function');

const scope = `v173-concurrency:${randomUUID()}`;
const clients = await Promise.all(Array.from({ length: 16 }, async () => {
  const client = new Client({ connectionString: process.env.MINUTA_TEST_DATABASE_URL,
    application_name: 'minuta-v173-abuse-concurrency' });
  await client.connect();
  return client;
}));
try {
  const results = await Promise.allSettled(clients.map(client => client.query(
    "select public.minuta_consume_abuse_limit_v173('booking_phone_hour',$1,3600,5)",
    [scope],
  )));
  const allowed = results.filter(result => result.status === 'fulfilled').length;
  const denied = results.filter(result => result.status === 'rejected');
  assert.equal(allowed,5);
  assert.equal(denied.length,11);
  assert.ok(denied.every(result => result.reason?.message === 'request_rate_limited'));
  const state = await clients[0].query(`select request_count from public.minuta_abuse_rate_buckets_v173
    where scope_kind='booking_phone_hour'
      and scope_sha256=encode(extensions.digest(convert_to($1,'UTF8'),'sha256'),'hex')`,[scope]);
  assert.equal(state.rows[0]?.request_count,5);
  console.log('PASS: v173 concurrent budget admits exactly five requests');
} finally {
  if (clients[0]) {
    await clients[0].query(`delete from public.minuta_abuse_rate_buckets_v173
      where scope_kind='booking_phone_hour'
        and scope_sha256=encode(extensions.digest(convert_to($1,'UTF8'),'sha256'),'hex')`,[scope]);
  }
  await Promise.all(clients.map(client => client.end()));
}
