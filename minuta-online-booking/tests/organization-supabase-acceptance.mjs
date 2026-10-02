import { resolve, extname, sep } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

// Test ref is intentionally pinned independently of mutable GitHub configuration.
// No production URL, dump, real account, email delivery or credential export is used.
const testRef = 'umazhvvxutnsyuphbhda';
const prodRef = 'cawexmmrqjvothcbgjxr';
const out = resolve(process.env.MINUTA_ACCEPTANCE_OUT || 'organization-supabase-evidence');
const report = { mode: 'genuine-auth-native-acceptance', sourceSha: '05204730f217023883d61b31c914d3517d5b2b39', checks: [], status: 'running', acceptance: { O1:false, O2:false }, writesAttempted:false };
let client, browser, server, nativePage, phase = 'test-target-guard';
const api = `https://${testRef}.supabase.co`;
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
  // The user rotated the environment-level scoped token in minuta-test.
  // The old repository/production token is never used or changed by this job.
  phase = 'management-access';
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
  check(Boolean(accessToken), 'environment-management-token-present');
  const project = await request(`https://api.supabase.com/v1/projects/${testRef}`, { headers: { authorization: `Bearer ${accessToken}` } });
  check(project.id === testRef && project.status === 'ACTIVE_HEALTHY', 'genuine-test-project-healthy');
  report.management = { status: 'verified', testProjectOnly: true };
  phase = 'test-api-keys';
  const keys = await request(`https://api.supabase.com/v1/projects/${testRef}/api-keys`, { headers: { authorization: `Bearer ${accessToken}` } });
  for (const key of keys) mask(key.api_key);
  const anon = keys.find(key => key.name === 'anon')?.api_key;
  const service = keys.find(key => key.name === 'service_role')?.api_key;
  report.keyMetadata = keys.map(key => ({ name: key.name, valueAvailable: Boolean(key.api_key) }));
  check(Boolean(anon && service), 'existing-test-keys-available-server-only');
  phase = 'genuine-auth-settings';
  const authSettings = await request(`https://${testRef}.supabase.co/auth/v1/settings`, { headers: { apikey: anon } });
  report.auth = { email: Boolean(authSettings.external?.email), signupDisabled: Boolean(authSettings.disable_signup) };
  check(report.auth.email, 'genuine-supabase-email-auth-enabled');
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
  // All users and rows below are new, isolated fixtures. Admin createUser confirms
  // email server-side and does not send signup, invitation or recovery messages.
  phase = 'genuine-auth-create-fixtures';
  const run = `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || 1}`;
  const actors = {};
  report.fixture = { run, users: {}, preserved:true, delivery:false };
  for (const role of ['owner','admin','specialist','outsider']) {
    const actor = { email:`organization-${run}-${role}@example.invalid`, password:`Org!${randomBytes(24).toString('hex')}` };
    mask(actor.password);
    report.writesAttempted = true;
    const user = await request(`${api}/auth/v1/admin/users`, { method:'POST', headers:{apikey:service,authorization:`Bearer ${service}`,'content-type':'application/json'}, body:JSON.stringify({email:actor.email,password:actor.password,email_confirm:true,user_metadata:{display_name:`Тест · ${role}`,minuta_onboarding_status:'completed',provider_display_preferences:{theme:'pink-porcelain',color_mode:'light'}}}) });
    check(Boolean(user.id && user.email_confirmed_at), `genuine-admin-created-${role}`);
    actors[role] = {...actor,id:user.id}; report.fixture.users[role] = user.id;
  }
  phase = 'scoped-new-fixture-seed';
  const ownOrg = (await client.query('select id from public.organizations where legacy_performer_id=$1 and created_by=$1', [actors.owner.id])).rows;
  check(ownOrg.length === 1, 'new-owner-trigger-organization');
  const orgId = ownOrg[0].id; report.fixture.organizationId = orgId;
  const name = `Организация · тест ${run}`;
  const location = (await client.query('select id from public.locations where organization_id=$1 and is_primary', [orgId])).rows;
  check(location.length === 1, 'new-owner-trigger-location');
  const locId = location[0].id;
  await client.query('begin');
  try {
    await client.query('update public.organizations set name=$2, public_booking_enabled=false where id=$1 and created_by=$3', [orgId,name,actors.owner.id]);
    await client.query("update public.locations set name='Тестовый филиал',address='Тестовый адрес, 1',timezone='Europe/Samara',active=true where id=$1 and organization_id=$2", [locId,orgId]);
    for (const role of ['admin','specialist']) await client.query('insert into public.organization_memberships(organization_id,user_id,role,is_bookable,active,created_by) values($1,$2,$3,$4,true,$5)', [orgId,actors[role].id,role,role === 'specialist',actors.owner.id]);
    for (const role of ['owner','specialist']) {
      await client.query("insert into public.services(performer_id,name,duration_minutes,price_rub,active) values($1,'Тестовая услуга',45,1000,true)", [actors[role].id]);
      await client.query("insert into public.staff_location_shifts(organization_id,location_id,performer_id,shift_date,start_time,end_time,created_by) values($1,$2,$3,(now() at time zone 'Europe/Samara')::date+1,'08:00','20:00',$4)", [orgId,locId,actors[role].id,actors.owner.id]);
    }
    await client.query('update public.organization_shift_settings set enabled=false where organization_id=$1', [orgId]);
    await client.query('commit');
  } catch(error) { await client.query('rollback'); throw error; }
  check(true, 'new-fixture-only-seed-committed');
  phase = 'real-auth-and-role-rpc';
  async function rpc(actor, fn, body={}) {
    const res = await fetch(`${api}/rest/v1/rpc/${fn}`, {method:'POST',headers:{apikey:anon,authorization:`Bearer ${actor?.session?.access_token || anon}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
    return {status:res.status,data:await res.json()};
  }
  for (const [role,actor] of Object.entries(actors)) {
    actor.session = await request(`${api}/auth/v1/token?grant_type=password`, {method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({email:actor.email,password:actor.password})});
    mask(actor.session.access_token); mask(actor.session.refresh_token);
    check(actor.session.user?.id === actor.id && actor.session.token_type === 'bearer', `real-password-signin-${role}`);
    const verified = await request(`${api}/auth/v1/user`, {headers:{apikey:anon,authorization:`Bearer ${actor.session.access_token}`}});
    check(verified.id === actor.id, `server-verified-session-${role}`);
    const workspace = await rpc(actor,'get_minuta_workspace');
    check(workspace.status === 200 && Array.isArray(workspace.data.organizations), `real-workspace-${role}`);
    const fixture = workspace.data.organizations.find(item => item.id === orgId);
    if (role === 'outsider') check(!fixture,'foreign-organization-not-readable');
    else check(fixture?.current_role === role && fixture.can_manage === (role !== 'specialist'), `server-role-${role}`);
  }
  for (const role of ['specialist','outsider']) {
    const refused = await rpc(actors[role],'update_minuta_organization',{p_organization:orgId,p_name:'Запрещённое изменение'});
    check(refused.status === 403 && refused.data.code === '42501', `real-rename-refused-${role}`);
  }
  const anonymous = await rpc(null,'get_minuta_workspace');
  check(anonymous.status >= 400, 'anonymous-workspace-refused');
  const range = (await client.query("select (now() at time zone 'Europe/Samara')::date::text as start, ((now() at time zone 'Europe/Samara')::date+13)::text as end")).rows[0];
  const schedule = await rpc(actors.owner,'get_minuta_shift_workspace',{p_organization:orgId,p_start:range.start,p_end:range.end});
  report.fixture.scheduleShape = {status:schedule.status,services:schedule.data.services?.map(item=>({active:item.active,duration_minutes:item.duration_minutes})),shifts:schedule.data.shifts?.length};
  check(schedule.status===200 && schedule.data.organization_id===orgId && schedule.data.services?.every(item=>item.duration_minutes>0) && schedule.data.shifts?.length===2,'genuine-filled-workspace-contract');
  const fresh = await request(`${api}/auth/v1/token?grant_type=refresh_token`, {method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({refresh_token:actors.owner.session.refresh_token})});
  mask(fresh.access_token); mask(fresh.refresh_token); actors.owner.session = fresh;
  check(fresh.user?.id === actors.owner.id, 'genuine-session-refresh');
  await runNativeAcceptance({actors,orgId,name,anon,rpc});
  phase = 'real-session-revocation';
  const logout = await fetch(`${api}/auth/v1/logout?scope=global`, {method:'POST',headers:{apikey:anon,authorization:`Bearer ${actors.owner.session.access_token}`},signal:AbortSignal.timeout(20000)});
  check(logout.ok,'genuine-owner-global-signout');
  const revoked = await fetch(`${api}/auth/v1/token?grant_type=refresh_token`, {method:'POST',headers:{apikey:anon,'content-type':'application/json'},body:JSON.stringify({refresh_token:actors.owner.session.refresh_token}),signal:AbortSignal.timeout(20000)});
  check(!revoked.ok,'signed-out-refresh-token-refused');
  report.acceptance.O2 = true;
  report.status = 'pass';
  console.log(`Genuine Supabase native acceptance PASS: ${report.checks.length} checks; isolated fixtures preserved, no delivery or credential export.`);
} catch (error) {
  report.status = 'blocked'; report.phase = phase; report.reason = /^[A-Za-z0-9_-]+$/.test(String(error.message)) ? error.message : String(error.code || error.name || 'request_failed');
  if (nativePage && await nativePage.locator('#organizationOverviewSection').isVisible().catch(()=>false)) {
    report.native.lastOverview = await nativePage.locator('#organizationOverviewSection').innerText().catch(()=> 'unavailable');
    await nativePage.locator('#organizationOverviewSection').screenshot({path:resolve(out,'native-failure-overview.png')}).catch(()=>{});
  }
  console.error(`Genuine Supabase acceptance stopped: ${phase} (${report.reason}). Fixtures preserved; no delivery or credential export.`);
  process.exitCode = 1;
} finally {
  await client?.end().catch(() => {});
  await browser?.close().catch(() => {});
  await new Promise(done => server ? server.close(done) : done());
  await writeFile(resolve(out, 'result.json'), JSON.stringify(report, null, 2));
}

async function runNativeAcceptance({actors,orgId,name,anon,rpc}) {
  phase = 'native-provider-test-configuration';
  const source = resolve(process.env.MINUTA_ACCEPTANCE_SOURCE);
  const html = await readFile(resolve(source,'provider.html'),'utf8');
  check(html.includes(prodRef) && html.includes('organization-flow.js'), 'native-published-source-loaded');
  // Deployment configuration only: preserve provider code, DOM and real SDK.
  // Replace the CSP endpoint together with config so no production request can run.
  const config = `window.MINUTA_CONFIG=Object.freeze(${JSON.stringify({supabaseUrl:api,supabaseKey:anon,defaultOrganizationSlug:'',assistantRemoteUnderstanding:false,assistantCloudSpeechEnabled:false,socialAuthProviders:{telegram:false,vk:false,yandex:false}})});`;
  const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json','.webmanifest':'application/manifest+json'};
  server = createServer(async (req,res) => {
    try {
      const path = resolve(source, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname));
      if (!path.startsWith(source + sep)) { res.writeHead(403); res.end(); return; }
      const data = path === resolve(source,'config.js') ? config : path === resolve(source,'provider.html') ? html.replaceAll(prodRef,testRef) : await readFile(path);
      res.writeHead(200,{'content-type':types[extname(path)] || 'application/octet-stream','cache-control':'no-store'}); res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0,'127.0.0.1',done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const {chromium} = await import(pathToFileURL(resolve(process.env.MINUTA_ACCEPTANCE_DEPS,'playwright/index.mjs')).href);
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
  report.native = {widths:[],authResponses:[],rpcFailures:[],blocked:[],screenshots:[],sourceConfigurationOnly:true};
  let saveGate = null;
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin) return route.continue();
    const readRpc = url.pathname.startsWith('/rest/v1/rpc/') && /^(get_|list_|has_|is_|check_)/.test(url.pathname.split('/').at(-1));
    const auth = url.pathname.startsWith('/auth/v1/') && ['/auth/v1/token','/auth/v1/user','/auth/v1/logout'].includes(url.pathname);
    const rename = url.pathname === '/rest/v1/rpc/update_minuta_organization' && req.postDataJSON()?.p_organization === orgId;
    if (url.origin === api && (req.method() === 'GET' || req.method() === 'OPTIONS' || auth || readRpc || rename) && !url.pathname.startsWith('/functions/')) {
      if (rename && saveGate) { const gate=saveGate; saveGate=null; gate.enter(); await gate.wait; }
      return route.continue();
    }
    if (report.native.blocked.length < 12) report.native.blocked.push({host:url.hostname,path:url.pathname,method:req.method()});
    await route.abort('blockedbyclient');
  });
  const page = await context.newPage(); nativePage=page; page.setDefaultTimeout(30000);
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== api) return;
    if (url.pathname === '/auth/v1/token') report.native.authResponses.push({status:response.status(),passwordSignin:url.searchParams.get('grant_type') === 'password'});
    if (response.status() >= 400 && url.pathname.startsWith('/rest/v1/rpc/') && report.native.rpcFailures.length < 20) report.native.rpcFailures.push({rpc:url.pathname.split('/').at(-1),status:response.status()});
  });
  async function login(role) {
    phase = `native-signin-${role}`;
    await page.goto(`${origin}/provider.html?section=organization`,{waitUntil:'domcontentloaded'});
    await page.locator('#loginEmail').fill(actors[role].email);
    await page.locator('#loginPassword').fill(actors[role].password);
    const signin = page.waitForResponse(res => res.url().startsWith(api+'/auth/v1/token') && res.request().method() === 'POST');
    await page.locator('#loginForm button[type=submit]').click();
    check((await signin).status() === 200, `native-password-signin-${role}`);
    await page.locator('#dashboard').waitFor({state:'visible',timeout:90000});
    await page.locator('#organizationWorkspace').waitFor({state:'visible',timeout:90000});
    const selected = await page.locator('#organizationSwitcher').inputValue();
    if (selected !== orgId && role !== 'outsider') await page.locator('#organizationSwitcher').selectOption(orgId);
    await page.locator('#organizationOverviewSection').waitFor({state:'visible'});
    if (role !== 'outsider') await page.waitForFunction(expected => document.querySelector('#organizationTitle')?.textContent === expected,name);
  }
  async function fullProgress(label) {
    await page.waitForFunction(() => document.querySelector('#organizationOverviewSection .of-count')?.textContent === '4 из 4',null,{timeout:45000});
    check(await page.locator('#organizationOverviewSection .of-track').getAttribute('aria-valuenow') === '4',label);
  }
  async function screenshot(label) {
    await page.locator('#organizationOverviewSection').screenshot({path:resolve(out,label+'.png')}); report.native.screenshots.push(label+'.png');
  }
  async function logout(role) {
    await page.locator('#logoutButton').click();
    await page.locator('#loginForm').waitFor({state:'visible'});
    check(!await page.locator('#dashboard').isVisible(),`native-signed-out-cleared-${role}`);
  }
  await login('owner');
  phase = 'native-filled-organization';
  await fullProgress('native-real-filled-four-of-four');
  for (const width of [390,760,1440]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    await fullProgress(`native-filled-progress-${width}`);
    check(!await page.locator('#organizationFlowSteps').isVisible(),`native-ready-collapsed-${width}`);
    await page.locator('[data-org-action=manage]').click();
    check(await page.locator('#organizationFlowSteps li').count() === 4 && await page.locator('#organizationFlowSteps').isVisible(),`native-manage-expanded-${width}`);
    const overflow = await page.evaluate(() => Math.max(0,document.documentElement.scrollWidth-innerWidth));
    check(overflow === 0,`native-no-horizontal-overflow-${width}`);
    await page.locator('[data-org-action=manage]').click();
    await screenshot(`genuine-filled-${width}`);
    report.native.widths.push({width,overflow,completed:4,collapsed:true});
  }
  await page.reload({waitUntil:'domcontentloaded'}); await fullProgress('native-real-session-reload-filled');
  check((await page.locator('#organizationOverviewSection .of-status').innerText()).includes('выключена'),'real-booking-status-stays-off');
  report.acceptance.O1 = true;
  phase = 'native-real-save-pending-ack';
  const savedName = `Проверено · ${runLabel()}`;
  await page.locator('[data-org-action=rename]').click(); await page.locator('#organizationName').fill(savedName);
  let entered; const enteredPromise = new Promise(done=>entered=done); let release; const wait=new Promise(done=>release=done);
  saveGate = {enter:entered,wait};
  const acknowledgement = page.waitForResponse(res=>res.url().startsWith(api+'/rest/v1/rpc/update_minuta_organization'));
  await page.locator('#organizationForm button[type=submit]').click(); await enteredPromise;
  check(await page.locator('#organizationForm button[type=submit]').isDisabled(),'native-real-save-pending-disabled');
  release(); check((await acknowledgement).status() === 200,'native-real-save-server-ack');
  await page.waitForFunction(expected=>document.querySelector('#organizationTitle')?.textContent === expected,savedName);
  check((await client.query('select name from public.organizations where id=$1',[orgId])).rows[0].name === savedName,'native-rename-persisted-on-server');
  check((await client.query("select count(*)::int as count from public.organization_audit_log where organization_id=$1 and actor_id=$2 and action='organization_updated'",[orgId,actors.owner.id])).rows[0].count > 0,'native-save-audit-actor');
  await page.reload({waitUntil:'domcontentloaded'}); await fullProgress('native-progress-after-server-save-reload');
  check(await page.locator('#organizationTitle').innerText() === savedName,'native-server-name-survives-reload');
  phase = 'native-real-revoked-role-refusal';
  // Keep an owner throughout the temporary fixture-only role change.
  await client.query("update public.organization_memberships set role='owner' where organization_id=$1 and user_id=$2",[orgId,actors.admin.id]);
  try {
    await client.query("update public.organization_memberships set role='specialist' where organization_id=$1 and user_id=$2",[orgId,actors.owner.id]);
    await page.locator('[data-org-action=rename]').click(); await page.locator('#organizationName').fill('Черновик после отказа');
    const refusal = page.waitForResponse(res=>res.url().startsWith(api+'/rest/v1/rpc/update_minuta_organization'));
    await page.locator('#organizationForm button[type=submit]').click();
    check((await refusal).status() === 403,'native-actual-permission-refusal');
    await page.locator('#organizationError').waitFor({state:'visible'});
    check(await page.locator('#organizationName').inputValue() === 'Черновик после отказа','native-server-refusal-retains-draft');
    check((await client.query('select name from public.organizations where id=$1',[orgId])).rows[0].name === savedName,'native-refusal-does-not-save');
    await screenshot('genuine-permission-refusal');
  } finally {
    await client.query("update public.organization_memberships set role='owner' where organization_id=$1 and user_id=$2",[orgId,actors.owner.id]);
    await client.query("update public.organization_memberships set role='admin' where organization_id=$1 and user_id=$2",[orgId,actors.admin.id]);
  }
  await logout('owner');
  // login helper checks the current name, updated only by the acknowledged save.
  name = savedName;
  await login('admin'); await fullProgress('native-admin-full-progress');
  check(await page.locator('[data-org-action=rename]').isVisible(),'native-admin-can-rename'); await screenshot('genuine-admin'); await logout('admin');
  await login('specialist');
  await page.waitForFunction(()=>document.querySelector('#organizationOverviewSection .of-count')?.textContent.includes('проверка неполная'));
  check(!await page.locator('[data-org-action=rename]').isVisible(),'native-specialist-no-rename-control');
  check(await page.locator('#organizationOverviewSection .of-count').innerText() === '2 из 4 · проверка неполная','native-specialist-honest-limited-progress');
  await screenshot('genuine-specialist'); await logout('specialist');
  await login('outsider');
  check(!await page.locator('#organizationSwitcher option').evaluateAll((options,id)=>options.some(option=>option.value===id),orgId),'native-foreign-organization-not-listed');
  check(!await page.locator('#organizationTitle').innerText().then(text=>text===savedName),'native-no-previous-account-workspace');
  await logout('outsider');
  check(report.native.authResponses.filter(item=>item.passwordSignin && item.status===200).length === 4,'native-four-real-signins-observed');
  check(!report.native.blocked.some(item=>item.host.includes(prodRef)),'native-no-production-network-attempt');
  await context.close();
}

function runLabel() { return `${process.env.GITHUB_RUN_ID || 'local'}-${process.env.GITHUB_RUN_ATTEMPT || 1}`; }
