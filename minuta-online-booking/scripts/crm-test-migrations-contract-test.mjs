// No shell execution, network, or external database. Optional PGlite is memory-only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const shell = readFileSync(new URL('crm-test-migrations.sh', import.meta.url), 'utf8').replaceAll('\r', '');
const integration = readFileSync(new URL('../client-records-v112-integration.sql', import.meta.url), 'utf8');
const nodeBlocks = [...shell.matchAll(/<<'JS'\n([\s\S]*?)\nJS/g)].map(match => match[1]);
const catalogGenerator = nodeBlocks.find(source => source.includes('const publicTables='));
const hashGenerator = shell.match(/<<'FINGERPRINT_JS'\n([\s\S]*?)\nFINGERPRINT_JS/)[1];
const files = new Map();
const executeGenerator = (source) => vm.runInNewContext(source.replace(/^import .*;\n/gm, ''), {
  assert, process: { env: { CRM_MIGRATION_PRIVATE_DIR: '/private' } },
  writeFileSync: (path, data, options) => { assert.equal(options.mode, 0o600); files.set(path, data); },
  readFileSync: (path) => { assert.ok(files.has(path)); return files.get(path); },
}, { timeout: 1000 });
executeGenerator(catalogGenerator);
const tables = JSON.parse(files.get('/private/tables.json'));
const manifest = Object.fromEntries(tables.map(table => [table, ['id', 'label', 'occurred_at']]));
files.set('/private/column-manifest.json', JSON.stringify(manifest));
executeGenerator(hashGenerator);
const fingerprintSql = files.get('/private/fingerprints.sql');
const manifestSql = files.get('/private/column-manifest.sql');

test('one fixed 24-table manifest captures catalog columns before first write', () => {
  assert.equal(tables.length, 24);
  assert.equal(new Set(tables).size, 24);
  assert.ok(tables.includes('auth.users') && tables.includes('storage.objects'));
  assert.equal(tables.filter(table => table.startsWith('public.')).length, 22);
  assert.match(manifestSql, /a\.attnum>0 and not a\.attisdropped/);
  assert.match(manifestSql, /jsonb_agg\(a\.attname order by a\.attnum\)/);
  assert.equal((shell.match(/-f "\$private_dir\/column-manifest\.sql"/g) || []).length, 1);
  assert.ok(shell.indexOf('fingerprints "$private_dir/fingerprints-before.json"') < shell.indexOf('phase=apply-v112-v114'));
});

test('active owner fixture predicate matches integration and precedes migrations', () => {
  for (const predicate of ["o.id=b.organization_id and o.status='active'",
    "m.organization_id=o.id and m.role='owner' and m.active",
    "public.normalize_client_phone(b.client_phone) ~ '^7[0-9]{10}$'"]) {
    assert.ok(shell.includes(predicate)); assert.ok(integration.includes(predicate));
  }
  assert.ok(shell.indexOf('test_v112_active_owner_booking_fixture_missing') < shell.indexOf('phase=apply-v112-v114'));
});

test('fingerprints are server-side, frozen-column, stable-order and UTC', () => {
  assert.match(fingerprintSql, /^begin read only;/);
  assert.match(fingerprintSql, /set local search_path='pg_catalog';/);
  assert.match(fingerprintSql, /set local timezone='UTC';/);
  assert.match(fingerprintSql, /set local datestyle='ISO, YMD';/);
  assert.match(fingerprintSql, /to_jsonb\(ROW\(t\."id",t\."label",t\."occurred_at"\)\)/);
  assert.match(fingerprintSql, /string_agg\(row_hash,'' order by row_hash collate "C"\)/);
  assert.doesNotMatch(fingerprintSql, /to_jsonb\(t\)|t\.\*/);
  assert.equal((fingerprintSql.match(/ as fingerprint /g) || []).length, 24);
  assert.match(fingerprintSql, /rollback;\n$/);
});

