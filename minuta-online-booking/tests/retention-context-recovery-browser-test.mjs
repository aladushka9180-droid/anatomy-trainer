import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Isolated native-DOM smoke, not authenticated provider or production E2E.
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../retention-management.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true,
  ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const pageErrors = [], unexpectedRequests = [];
const fixtureUrl = 'https://retention-recovery.test/';

async function fixture() {
  const page = await browser.newPage({ viewport:{ width:1280, height:900 }, serviceWorkers:'block' });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => pageErrors.push(error.message));
  // Only an inert document is served; every other request is blocked before networking.
  await page.route('**/*', route => {
    if (route.request().url() !== fixtureUrl) {
      unexpectedRequests.push(route.request().url());
      return route.abort();
    }
    return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><title>Retention recovery fixture</title><body></body></html>' });
  });
  await page.goto(fixtureUrl);
  await page.evaluate(html => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const panel = parsed.getElementById('retentionPanel');
    if (!panel) throw new Error('Missing real provider #retentionPanel');
    document.body.append(document.importNode(panel, true));
  }, html);
  await page.addStyleTag({ content:'svg{width:20px;height:20px}label{display:block;margin:8px}input,textarea,button,select{font:16px sans-serif}textarea{width:500px;height:90px}' });
  await page.addScriptTag({ content:source });
  await page.evaluate(async () => {
    const state = window.testState = { user:'owner', generation:1, mode:'success', calls:[], notices:[], settled:0 };
    const workspace = id => ({ organization_id:id, current_role:'owner', enabled:true, inactivity_days:45, cooldown_days:90,
      message_template:`Здравствуйте, клиент ${id}! Приглашаем снова: {ссылка}`,
      clients:[{ client_account_id:`client-${id}`, client_name:`Клиент ${id}`, client_phone:'+79990000000',
        last_visit_on:'2025-01-01', eligible:true, consent_status:'granted', completed_visits:1,
        performer_id:'performer-a', last_booking_id:'booking-a', last_sent_at:null }],
      deliveries:[], audit:[] });
    const db = { rpc:async (name, args) => {
      state.calls.push({ name, args:structuredClone(args) });
      if (name === 'get_minuta_retention_workspace') return { data:workspace(args.p_organization), error:null };
      try {
        if (state.mode === 'hold') await new Promise((resolve, reject) => {
          state.release = () => resolve(); state.reject = () => reject(new Error('connection lost'));
        });
        if (state.mode === 'throw') throw new Error('connection lost');
        const scope = { organization_id:args.p_organization };
        if (name === 'save_minuta_retention_settings') return { data:{ ...scope, enabled:args.p_enabled }, error:null };
        if (name === 'prepare_minuta_retention_delivery') return { data:{ ...scope, id:'delivery-a', client_phone:'+79990000000', message:'Приглашаем клиента снова', status:'prepared' }, error:null };
        throw new Error(`Unexpected fixture RPC: ${name}`);
      } finally { state.settled += 1; }
    } };
    window.controller = window.MinutaRetention.createController({ db,
      $:selector => document.querySelector(selector),
      escapeHtml:value => String(value ?? '').replace(/[&<>"']/g,
        char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])),
      notify:message => state.notices.push(message), requireWrites:() => true,
      getCurrentUser:() => state.user ? { id:state.user } : null,
      getSessionGeneration:() => state.generation,
      sessionIsCurrent:(user, generation) => state.user === user && state.generation === generation,
      applyWriteAvailability() {} });
    controller.bind();
    await controller.setOrganization({ id:'org-a', current_role:'owner' });
  });
  return page;
}

const loads = page => page.evaluate(() => testState.calls.filter(row => row.name === 'get_minuta_retention_workspace').map(row => row.args.p_organization));
async function beginAutosave(page, mode) {
  await page.evaluate(mode => { testState.mode = mode; }, mode);
  await page.locator('#retentionMessageTemplate').fill('Новый исходный шаблон для клиента: {ссылка}');
  // Real input event and the actual 500ms debounce, not direct controller invocation.
  await page.waitForFunction(() => testState.calls.some(row => row.name === 'save_minuta_retention_settings'));
}
async function runCase(title, run) {
  const page = await fixture();
  try { await run(page); console.log(`PASS: ${title}`); }
  finally { await page.close(); }
}

