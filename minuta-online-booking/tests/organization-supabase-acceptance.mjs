import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Test ref is intentionally pinned independently of mutable GitHub configuration.
// No production URL, dump, real account, email delivery or credential export is used.
const testRef = 'umazhvvxutnsyuphbhda';
const prodRef = 'cawexmmrqjvothcbgjxr';
const out = resolve(process.env.MINUTA_ACCEPTANCE_OUT || 'organization-supabase-evidence');
const report = { mode: 'read-only-preflight', sourceSha: '05204730f217023883d61b31c914d3517d5b2b39', checks: [], status: 'running' };
let client, phase = 'test-target-guard';
function check(condition, label) { if (!condition) throw new Error(label); report.checks.push(label); }
function mask(value) { if (value) process.stdout.write(`::add-mask::${value}\n`); }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}
try {
  await mkdir(out, { recursive: true });
  check(process.env.MINUTA_TEST_PROJECT_REF === testRef && process.env.MINUTA_PRODUCTION_PROJECT_REF === prodRef && testRef !== prodRef, 'separate-pinned-test-ref');
  const connectionString = process.env.MINUTA_TEST_DATABASE_URL || '';
  const identity = new URL(connectionString);
  check(['postgres:', 'postgresql:'].includes(identity.protocol), 'postgres-protocol');
  check((identity.hostname + decodeURIComponent(identity.username)).includes(testRef) && !connectionString.includes(prodRef), 'test-database-identity');
  // The management PAT returned 401 in the preceding recorded preflight.
  // Do not retry it, export keys, change credentials, or use the production secret.
  report.management = { status: 'unavailable', evidenceRun: '36990822599', reason: 'HTTP_401' };
  phase = 'test-database-connection';
  const { default: pg } = await import(pathToFileURL(resolve(process.env.MINUTA_ACCEPTANCE_DEPS, 'pg/lib/index.js')).href);
  if (identity.port === '6543') identity.port = '5432';
  const certificate = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(20000) });
  check(certificate.ok, 'official-supabase-root-certificate');
  const ca = await certificate.text();
  check(ca.includes('-----BEGIN CERTIFICATE-----'), 'valid-root-certificate-format');
  // Retain verification of the issuer chain and hostname, using the official CA.
  client = new pg.Client({ connectionString: identity.href, ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 20000, statement_timeout: 15000 });
  await client.connect();
  phase = 'schema-preflight';
  const tables = ['performer_profiles', 'services', 'organizations', 'locations', 'organization_memberships', 'organization_audit_log', 'organization_shift_settings', 'staff_location_shifts'];
  const result = await client.query(`select table_name,column_name,is_nullable,column_default,data_type from information_schema.columns where table_schema='public' and table_name=any($1) order by table_name,ordinal_position`, [tables]);
  report.columns = result.rows;
  for (const table of tables) check(result.rows.some(row => row.table_name === table), `table-${table}`);
  report.functions = (await client.query(`select p.proname,pg_get_function_identity_arguments(p.oid) as arguments from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1) order by p.proname`, [['get_minuta_workspace','get_minuta_shift_workspace','update_minuta_organization','create_minuta_organization','create_minuta_location','upsert_minuta_location']])).rows;
  for (const rpc of ['get_minuta_workspace', 'get_minuta_shift_workspace', 'update_minuta_organization']) check(report.functions.some(row => row.proname === rpc), `rpc-${rpc}`);
  report.triggers = (await client.query(`select event_object_schema,event_object_table,trigger_name,action_statement from information_schema.triggers where (event_object_schema='public' and event_object_table=any($1)) or event_object_schema='auth' order by event_object_schema,event_object_table,trigger_name`, [tables])).rows;
  report.status = 'pass';
  console.log(`Genuine Supabase read-only preflight PASS: ${report.checks.length} checks; no writes or credential export.`);
} catch (error) {
  report.status = 'blocked'; report.phase = phase; report.reason = /^[A-Za-z0-9_-]+$/.test(String(error.message)) ? error.message : String(error.code || error.name || 'request_failed');
  console.error(`Genuine Supabase preflight stopped: ${phase} (${report.reason}). No writes attempted.`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
  await writeFile(resolve(out, 'result.json'), JSON.stringify(report, null, 2));
}
