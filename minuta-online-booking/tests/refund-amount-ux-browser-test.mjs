import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Native HTML/controller validation only. No real payment, API, or provider E2E.
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../payment-management.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true,
  ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const fixtureUrl = 'https://refund-amount.test/';
const pageErrors = [], unexpectedRequests = [];
async function fixture(captured = 1000, refunded = 0) {
  const page = await browser.newPage({ serviceWorkers:'block', viewport:{ width:390, height:844 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url() !== fixtureUrl) {
      unexpectedRequests.push(route.request().url());
      return route.abort();
    }
    return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><title>Isolated refund test</title><body></body></html>' });
  });
  await page.goto(fixtureUrl);
  await page.evaluate(html => {
    const panel = new DOMParser().parseFromString(html, 'text/html').getElementById('paymentProviderPanel');
    if (!panel) throw new Error('Missing real payment panel');
    document.body.append(document.importNode(panel, true));
  }, html);
  await page.addStyleTag({ content:'label{display:block;margin:6px}input,button,select{font:16px sans-serif}svg{width:20px;height:20px}' });
  await page.addScriptTag({ content:source });
  await page.evaluate(async ({ captured, refunded }) => {
    const state = window.testState = { calls:[], notices:[], loads:0 };
    const payload = { organization_id:'org-a', current_role:'owner', settings:{ enabled:false, environment:'test' },
      recent_attempts:[{ id:'attempt-a', amount_minor:captured, captured_amount_minor:captured,
        refunded_amount_minor:refunded, status:'succeeded', created_at:'2026-09-01T12:00:00Z' }] };
    state.payload = payload;
    const db = {
      rpc:async name => {
        if (name !== 'get_minuta_payment_workspace') throw new Error('Unexpected RPC: ' + name);
        state.loads += 1;
        return { data:structuredClone(payload), error:null };
      },
      functions:{ invoke:async (name, args) => {
        state.calls.push({ name, body:structuredClone(args.body) });
        return { data:{ ok:true, status:'pending' }, error:null };
      } }
    };
    window.controller = window.MinutaPayments.createController({ db, $:s => document.querySelector(s),
      escapeHtml:v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])),
      notify:v => state.notices.push(v), requireWrites:() => true });
    controller.bind();
    await controller.setOrganization({ id:'org-a', current_role:'owner' });
  }, { captured, refunded });
  await page.locator('#paymentRefundReason').fill('Возврат по просьбе клиента');
  return page;
}
async function submit(page, amount) {
  await page.locator('#paymentRefundAmount').fill(amount);
  await page.locator('#paymentRefundForm button[type=submit]').click();
}
async function run(title, body, ...args) {
  const page = await fixture(...args);
  try { await body(page); console.log(`PASS: ${title}`); }
  finally { await page.close(); }
}
try {
  await run('native 9.50 of 10.00 shows exact alternatives and sends no refund', async page => {
    await submit(page, '9.50');
    assert.match(await page.evaluate(() => testState.notices.at(-1)), /9,00.*10,00/);
    assert.equal(await page.locator('#paymentRefundAmount').inputValue(), '9.50');
    assert.equal(await page.locator('#paymentRefundReason').inputValue(), 'Возврат по просьбе клиента');
    assert.deepEqual(await page.evaluate(() => ({ calls:testState.calls.length, loads:testState.loads })), { calls:0, loads:1 });
  });
  await run('corrected native amount submits exact cents once, only after explicit click', async page => {
    await submit(page, '9.50');
    await page.locator('#paymentRefundAmount').fill('9.00');
    assert.equal(await page.evaluate(() => testState.calls.length), 0);
    await page.locator('#paymentRefundForm button[type=submit]').click();
    await page.waitForFunction(() => testState.notices.includes('Возврат принят в обработку'));
    const calls = await page.evaluate(() => testState.calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'yookassa-refund');
    assert.equal(calls[0].body.amount_minor, 900);
    assert.equal(calls[0].body.attempt_id, 'attempt-a');
    assert.equal(calls[0].body.organization_id, 'org-a');
    assert.ok(calls[0].body.request_id);
    assert.equal(await page.evaluate(() => testState.notices.includes('Возврат выполнен')), false);
  });
  await run('native min/step/max validation blocks invalid amounts without rounding', async page => {
    for (const amount of ['0.99', '1.005', '10.01']) {
      await submit(page, amount);
      assert.equal(await page.locator('#paymentRefundAmount').evaluate(input => input.checkValidity()), false);
      assert.equal(await page.evaluate(() => testState.calls.length), 0);
      assert.equal(await page.locator('#paymentRefundAmount').inputValue(), amount);
    }
  });
  await run('remaining 1.50 explains full remainder; 1.50 submits exactly 150 cents', async page => {
    await submit(page, '1.00');
    assert.match(await page.evaluate(() => testState.notices.at(-1)), /весь остаток.*1,50/);
    assert.equal(await page.evaluate(() => testState.calls.length), 0);
    await submit(page, '1.50');
    await page.waitForFunction(() => testState.calls.length === 1);
    assert.equal(await page.evaluate(() => testState.calls[0].body.amount_minor), 150);
  }, 1000, 850);
  await run('native reload preserves selected payment and its entered draft', async page => {
    await page.evaluate(async () => {
      testState.payload.recent_attempts.push({ ...testState.payload.recent_attempts[0], id:'attempt-b', amount_minor:2000, captured_amount_minor:2000 });
      await controller.load();
    });
    await page.locator('#paymentRefundAttempt').selectOption('attempt-b');
    await page.locator('#paymentRefundAmount').fill('9.00');
    await page.evaluate(() => controller.load());
    assert.equal(await page.locator('#paymentRefundAttempt').inputValue(), 'attempt-b');
    assert.equal(await page.locator('#paymentRefundAmount').inputValue(), '9.00');
    assert.equal(await page.locator('#paymentRefundAmount').getAttribute('max'), '20.00');
    assert.equal(await page.locator('#paymentRefundReason').inputValue(), 'Возврат по просьбе клиента');
    assert.equal(await page.evaluate(() => testState.calls.length), 0);
  });
  await run('removed payment stays unselected across reloads until explicit selection', async page => {
    await page.evaluate(async () => {
      testState.payload.recent_attempts.push({ ...testState.payload.recent_attempts[0], id:'attempt-b', amount_minor:2000, captured_amount_minor:2000 });
      await controller.load();
    });
    await page.locator('#paymentRefundAttempt').selectOption('attempt-b');
    await page.locator('#paymentRefundAmount').fill('9.00');
    await page.evaluate(async () => {
      testState.payload.recent_attempts = testState.payload.recent_attempts.filter(row => row.id !== 'attempt-b');
      await controller.load();
    });
    for (let i = 0; i < 2; i += 1) {
      assert.equal(await page.locator('#paymentRefundAttempt').inputValue(), '');
      assert.equal(await page.locator('#paymentRefundAmount').inputValue(), '9.00');
      await page.locator('#paymentRefundForm button[type=submit]').click();
      assert.equal(await page.evaluate(() => testState.calls.length), 0);
      await page.evaluate(() => controller.load());
    }
    await page.locator('#paymentRefundAttempt').selectOption('attempt-a');
    await page.locator('#paymentRefundForm button[type=submit]').click();
    await page.waitForFunction(() => testState.calls.length === 1);
    assert.equal(await page.evaluate(() => testState.calls[0].body.attempt_id), 'attempt-a');
    assert.equal(await page.evaluate(() => testState.calls[0].body.amount_minor), 900);
  });
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedRequests, []);
  console.log('Refund amount native DOM: 6/6 PASS; mocked Edge only, real payments 0');
} finally {
  await browser.close();
}
