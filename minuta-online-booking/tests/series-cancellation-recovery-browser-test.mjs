import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Native DOM + sourced production handlers, NOT full provider/auth/production E2E.
// Open/close/submit/session guards and delegated click/Escape wiring are real.
// Only initial account/data, sibling controllers, RPC, refresh and notices are fixtures.
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const icons = readFileSync(new URL('../ui-icons.svg', import.meta.url), 'utf8');
const source = readFileSync(process.env.MINUTA_PROVIDER_SOURCE || new URL('../provider.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function declaration(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Missing production function ${name}`);
  const firstLineEnd = source.indexOf('\n', start);
  if (source.slice(start, firstLineEnd).endsWith('}')) return source.slice(start, firstLineEnd);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, `Missing end of ${name}`);
  return source.slice(start, end + 2);
}
function listener(startText, from = 0) {
  const start = source.indexOf(startText, from);
  assert.ok(start >= 0, `Missing production listener ${startText}`);
  const firstLineEnd = source.indexOf('\n', start);
  if (source.slice(start, firstLineEnd).endsWith(');')) return source.slice(start, firstLineEnd);
  const end = source.indexOf('\n});', start);
  assert.ok(end > start, 'Missing listener end');
  return source.slice(start, end + 4);
}
const functions = ['openBookingSeriesCancellation', 'cancelBookingSeries', 'closeBookingSheet',
  'sessionIsCurrent', 'requireWrites', 'applyWriteAvailability', 'bookingOutcome',
  'actionableSeriesBookings', 'seriesBookingCountLabel', 'bookingSeriesScopeMarkup',
  'seriesRpcErrorMessage', 'showFormError', 'clearFormError', 'escapeHtml'];
