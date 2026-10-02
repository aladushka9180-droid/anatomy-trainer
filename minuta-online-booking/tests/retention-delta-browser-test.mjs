import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRetentionFixture } from './retention-delta-fixture.mjs';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [], outbound = [], results = [];
const output = process.env.RETENTION_SCREENSHOT_DIR;
const fixture = buildRetentionFixture();
if (output) { mkdirSync(output, { recursive:true }); writeFileSync(join(output, 'fixture.html'), fixture); }
async function pageFor(width = 1440, four = false) {
  const page = await browser.newPage({ viewport:{ width, height:1000 }, serviceWorkers:'block' });
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url() === 'https://retention-delta.synthetic.test/') return route.fulfill({ contentType:'text/html', body:fixture });
    outbound.push(route.request().url()); return route.abort();
  });
  await page.goto('https://retention-delta.synthetic.test/');
  await page.evaluate(async four => { await retentionReady; if (!four) { retentionFixture.clients = retentionFixture.clients.filter(row => row.client_account_id !== 'd'); await retentionController.load(); } }, four);
  return page;
}
const pick = (page, id) => page.locator(`[data-retention-select="${id}"]`).check();
const prepares = page => page.evaluate(() => retentionFixture.calls.filter(row => row.name === 'prepare_minuta_retention_delivery').map(row => row.args.p_client_account));
const selected = page => page.locator('[data-retention-select]:checked').evaluateAll(rows => rows.map(row => row.dataset.retentionSelect));
const batch = page => page.locator('[data-retention-prepare-selected]');
async function settled(page) { await page.waitForFunction(() => retentionController.availability === 'ready' && !document.querySelector('[data-retention-prepare-selected]')?.dataset.retentionBusy); }
async function run(title, fn, width, four) {
  const page = await pageFor(width, four);
  try { await fn(page); results.push(title); console.log(`PASS ${title}`); }
  finally { await page.close(); }
}
try {
  for (const width of [390, 760, 1440]) {
    await run(`${width}: sequential selection, snapshots, full clipboard, retry, reset, layout and retained manual actions`, async page => {
      assert.equal(await page.locator('[data-retention-select]').count(), 3);
      assert.equal(await page.locator('.retention-client-row').count(), 6);
      assert.match(await page.locator('#retentionPanel').innerText(), /последней ручной отметки отправки, а не подготовки/);
      assert.equal(await page.locator('#retentionMessagePreview').isVisible(), width >= 1000);
      if (width < 1000) { await page.locator('.cs-preview-toggle').click(); assert.equal(await page.locator('#retentionMessagePreview').isVisible(), true); }
      await page.locator('.retention-client-options').first().locator('summary').click();
      assert.equal(await page.locator('.retention-client-options').first().locator('select').isVisible(), true);
      await page.locator('.retention-client-options').first().locator('summary').click();
      await pick(page, 'a'); await pick(page, 'b');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.retentionSelect), 'b', 'selection keeps keyboard focus');
      assert.equal(await page.locator('[data-retention-select-all]').evaluate(node => node.indeterminate), true);
      assert.equal(await batch(page).innerText(), 'Подготовить 2 сообщения');
      await page.evaluate(() => { retentionFixture.faults.holdAt = 1; });
      await batch(page).click();
      await page.waitForFunction(() => typeof retentionFixture.releasePrepare === 'function');
      await page.evaluate(() => document.querySelector('[data-retention-prepare-selected]').dispatchEvent(new MouseEvent('click', { bubbles:true })));
      assert.deepEqual(await prepares(page), ['a'], 'a pending batch blocks double-click and second RPC');
      await page.evaluate(() => retentionFixture.releasePrepare());
      await settled(page);
      assert.deepEqual(await prepares(page), ['a', 'b']);
      assert.equal(await page.locator('[data-retention-select]').count(), 1);
      assert.equal(await page.locator('#retentionPreparedCount').innerText(), '3');
      assert.equal(await page.locator('[data-retention-copy]').count(), 3);
      assert.deepEqual(await selected(page), []);
      await pick(page, 'c'); assert.equal(await batch(page).innerText(), 'Подготовить 1 сообщение');
      assert.equal(await page.locator('[data-retention-select-all]').isChecked(), true);
      const copy = page.locator('[data-retention-copy="prepared-a"]');
      await page.evaluate(() => { retentionFixture.copyMode = 'hold'; });
      await copy.click(); await page.waitForFunction(() => typeof retentionFixture.releaseCopy === 'function');
      assert.equal(await copy.innerText(), 'Копируем…');
      await page.evaluate(() => retentionFixture.releaseCopy());
      await page.waitForFunction(() => document.querySelector('[data-retention-copy="prepared-a"]').textContent === 'Скопировано');
      assert.equal(await page.evaluate(() => retentionFixture.copied.at(-1)), await page.evaluate(() => retentionFixture.fullText('a')));
      await page.waitForFunction(() => document.querySelector('[data-retention-copy="prepared-a"]').textContent === 'Скопировать текст');
      await page.evaluate(() => { retentionFixture.copyMode = 'error'; });
      await copy.click();
      assert.equal(await copy.innerText(), 'Повторить копирование');
      assert.match(await copy.locator('..').innerText(), /Не удалось скопировать/);
      await page.evaluate(() => { retentionFixture.copyMode = 'success'; }); await copy.click();
      assert.equal(await copy.innerText(), 'Скопировано');
      assert.equal(await page.evaluate(() => retentionFixture.calls.some(row => row.name === 'finish_minuta_retention_delivery')), false, 'copy never marks sent');
      const options = copy.locator('..').locator('details'); await options.locator('summary').click();
      assert.equal(await options.locator('[data-retention-action="sent"]').isVisible(), true);
      assert.equal(await options.locator('a').isVisible(), true);
      await options.locator('summary').click();
      const layout = await page.evaluate(() => {
        const clients = document.querySelector('#retentionClientsList').closest('section').getBoundingClientRect();
        const deliveries = document.querySelector('#retentionDeliveriesList').closest('section').getBoundingClientRect();
        const preview = document.querySelector('#retentionMessagePreview').getBoundingClientRect();
        const template = document.querySelector('.retention-message-field').getBoundingClientRect();
        return { overflow:document.documentElement.scrollWidth-innerWidth, stacked:deliveries.top>=clients.bottom, previewBeside:preview.left>=template.right, neighbors:[...document.querySelectorAll('.fixture-neighbor')].every(node=>node.getBoundingClientRect().right<=innerWidth), below:false };
      });
      assert.ok(layout.overflow <= 0 && layout.stacked && layout.neighbors, JSON.stringify(layout));
      if (width >= 1000) assert.equal(layout.previewBeside, true);
      if (output) await page.screenshot({ path:join(output, `retention-${width}.png`), fullPage:true });
    }, width);
  }
  await run('selection survives load and same-org refresh, prunes authoritative prepared drafts, clears changed actor/session/role', async page => {
    await pick(page, 'a'); await pick(page, 'c');
    await page.evaluate(() => retentionController.load()); assert.deepEqual(await selected(page), ['a', 'c']);
    await page.evaluate(() => retentionController.setOrganization({ id:'org-a', current_role:'owner' })); assert.deepEqual(await selected(page), ['a', 'c']);
    await page.evaluate(async () => { retentionFixture.deliveries.push({ id:'server-c', client_account_id:'c', status:'prepared', message_snapshot:'Серверный текст' }); await retentionController.load(); });
    assert.deepEqual(await selected(page), ['a']);
    await page.evaluate(async () => { retentionFixture.user='owner-b'; await retentionController.load(); }); assert.deepEqual(await selected(page), []);
    await pick(page, 'b'); await page.evaluate(async () => { retentionFixture.generation++; await retentionController.load(); }); assert.deepEqual(await selected(page), []);
    await pick(page, 'b'); await page.evaluate(async () => { retentionFixture.role='admin'; await retentionController.setOrganization({ id:'org-a', current_role:'admin' }); }); assert.deepEqual(await selected(page), []);
    assert.equal(await page.locator('#retentionMessageTemplate').isDisabled(), true);
    assert.equal(await page.locator('#retentionEnabled').isDisabled(), false);
  });
  await run('partial failure stops batch; acknowledged texts remain copyable when reload fails; recovery retains/prunes selection', async page => {
    await page.locator('[data-retention-select-all]').check();
    await page.evaluate(() => { retentionFixture.faults.failAt=3; retentionFixture.faults.read=true; });
    await batch(page).click(); await page.waitForFunction(() => retentionController.availability === 'error');
    assert.deepEqual(await prepares(page), ['a','b','c']);
    assert.equal(await page.locator('[data-retention-copy]').count(), 2);
    assert.equal(await page.locator('[data-retention-finish]').count(), 0);
    assert.equal(await page.locator('#retentionSettingsForm').isVisible(), false);
    await page.locator('[data-retention-copy="prepared-a"]').click();
    assert.equal(await page.evaluate(() => retentionFixture.copied.at(-1)), await page.evaluate(() => retentionFixture.fullText('a')));
    await page.evaluate(() => { retentionFixture.faults.read=false; });
    await page.locator('#reloadRetention').click(); await settled(page);
    assert.deepEqual(await selected(page), ['c','d']);
    assert.equal(await page.locator('[data-retention-copy]').count(), 3);
    assert.match(await batch(page).innerText(), /2 сообщения/);
    if (output) await page.screenshot({ path:join(output,'retention-read-error-recovered.png'), fullPage:true });
  }, 1440, true);
  await run('unknown prepare response rereads actual draft; retry never recreates it', async page => {
    await page.locator('[data-retention-select-all]').check();
    await page.evaluate(() => { retentionFixture.faults.unknownAt=2; });
    await batch(page).click(); await settled(page);
    assert.deepEqual(await prepares(page), ['a','b']);
    assert.deepEqual(await selected(page), ['c']);
    assert.equal(await page.locator('[data-retention-copy="prepared-b"]').count(), 1);
    await batch(page).click(); await settled(page);
    assert.deepEqual(await prepares(page), ['a','b','c']);
  });
  for (const change of ['organization','session','actor','role','writes']) {
    await run(`${change} change immediately before second RPC stops serial batch and hides old-scope success`, async page => {
      await pick(page,'a'); await pick(page,'b');
      await page.evaluate(change => {
        retentionFixture.beforeWrite = count => {
          if (count !== 3) return;
          if (change==='organization') { retentionFixture.org='org-b'; retentionFixture.deliveries=[]; retentionController.setOrganization({ id:'org-b', current_role:'owner' }); }
          if (change==='session') retentionFixture.generation++;
          if (change==='actor') retentionFixture.user='owner-b';
          if (change==='role') { retentionFixture.role='admin'; retentionController.setOrganization({ id:'org-a', current_role:'admin' }); }
          if (change==='writes') retentionFixture.writesAllowed=false;
        };
      }, change);
      await batch(page).click(); await page.waitForFunction(() => retentionFixture.prepareCount === 1);
      await page.waitForTimeout(30);
      assert.deepEqual(await prepares(page), ['a']);
      assert.equal(await page.evaluate(() => retentionFixture.notices.some(text => /Подготовлено 2/.test(text))), false);
      if (change==='organization' || change==='role') {
        await settled(page); assert.deepEqual(await selected(page), []);
        assert.equal(await page.evaluate(() => retentionFixture.calls.filter(row=>row.name==='get_minuta_retention_workspace').length),3,'one pending-org recovery read');
      } else if (change!=='writes') assert.equal(await page.locator('#retentionWorkspace').isVisible(),false);
    });
  }
  await run('pending clipboard success in old session cannot announce copied; changed scope clears acknowledged read-error texts', async page => {
    await pick(page,'a'); await pick(page,'b');
    await page.evaluate(() => { retentionFixture.faults.failAt=2; retentionFixture.faults.read=true; });
    await batch(page).click(); await page.waitForFunction(() => retentionController.availability==='error');
    await page.evaluate(() => { retentionFixture.copyMode='hold'; });
    const copy = page.locator('[data-retention-copy="prepared-a"]'); await copy.click();
    await page.waitForFunction(() => typeof retentionFixture.releaseCopy==='function');
    await page.evaluate(async () => { retentionFixture.generation++; await retentionController.setOrganization({ id:'org-a', current_role:'owner' }); retentionFixture.releaseCopy(); });
    assert.equal(await page.locator('[data-retention-copy]').count(),0);
    assert.doesNotMatch(await page.locator('#retentionPanel').innerText(), /Скопировано/);
  });
  await run('settings Saving/Saved/Error wait for actual RPC and preserve server 45/90 parameters', async page => {
    await page.evaluate(() => { retentionFixture.faults.holdSave=true; });
    await page.locator('#retentionMessageTemplate').fill('Новый текст для клиента: {ссылка}');
    await page.waitForFunction(() => typeof retentionFixture.releaseSave==='function');
    assert.equal(await page.locator('#retentionSaveStatus').innerText(),'Сохраняем…');
    await page.evaluate(() => retentionFixture.releaseSave());
    await page.waitForFunction(() => document.querySelector('#retentionSaveStatus').textContent==='Сохранено автоматически');
    const args=await page.evaluate(() => retentionFixture.calls.find(row=>row.name==='save_minuta_retention_settings').args);
    assert.equal(args.p_inactivity_days,45); assert.equal(args.p_cooldown_days,90);
    await page.evaluate(() => { retentionFixture.faults.holdSave=false; retentionFixture.faults.save=true; });
    await page.locator('#retentionMessageTemplate').fill('Следующий текст после ошибки: {ссылка}');
    await page.waitForFunction(() => document.querySelector('#retentionSaveStatus').textContent.includes('Не удалось подтвердить'));
    assert.notEqual(await page.locator('#retentionSaveStatus').innerText(),'Сохранено автоматически');
  });
  await run('empty and ineligible workspaces remain distinct; empty factual snapshots cannot claim copied', async page => {
    await page.evaluate(async () => {
      retentionFixture.deliveries[0].message_snapshot='';
      retentionFixture.clients.forEach(row=>row.eligible=false);
      await retentionController.load();
    });
    assert.equal(await page.locator('[data-retention-select]').count(),0);
    assert.equal(await batch(page).isDisabled(),true);
    assert.match(await page.locator('#retentionSelectionToolbar').innerText(),/Подходящих клиентов для подготовки пока нет/);
    assert.equal(await page.locator('[data-retention-copy]').count(),0);
    assert.equal(await page.locator('[data-retention-consent]').count(),6);
    await page.evaluate(async () => { retentionFixture.clients=[]; retentionFixture.deliveries=[]; await retentionController.load(); });
    assert.match(await page.locator('#retentionClientsList').innerText(),/Клиентов пока нет/);
    assert.match(await page.locator('#retentionDeliveriesList').innerText(),/Сообщений пока нет/);
    assert.equal(await page.locator('#retentionClientsCount').innerText(),'0');
  });
  assert.deepEqual(errors, []); assert.deepEqual(outbound, []);
  if (output) writeFileSync(join(output,'CHECKS.json'),JSON.stringify({ base:'cb17f0cf24b621f1307be166559371c9bd6306b0', passed:results, pageErrors:errors, outboundRequests:outbound, liveAcceptance:'0/4; isolated candidate only' },null,2));
} finally { await browser.close(); }