try {
  for (const outcome of ['success', 'throw']) {
    await runCase(`native autosave A to B suppresses stale ${outcome} and loads B once`, async page => {
      await beginAutosave(page, 'hold');
      assert.equal(await page.locator('#retentionMessageTemplate').isDisabled(), true);
      await page.evaluate(() => controller.setOrganization({ id:'org-b', current_role:'owner' }));
      assert.equal(await page.locator('#retentionWorkspace').isVisible(), false);
      assert.equal(await page.locator('#retentionClientsList').textContent(), '', 'old PII must leave the DOM immediately');
      await page.evaluate(outcome => outcome === 'throw' ? testState.reject() : testState.release(), outcome);
      await page.waitForFunction(() => controller.payload?.organization_id === 'org-b' && controller.availability === 'ready');
      assert.deepEqual(await loads(page), ['org-a', 'org-b']);
      assert.equal(await page.locator('#retentionWorkspace').isVisible(), true);
      assert.match(await page.locator('#retentionClientsList').textContent(), /Клиент org-b/);
      assert.doesNotMatch(await page.locator('#retentionClientsList').textContent(), /org-a/);
      assert.match(await page.locator('#retentionMessageTemplate').inputValue(), /org-b/);
      assert.equal(await page.locator('#retentionMessageTemplate').isEditable(), true);
      assert.equal(await page.locator('#retentionSaveStatus').textContent(), 'Изменения сохраняются автоматически');
      assert.deepEqual(await page.evaluate(() => testState.notices), []);
    });
  }

  await runCase('logout during pending native action cannot restore PII or success notices', async page => {
    await page.evaluate(() => { testState.mode = 'hold'; });
    await page.locator('[data-retention-prepare="client-org-a"]').click();
    await page.waitForFunction(() => typeof testState.release === 'function');
    assert.equal(await page.locator('[data-retention-prepare]').isDisabled(), true);
    await page.evaluate(async () => {
      testState.user = null; testState.generation += 1;
      await controller.setOrganization(null);
    });
    assert.equal(await page.locator('#retentionClientsList').textContent(), '');
    await page.evaluate(() => testState.release());
    await page.waitForFunction(() => testState.settled === 1);
    assert.equal(await page.locator('#retentionPanel').isVisible(), false);
    assert.equal(await page.locator('#retentionWorkspace').isVisible(), false);
    assert.equal(await page.evaluate(() => controller.payload), null);
    assert.deepEqual(await loads(page), ['org-a']);
    assert.deepEqual(await page.evaluate(() => testState.notices), []);
  });

  await runCase('thrown autosave releases native controls and a subsequent edit saves', async page => {
    await beginAutosave(page, 'throw');
    await page.waitForFunction(() => document.querySelector('#retentionSaveStatus').textContent === 'Не удалось подтвердить результат — проверьте актуальные данные перед повтором');
    assert.equal(await page.locator('#retentionMessageTemplate').isEditable(), true);
    assert.equal(await page.locator('#retentionInactivityDays').isEditable(), true);
    assert.equal(await page.locator('[data-retention-prepare]').isEnabled(), true);
    assert.deepEqual(await loads(page), ['org-a', 'org-a'], 'unknown write must refresh authoritative state');
    await page.evaluate(() => { testState.mode = 'success'; });
    const retryText = 'Исправленный шаблон после ошибки: {ссылка}';
    await page.locator('#retentionMessageTemplate').fill(retryText);
    await page.waitForFunction(() => document.querySelector('#retentionSaveStatus').textContent === 'Сохранено автоматически');
    const attempts = await page.evaluate(() => testState.calls.filter(row => row.name === 'save_minuta_retention_settings'));
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1].args.p_message_template, retryText);
    assert.equal(await page.evaluate(() => controller.payload.message_template), retryText);
    assert.equal(await page.locator('#retentionMessageTemplate').isEditable(), true);
    assert.equal(await page.evaluate(() => testState.notices.length), 1, 'only the first current-context failure is notified');
  });

  assert.deepEqual(pageErrors, [], 'no unhandled controller errors');
  assert.deepEqual(unexpectedRequests, [], 'fixture must never request external resources');
  console.log('Retention native DOM recovery: 4/4 PASS (isolated RPC mocks, no production access)');
} finally { await browser.close(); }
