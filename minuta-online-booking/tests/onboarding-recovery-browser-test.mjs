import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium, devices } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/onboarding.css"><body><script src="/service-presets-catalog.js"></script><script src="/onboarding.js"></script></body></html>';
const mime = { '.css':'text/css', '.js':'text/javascript' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/') { response.setHeader('content-type', 'text/html; charset=utf-8'); response.end(html); return; }
  const target = resolve(root, `.${pathname}`);
  if (!target.startsWith(root + sep)) { response.writeHead(400).end(); return; }
  try { response.setHeader('content-type', mime[extname(target)] || 'application/octet-stream'); response.end(readFileSync(target)); }
  catch { response.writeHead(404).end(); }
});

await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ ...(process.env.MINUTA_CHROME_PATH ? { executablePath:process.env.MINUTA_CHROME_PATH } : { channel:'chrome' }), headless:true });
const screenshotDir = process.env.MINUTA_AUDIT_SCREENSHOTS;
if (screenshotDir) mkdirSync(screenshotDir, { recursive:true });

async function fixture(width, mode = 'normal', device = {}) {
  const browserContext = await browser.newContext({ ...device, viewport:{ width, height:device.viewport?.height || 920 } });
  await browserContext.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await browserContext.newPage();
  await page.goto(origin);
  await page.evaluate(async modeValue => {
    const user = { id:'11111111-1111-4111-8111-111111111111', user_metadata:{ minuta_onboarding_status:'pending', display_name:'Тестовый мастер' } };
    const state = window.fixture = { mode:modeValue, rpcCalls:[], schedule:[], complete:0, refresh:0, statusWrites:0, scheduleAttempts:0 };
    const db = {
      async rpc(name, args) {
        state.rpcCalls.push({ name, args:structuredClone(args) });
        if (state.mode === 'permission') return { data:null, error:{ code:'42501', message:'permission denied' } };
        if (state.mode === 'schema') return { data:null, error:{ code:'PGRST202', message:'function not found' } };
        if (state.mode === 'retry' && state.rpcCalls.length === 1) return { data:null, error:{ code:'08006', message:'connection lost' } };
        return { data:{ replayed:state.rpcCalls.length > 1, created_count:args.p_services.length }, error:null };
      },
      from(table) {
        return { async upsert(rows) {
          state.scheduleAttempts += 1;
          if (table !== 'provider_schedule') return { error:{ message:'unexpected table' } };
          if (state.mode === 'schedule-fail' && state.scheduleAttempts === 1) return { error:{ code:'08006', message:'schedule write failed' } };
          state.schedule = structuredClone(rows);
          return { error:null };
        } };
      },
      auth:{
        async updateUser({ data }) { state.statusWrites += 1; Object.assign(user.user_metadata, data); return { data:{ user }, error:null }; },
        async getUser() { return { data:{ user }, error:null }; }
      }
    };
    await window.MinutaProviderOnboarding.handleSession({ db, user, refresh:async () => { state.refresh += 1; }, onComplete:() => { state.complete += 1; } });
  }, mode);
  return { page, browserContext };
}

async function chooseProfessionAndAdvance(page, { withService = true } = {}) {
  await page.locator('.onboarding-chips label').filter({ has:page.locator('[data-onboarding-profession][value="massage_therapist"]') }).click();
  await page.locator('.onboarding-chips label').filter({ has:page.locator('[data-onboarding-profession][value="esthetician"]') }).click();
  await page.locator('[data-onboarding-next]').click();
  if (withService) {
    await page.locator('[data-onboarding-preset="massage_full_body"]').click();
    await page.locator('[data-service-price]').fill('2500');
  }
  await page.locator('[data-onboarding-next]').click();
  await page.locator('[data-onboarding-next]').click();
}