test('runtime, reverse rollback and final stage compare private original-value hashes', () => {
  for (const suffix of ['after-runtime', 'after-rollback', 'after']) {
    assert.ok(shell.includes(`fingerprints "$private_dir/fingerprints-${suffix}.json"`));
    assert.ok(shell.includes(`cmp --silent "$private_dir/fingerprints-before.json" "$private_dir/fingerprints-${suffix}.json"`));
  }
  assert.match(shell, /oldColumnFingerprintsVerified:true/);
  assert.match(shell, /oldColumnFingerprintTables:24/);
  assert.doesNotMatch(shell, /cat[^\n]*(?:fingerprints|column-manifest).*json/);
  assert.match(shell, /fingerprints\.sql" >"\$1" 2>"\$private_dir\/database\.log"/);
  assert.match(shell, /<<'FINGERPRINT_JS'/);
});

test('manifest mismatch or malformed metadata fails closed', () => {
  const valid = files.get('/private/column-manifest.json');
  for (const invalid of [
    { ...manifest, 'external.secrets': ['id'] },
    { ...manifest, 'auth.users': [] },
    { ...manifest, 'auth.users': ['id', 'id'] },
    { ...manifest, 'auth.users': [null] },
  ]) {
    files.set('/private/column-manifest.json', JSON.stringify(invalid));
    assert.throws(() => executeGenerator(hashGenerator));
  }
  files.set('/private/column-manifest.json', valid);
});

test('generated SQL ignores additive columns but detects old values, nulls and lost duplicates', async (t) => {
  let PGlite;
  const modulePath = process.env.MINUTA_PGLITE_MODULE;
  if (!modulePath) { t.skip('Set MINUTA_PGLITE_MODULE for isolated SQL runtime verification'); return; }
  ({ PGlite } = await import(modulePath.startsWith('file:') ? modulePath : pathToFileURL(modulePath).href));
  const db = new PGlite();
  try {
    await db.exec('create schema auth; create schema storage;');
    for (const table of tables) {
      await db.exec(`create table ${table}(id integer,label text,occurred_at timestamptz);`);
      await db.exec(`insert into ${table} values(1,'synthetic-only','2026-09-05T08:00:00Z'),(1,'synthetic-only','2026-09-05T08:00:00Z'),(2,null,null);`);
    }
    const objectResult = (results) => results.find(result => result.rows[0]?.jsonb_object_agg)?.rows[0].jsonb_object_agg;
    const actualManifest = objectResult(await db.exec(manifestSql));
    assert.deepEqual(actualManifest, manifest);
    const hashes = async () => objectResult(await db.exec(fingerprintSql));
    const baseline = await hashes();
    assert.equal(Object.keys(baseline).length, 24);
    assert.equal(baseline['auth.users'].count, 3);
    assert.match(baseline['auth.users'].sha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(baseline).includes('synthetic-only'));
    await db.exec("alter table public.bookings add column additive text default 'ignored'; set timezone='Pacific/Auckland';");
    assert.deepEqual(await hashes(), baseline, 'new columns and session timezone must not affect fingerprints');
    await db.exec("update public.bookings set label='changed' where id=1;");
    assert.notEqual((await hashes())['public.bookings'].sha256, baseline['public.bookings'].sha256);
    await db.exec("update public.bookings set label='synthetic-only' where id=1;");
    assert.deepEqual(await hashes(), baseline);
    await db.exec("update public.bookings set label='' where id=2;");
    assert.notEqual((await hashes())['public.bookings'].sha256, baseline['public.bookings'].sha256, 'NULL differs from empty');
    await db.exec("update public.bookings set label=null where id=2; delete from public.bookings where ctid in(select ctid from public.bookings where id=1 limit 1);");
    assert.notEqual((await hashes())['public.bookings'].sha256, baseline['public.bookings'].sha256, 'duplicate removal is detected');
  } finally { await db.close(); }
});
