// Native PostgreSQL, empty synthetic database only. No production or shared test DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const connectionString = process.env.MINUTA_TEST_DATABASE_URL || '';
const address = new URL(connectionString);
if (process.env.MINUTA_REPORT_EXPORT_EPHEMERAL_CONFIRM !== 'LOCAL_SYNTHETIC_DB_ONLY'
  || !['127.0.0.1','localhost'].includes(address.hostname)
  || address.pathname !== '/eldion-report-export-fixture') {
  throw new Error('isolated_synthetic_database_required');
}
const pg = await import(process.env.MINUTA_PG_MODULE ? pathToFileURL(process.env.MINUTA_PG_MODULE).href : 'pg');
const Client = pg.Client || pg.default?.Client;
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const fixture = read('report-export-owner-scope-fixture.sql');
const candidate = read('../report-export-owner-scope-candidate.sql');
const rollback = read('../report-export-owner-scope-rollback.sql');
const offlineAuthTable = read('../scripts/crm-snapshot-offline-bootstrap.sql').match(/^create table auth\.users\([^;]+;/m)?.[0];
const fullSchemaSql = read('report-export-owner-scope-full-schema.sql');
const fullSchemaAuthInsert = fullSchemaSql.match(/^insert into auth\.users\([\s\S]*?;/m)?.[0];
// Only columns used by this fixture, observed in a compared offline public restore.
// This is a column/type rehearsal, not a replacement for full constraints or RLS.
const observed = JSON.parse(read('report-export-owner-scope-observed-columns.json'));
assert.ok(offlineAuthTable && fullSchemaAuthInsert, 'offline auth fixture contract must exist');
assert.equal(observed.sourceRun,'36774331133');
assert.equal(observed.fullPublicRestoreCompared,true);
const client = new Client({ connectionString, application_name:'eldion-report-export-synthetic' });
const org = '00000000-0000-4000-8000-000000000001';
const foreignOrg = '00000000-0000-4000-8000-000000000002';
const owner = '00000000-0000-4000-8000-000000000011';
const admin = '00000000-0000-4000-8000-000000000012';
const specialist = '00000000-0000-4000-8000-000000000013';
const locationA = '00000000-0000-4000-8000-000000000021';
const locationB = '00000000-0000-4000-8000-000000000022';
const args = (organization=org, performer=null, location=null, phoneMode='masked', limit=1000, offset=0) =>
  [organization,'2026-09-01','2026-09-30',performer,location,phoneMode,limit,offset];

async function rpc(actor, functionName, values, expectedCode='') {
  await client.query('savepoint rpc_case');
  try {
    await client.query('set role authenticated');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)",[actor]);
    const result = await client.query(`select public.${functionName}($1,$2,$3,$4,$5,$6,$7,$8) payload`, values);
    assert.equal(expectedCode, '', `${functionName} unexpectedly succeeded`);
    await client.query('reset role');
    await client.query('release savepoint rpc_case');
    return result.rows[0].payload;
  } catch (error) {
    await client.query('rollback to savepoint rpc_case');
    await client.query('release savepoint rpc_case');
    if (!expectedCode) throw error;
    assert.equal(error.code, expectedCode, `${functionName} returned the wrong SQLSTATE`);
    return null;
  }
}

async function verify() {
  const bookingFn = 'get_minuta_report_export_bookings';
  const importFn = 'get_minuta_report_export_imported_history';
  await rpc(admin, bookingFn, args(org,null,null,'full'), '42501');
  await rpc(specialist, importFn, args(org,null,null,'full'), '42501');
  await rpc(admin, bookingFn, args(foreignOrg), '42501');
  await rpc(specialist, bookingFn, args(org,owner), '42501');
  await rpc(owner, bookingFn, args(org,null,locationB,'masked'), '');
  await rpc(owner, bookingFn, args(org,null,'00000000-0000-4000-8000-000000000023'), '22023');
  await rpc(admin, importFn, args(org,null,locationA), '22023');
  const full = await rpc(owner,bookingFn,args(org,null,null,'full'));
  assert.equal(full.bookings.length,2);
  assert.equal(full.bookings[0].client_phone,'+7 (900) 111-22-33');
  assert.equal(full.bookings[0].export_session_items.length,1);
  const masked = await rpc(admin,bookingFn,args());
  assert.equal(masked.bookings.length,2);
  assert.equal(masked.bookings[0].client_phone,'+7 *** ***-22-33');
  assert.equal(masked.bookings[0].client_had_previous,true);
  assert.equal(masked.bookings.every(row => row.organization_id === org),true);
  const location = await rpc(admin,bookingFn,args(org,null,locationA));
  assert.equal(location.bookings.length,1);
  assert.equal(location.bookings[0].location_id,locationA);
  const personal = await rpc(specialist,bookingFn,args(org,specialist));
  assert.equal(personal.bookings.length,2);
  const none = await rpc(admin,bookingFn,args(org,null,null,'none'));
  assert.equal(none.bookings.every(row => row.client_phone === ''),true);
  const firstPage = await rpc(admin,bookingFn,args(org,null,null,'masked',1,0));
  assert.equal(firstPage.bookings.length,1);
  assert.equal(firstPage.has_more,true);
  const secondPage = await rpc(admin,bookingFn,args(org,null,null,'masked',1,1));
  assert.equal(secondPage.bookings.length,1);
  assert.notEqual(secondPage.bookings[0].id,firstPage.bookings[0].id);
  const imported = await rpc(admin,importFn,args());
  assert.equal(imported.bookings.length,2);
  assert.equal(imported.bookings[0].client_phone,'+7 *** ***-22-33');
  assert.equal(imported.bookings[0].client_export_key,masked.bookings[0].client_export_key);
  assert.equal(imported.bookings[0].client_had_previous,true);
  await client.query('update public.organization_memberships set role=$1 where organization_id=$2 and user_id=$3',['owner',org,admin]);
  const promoted = await rpc(admin,bookingFn,args(org,null,null,'full'));
  assert.equal(promoted.bookings[0].client_phone,'+7 (900) 111-22-33');
  await client.query('update public.organization_memberships set active=false where organization_id=$1 and user_id=$2',[org,admin]);
  await rpc(admin,bookingFn,args(), '42501');
  await client.query('update public.organization_memberships set role=$1,active=true where organization_id=$2 and user_id=$3',['admin',org,admin]);
}

async function verifyObservedFixtureInserts() {
  const setup = fullSchemaSql.match(/do \$fixture\$[\s\S]*?end \$fixture\$;/)?.[0];
  assert.ok(setup,'full-schema fixture settings missing');
  const inserts = [...fullSchemaSql.matchAll(/^insert into (auth|public)\.([a-z_]+)\s*\(([^)]*)\)\s*(?:values|select)[\s\S]*?;/gm)];
  assert.equal(inserts.length,Object.keys(observed.tables).length,'every fixture INSERT needs an observed table');
  const identifiers = /^[a-z_][a-z0-9_]*$/;
  const types = new Set(['uuid','text','integer','bigint','boolean','date','time without time zone','timestamp with time zone','jsonb']);
  const usedTables = new Set();
  await client.query('create schema export_fixture_contract');
  for (const [qualified,table] of Object.entries(observed.tables)) {
    const [schema,name] = qualified.split('.');
    assert.ok(['auth','public'].includes(schema) && identifiers.test(name));
    const fields = Object.entries(table.columns).map(([column,type]) => {
      assert.ok(identifiers.test(column) && types.has(type));
      const required = table.required.includes(column) ? ' not null' : '';
      const generated = table.defaulted.includes(column) && type==='uuid' ? ' default gen_random_uuid()' : '';
      return `"${column}" ${type}${required}${generated}`;
    });
    await client.query(`create table export_fixture_contract."${name}" (${fields.join(',')})`);
  }
  await client.query(setup);
  for (const match of inserts) {
    const key=`${match[1]}.${match[2]}`,table=observed.tables[key];
    assert.ok(table && !usedTables.has(key),`unexpected or duplicate fixture INSERT: ${key}`);
    usedTables.add(key);
    const columns=match[3].split(',').map(value=>value.trim());
    assert.equal(new Set(columns).size,columns.length,`duplicate INSERT column: ${key}`);
    for (const column of columns) assert.ok(Object.hasOwn(table.columns,column),`unobserved INSERT column: ${key}.${column}`);
    for (const required of table.required) assert.ok(columns.includes(required),`required INSERT column omitted: ${key}.${required}`);
    const sql=match[0].replace(/\b(?:auth|public)\./g,'export_fixture_contract.');
    await client.query(sql);
  }
  assert.equal(usedTables.size,Object.keys(observed.tables).length);
}

await client.connect();
try {
  await client.query('begin');
  await client.query("set local statement_timeout='20s'; set local lock_timeout='5s'");
  await client.query(fixture);
  await verifyObservedFixtureInserts();
  // Execute the actual full-schema identity insert against the actual public-only
  // restore placeholder. This catches unavailable auth columns before a backup run.
  await client.query(offlineAuthTable);
  for (const [name, id] of [['owner', owner], ['admin', admin], ['staff', specialist]]) {
    await client.query("select set_config($1,$2,true)", ['export_probe.' + name, id]);
  }
  await client.query(fullSchemaAuthInsert);
  assert.equal((await client.query('select count(*)::int count from auth.users')).rows[0].count, 3);
  await client.query(candidate);
  await verify();
  await client.query(rollback);
  const absent = await client.query("select to_regprocedure('public.get_minuta_report_export_bookings(uuid,date,date,uuid,uuid,text,integer,integer)') missing");
  assert.equal(absent.rows[0].missing,null,'rollback did not remove the candidate');
  await client.query(candidate);
  await verify();
  await client.query('rollback');
  console.log('report export native PostgreSQL apply/rollback/reapply: ok');
} finally {
  try { await client.query('rollback'); } catch {}
  await client.end();
}
