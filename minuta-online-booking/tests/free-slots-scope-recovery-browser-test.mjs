import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../free-slots-share.js', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dialogStart = html.indexOf('<dialog class="free-slots-dialog"');
const dialog = html.slice(dialogStart, html.indexOf('</dialog>', dialogStart) + 9);
const callbackStart = provider.indexOf('onActiveOrganizationChange: organization => {');
const callbackEnd = provider.indexOf('\n  }\n});', callbackStart);
assert.ok(callbackStart > 0 && callbackEnd > callbackStart, 'Actual provider organization callback must be present');
const callbackBody = provider.slice(provider.indexOf('{', callbackStart) + 1, callbackEnd);
const resetBinding = provider.split(/\r?\n/).find(line => line.includes("window.addEventListener('minuta:provider-session-reset'") && line.includes('freeSlotsController'));
assert.ok(resetBinding, 'Actual provider session-reset wiring must be present');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
let passed = 0;

async function fixture(mode = 'service') {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    assert.equal(new URL(route.request().url()).hostname, 'scope.test', 'No external request is allowed');
    return route.fulfill({ contentType:'text/html', body:dialog });
  });
  await page.goto('https://scope.test/');
  await page.addScriptTag({ content:source });
  await page.evaluate(async ({ mode, callbackBody, resetBinding }) => {
    window.activeOrg = 'A'; window.sessionRevision = 1;
    window.calls = []; window.copied = []; window.shared = []; window.notices = [];
    window.holdNext = false; window.holdContext = false; window.pending = []; window.activation = true;
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:async text => copied.push(text) } });
    Object.defineProperty(navigator, 'share', { configurable:true, value:async data => shared.push(data.text) });
    Object.defineProperty(navigator, 'userActivation', { configurable:true, get:() => ({ isActive:activation }) });
    const context = () => ({ mode:'organization', organizationId:activeOrg, organizationSlug:activeOrg,
      resourceScheduling:true, performerId:'master', locations:[{ id:`loc-${activeOrg}`, name:`Филиал ${activeOrg}` }],
      services:[1, 2].map(n => ({ id:`service-${activeOrg}-${n}`, name:`Услуга ${activeOrg}-${n}`,
        duration_minutes:60, location_ids:[`loc-${activeOrg}`] })) });
    const load = async (args, general) => {
      calls.push({ org:args.context.organizationId, service:args.serviceId, general });
      const result = { data:general ? [{ booking_date:args.from, start_time:'10:00', end_time:'12:00', duration_minutes:120 }]
        : [{ booking_date:args.from, booking_time:args.serviceId.endsWith('2') ? '15:00' : '10:00' }] };
      if (holdNext) { holdNext = false; return new Promise(resolve => pending.push(() => resolve(result))); }
      return result;
    };
    window.controller = MinutaFreeSlots.createController({ root:document.querySelector('#freeSlotsDialog'),
      getData:() => ({ userId:'master', organizationId:activeOrg, sessionGeneration:sessionRevision,
        today:'2026-09-05', now:'2026-09-05T08:00:00Z', selectedDate:'2026-09-06', bookingUrl:`https://scope.test/index.html?org=${activeOrg}` }),
      loadContext:async () => {
        const result = context();
        if (holdContext) { holdContext = false; return new Promise(resolve => pending.push(() => resolve(result))); }
        return result;
      }, loadSlots:args => load(args, false), loadWindows:args => load(args, true), notify:text => notices.push(text) });
    // Execute the production callback, mocking only unrelated controllers/views.
    const noop = Object.assign(() => {}, { setOrganization() {} });
    const values = { currentUser:null, activeClientOrganizationId:'A', $:() => null, navigator };
    const dependencies = new Proxy(values, {
      has:(_, key) => !['organization', 'freeSlotsController'].includes(key),
      get:(target, key) => key === Symbol.unscopables ? undefined : key in target ? target[key] : noop,
      set:(target, key, value) => { target[key] = value; return true; }
    });
    const applyOrganization = Function('organization', 'freeSlotsController', 'dependencies', `with (dependencies) { ${callbackBody} }`);
    window.changeOrganization = id => {
      activeOrg = id;
      applyOrganization(id ? { id } : null, controller, dependencies);
    };
    Function('freeSlotsController', resetBinding)(controller);
    document.querySelector(`[name="freeSlotsBookingMode"][value="${mode}"]`).checked = true;
    await controller.open();
  }, { mode, callbackBody, resetBinding });
  return { page, errors };
}

async function invalidateAndAssert(page, org = 'B') {
  const result = await page.evaluate(org => {
    changeOrganization(org);
    return { text:document.querySelector('#freeSlotsText').value,
      href:document.querySelector('#freeSlotsBookingLink').getAttribute('href'),
      disabled:['#copyFreeSlots', '#shareFreeSlots', '#copyFreeSlotsLink'].every(id => document.querySelector(id).disabled),
      qrHidden:document.querySelector('.free-slots-qr-wrap').hidden };
  }, org);
  assert.equal(result.disabled, true, 'All publication controls must be disabled immediately');
  assert.equal(result.href, null); assert.equal(result.qrHidden, true);
  assert.doesNotMatch(result.text, /Услуга A|10:00|12:00/);
}
async function assertNoOutput(page) {
  const output = await page.evaluate(() => ({ copied, shared }));
  assert.deepEqual(output, { copied:[], shared:[] });
}
async function finish({ page, errors }, name) {
  assert.deepEqual(errors, []); await page.close(); passed += 1; console.log(`PASS ${name}`);
}

