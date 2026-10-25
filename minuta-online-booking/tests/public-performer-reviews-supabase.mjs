import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

// Same pinned, genuine test environment used by the accepted Organization check.
// Only the new function is installed/rolled back. No account or table data writes.
const testRef = 'umazhvvxutnsyuphbhda';
const prodRef = 'cawexmmrqjvothcbgjxr';
const api = `https://${testRef}.supabase.co`;
const out = resolve(process.env.MINUTA_ACCEPTANCE_OUT || 'review-rpc-qualification');
const report = { target: 'genuine-isolated-test-supabase', productionWrites: 0, accountWrites: 0, tableWrites: 0, checks: [], status: 'running', rollback: 'not-needed' };
let db, installedHash, applied = false, phase = 'target-guard';
function check(condition, name) { assert.ok(condition, name); report.checks.push(name); }
const mask = value => { if (value) process.stdout.write(`::add-mask::${value}\n`); };
async function management(path, token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${testRef}${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  check(response.ok, `management-read-${path || 'project'}`);
  return response.json();
}
async function rpcVisible(anon, present) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${api}/rest/v1/rpc/get_public_performer_booking_reviews`, {
      method: 'POST', headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_performer_id: randomUUID() }), signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    if (present && response.status === 200) { assert.deepEqual(await response.json(), []); return; }
    if (!present && response.status === 404) return;
    await response.body?.cancel();
    await new Promise(done => setTimeout(done, 1000));
  }
  throw new Error('schema-reload-not-observed');
}
async function fingerprint() {
  const result = await db.query(`
    select 'rpc' as kind, p.proname as name, md5(pg_get_functiondef(p.oid)) as definition, coalesce(p.proacl::text,'') as permissions
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('get_public_booking_reviews','get_provider_booking_reviews','set_booking_review_published')
    union all
    select 'table',c.relname,c.relrowsecurity::text,coalesce(c.relacl::text,'')
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('booking_reviews','portfolio_items','portfolio_photos')
    union all
    select 'policy',tablename||':'||policyname,coalesce(qual,'')||coalesce(with_check,''),roles::text
      from pg_policies where schemaname='public' and tablename in ('booking_reviews','portfolio_items','portfolio_photos')
    order by kind,name`);
  check(result.rows.some(row => row.kind === 'rpc' && row.name === 'get_public_booking_reviews'), 'legacy-rpc-present');
  return JSON.stringify(result.rows);
}
async function rollback() {
  if (!installedHash) return;
  const current = (await db.query("select md5(prosrc) as hash from pg_proc where oid=to_regprocedure('public.get_public_performer_booking_reviews(uuid)')")).rows[0];
  check(current?.hash === installedHash, 'rollback-owns-exact-new-function');
  await db.query(await readFile(new URL('../supabase-public-performer-reviews-rollback.sql', import.meta.url), 'utf8'));
  installedHash = undefined;
  applied = false;
  report.rollback = 'confirmed';
}
try {
  await mkdir(out, { recursive: true });
  check(process.env.MINUTA_TEST_PROJECT_REF === testRef && process.env.MINUTA_PRODUCTION_PROJECT_REF === prodRef, 'pinned-test-and-production-identities');
  const rawConnection = process.env.MINUTA_TEST_DATABASE_URL || '';
  mask(rawConnection);
  const identity = new URL(rawConnection);
  check(['postgres:', 'postgresql:'].includes(identity.protocol), 'postgres-protocol');
  check((identity.hostname + decodeURIComponent(identity.username)).includes(testRef) && !rawConnection.includes(prodRef), 'test-database-only');
  check(identity.hostname === `db.${testRef}.supabase.co` ||
    (/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(identity.hostname) && decodeURIComponent(identity.username) === `postgres.${testRef}`), 'official-pinned-test-host');
  for (const setting of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) identity.searchParams.delete(setting);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  mask(token);
  check(Boolean(token), 'environment-test-management-token');
  phase = 'read-only-preflight';
  const project = await management('', token);
  check(project.id === testRef && project.status === 'ACTIVE_HEALTHY', 'genuine-test-project-healthy');
  const keys = await management('/api-keys', token);
  keys.forEach(key => mask(key.api_key));
  const anon = keys.find(key => key.name === 'anon')?.api_key;
  check(Boolean(anon), 'existing-test-anonymous-key');
  const certificate = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(20_000) });
  check(certificate.ok, 'official-supabase-ca-read');
  const ca = await certificate.text();
  check(ca.includes('-----BEGIN CERTIFICATE-----'), 'official-ca-format');
  if (identity.port === '6543') identity.port = '5432';
  const { default: pg } = await import(pathToFileURL(resolve(process.env.MINUTA_ACCEPTANCE_DEPS, 'pg/lib/index.js')).href);
  db = new pg.Client({ connectionString: identity.href, ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 20_000, statement_timeout: 15_000 });
  await db.connect();
  check((await db.query("select to_regprocedure('public.get_public_performer_booking_reviews(uuid)') as fn")).rows[0].fn === null, 'new-function-absent-do-not-overwrite');
  const before = await fingerprint();
  const sql = await readFile(new URL('../supabase-public-performer-reviews.sql', import.meta.url), 'utf8');
  report.contractSha256 = createHash('sha256').update(sql).digest('hex');
  phase = 'test-only-additive-apply';
  await db.query(sql);
  applied = true;
  report.rollback = 'pending';
  installedHash = (await db.query("select md5(prosrc) as hash from pg_proc where oid='public.get_public_performer_booking_reviews(uuid)'::regprocedure")).rows[0].hash;
  check(before === await fingerprint(), 'apply-keeps-legacy-rls-table-grants');
  for (const role of ['anon', 'authenticated']) {
    await db.query('begin');
    try {
      await db.query(`set local role ${role}`);
      assert.deepEqual((await db.query('select * from public.get_public_performer_booking_reviews($1::uuid)', [randomUUID()])).rows, []);
      check(true, `real-postgres-execute-${role}`);
    } finally { await db.query('rollback'); }
  }
  await rpcVisible(anon, true);
  check(true, 'real-anonymous-postgrest-rpc-200');
  phase = 'read-existing-native-synthetic-publication';
  const nativeRun = process.env.MINUTA_REVIEW_NATIVE_FIXTURE_RUN;
  check(/^\d+-\d+$/.test(nativeRun || ''), 'pinned-existing-native-fixture-run');
  const nativeEmails = ['owner', 'other'].map(role => `portfolio-${nativeRun}-${role}@example.invalid`);
  const nativeActors = (await db.query('select id,email from auth.users where email=any($1::text[])', [nativeEmails])).rows;
  const owner = nativeActors.find(actor => actor.email === nativeEmails[0])?.id;
  const other = nativeActors.find(actor => actor.email === nativeEmails[1])?.id;
  check(Boolean(owner && other && owner !== other), 'only-existing-reserved-invalid-test-actors');
  const expectedText = `Синтетический отзыв ${nativeRun}. Без реального клиента.`;
  const fixture = (await db.query('select rating,published,review_text from public.booking_reviews where performer_id=$1 and review_text=$2', [owner, expectedText])).rows;
  check(fixture.length === 1 && fixture[0].published && fixture[0].rating === 5, 'native-ui-published-synthetic-review-present');
  async function publicRows(performerId) {
    const response = await fetch(`${api}/rest/v1/rpc/get_public_performer_booking_reviews`, {
      method: 'POST', headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_performer_id: performerId }), signal: AbortSignal.timeout(20_000), redirect: 'error',
    });
    check(response.status === 200, 'real-postgrest-synthetic-fixture-200');
    return response.json();
  }
  const actualPublicRows = await publicRows(owner);
  check(actualPublicRows.length === 1 && actualPublicRows[0].performer_id === owner && actualPublicRows[0].review_text === expectedText, 'real-published-native-review-returned-to-own-profile');
  check(actualPublicRows[0].reviewer_name === 'Клиент' && ['client_name','client_id','client_account_id','phone','email'].every(key => !(key in actualPublicRows[0])), 'real-native-public-author-masked-no-private-fields');
  check(Number(actualPublicRows[0].average_rating) === 5 && Number(actualPublicRows[0].total_reviews) === 1, 'real-native-public-rating-and-count');
  check((await publicRows(other)).length === 0, 'real-other-native-profile-no-foreign-review');
  report.nativeFixtureRun = nativeRun;
  report.existingNativePublicationReadOnly = true;
  phase = 'test-only-rollback';
  await rollback();
  check((await db.query("select to_regprocedure('public.get_public_performer_booking_reviews(uuid)') as fn")).rows[0].fn === null, 'new-function-removed');
  check(before === await fingerprint(), 'rollback-keeps-legacy-rls-table-grants');
  await rpcVisible(anon, false);
  check(true, 'real-postgrest-schema-reload-after-rollback');
  report.status = 'passed';
  console.log(`PASS: genuine test Supabase RPC qualification (${report.checks.length} checks); no production/account/table data writes; rollback confirmed`);
} catch (error) {
  report.status = 'failed';
  report.failedPhase = phase;
  if (['28P01', '28000', '42501', '42P01', '42704', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error?.code)) report.failureCode = error.code;
  console.error(`Test qualification stopped at ${phase}; sensitive diagnostics withheld`);
  process.exitCode = 1;
} finally {
  if (db) {
    try { await rollback(); } catch { report.rollback = 'requires-owner-attention'; report.status = 'failed'; process.exitCode = 1; }
    if (applied) { report.rollback = 'requires-owner-attention'; report.status = 'failed'; process.exitCode = 1; }
    await db.end().catch(() => {});
  }
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'RESULTS.json'), JSON.stringify(report, null, 2));
}
