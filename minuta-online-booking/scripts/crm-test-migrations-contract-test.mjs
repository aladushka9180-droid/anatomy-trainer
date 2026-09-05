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
  assert.ok(shell.indexOf('fingerprints "$private_dir/fingerprints-before.json"') < shell.indexOf('phase="apply-v$version"'));
});

test('active owner fixture predicate matches integration and precedes migrations', () => {
  for (const predicate of ["o.id=b.organization_id and o.status='active'",
    "m.organization_id=o.id and m.role='owner' and m.active",
    "public.normalize_client_phone(b.client_phone) ~ '^7[0-9]{10}$'"]) {
    assert.ok(shell.includes(predicate)); assert.ok(integration.includes(predicate));
  }
  assert.ok(shell.indexOf('test_v112_active_owner_booking_fixture_missing') < shell.indexOf('phase="apply-v$version"'));
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

test('resume is opt-in for the reviewed failed run, unchanged v112 and newer encrypted backup',()=>{
  assert.match(shell,/resume_v112=false/);
  assert.ok(shell.includes('[[ -n "${RESUME_V112_RUN_ID:-}" || -n "${RESUME_V112_SHA:-}" ]]'));
  assert.ok(shell.includes('[[ "${RESUME_V112_RUN_ID:-}" == 33983858607 ]]'));
  assert.ok(shell.includes('[[ "${RESUME_V112_SHA:-}" == 678ada88563f200b804267bfe9d93195bbade4cf ]]'));
  assert.match(shell,/\.conclusion=="failure"/);assert.match(shell,/\.run_attempt==1/);
  assert.match(shell,/\.path=="\.github\/workflows\/minuta-crm-test-migrations\.yml"/);
  assert.ok(shell.includes("grep -Fq 'Test CRM rehearsal stopped in phase: apply-v112-v114.'"));
  assert.ok(shell.includes("grep -Fq 'SQLSTATE: 42830'"));
  assert.ok(shell.includes("jq -r '.updated_at' \"$private_dir/failed-run.json\""));
  assert.ok(shell.includes('test "$old_v112_blob" = "$(git rev-parse HEAD:minuta-online-booking/supabase-migration-v112.sql)"'));
  assert.doesNotMatch(shell,/cat[^\n]*failed-run-private\.log/);
  assert.match(shell,/priorFailedRunLegacyFingerprintsVerified:false/);
  assert.ok(shell.indexOf('phase=reviewed-v112-resume-certificate')<shell.indexOf('phase=read-only-baseline'));
});

test('read-only pristine-v112 resume baseline fails closed on data, ACL, policy and partial schema drift',async(t)=>{
  const modulePath=process.env.MINUTA_PGLITE_MODULE;
  if(!modulePath){t.skip('Set MINUTA_PGLITE_MODULE for isolated SQL baseline verification');return;}
  const {PGlite}=await import(modulePath.startsWith('file:')?modulePath:pathToFileURL(modulePath).href);
  const db=new PGlite();
  const baseline=shell.match(/<<'BASELINE_SQL'\n([\s\S]*?)\nBASELINE_SQL/)[1];
  assert.match(baseline,/^begin read only;/);assert.match(baseline,/rollback;$/);
  assert.doesNotMatch(baseline,/\b(?:insert into|update public|delete from|create table|alter table|grant |revoke )/i);
  const check=async(resume=true)=>db.exec(baseline.replace(":'resume_v112'",resume?"'true'":"'false'"));
  const denied=async(message)=>{
    await assert.rejects(()=>check(),new RegExp(message));await db.exec('rollback;');
  };
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create schema storage;create schema cron;create table cron.job(id int);
      create table storage.objects(bucket_id text,name text);
      create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      insert into storage.buckets values('minuta-client-records','minuta-client-records',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
      create table public.client_record_settings(enabled boolean);create table public.client_record_entries(id int);
      alter table public.client_record_settings enable row level security;
      alter table public.client_record_entries enable row level security;
      grant all on public.client_record_settings,public.client_record_entries to service_role;
      create table public.organizations(id int,status text);create table public.organization_memberships(organization_id int,role text,active boolean);
      create table public.bookings(organization_id int,client_phone text);
      insert into public.organizations values(1,'active');insert into public.organization_memberships values(1,'owner',true);
      insert into public.bookings values(1,'70000000001');
      create table public.inventory_movements(id int);create table public.notification_outbox(id int);
      create function public.normalize_client_phone(text) returns text language sql as $$select $1$$;
      create function public.join_minuta_waitlist_v111(text,uuid,uuid,date,text,text,text) returns void language sql as $$select$$;`);
    const authenticated=[
      'set_minuta_client_records_enabled(uuid,boolean)','get_minuta_client_records(uuid,text,integer)',
      'create_minuta_client_record(uuid,text,uuid,uuid,text,text,text,text,integer)',
      'complete_minuta_client_file(uuid)','archive_minuta_client_record(uuid)','can_use_minuta_client_object(text,text)',
    ];
    const service=['claim_expired_minuta_client_records(integer,boolean)','finish_expired_minuta_client_record(uuid)'];
    for(const signature of [...authenticated,...service,'can_access_minuta_client_record(uuid,text,uuid)']) {
      await db.exec(`create function public.${signature} returns boolean language sql as $$select false$$;
        revoke all on function public.${signature} from public,anon,authenticated,service_role;`);
      if(authenticated.includes(signature))await db.exec(`grant execute on function public.${signature} to authenticated;`);
      if(service.includes(signature))await db.exec(`grant execute on function public.${signature} to service_role;`);
    }
    const migration=readFileSync(new URL('../supabase-migration-v112.sql',import.meta.url),'utf8');
    const policies=[...migration.matchAll(/create policy [\s\S]*?;/g)].map(m=>m[0]);
    assert.equal(policies.length,7);
    for(const policy of policies)await db.exec(policy);
    await check();
    await assert.rejects(()=>check(false),/requires_unmodified_restored_v111/);await db.exec('rollback;');
    await db.exec('insert into public.client_record_settings values(false)');await denied('v112_is_not_pristine');await db.exec('delete from public.client_record_settings');
    await db.exec('insert into public.client_record_entries values(1)');await denied('v112_is_not_pristine');await db.exec('delete from public.client_record_entries');
    await db.exec("insert into storage.objects values('minuta-client-records','fixture')");await denied('v112_is_not_pristine');await db.exec('delete from storage.objects');
    await db.exec("update storage.buckets set public=true");await denied('v112_is_not_pristine');await db.exec('update storage.buckets set public=false');
    await db.exec('grant select on public.client_record_entries to authenticated');await denied('table_acl_changed');await db.exec('revoke select on public.client_record_entries from authenticated');
    await db.exec('revoke execute on function public.get_minuta_client_records(uuid,text,integer) from authenticated');await denied('rpc_acl_changed');await db.exec('grant execute on function public.get_minuta_client_records(uuid,text,integer) to authenticated');
    await db.exec('alter policy client_record_object_read_v112 on storage.objects using(true)');await denied('storage_policy_changed');
    await db.exec('drop policy client_record_object_read_v112 on storage.objects');await db.exec(policies.find(p=>p.startsWith('create policy client_record_object_read_v112 ')));
    await db.exec('create table public.inventory_cost_layers(id int)');await denied('unknown_partial_v113_v114_state');await db.exec('drop table public.inventory_cost_layers');
    await db.exec('alter table public.notification_outbox add column delivered_at timestamptz');await denied('unknown_partial_v113_v114_state');await db.exec('alter table public.notification_outbox drop column delivered_at');
    await check();
  } finally {await db.close();}
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