try {
  for (const mode of ['service', 'general']) for (const action of ['#copyFreeSlots', '#shareFreeSlots']) {
    const f = await fixture(mode), { page } = f;
    await page.evaluate(action => { holdNext = true; document.querySelector(action).click(); }, action);
    await page.waitForFunction(() => pending.length === 1);
    await invalidateAndAssert(page);
    await page.evaluate(() => pending.shift()());
    await assertNoOutput(page);
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true);
    await page.evaluate(() => controller.open());
    const link = await page.locator('#freeSlotsBookingLink').getAttribute('href');
    assert.match(link, /org=B/); assert.match(link, /location=loc-B/); assert.doesNotMatch(link, /service-A|loc-A/);
    await page.evaluate(action => document.querySelector(action).click(), action);
    await page.waitForFunction(() => copied.length + shared.length === 1);
    assert.ok((await page.evaluate(() => [...copied, ...shared])).every(text => !text.includes('service-A') && text.includes('org=B')));
    await finish(f, `${mode}: pending ${action} cannot publish a previous organization`);
  }
  {
    const f = await fixture(), { page } = f;
    await page.evaluate(() => { activation = false; document.querySelector('#copyFreeSlots').click(); });
    await page.waitForFunction(() => document.querySelector('#freeSlotsShareStatus').textContent.includes('ещё раз'));
    const before = await page.evaluate(() => calls.length);
    await invalidateAndAssert(page);
    await page.evaluate(() => document.querySelector('#copyFreeSlots').click());
    await assertNoOutput(page);
    assert.equal(await page.evaluate(() => calls.length), before, 'Invalidated cached confirmation cannot dispatch');
    await page.evaluate(() => controller.open());
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), false);
    await page.evaluate(() => { sessionRevision += 1; window.dispatchEvent(new CustomEvent('minuta:provider-session-reset')); });
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true, 'The real session-reset listener invalidates a ready preview');
    assert.equal(await page.locator('#freeSlotsBookingLink').getAttribute('href'), null);
    await assertNoOutput(page);
    await finish(f, 'five-second confirmation is invalidated by organization/session changes');
  }
  {
    const f = await fixture(), { page } = f;
    await page.evaluate(() => { holdNext = true; document.querySelector('#copyFreeSlots').click(); });
    await page.waitForFunction(() => pending.length === 1);
    await invalidateAndAssert(page, 'B'); await invalidateAndAssert(page, 'A');
    await page.evaluate(() => pending.shift()());
    await assertNoOutput(page);
    assert.equal(await page.locator('#copyFreeSlots').isDisabled(), true);
    await finish(f, 'A to B to A rejects the original A revision');
  }
  {
    const f = await fixture(), { page } = f;
    await page.evaluate(() => { holdNext = true; document.querySelector('#copyFreeSlots').click(); });
    await page.waitForFunction(() => pending.length === 1);
    await page.selectOption('#freeSlotsService', 'service-A-2');
    await page.waitForFunction(() => document.querySelector('#freeSlotsText').value.includes('15:00'));
    await page.evaluate(() => pending.shift()());
    await assertNoOutput(page);
    assert.match(await page.locator('#freeSlotsText').inputValue(), /15:00/);
    assert.match(await page.locator('#freeSlotsBookingLink').getAttribute('href'), /service=service-A-2/);
    await finish(f, 'service change preserves the existing out-of-order response guard');
  }
  {
    const f = await fixture(), { page } = f;
    await page.evaluate(() => { holdContext = true; document.querySelector('#copyFreeSlots').click(); });
    await page.waitForFunction(() => pending.length === 1);
    await invalidateAndAssert(page, null);
    await page.evaluate(() => pending.shift()());
    await assertNoOutput(page);
    assert.equal(await page.evaluate(() => calls.length), 1, 'Stale context cannot launch another slot request');
    await finish(f, 'revocation while context is pending cannot start availability reads');
  }
  for (const native of ['share', 'clipboard']) {
    const f = await fixture(), { page } = f;
    await page.evaluate(native => {
      window.nativePending = null; window.nativeStarted = false; window.fallbacks = 0;
      document.execCommand = () => { fallbacks += 1; return true; };
      const hold = () => { nativeStarted = true; return new Promise((resolve, reject) => { nativePending = reject; }); };
      if (native === 'share') Object.defineProperty(navigator, 'share', { configurable:true, value:hold });
      else Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{ writeText:hold } });
      document.querySelector(native === 'share' ? '#shareFreeSlots' : '#copyFreeSlots').click();
    }, native);
    await page.waitForFunction(() => nativeStarted);
    await invalidateAndAssert(page);
    await page.evaluate(() => nativePending(Error('Native action failed')));
    await assertNoOutput(page);
    assert.equal(await page.evaluate(() => fallbacks), 0, 'An old failed native operation cannot trigger a fallback copy');
    assert.deepEqual(await page.evaluate(() => notices), [], 'Old completion cannot notify the new organization');
    await finish(f, `${native} rejection after organization change has no fallback or stale completion`);
  }
  assert.equal(passed, 10);
  console.log('PASS 10/10 free-slots scope browser regressions; no external writes');
} finally { await browser.close(); }
