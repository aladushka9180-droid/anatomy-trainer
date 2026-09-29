import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Synthetic A11 text and state check against the real inventory controller and HTML.
// No production data, writes, camera, or network requests are used.
const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '..');
const html = readFileSync(join(project, 'provider.html'), 'utf8');
const source = readFileSync(join(project, 'inventory-management.js'), 'utf8');
const providerSource = readFileSync(join(project, 'provider.js'), 'utf8');
const cssLayers = [...html.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '').matchAll(/<link\s+rel="stylesheet"[^>]*href="([^"?]+)(?:\?[^"]*)?"[^>]*>/g)].map(match => ({ name:match[1], media:match[0].match(/media="([^"]+)"/)?.[1] || '' }));
const css = cssLayers.map(layer => ({ ...layer, content:readFileSync(join(project, layer.name), 'utf8') }));
const messageStart = source.indexOf('function messageFor(error)');
const messageEnd = source.indexOf('async function mutate(', messageStart);
assert.ok(messageStart >= 0 && messageEnd > messageStart, 'real error mapper must exist');
const messageFor = Function(`${source.slice(messageStart, messageEnd)}; return messageFor;`)();
const navStart = providerSource.indexOf('function setInventorySection(');
const navEnd = providerSource.indexOf('const PROVIDER_ASSISTANT_UNDO_TTL_MS', navStart);
assert.ok(navStart >= 0 && navEnd > navStart, 'real inventory navigation must exist');
const inventoryNavigation = providerSource.slice(navStart, navEnd);
const colorStart = providerSource.indexOf('function applyProviderColorMode()');
const colorEnd = providerSource.indexOf('function applyDisplayPreferences()', colorStart);
assert.ok(colorStart >= 0 && colorEnd > colorStart, 'real palette application must exist');
const applyColorMode = providerSource.slice(colorStart, colorEnd);
assert.equal(messageFor({ message:'inventory_transfers_disabled' }), 'Перемещения выключены.');
assert.equal(messageFor({ message:'inventory_unit_locked_by_ledger' }), 'Нельзя изменить единицу материала после первой операции. Создайте новую позицию.');
assert.equal(messageFor({ message:'inventory_warehouse_location_locked_by_ledger' }), 'Нельзя перенести склад в другой филиал после первой операции. Создайте новый склад.');

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = modulePath ? await import(pathToFileURL(modulePath).href) : createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ headless:true,
  ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const outputDir = process.env.MINUTA_A11_SCREENSHOT_DIR;
if (outputDir) mkdirSync(outputDir, { recursive:true });
const errors = [], blocked = [];
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block' });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://a11-synthetic.test/') {
        return route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="ru"><meta charset="utf-8"><body></body></html>' });
      }
      blocked.push(route.request().url());
      return route.abort();
    });
    await page.goto('https://a11-synthetic.test/');
    await page.evaluate(markup => {
      const parsed = new DOMParser().parseFromString(markup, 'text/html');
      const panel = parsed.getElementById('inventoryPanel');
      if (!panel) throw new Error('Real inventory panel missing');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerPorcelainCharacter = 'petal';
      document.body.dataset.providerLayout = 'soft';
      document.body.dataset.providerTextScale = 'default';
      document.body.style.margin = '0';
      const main = document.createElement('main');
      main.id = 'dashboard';
      main.dataset.activeView = 'organization';
      main.style.cssText = 'max-width:1100px;margin:auto;padding:12px;box-sizing:border-box';
      const organization = document.importNode(panel.closest('[data-provider-panel]'), false);
      organization.hidden = false;
      organization.append(document.importNode(panel, true));
      main.append(organization);
      document.body.append(main);
    }, html);
    for (const layer of css) { const style = await page.addStyleTag({ content:layer.content }); if (layer.media) await style.evaluate((node,media) => { node.media = media; }, layer.media); }
    for (const file of ['theme-catalog.js', 'provider-color-mode.js', 'provider-porcelain-matrix.js']) {
      await page.addScriptTag({ content:readFileSync(join(project, file), 'utf8') });
    }
    await page.addScriptTag({ content:`const displayPreferences = { theme:'pink-porcelain', color_mode:'light', porcelain:{ character:'petal', shade:'gentle-pink' } };
const providerColorSchemeQuery = { matches:false };
${applyColorMode}
applyProviderColorMode();` });
    await page.addScriptTag({ content:source });
    await page.addScriptTag({ content:`function $$(selector) { return [...document.querySelectorAll(selector)]; }
${inventoryNavigation}
document.querySelectorAll('[data-inventory-section]').forEach(button =>
  button.addEventListener('click', () => setInventorySection(button.dataset.inventorySection)));
setInventorySection('balances');` });
    await page.evaluate(async () => {
      const item = (id, unit) => ({ id, name:`Материал ${unit}`, sku:`SYN-${unit}`, unit, active:true, low_stock_threshold:2 });
      const base = {
        organization_id:'synthetic-org', current_role:'owner', enabled:true, auto_deduct_completed_visits:true,
        transfer_version:130, transfers_initialized_at:null, transfers_suspended_at:null, transfers_enabled:false,
        locations:[{ id:'synthetic-location', name:'Филиал', active:true }],
        services:[{ id:'synthetic-service', name:'Синтетическая услуга', active:true }],
        items:[item('synthetic-ml','ml'), item('synthetic-g','g')],
        warehouses:[{ id:'synthetic-warehouse', location_id:'synthetic-location', name:'Склад', active:true }],
        balances:[], usage:[], movements:[], audit:[], transfer_documents:[]
      };
      window.a11Payload = base;
      window.a11RpcCalls = [];
      const controller = MinutaInventory.createController({
        db:{ rpc:async name => {
          a11RpcCalls.push(name);
          if (name !== 'get_minuta_inventory_workspace_v130') throw new Error(`Unexpected RPC: ${name}`);
          return { data:a11Payload, error:null };
        } },
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:message => { throw new Error(`Unexpected notification: ${message}`); },
        requireWrites:() => { throw new Error('Writes forbidden in A11 test'); },
        getCurrentUser:() => ({ id:'synthetic-user' }),
        getSessionGeneration:() => 1,
        sessionIsCurrent:() => true,
        applyWriteAvailability:() => {}
      });
      window.a11Controller = controller;
      controller.bind();
      await controller.setOrganization({ id:'synthetic-org', current_role:'owner' });
    });
    const initial = await page.evaluate(() => ({
      enabled:document.querySelector('#inventoryEnabled').checked,
      enabledHint:document.querySelector('#inventoryEnabledHint').textContent,
      autoDeduct:document.querySelector('#inventoryAutoDeduct').checked,
      transferHint:document.querySelector('#inventoryTransfersHint').textContent,
      usageEmpty:document.querySelector('#inventoryUsageList').textContent,
      firstAction:document.querySelector('#inventoryFirstRunAction').textContent,
      tabs:[...document.querySelectorAll('.inventory-section-nav button')].map(button => button.textContent.trim()),
      quantityLabel:document.querySelector('#inventoryUsageQuantity').closest('label').firstChild.textContent.trim(),
      rpcCalls:a11RpcCalls,
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth
    }));
    assert.equal(initial.enabled, true);
    assert.equal(initial.autoDeduct, true);
    assert.equal(initial.enabledHint, 'Учёт включён. Старые визиты не списываются.');
    assert.equal(initial.transferHint, 'Подготовим учёт текущих остатков для перемещений.');
    assert.ok(initial.usageEmpty.includes('Для автоматического списания задайте расход материала на один визит.'));
    assert.equal(initial.firstAction, 'Оформить приход');
    assert.deepEqual(initial.tabs, ['Остатки', 'Каталог и склады', 'Операции и нормы', 'История']);
    assert.equal(initial.quantityLabel, 'Расход на один визит, мл');
    assert.deepEqual(initial.rpcCalls, ['get_minuta_inventory_workspace_v130']);
    assert.ok(initial.overflow <= 1, `${width}px initial overflow ${initial.overflow}`);
    assert.equal(await page.locator('#inventoryPanel>.panel-head h3').innerText(), 'Склад');
    assert.equal(await page.locator('#inventoryPanel>.panel-head small').count(), 0);
    assert.equal(await page.locator('#inventoryFirstRun ol li').count(), 2);
    await page.locator('[data-inventory-section="catalog"]').click();
    await page.locator('#inventoryItemCreator>summary').click();
    await page.locator('#inventoryWarehouseCreator>summary').click();
    assert.match(await page.locator('[data-inventory-pane="catalog"]').innerText(), /Один филиал — один склад\. После первой операции нельзя изменить единицу материала или перенести склад в другой филиал\./);
    assert.match(await page.locator('#inventoryItemForm').innerText(), /После отключения позиция останется в истории\./);
    assert.match(await page.locator('#inventoryWarehouseForm').innerText(), /Использовать склад[\s\S]*Отключённый склад не участвует в операциях и автосписании\./);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `${width}px catalogue overflow`);
    if (outputDir) await page.locator('#inventoryPanel').screenshot({ path:join(outputDir, `a11-inventory-${width}.png`) });
    await page.locator('#inventoryItemCreator>summary').click();
    await page.locator('#inventoryWarehouseCreator>summary').click();
    await page.locator('[data-inventory-section="history"]').click();
    assert.equal((await page.locator('#inventoryMovementsPanel>summary').innerText()).replace(/\s*0$/, '').trim(), 'История операций');

    await page.locator('[data-inventory-section="operations"]').click();
    assert.equal(await page.locator('[data-inventory-pane="operations"]').isVisible(), true);
    await page.locator('#inventoryUsageItem').selectOption('synthetic-g');
    assert.equal(await page.locator('#inventoryUsageQuantity').evaluate(input => input.closest('label').firstChild.textContent.trim()), 'Расход на один визит, г');
    for (const [kind, label] of [['receipt','Оформить приход'],['write_off','Списать материал'],['inventory','Сохранить остаток'],['transfer','Переместить материал']]) {
      await page.locator('#inventoryMovementKind').selectOption(kind);
      assert.equal(await page.locator('#inventoryMovementForm button[type="submit"]').textContent(), label);
    }
    assert.equal(await page.locator('#inventoryTransfersState').textContent(), 'Перемещения выключены.');
    await page.evaluate(async () => {
      a11Payload = { ...a11Payload, transfers_initialized_at:'2026-09-01T00:00:00Z', transfers_enabled:false };
      await a11Controller.load();
    });
    assert.equal(await page.locator('#inventoryTransfersHint').textContent(), 'Перемещения выключены. Включение сохранит историю и остатки.');
    await page.evaluate(async () => { a11Payload = { ...a11Payload, transfers_enabled:true }; await a11Controller.load(); });
    assert.equal(await page.locator('#inventoryTransfersHint').textContent(), 'Перемещения включены. Выключение сохранит историю и остатки.');
    await page.evaluate(async () => {
      a11Payload = { ...a11Payload, current_role:'admin' };
      await a11Controller.load();
    });
    assert.equal(await page.locator('#inventoryTransfersHint').textContent(), 'Режим перемещений может менять только владелец.');
    assert.equal(await page.locator('#inventoryEnabled').isDisabled(), true);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth <= 1));
    console.log(`${width}px: controller copy, status, units, four operations, tabs, overflow PASS`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(`All external requests blocked (${blocked.length} attempted); write RPC calls: 0.`);
} finally {
  await browser.close();
}
