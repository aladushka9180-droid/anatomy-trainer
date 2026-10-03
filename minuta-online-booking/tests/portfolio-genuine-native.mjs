import assert from 'node:assert/strict';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';

const testRef = 'umazhvvxutnsyuphbhda', prodRef = 'cawexmmrqjvothcbgjxr';
const api = `https://${testRef}.supabase.co`;
const out = resolve(process.env.MINUTA_ACCEPTANCE_OUT || 'portfolio-native-evidence');
const report = { target: 'genuine-test-Supabase-native-published-Pro', sourceSha: 'fb986d408b9afed2299e471ffd96298866c21e9f', status: 'running', checks: [], productionWrites: 0, delivery: false, fixturesPreserved: true, screenshots: [], acceptance: { auth: false, nativePublication: false, transportRetry: false, canonicalClient: false } };
let db, browser, server, page, phase = 'target-guard';
const check = (condition, name) => { assert.ok(condition, name); report.checks.push(name); };
const mask = value => { if (value) process.stdout.write(`::add-mask::${value}\n`); };
async function json(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json();
}
try {
  await mkdir(out, { recursive: true });
  check(process.env.MINUTA_TEST_PROJECT_REF === testRef && process.env.MINUTA_PRODUCTION_PROJECT_REF === prodRef, 'pinned-distinct-test-target');
  const raw = process.env.MINUTA_TEST_DATABASE_URL || '';
  mask(raw);
  const identity = new URL(raw);
  check(['postgres:', 'postgresql:'].includes(identity.protocol) && !raw.includes(prodRef), 'never-production-database');
  check(identity.hostname === `db.${testRef}.supabase.co` || (/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(identity.hostname) && decodeURIComponent(identity.username) === `postgres.${testRef}`), 'official-pinned-test-host');
  for (const option of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) identity.searchParams.delete(option);
  if (identity.port === '6543') identity.port = '5432';
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  mask(token);
  const project = await json(`https://api.supabase.com/v1/projects/${testRef}`, { headers: { authorization: `Bearer ${token}` } });
  check(project.id === testRef && project.status === 'ACTIVE_HEALTHY', 'genuine-test-project-healthy');
  const keys = await json(`https://api.supabase.com/v1/projects/${testRef}/api-keys`, { headers: { authorization: `Bearer ${token}` } });
  keys.forEach(key => mask(key.api_key));
  const anon = keys.find(key => key.name === 'anon')?.api_key;
  const service = keys.find(key => key.name === 'service_role')?.api_key;
  check(Boolean(anon && service), 'existing-test-only-keys');
  phase = 'test-storage-preflight';
  let bucketResponse = await fetch(`${api}/storage/v1/bucket/portfolio-images`, { headers: { apikey: service, authorization: `Bearer ${service}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
  let bucket = await bucketResponse.json();
  report.storage = { httpStatus: bucketResponse.status, bucketExists: bucket.id === 'portfolio-images', private: bucket.public === false, webpAllowed: !bucket.allowed_mime_types || bucket.allowed_mime_types.includes('image/webp') };
  if (/bucket.*not.*found/i.test(bucket.message || bucket.error || '')) report.storage.errorClass = 'bucket-not-found';
  else if (!bucketResponse.ok) report.storage.errorClass = 'other-storage-refusal';
  const certificate = await fetch('https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt', { signal: AbortSignal.timeout(20_000) });
  check(certificate.ok, 'official-ca-read');
  const ca = await certificate.text();
  check(ca.includes('-----BEGIN CERTIFICATE-----'), 'official-ca-format');
  const { default: pg } = await import(pathToFileURL(resolve(process.env.MINUTA_ACCEPTANCE_DEPS, 'pg/lib/index.js')).href);
  db = new pg.Client({ connectionString: identity.href, ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 20_000, statement_timeout: 15_000 });
  await db.connect();
  phase = 'test-storage-read-only-diagnosis';
  const storageRow = (await db.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id='portfolio-images'")).rows[0];
  report.storage.databaseRowExists = Boolean(storageRow);
  report.storage.databasePrivate = storageRow?.public === false;
  report.storage.policyNames = (await db.query("select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'portfolio_objects_%' order by policyname")).rows.map(row => row.policyname);
  if (report.storage.errorClass === 'bucket-not-found' && !storageRow && report.storage.policyNames.length === 0) {
    phase = 'only-missing-test-baseline-storage';
    // Reuse only the missing Storage portion of the pinned published baseline.
    // Never overwrite a bucket, policy, product table or function.
    const baseline = await readFile(resolve(process.env.MINUTA_ACCEPTANCE_SOURCE, 'supabase-migration-v45.sql'), 'utf8');
    const start = baseline.indexOf('insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)');
    const end = baseline.indexOf('create or replace function public.reorder_portfolio_items', start);
    check(start >= 0 && end > start, 'pinned-v45-storage-section');
    const storageSql = baseline.slice(start, end)
      .replace(/on conflict \(id\) do update set[\s\S]*?allowed_mime_types = excluded\.allowed_mime_types;/, ';')
      .replace(/drop policy if exists portfolio_objects_(owner_select|owner_insert|owner_update|owner_delete|public_select) on storage\.objects;\s*/g, '');
    check((storageSql.match(/create policy portfolio_objects_/g) || []).length === 5 && !/\b(drop|alter|truncate|grant|revoke|on conflict)\b/i.test(storageSql), 'only-new-private-bucket-and-five-baseline-policies');
    const preservedStorage = async () => JSON.stringify((await db.query("select policyname,cmd,roles::text,permissive,qual,with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname not like 'portfolio_objects_%' order by policyname")).rows);
    const preservedBuckets = async () => JSON.stringify((await db.query("select id,name,public,file_size_limit,allowed_mime_types from storage.buckets where id <> 'portfolio-images' order by id")).rows);
    const beforePolicies = await preservedStorage(), beforeBuckets = await preservedBuckets();
    await db.query('begin');
    try {
      await db.query("select pg_advisory_xact_lock(hashtext('portfolio-test-baseline-storage'))");
      check(!(await db.query("select 1 from storage.buckets where id='portfolio-images'")).rowCount && !(await db.query("select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'portfolio_objects_%'")).rowCount, 'test-storage-still-absent-no-overwrite');
      check((await db.query("select relrowsecurity from pg_class where oid='storage.objects'::regclass")).rows[0].relrowsecurity, 'test-storage-rls-already-enabled');
      await db.query(storageSql);
      check(beforePolicies === await preservedStorage() && beforeBuckets === await preservedBuckets(), 'foreign-test-storage-configuration-preserved');
      await db.query('commit');
    } catch (error) { await db.query('rollback'); throw error; }
    report.storage.baselineFixtureCreated = true;
    bucketResponse = await fetch(`${api}/storage/v1/bucket/portfolio-images`, { headers: { apikey: service, authorization: `Bearer ${service}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    bucket = await bucketResponse.json();
    report.storage.configuredHttpStatus = bucketResponse.status;
    report.storage.bucketExists = bucket.id === 'portfolio-images';
    report.storage.private = bucket.public === false;
    report.storage.webpAllowed = bucket.allowed_mime_types?.length === 1 && bucket.allowed_mime_types[0] === 'image/webp';
    report.storage.policyNames = (await db.query("select policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'portfolio_objects_%' order by policyname")).rows.map(row => row.policyname);
  }
  check(bucketResponse.ok && report.storage.bucketExists && report.storage.private && report.storage.webpAllowed, 'existing-private-test-storage-ready');
  check(report.storage.policyNames.length === 5 && Number(bucket.file_size_limit) === 8388608, 'baseline-test-storage-limits-and-policies');
  phase = 'schema-preflight';
  for (const table of ['portfolio_items', 'portfolio_photos', 'booking_reviews', 'booking_outcomes', 'client_accounts']) {
    check((await db.query('select to_regclass($1) as table', [`public.${table}`])).rows[0].table, `existing-table-${table}`);
  }
  check((await db.query("select to_regprocedure('public.save_provider_portfolio_item(uuid,timestamp with time zone,jsonb,jsonb)') as fn")).rows[0].fn, 'existing-atomic-portfolio-save');
  phase = 'new-synthetic-fixtures';
  const run = `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`;
  const actors = {};
  for (const role of ['owner', 'other']) {
    const actor = { email: `portfolio-${run}-${role}@example.invalid`, password: `Test!${randomBytes(24).toString('hex')}` };
    mask(actor.password);
    const user = await json(`${api}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: service, authorization: `Bearer ${service}`, 'content-type': 'application/json' }, body: JSON.stringify({ email: actor.email, password: actor.password, email_confirm: true, user_metadata: { display_name: `Тест портфолио ${role}`, minuta_onboarding_status: 'completed', provider_display_preferences: { theme: 'pink-porcelain', color_mode: 'light' } } }) });
    check(Boolean(user.id && user.email_confirmed_at), `real-test-only-created-${role}`);
    actors[role] = { ...actor, id: user.id };
  }
  const ids = { owner: actors.owner.id, other: actors.other.id, service: randomUUID(), client: randomUUID(), booking: randomUUID(), review: randomUUID() };
  const procedure = `Синтетическая работа ${run}`;
  report.fixtureIds = ids;
  const organization = (await db.query('select id from public.organizations where legacy_performer_id=$1 and created_by=$1', [ids.owner])).rows;
  check(organization.length === 1, 'new-owner-trigger-organization');
  const location = (await db.query('select id from public.locations where organization_id=$1 and is_primary', [organization[0].id])).rows;
  check(location.length === 1, 'new-owner-trigger-location');
  const phone = '700000' + String(Number.parseInt(randomBytes(4).toString('hex'), 16) % 100000).padStart(5, '0');
  await db.query('begin');
  try {
    await db.query('update public.organizations set public_booking_enabled=false where id=$1 and created_by=$2', [organization[0].id, ids.owner]);
    await db.query("insert into public.services(id,performer_id,name,duration_minutes,price_rub,active) values($1,$2,'Синтетическая услуга',30,0,true)", [ids.service, ids.owner]);
    await db.query("insert into public.client_accounts(id,normalized_phone,access_code_hash) values($1,$2,repeat('a',64))", [ids.client, phone]);
    await db.query("select set_config('minuta.booking_organization',$1,true),set_config('minuta.booking_location',$2,true)", [organization[0].id, location[0].id]);
    await db.query(`insert into public.bookings(id,booking_code,manage_token,performer_id,service_id,client_name,client_phone,booking_date,booking_time,duration_minutes,original_price_rub,total_price_rub,status,deposit_amount_rub,payment_status,payment_url,booking_policy_snapshot,client_account_id)
      values($1,$2,$3,$4,$5,'Синтетический клиент',$6,current_date-2,'12:00',30,0,0,'confirmed',0,'not_required','','{}',$7)`, [ids.booking, `PF-${ids.booking.slice(0, 8)}`, randomUUID(), ids.owner, ids.service, phone, ids.client]);
    await db.query("insert into public.booking_outcomes(booking_id,performer_id,visit_status,payment_method,amount_rub,actual_duration_minutes,calculated_amount_rub,completion_source) values($1,$2,'completed','unpaid',0,30,0,'manual')", [ids.booking, ids.owner]);
    await db.query("insert into public.booking_reviews(id,booking_id,performer_id,service_id,client_account_id,rating,review_text,published) values($1,$2,$3,$4,$5,5,$6,true)", [ids.review, ids.booking, ids.owner, ids.service, ids.client, `Синтетический отзыв ${run}. Без реального клиента.`]);
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
  check(true, 'only-own-new-synthetic-rows');
  phase = 'native-test-configuration';
  const source = resolve(process.env.MINUTA_ACCEPTANCE_SOURCE);
  const html = await readFile(resolve(source, 'provider.html'), 'utf8');
  check(html.includes(prodRef) && html.includes('portfolio-soft-ui.js'), 'published-native-source-loaded');
  const config = `window.MINUTA_CONFIG=Object.freeze(${JSON.stringify({ supabaseUrl: api, supabaseKey: anon, defaultOrganizationSlug: '', assistantRemoteUnderstanding: false, assistantCloudSpeechEnabled: false, socialAuthProviders: { telegram: false, vk: false, yandex: false } })});`;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
  server = createServer(async (req, res) => {
    try {
      const file = resolve(source, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (!file.startsWith(source + sep)) { res.writeHead(403); res.end(); return; }
      const data = file === resolve(source, 'config.js') ? config : file === resolve(source, 'provider.html') ? html.replaceAll(prodRef, testRef) : await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import(pathToFileURL(resolve(process.env.MINUTA_ACCEPTANCE_DEPS, 'playwright/index.mjs')).href);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  const blocked = [], auth = [], failures = [], rpcFailures = [], scriptErrors = [], storageResponses = [];
  report.network = { blocked, auth, failures, rpcFailures, scriptErrors, storageResponses };
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin) return route.continue();
    const readRpc = url.pathname.startsWith('/rest/v1/rpc/') && /^(get_|list_|has_|is_|check_)/.test(url.pathname.split('/').at(-1));
    const authPath = ['/auth/v1/token', '/auth/v1/user', '/auth/v1/logout'].includes(url.pathname);
    const portfolioRpc = url.pathname === '/rest/v1/rpc/save_provider_portfolio_item' && req.postDataJSON()?.p_item?.procedure_name === procedure && (!ids.item || req.postDataJSON()?.p_item_id === ids.item);
    const reviewRpc = url.pathname === '/rest/v1/rpc/set_booking_review_published' && req.postDataJSON()?.p_review === ids.review;
    const storage = url.pathname.startsWith('/storage/v1/object/') && (url.pathname.includes(`/portfolio-images/${ids.owner}/`) || url.pathname === '/storage/v1/object/sign/portfolio-images');
    if (url.origin === api && !url.pathname.startsWith('/functions/') && (['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || authPath || readRpc || portfolioRpc || reviewRpc || storage)) return route.continue();
    if (blocked.length < 25) blocked.push({ host: url.hostname, path: url.pathname, method: req.method() });
    return route.abort('blockedbyclient');
  });
  page = await context.newPage(); page.setDefaultTimeout(30_000);
  page.on('pageerror', error => { if (scriptErrors.length < 10 && /^(\w+ is not defined|Cannot read properties of (?:null|undefined)|\w+(?:\.\w+)* is not a function)/.test(error.message)) scriptErrors.push(error.message.slice(0, 200)); });
  context.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== api) return;
    if (['/auth/v1/token', '/auth/v1/logout'].includes(url.pathname)) auth.push({ operation: url.pathname.split('/').at(-1), status: response.status(), passwordSignin: url.searchParams.get('grant_type') === 'password' });
    if (url.pathname.startsWith('/storage/v1/') && storageResponses.length < 20) storageResponses.push({ method: response.request().method(), status: response.status(), operation: url.pathname.startsWith('/storage/v1/object/sign/') ? 'sign' : 'object' });
    if (response.status() >= 400 && url.pathname.startsWith('/rest/v1/rpc/') && rpcFailures.length < 25) rpcFailures.push({ rpc: url.pathname.split('/').at(-1), status: response.status() });
  });
  page.on('requestfailed', request => { if (new URL(request.url()).pathname === '/rest/v1/rpc/set_booking_review_published') failures.push({ rpc: 'set_booking_review_published', error: request.failure()?.errorText }); });
  async function login(role) {
    await page.goto(`${origin}/provider.html?section=portfolio`, { waitUntil: 'domcontentloaded' });
    await page.locator('#loginEmail').fill(actors[role].email);
    await page.locator('#loginPassword').fill(actors[role].password);
    const response = page.waitForResponse(res => res.url().startsWith(api + '/auth/v1/token') && res.request().method() === 'POST');
    await page.locator('#loginForm button[type=submit]').click();
    check((await response).status() === 200, `native-real-password-signin-${role}`);
    await page.locator('#dashboard').waitFor({ state: 'visible', timeout: 90_000 });
    await page.locator('[data-provider-panel="portfolio"]').waitFor({ state: 'visible', timeout: 90_000 });
  }
  async function shot(label) { await page.locator('[data-provider-panel="portfolio"]').screenshot({ path: resolve(out, `${label}.png`) }); report.screenshots.push(`${label}.png`); }
  const publicItem = async id => json(`${api}/rest/v1/portfolio_items?select=id,published&id=eq.${id}`, { headers: { apikey: anon, authorization: `Bearer ${anon}` } });
  await login('owner');
  phase = 'native-new-neutral-pair';
  const canvas = await context.newPage();
  await canvas.setContent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#f4dce4"/><text x="80" y="300" font-size="40">SYNTHETIC FIXTURE · NO CLIENT DATA</text></svg>');
  const neutral = await canvas.locator('svg').screenshot(); await canvas.close();
  await page.bringToFront();
  phase = 'native-editor-write-readiness';
  report.writeReadiness = await page.locator('.portfolio-title-actions [data-open-portfolio-editor]').evaluate(button => ({ disabled: button.disabled, reliabilityDisabled: button.dataset.reliabilityDisabled === 'true', sync: document.querySelector('#syncState')?.textContent }));
  await page.locator('#syncState.is-online').waitFor({ timeout: 90_000 });
  await page.locator('.portfolio-title-actions [data-open-portfolio-editor]').click({ timeout: 90_000 });
  await page.locator('#portfolioEditorDialog').waitFor({ state: 'visible' });
  phase = 'native-editor-fields';
  await page.locator('#portfolioProcedure').fill(procedure);
  await page.locator('#portfolioDescription').fill('Нейтральные тестовые изображения. Отметка согласия проверяется только в изолированном тесте, реального клиента нет.');
  phase = 'native-pair-file-selection';
  await page.locator('#portfolioBeforeFile').setInputFiles({ name: 'before.png', mimeType: 'image/png', buffer: neutral });
  await page.locator('#portfolioAfterFile').setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: neutral });
  check(await page.locator('#portfolioPublished').isDisabled(), 'native-no-consent-blocks-publication');
  phase = 'native-pair-server-save';
  const save = page.waitForResponse(res => res.url().includes('/rest/v1/rpc/save_provider_portfolio_item') && res.request().method() === 'POST');
  await page.locator('#portfolioForm button[type=submit]').click();
  check((await save).status() === 200, 'native-atomic-save-server-ack');
  await page.locator('#portfolioEditorDialog').waitFor({ state: 'hidden' });
  const item = (await db.query('select id,published,consent_confirmed_at from public.portfolio_items where performer_id=$1 and procedure_name=$2', [ids.owner, procedure])).rows;
  check(item.length === 1 && !item[0].published && !item[0].consent_confirmed_at, 'native-private-unconsented-draft-persisted');
  ids.item = item[0].id;
  check((await db.query('select photo_type from public.portfolio_photos where portfolio_item_id=$1 and performer_id=$2', [ids.item, ids.owner])).rows.length === 2, 'native-both-storage-photos-persisted');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-portfolio-photo-preview]').waitFor();
  await page.waitForFunction(() => {
    const photos = [...document.querySelectorAll('.portfolio-card img')];
    return photos.length === 2 && photos.every(photo => photo.complete && photo.naturalWidth > 0);
  });
  check((await publicItem(ids.item)).length === 0, 'real-anonymous-private-draft-denied');
  await shot('native-private-pair-persisted');
  phase = 'genuine-auth-open-gallery';
  await page.locator('[data-portfolio-photo-preview]').click();
  await page.locator('#portfolioPhotoPreviewDialog').waitFor({ state: 'visible' });
  const logoutPage = await context.newPage();
  await logoutPage.goto(`${origin}/provider.html?section=portfolio`);
  await logoutPage.locator('#dashboard').waitFor({ state: 'visible', timeout: 90_000 });
  phase = 'genuine-auth-native-peer-local-logout';
  // Native logout clears local Auth storage and broadcasts before SDK signOut;
  // a remote revocation request is not part of its local gallery-reset contract.
  await logoutPage.locator('#logoutButton').click();
  await page.locator('#loginForm').waitFor({ state: 'visible' });
  check(await page.locator('#loginForm').isVisible(), 'genuine-native-peer-logout-completed');
  check(!await page.locator('#portfolioPhotoPreviewDialog').isVisible(), 'genuine-logout-closes-open-gallery');
  check(await page.locator('#portfolioPhotoPreviewDialog img').count() === 0, 'genuine-logout-clears-private-images');
  await logoutPage.close();
  phase = 'genuine-auth-native-other-account';
  const otherReads = ['portfolio_items', 'portfolio_photos'].map(table => page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.origin === api && url.pathname === `/rest/v1/${table}` && url.searchParams.get('performer_id') === `eq.${ids.other}`;
  }));
  await login('other');
  for (const response of await Promise.all(otherReads)) {
    check(response.status() === 200 && (await response.json()).length === 0, `real-other-account-empty-${new URL(response.url()).pathname.split('/').at(-1)}`);
  }
  await page.locator('#syncState.is-online').waitFor({ timeout: 90_000 });
  await page.waitForFunction(() => document.querySelector('#portfolioCount')?.textContent?.trim() === '0 работ');
  check(await page.locator('[data-portfolio-photo-preview]').count() === 0, 'native-other-account-no-old-gallery');
  check(!await page.getByText(procedure, { exact: true }).count(), 'native-other-account-no-old-work');
  await shot('native-other-account');
  await page.locator('#logoutButton').click(); await page.locator('#loginForm').waitFor({ state: 'visible' });
  phase = 'genuine-auth-native-owner-return';
  await login('owner'); await page.locator('[data-portfolio-photo-preview]').waitFor();
  await page.locator('[data-portfolio-photo-preview]').click();
  check(await page.locator('#portfolioPhotoPreviewDialog img').count() === 2, 'genuine-owner-fresh-gallery-works');
  await page.keyboard.press('Escape');
  report.acceptance.auth = true;
  phase = 'native-previous-draft-test-consent-and-publication';
  await page.locator('#syncState.is-online').waitFor({ timeout: 90_000 });
  await page.locator(`[data-portfolio-actions="${ids.item}"]`).click();
  await page.locator(`[data-edit-portfolio="${ids.item}"]`).click();
  await page.locator('#portfolioEditorDialog').waitFor({ state: 'visible' });
  await page.locator('#portfolioConsent').check(); await page.locator('#portfolioPublished').check();
  const publication = page.waitForResponse(response => response.url().includes('/rest/v1/rpc/save_provider_portfolio_item') && response.request().method() === 'POST');
  await page.locator('#portfolioForm button[type=submit]').click();
  check((await publication).status() === 200, 'native-test-consent-publication-server-ack');
  await page.locator('#portfolioEditorDialog').waitFor({ state: 'hidden' });
  const published = (await db.query('select published,consent_confirmed_at from public.portfolio_items where id=$1 and performer_id=$2', [ids.item, ids.owner])).rows[0];
  check(published?.published && published.consent_confirmed_at, 'native-test-publication-persisted');
  check((await publicItem(ids.item)).length === 1, 'real-anonymous-published-item-visible');
  report.acceptance.nativePublication = true;
  await shot('native-pair-persisted');
  phase = 'genuine-in-flight-transport-refusal';
  const visibility = page.locator(`[data-review-visibility="${ids.review}"]`);
  await visibility.waitFor();
  let release, entered;
  const atTransport = new Promise(done => { entered = done; });
  const gate = new Promise(done => { release = done; });
  const endpoint = `${api}/rest/v1/rpc/set_booking_review_published`;
  const hold = async route => { entered(); await gate; await route.continue(); };
  await context.route(endpoint, hold);
  await visibility.click(); await atTransport;
  check(await visibility.isDisabled(), 'native-review-action-pending-disabled');
  await context.setOffline(true); release();
  await page.getByText(/Не удалось изменить видимость отзыва/).waitFor();
  await page.waitForFunction(id => !document.querySelector(`[data-review-visibility="${id}"]`)?.disabled, ids.review);
  check((await db.query('select published from public.booking_reviews where id=$1 and performer_id=$2', [ids.review, ids.owner])).rows[0].published, 'failed-transport-keeps-server-publication');
  check(failures.some(item => /INTERNET_DISCONNECTED|FAILED/.test(item.error || '')), 'actual-browser-transport-failure-observed');
  await shot('native-transport-failure');
  await context.unroute(endpoint, hold); await context.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' }); await visibility.waitFor();
  const retry = page.waitForResponse(res => res.url() === endpoint && res.request().method() === 'POST');
  await visibility.click(); check((await retry).status() === 200, 'native-retry-real-server-ack');
  check(!(await db.query('select published from public.booking_reviews where id=$1 and performer_id=$2', [ids.review, ids.owner])).rows[0].published, 'native-retry-hides-exact-review');
  check((await db.query('select count(*)::int as count from public.booking_reviews where booking_id=$1', [ids.booking])).rows[0].count === 1, 'native-retry-no-duplicate-review');
  await page.reload({ waitUntil: 'domcontentloaded' }); await visibility.waitFor();
  const restore = page.waitForResponse(res => res.url() === endpoint && res.request().method() === 'POST');
  await visibility.click(); check((await restore).status() === 200, 'native-fixture-review-restored');
  report.acceptance.transportRetry = true;
  check(!blocked.some(item => item.host.includes(prodRef)), 'zero-production-network-attempts');
  report.status = 'passed';
  await shot('native-final');
  console.log(`PASS: genuine isolated native Portfolio (${report.checks.length} checks); actual Auth, persisted pair and transport refusal/retry; canonical client acceptance still pending`);
} catch (error) {
  report.status = 'failed'; report.failedPhase = phase;
  if (/^HTTP_[0-9]{3}$/.test(error?.message || '')) report.failureCode = error.message;
  if (['28P01', '42501', '23502', '23503', '23514', '42883'].includes(error?.code)) report.failureCode = error.code;
  if (error?.name === 'TimeoutError') report.failureCode = 'native-timeout';
  const failedLocator = error?.message?.match(/waiting for locator\('([^']+)'\)/)?.[1];
  if (failedLocator && /^(#portfolio|\.portfolio)/.test(failedLocator)) report.failureLocator = failedLocator;
  if (page) report.finalReadiness = await page.locator('.portfolio-title-actions [data-open-portfolio-editor]').evaluate(button => ({ disabled: button.disabled, reliabilityDisabled: button.dataset.reliabilityDisabled === 'true', sync: document.querySelector('#syncState')?.textContent, formError: document.querySelector('#portfolioError')?.textContent })).catch(() => null);
  console.error(`Genuine native Portfolio stopped at ${phase}; sensitive details withheld`);
  if (page) await page.locator('[data-provider-panel="portfolio"]').screenshot({ path: resolve(out, 'native-failure.png') }).catch(() => {});
  if (page) await page.screenshot({ path: resolve(out, 'native-failure-screen.png'), fullPage: false }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await new Promise(done => server ? server.close(done) : done());
  await db?.end().catch(() => {});
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'RESULTS.json'), JSON.stringify(report, null, 2));
}
