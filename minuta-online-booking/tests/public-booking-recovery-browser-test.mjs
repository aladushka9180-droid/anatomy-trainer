import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Full, unmodified app.js, real index DOM, browser storage and Supabase SDK.
// Only transport/catalog data are fixtures. No production, SQL concurrency or
// installed-PWA claim: optional group/Telegram/SW bootstraps are out of scope.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = process.env.MINUTA_PUBLIC_BOOKING_SOURCE || resolve(root, 'app.js');
const source = readFileSync(sourcePath);
const originalHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
const html = originalHtml.replace(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]*?<\/script>/gi,
  (tag, src) => /^(?:vendor\/supabase[^/]*\.js|config\.js|app\.js)(?:\?|$)/.test(src) ? tag : '');
assert.ok(html.includes('id="bookingForm"') && html.includes('src="app.js'), 'Real form and app must remain');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const ids = {
  org:'11111111-1111-4111-8111-111111111111', service:'22222222-2222-4222-8222-222222222222',
  a:'33333333-3333-4333-8333-333333333333', b:'44444444-4444-4444-8444-444444444444',
  token:'55555555-5555-4555-8555-555555555555', performer:'66666666-6666-4666-8666-666666666666'
};
const day = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone:'UTC' });
const attemptKey = 'minuta-booking-attempt-v1';
const canonical = value => JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
let scenario;
let origin;
const unexpected = [];
const mime = { '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.woff2':'font/woff2', '.webmanifest':'application/manifest+json' };
function json(res, value, status = 200) {
  res.writeHead(status, { 'content-type':'application/json', 'cache-control':'no-store' });
  res.end(JSON.stringify(value));
}
function rpc(name, args, res) {
  scenario.calls.push({ name, args });
  if (name === 'get_public_minuta_catalog_v4') return json(res, {
    organization:{ id:ids.org, name:'Изолированная студия' }, resource_scheduling:true,
    branch_shift_scheduling:true,
    locations:[{ id:ids.a, name:'Филиал A', is_primary:true }, { id:ids.b, name:'Филиал B' }],
    services:[{ id:ids.service, performer_id:ids.performer, name:'Тестовая услуга', duration_minutes:60,
      price_rub:1000, location_ids:[ids.a, ids.b], performer_profiles:{ display_name:'Тестовый мастер' } }]
  });
  if (name === 'get_public_minuta_available_slots_v101') return json(res,
    scenario.busy ? [] : [{ booking_date:day, booking_time:'10:00:00' }]);
  if (name === 'book_minuta_appointment') {
    scenario.creates.push(args);
    const previous = scenario.ledger.get(args.p_request_id);
    if (previous) {
      if (previous.payload !== canonical(args)) return json(res, { code:'P0001', message:'request_conflict' }, 400);
      if (scenario.outage) { res.destroy(); return; }
      return json(res, previous.result);
    }
    // Do not hide accidental new nonces behind a permissive dedupe mock.
    if (scenario.busy) return json(res, { code:'P0001', message:'slot_unavailable' }, 400);
    assert.equal(args.p_location, ids.b, 'The first visit must belong to non-primary B');
    const result = [{ booking_code:'NATIVE-BOOKING', manage_token:ids.token }];
    scenario.ledger.set(args.p_request_id, { payload:canonical(args), result });
    scenario.busy = true;
    // Commit is durable in this process; only the HTTP response is lost.
    res.destroy();
    return;
  }
  if (name === 'get_booking_management') return json(res, [{ booking_code:'NATIVE-BOOKING',
    status:'confirmed', booking_date:day, booking_time:'10:00:00', service_name:'Тестовая услуга',
    performer_name:'Тестовый мастер', duration_minutes:60 }]);
  if (name === 'get_public_booking_reviews' || name === 'bootstrap_client_access') return json(res, []);
  if (name === 'get_yookassa_payment_capability') return json(res, { available:false });
  if (['track_public_booking_funnel_event', 'upsert_public_booking_presence', 'record_minuta_booking_legal_acceptance_v110'].includes(name)) return json(res, true);
  unexpected.push(`RPC ${name}`);
  return json(res, { message:`Unexpected fixture RPC ${name}` }, 500);
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, origin);
    if (req.method === 'POST' && url.pathname.startsWith('/rest/v1/rpc/')) {
      const parts = []; for await (const part of req) parts.push(part);
      return rpc(url.pathname.split('/').at(-1), JSON.parse(Buffer.concat(parts).toString()), res);
    }
    if (url.pathname === '/functions/v1/telegram-client-notify/event') return json(res, { ok:true });
    if (req.method !== 'GET') throw new Error(`Unexpected method ${req.method}`);
    const pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith('/minuta-online-booking/') || pathname.includes('\\') || pathname.split('/').includes('..')) throw new Error('Disallowed URL');
    const relative = pathname.slice('/minuta-online-booking/'.length) || 'index.html';
    const target = resolve(root, relative);
    if (!target.startsWith(root + sep)) throw new Error('Path escapes fixture root');
    if (relative === 'config.js') {
      res.writeHead(200, { 'content-type':'text/javascript' });
      return res.end(`window.MINUTA_CONFIG=${JSON.stringify({ supabaseUrl:origin, supabaseKey:'fixture-anon-key', defaultOrganizationSlug:'studio' })};`);
    }
    const body = relative === 'index.html' ? html : relative === 'app.js' ? source : readFileSync(target);
    res.writeHead(200, { 'content-type':relative === 'index.html' ? 'text/html; charset=utf-8' : mime[extname(target)] || 'application/octet-stream', 'cache-control':'no-store' });
    res.end(body);
  } catch (error) {
    unexpected.push(`${req.method} ${req.url}: ${error.message}`);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const failures = [];
async function fixture({ busy = false } = {}) {
  scenario = { busy, outage:true, calls:[], creates:[], ledger:new Map() };
  const context = await browser.newContext({ serviceWorkers:'block', viewport:{ width:1100, height:900 }, reducedMotion:'reduce' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    unexpected.push(`External ${route.request().url()}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/minuta-online-booking/index.html?org=studio`);
  await page.locator(`[data-service="${ids.service}"]`).waitFor();
  return { page, context, errors, model:scenario };
}
async function chooseSlot(page) {
  await page.locator('#locationSelect').selectOption(ids.b);
  await page.locator(`[data-service="${ids.service}"]`).click();
  await page.locator(`[data-date="${day}"]`).click();
  await page.locator('[data-time="10:00"]').click();
}
async function contacts(page, name = 'Ирина') {
  await page.locator('#clientName').fill(name);
  await page.locator('#clientPhone').fill('+79990000000');
  await page.locator('#dataConsent').check();
}
async function loseReply(page, model) {
  await chooseSlot(page); await contacts(page);
  await page.locator('#submitBooking').click();
  await page.waitForFunction(() => !document.querySelector('#submitBooking').disabled && !document.querySelector('#formError').hidden);
  assert.equal(model.ledger.size, 1);
  // The shipped SDK retries transport failures itself. Preserve that behavior:
  // every automatic wire retry must keep the very same immutable request.
  assert.ok(model.creates.length >= 1);
  for (const request of model.creates) assert.deepEqual(request, model.creates[0]);
  model.initialWireCount = model.creates.length;
  assert.equal(await page.locator('#success').evaluate(el => el.hidden), true);
  assert.equal(await page.locator('#clientName').evaluate(el => el.readOnly), true);
  const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), attemptKey);
  assert.deepEqual(Object.keys(saved).sort(), ['fingerprint', 'requestId', 'scope']);
  assert.ok(!JSON.stringify(saved).includes('Ирина') && !JSON.stringify(saved).includes('79990000000') && !JSON.stringify(saved).includes(ids.token));
  return saved;
}
async function reload(page) {
  scenario.outage = false;
  await page.reload();
  await page.locator('#bookingForm.active').waitFor();
  assert.equal(await page.locator('#clientName').inputValue(), '');
  assert.equal(await page.locator('#clientPhone').inputValue(), '');
  assert.match(await page.locator('#summary').innerText(), /Филиал B/);
  assert.match(await page.locator('#summary').innerText(), /10:00/);
}
const cases = [
  ['lost committed reply → native reload → occupied slot → same nonce', async ({ page, model }) => {
    const original = await loseReply(page, model);
    await reload(page);
    const restoredLocation = await page.locator('#locationSelect').inputValue();
    await contacts(page);
    assert.equal(await page.locator('#submitBooking').isDisabled(), false, 'Own occupied slot must not block resolution');
    await page.locator('#submitBooking').click();
    await page.locator('#success').waitFor({ state:'visible' });
    assert.equal(model.creates.length, model.initialWireCount + 1);
    assert.equal(model.ledger.size, 1);
    assert.deepEqual(model.creates.at(-1), model.creates[0]);
    assert.equal(model.creates.at(-1).p_request_id, original.requestId);
    assert.equal(new Set(model.creates.map(item => item.p_request_id)).size, 1);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), attemptKey), null);
    assert.match(await page.locator('#successDetails').innerText(), /Тестовая услуга/);
    // Keep this real-DOM assertion even if a legacy render order makes it RED.
    assert.equal(restoredLocation, ids.b, 'Visible branch selector must agree with restored B scope and summary');
  }],
  ['changed contacts after reload cannot allocate a replacement nonce', async ({ page, model }) => {
    const original = await loseReply(page, model);
    await reload(page); await contacts(page, 'Другое имя');
    await page.locator('#submitBooking').click();
    await page.waitForFunction(() => document.querySelector('#formError').textContent.includes('исходную запись') && !document.querySelector('#submitBooking').disabled);
    assert.equal(model.creates.length, model.initialWireCount);
    assert.equal(model.ledger.size, 1);
    assert.equal(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)).requestId, attemptKey), original.requestId);
    assert.equal(await page.locator('#success').evaluate(el => el.hidden), true);
  }],
  ['fresh visitor cannot submit an occupied slot without an unresolved attempt', async ({ page, model }) => {
    await page.locator('#locationSelect').selectOption(ids.b);
    await page.locator(`[data-service="${ids.service}"]`).click();
    await page.locator('#noTimes').waitFor({ state:'visible' });
    assert.equal(await page.locator('[data-time]:not(:disabled)').count(), 0);
    assert.equal(await page.locator('#submitBooking').isDisabled(), true);
    assert.equal(model.creates.length, 0);
    assert.equal(model.ledger.size, 0);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), attemptKey), null);
  }, { busy:true }]
];
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  for (const [name, run, options] of cases) {
    let f;
    try {
      f = await fixture(options);
      await run(f);
      assert.deepEqual(f.errors, [], 'No unhandled app errors');
      assert.deepEqual(unexpected, [], 'No unmocked or external traffic');
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name);
      console.error(`FAIL ${name}\n${error.stack}`);
      if (f) console.error('Fixture diagnostic:', JSON.stringify({ creates:f.model.creates.length, ledger:f.model.ledger.size,
        rpc:f.model.calls.map(call => call.name), dom:await f.page.evaluate(() => ({
          error:document.querySelector('#formError').textContent, disabled:document.querySelector('#submitBooking').disabled,
          success:!document.querySelector('#success').hidden, name:document.querySelector('#clientName').value,
          phone:document.querySelector('#clientPhone').value, consent:document.querySelector('#dataConsent').checked
        })) }));
      if (f?.errors.length) console.error('Page errors:', f.errors);
      if (unexpected.length) console.error('Unexpected requests:', unexpected);
    } finally { await f?.context.close(); }
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(`${cases.length - failures.length}/${cases.length} native cases passed`);
if (failures.length) process.exitCode = 1;