const click = listener("document.addEventListener('click', async event => {");
const escape = listener("document.addEventListener('keydown', event => {\n  if (event.key !== 'Escape') return;");
const resetPrefix = "window.addEventListener('minuta:provider-session-reset'";
const resetHooks = [...source.matchAll(/window\.addEventListener\('minuta:provider-session-reset'/g)]
  .map(match => listener(resetPrefix, match.index));
assert.ok(resetHooks.length, 'All actual session reset hooks must be loaded');
const reset = resetHooks.join('\n');
const revisionDeclaration = ['bookingSeriesCancellationRevision', 'bookingEditorRevision', 'bookingMetadataRevision']
  .map(name => {
    const declaration = source.match(new RegExp(`^let ${name} = .*;$`, 'm'))?.[0];
    assert.ok(declaration, `Actual lifecycle declaration: ${name}`);
    return declaration.replace(/^let /, 'var ');
  }).join('\n');
const writeSelectors = source.match(/^const writeSelectors = \[[\s\S]*?^\];/m)?.[0];
assert.ok(writeSelectors, 'Production write selectors must be present');
const orgStart = source.indexOf('onActiveOrganizationChange: organization => {');
const orgEnd = source.indexOf('\n  }\n});', orgStart);
assert.ok(orgStart >= 0 && orgEnd > orgStart, 'Production organization callback boundary must be present');
const orgBody = source.slice(source.indexOf('{', orgStart) + 1, orgEnd);
const loader = `${writeSelectors}\n${functions.map(declaration).join('\n')}\n${click}\n${escape}\n${reset}`;
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
let browser;
const failures = [];
const fixtureUrl = 'https://series-cancellation.test/';
const ids = { A:'11111111-1111-4111-8111-111111111111', B:'22222222-2222-4222-8222-222222222222' };
const series = { A:'33333333-3333-4333-8333-333333333333', B:'44444444-4444-4444-8444-444444444444' };
const success = { data:{ series_id:series.A, action:'cancel', scope:'following',
  affected_count:1, affected:[{ booking_id:ids.A, occurrence:1 }] }, error:null };
const error = { data:null, error:{ code:'42501', message:'booking_access_denied' } };
async function fixture() {
  const context = await browser.newContext({ serviceWorkers:'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const errors = [], traffic = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (route.request().url() === `${fixtureUrl}ui-icons.svg`) return route.fulfill({ contentType:'image/svg+xml', body:icons });
    if (route.request().url() !== fixtureUrl) { traffic.push(route.request().url()); return route.abort(); }
    return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><body></body></html>' });
  });
  await page.goto(fixtureUrl);
  await page.evaluate(({html,ids}) => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const id of ['bookingSheet', 'portfolioEditorDialog']) {
      const element = parsed.getElementById(id);
      if (!element) throw new Error(`Missing actual provider #${id}`);
      document.body.append(document.importNode(element, true));
    }
    for (const id of ['A', 'B']) {
      const button = document.createElement('button');
      button.dataset.cancelBookingSeries = ids[id];
      button.textContent = `Открыть серию ${id}`;
      document.body.append(button);
    }
  }, {html,ids});
  await page.addStyleTag({ content:'[hidden]{display:none!important}label{display:block;margin:8px}svg{width:18px;height:18px}button,input{font:16px sans-serif}.booking-sheet-backdrop{width:20px;height:20px}' });
  await page.addScriptTag({ content:`
    var currentUser={id:'same-provider'}, sessionGeneration=7, activeClientOrganizationId='org-A';
    ${revisionDeclaration}
    var gestureClickSuppressedUntil=0, writesAllowed=true;
    var bookingCreationReady=false, editingOfflineBookingId='', newBookingHistoricalMode=false;
    var bookingIds=${JSON.stringify(ids)}, seriesIds=${JSON.stringify(series)};
    var bookingOutcomes=new Map(), allBookings=['A','B'].map(label=>({id:bookingIds[label],series_id:seriesIds[label],
      series_occurrence:1,booking_series:{occurrence_count:1},booking_date:'2099-09-05',booking_time:'10:00:00',status:'confirmed'}));
    var $=selector=>document.querySelector(selector), $$=selector=>[...document.querySelectorAll(selector)];
    var businessTodayIso=()=> '2099-09-05', uiIcon=()=>'', applyClientHighlightClasses=()=>{}, updateScheduleSaveState=()=>{};
    var resetEffects=[], providerReadFetch={cancelPendingReads(){resetEffects.push('reads');}}, REPORT_DEMO_SLUG='demo';
    var freeSlotsController={invalidateScope(){resetEffects.push('free-slots');}};
    var calls=[], notices=[], telegram=[], refreshes=0, holds=[], refreshHolds=[], holdRefresh=false;
    var notify=text=>notices.push(text), notifyTelegramClient=(id,event)=>telegram.push({id,event});
    var refreshAfterWrite=()=>{refreshes++;return holdRefresh?new Promise((resolve,reject)=>refreshHolds.push({resolve,reject})):Promise.resolve();};
    var db={rpc:(name,args)=>{calls.push({name,args:structuredClone(args)});return new Promise((resolve,reject)=>holds.push({resolve,reject}));}};
    ${loader}
  ` });
  await page.evaluate(orgBody => {
    const noop = Object.assign(() => {}, { setOrganization() {} });
    const siblings = new Proxy({}, {
      has:(_, key) => key !== 'organization',
      get:(_, key) => key === Symbol.unscopables ? undefined : key in window ? window[key] : noop,
      set:(_, key, value) => { window[key] = value; return true; }
    });
    const change = Function('organization', 'siblings', `with(siblings){${orgBody}}`);
    window.changeOrganization = id => change({ id }, siblings);
    window.releaseRpc = (value, thrown = false) => {
      const held = holds.shift();
      if (!held) throw new Error('No pending RPC');
      if (thrown) held.reject(new Error('Failed to fetch')); else held.resolve(value);
    };
  }, orgBody);
  return { page, context, errors, traffic };
}
const submit = page => page.locator('#bookingSeriesCancelForm button[type="submit"]').click();
async function open(page, id) {
  await page.locator(`[data-cancel-booking-series="${ids[id]}"]`).click();
  assert.equal(await page.locator('#bookingSeriesCancelForm').getAttribute('data-booking-id'), ids[id]);
}
async function pendingA(page) {
  await open(page, 'A');
  await page.locator('[name="cancelBookingSeriesScope"][value="following"]').check();
  await submit(page);
  await page.waitForFunction(() => holds.length === 1);
  assert.equal(await page.locator('#bookingSeriesCancelForm button[type="submit"]').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => calls), [{ name:'manage_minuta_booking_series', args:{
    p_booking:ids.A, p_action:'cancel', p_scope:'following', p_date:null, p_time:null } }]);
}
async function settle(page, reply = success, thrown = false) {
  await page.evaluate(({ reply, thrown }) => releaseRpc(reply, thrown), { reply, thrown });
  // RPC Promise continuations (including finally) complete before the next browser task.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
}
async function rememberNewForm(page, id) {
  await open(page, id);
  await page.locator('[name="cancelBookingSeriesScope"][value="all"]').check();
  await page.evaluate(() => { window.newForm=document.querySelector('#bookingSeriesCancelForm'); });
}
async function assertNewForm(page, id, effects = { refreshes:0, telegram:[], notices:[] }) {
  assert.deepEqual(await page.evaluate(() => ({
    visible:!$('#bookingSheet').hidden, same:newForm===$('#bookingSeriesCancelForm'), connected:newForm.isConnected,
    id:$('#bookingSeriesCancelForm').dataset.bookingId, scope:$('#bookingSeriesCancelForm').elements.cancelBookingSeriesScope.value,
    disabled:$('#bookingSeriesCancelForm button[type="submit"]').disabled,
    caption:$('#bookingSeriesCancelForm button[type="submit"]').textContent,
    errorHidden:$('#bookingSeriesCancelError').hidden,
    refreshes, telegram, notices, calls:calls.length, user:currentUser.id, generation:sessionGeneration
  })), { visible:true, same:true, connected:true, id:ids[id], scope:'all', disabled:false,
    caption:'Отменить выбранные записи', errorHidden:true, ...effects, calls:1, user:'same-provider', generation:7 });
}
const cases = [];
for (const [name, reply, thrown, close] of [
  ['late success', success, false, 'button'], ['late error', error, false, 'escape'], ['late rejection', null, true, 'button']
]) cases.push([`A pending → native close → B open → ${name}`, async page => {
  await pendingA(page);
  if (close === 'escape') await page.keyboard.press('Escape');
  else await page.locator('.booking-sheet-close').click();
  await rememberNewForm(page, 'B');
  await settle(page, reply, thrown);
  await assertNewForm(page, 'B');
}]);
cases.push(['close and reopen same booking ID must create a new form incarnation', async page => {
  await pendingA(page); await page.keyboard.press('Escape');
  await rememberNewForm(page, 'A'); await settle(page); await assertNewForm(page, 'A');
}]);
cases.push(['actual organization callback A → B → A invalidates a pending cancellation', async page => {
  await pendingA(page);
  await page.evaluate(() => { changeOrganization('org-B'); changeOrganization('org-A'); });
  const before = await page.locator('#bookingSeriesCancelForm').innerHTML();
  await settle(page);
  assert.equal(await page.locator('#bookingSheet').evaluate(el => el.hidden), false);
  assert.equal(await page.locator('#bookingSeriesCancelForm').innerHTML(), before);
  assert.deepEqual(await page.evaluate(() => ({ refreshes, telegram, notices, org:activeClientOrganizationId, user:currentUser.id, generation:sessionGeneration })),
    { refreshes:0, telegram:[], notices:[], org:'org-A', user:'same-provider', generation:7 });
}]);
cases.push(['same form success retains close, refresh and confirmation behavior', async page => {
  await pendingA(page);
  // A routine same-organization callback must not invalidate a live form.
  await page.evaluate(() => changeOrganization('org-A'));
  await settle(page);
  assert.equal(await page.locator('#bookingSheet').evaluate(el => el.hidden), true);
  assert.deepEqual(await page.evaluate(() => ({ refreshes, telegram, notices })),
    { refreshes:1, telegram:[{id:ids.A,event:'cancelled'}], notices:['Отменено: 1 запись'] });
}]);
cases.push(['new form during cancellation refresh must not receive the old success toast', async page => {
  await page.evaluate(() => { holdRefresh=true; });
  await pendingA(page); await settle(page);
  await page.waitForFunction(() => refreshHolds.length === 1);
  await rememberNewForm(page, 'B');
  await page.evaluate(() => refreshHolds.shift().resolve());
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  await assertNewForm(page, 'B', { refreshes:1, telegram:[{id:ids.A,event:'cancelled'}], notices:[] });
}]);
cases.push(['all real session-reset callbacks invalidate series even with unchanged account identity', async page => {
  await pendingA(page);
  const before = await page.locator('#bookingSeriesCancelForm').innerHTML();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('minuta:provider-session-reset')));
  await settle(page);
  assert.equal(await page.locator('#bookingSheet').evaluate(el => el.hidden), false);
  assert.equal(await page.locator('#bookingSeriesCancelForm').innerHTML(), before);
  assert.deepEqual(await page.evaluate(() => ({refreshes,telegram,notices})), {refreshes:0,telegram:[],notices:[]});
  assert.deepEqual(await page.evaluate(() => resetEffects.sort()),
    resetHooks.some(hook => hook.includes('freeSlotsController')) ? ['free-slots','reads'] : ['reads']);
}]);
for (const [label, reply] of [
  ['null successful envelope', {data:null,error:null}],
  ['partial successful envelope', {data:{series_id:series.A},error:null}],
  ['fulfilled transport error', {data:null,error:{code:'08006',message:'network: booking_access_denied'}}]
]) cases.push([`${label} cannot claim cancellation or unchanged server state`, async page => {
  await pendingA(page); await settle(page, reply);
  assert.equal(await page.locator('#bookingSheet').evaluate(el => el.hidden), false);
  assert.equal(await page.locator('#bookingSeriesCancelForm button[type="submit"]').isDisabled(), false);
  assert.equal(await page.locator('#bookingSeriesCancelError').evaluate(el => el.hidden), false);
  const message = await page.locator('#bookingSeriesCancelError').innerText();
  assert.match(message, /не удалось подтвердить результат/i);
  assert.doesNotMatch(message, /осталась без изменений|записи отменены/i);
  assert.deepEqual(await page.evaluate(() => ({refreshes,telegram,notices,calls:calls.length})), {refreshes:0,telegram:[],notices:[],calls:1});
}]);
try {
  browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  for (const [name, run] of cases) {
    let f;
    try {
      f = await fixture(); await run(f.page);
      assert.deepEqual(f.errors, [], 'No unhandled browser errors');
      assert.deepEqual(f.traffic, [], 'No external network or production requests');
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push(name); console.error(`FAIL ${name}\n${error.stack}`);
      if (f?.errors.length) console.error('Page errors:', f.errors);
    } finally { await f?.context.close(); }
  }
} finally { await browser?.close(); }
console.log(`${cases.length-failures.length}/${cases.length} native DOM/production-handler cases passed; full provider E2E not exercised`);
if (failures.length) process.exitCode=1;