try {
  for (const width of [390, 760, 1440]) {
    const current = await fixture(width);
    const { page } = current;
    assert.equal(await page.locator('[data-onboarding-profession]').count(), 12);
    const firstTap = await page.locator('[data-onboarding-profession]').first().evaluate(element => element.closest('label').getBoundingClientRect().height);
    assert.ok(firstTap >= 44);
    await chooseProfessionAndAdvance(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await page.evaluate(() => fixture.rpcCalls.length), 0, 'Services must not be created before final confirmation');
    if (screenshotDir) await page.screenshot({ path:resolve(screenshotDir, `onboarding-service-presets-${width}.png`), fullPage:true });
    const finalButton = page.locator('[data-onboarding-next]');
    assert.ok(await finalButton.evaluate(element => element.getBoundingClientRect().height) >= 44);
    await finalButton.click();
    await page.locator('#providerOnboarding').waitFor({ state:'hidden' });
    const saved = await page.evaluate(() => ({ complete:fixture.complete, calls:fixture.rpcCalls, schedule:fixture.schedule, statusWrites:fixture.statusWrites }));
    assert.equal(saved.complete, 1);
    assert.equal(saved.calls.length, 1);
    assert.equal(saved.calls[0].args.p_professions.length, 2);
    assert.equal(saved.calls[0].args.p_services.length, 1);
    assert.deepEqual(saved.schedule.map(row => row.weekday).sort(), [1,2,3,4,5,6,7]);
    assert.equal(saved.statusWrites, 1);
    await current.browserContext.close();
  }

  const skip = await fixture(390);
  await chooseProfessionAndAdvance(skip.page, { withService:false });
  await skip.page.locator('[data-onboarding-next]').click();
  await skip.page.locator('#providerOnboarding').waitFor({ state:'hidden' });
  assert.equal(await skip.page.evaluate(() => fixture.rpcCalls[0].args.p_services.length), 0, 'Skipping service presets must be supported');
  await skip.browserContext.close();

  for (const mode of ['permission', 'schema', 'retry', 'schedule-fail', 'offline']) {
    const current = await fixture(390, mode);
    await chooseProfessionAndAdvance(current.page);
    if (mode === 'offline') await current.browserContext.setOffline(true);
    await current.page.locator('[data-onboarding-next]').click();
    if (mode === 'permission' || mode === 'schema' || mode === 'offline') {
      await current.page.locator('.onboarding-error').waitFor();
      const message = await current.page.locator('.onboarding-error').innerText();
      assert.match(message, mode === 'permission' ? /прав|доступ/i : mode === 'schema' ? /сервер|обнов/i : /соединен|подключ/i);
      assert.equal(await current.page.evaluate(() => fixture.complete), 0);
    } else {
      await current.page.locator('.onboarding-error').waitFor();
      const firstRequest = await current.page.evaluate(() => fixture.rpcCalls[0].args.p_request);
      await current.page.locator('[data-onboarding-next]').click();
      await current.page.locator('#providerOnboarding').waitFor({ state:'hidden' });
      const retryState = await current.page.evaluate(() => ({ complete:fixture.complete, calls:fixture.rpcCalls, schedule:fixture.schedule }));
      assert.equal(retryState.complete, 1);
      assert.ok(retryState.calls.length >= 1);
      assert.ok(retryState.calls.every(call => call.args.p_request === firstRequest));
      assert.equal(retryState.schedule.length, 7);
    }
    await current.browserContext.close();
  }

  for (const name of ['iPhone 13', 'Pixel 7']) {
    const profile = devices[name];
    const current = await fixture(profile.viewport.width, 'normal', profile);
    await current.page.locator('.onboarding-chips label').first().tap();
    assert.equal(await current.page.evaluate(() => navigator.maxTouchPoints > 0), true);
    assert.equal(await current.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await current.browserContext.close();
  }

  console.log('PASS onboarding v2: multi-profession presets, explicit confirmation, skip, retry, schedule recovery and 390/760/1440 geometry.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}
