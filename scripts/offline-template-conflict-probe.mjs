// Observation probe, not an implementation gate: exit 0 proves the reported
// current behavior. The future conflict-preservation criterion still fails.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRef = '594a2fca4aa7a7fe41d258decc07aab1f80be110';
const repo = fileURLToPath(new URL('../', import.meta.url));
const readSource = path => execFileSync('git', ['show', `${sourceRef}:${path}`], { cwd:repo, encoding:'utf8' });
const html = readSource('minuta-online-booking/provider.html');
const component = readSource('minuta-online-booking/client-messaging.js');
const begin = html.indexOf('<dialog class="client-messaging-dialog"');
const end = html.indexOf('</dialog>', begin);
assert.ok(begin >= 0 && end > begin, 'Existing Pro messaging dialog found');
const dialog = html.slice(begin, end + '</dialog>'.length);
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
assert.ok(chromium, 'Chromium available');
const browser = await chromium.launch({ headless:true });
try {
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, serviceWorkers:'block' });
  const blockedRequests = [];
  await context.route('**/*', async route => { blockedRequests.push(route.request().resourceType()); await route.abort(); });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.name));
  await page.setContent(`<!doctype html><html lang="ru"><body><button id="probeOpen" data-message-client data-client-phone="00000000000" data-client-name="Синтетический клиент">Открыть</button>${dialog}</body></html>`);
  await page.addScriptTag({ content:component });
  await page.evaluate(() => {
    window.__probe = { gets:0, saves:0, attempts:[], mode:'conflict', resolveSave:null };
    const organizationId = '00000000-0000-4000-8000-000000000010';
    const performerId = '00000000-0000-4000-8000-000000000011';
    MinutaClientMessaging.configure({
      getOrganization:() => ({ id:organizationId }), getCurrentUser:() => ({ id:performerId }), requireWrites:() => true,
      db:{ rpc:async (name, payload) => {
        if (name === 'get_provider_message_templates_v161') {
          window.__probe.gets++;
          const afterConflict = window.__probe.gets > 1;
          return { data:{ organization_id:organizationId, performer_id:performerId,
            templates:[{ kind:'reminder', body:afterConflict ? 'SERVER_C' : 'SERVER_A', version:afterConflict ? 5 : 4 }] }, error:null };
        }
        if (name !== 'save_provider_message_template_v161') throw new Error('Unexpected mock RPC');
        window.__probe.saves++;
        window.__probe.attempts.push(payload);
        if (window.__probe.mode === 'conflict') return { data:null, error:{ message:'message_template_version_conflict' } };
        return new Promise(resolve => { window.__probe.resolveSave = () => resolve({ data:{ saved:true,
          organization_id:organizationId, performer_id:performerId, kind:payload.p_kind,
          body:payload.p_body, version:payload.p_expected_version+1 }, error:null }); });
      } }
    });
  });
  await page.locator('#probeOpen').click();
  await page.waitForFunction(() => document.querySelector('#clientMessagingText').value === 'SERVER_A');
  await page.locator('#clientMessagingText').fill('LOCAL_B');
  await page.locator('#saveClientMessageTemplate').click();
  await page.waitForFunction(() => window.__probe.gets === 2 && document.querySelector('#clientMessagingText').value === 'SERVER_C');
  await page.locator('[data-message-preset="reschedule"]').click();
  await page.locator('[data-message-preset="reminder"]').click();
  assert.equal(await page.locator('#clientMessagingText').inputValue(), 'SERVER_C', 'Conflict reload replaces local draft, including preset state');

  await page.evaluate(() => { window.__probe.mode = 'deferred'; });
  await page.locator('#clientMessagingText').fill('LOCAL_D');
  await page.locator('#saveClientMessageTemplate').click();
  await page.waitForFunction(() => typeof window.__probe.resolveSave === 'function');
  await page.locator('#clientMessagingText').fill('LOCAL_E');
  await page.evaluate(() => window.__probe.resolveSave());
  assert.equal(await page.locator('#clientMessagingText').inputValue(), 'LOCAL_E', 'Late response to old draft preserves newer input');
  const calls = await page.evaluate(() => ({ gets:window.__probe.gets, saves:window.__probe.saves,
    firstExpectedVersion:window.__probe.attempts[0].p_expected_version }));
  assert.deepEqual(calls, { gets:2, saves:2, firstExpectedVersion:4 });
  assert.equal(blockedRequests.length, 0, 'Component made no network requests');
  assert.deepEqual(pageErrors, [], 'No browser script errors');
  console.log(JSON.stringify({ format:'pro-offline-template-observation-v1', sourceRef,
    componentSha256:createHash('sha256').update(component).digest('hex'), syntheticOnly:true,
    browserObservationCompleted:true, conflictLocalDraftReplaced:true, lateResponsePreservesNewInput:true,
    futureConflictPreservationPassed:false, networkRequests:0, realMessagesSent:false,
    productionWritten:false, actualDatabaseRpcExecuted:false }));
} finally {
  await browser.close();
}
