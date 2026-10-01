import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('provider.html', root), 'utf8');
const head = html.replace(/<template[\s\S]*?<\/template>/g, '');
const layers = [...head.matchAll(/<link[^>]+href="([^"?]+\.css)(?:\?[^\"]*)?"/g)]
  .map(match => readFileSync(new URL(match[1], root), 'utf8'));
const controllerSource = readFileSync(new URL('inventory-management.js', root), 'utf8');
const uiSource = readFileSync(new URL('inventory-soft-ui.js', root), 'utf8');
const uiCss = readFileSync(new URL('inventory-soft-ui.css', root), 'utf8');
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless:true });
const org = '00000000-0000-4000-8000-000000000001';
const warehouse = '00000000-0000-4000-8000-000000000002';
const samples = [
  { id:'oil', name:'Массажное масло', sku:'MS-001', unit:'ml', low_stock_threshold:500, active:true },
  { id:'gloves', name:'Перчатки нитриловые', sku:'RS-012', unit:'pack', low_stock_threshold:10, active:true },
  { id:'sheets', name:'Одноразовые простыни', sku:'RS-008', unit:'piece', low_stock_threshold:20, active:true },
  { id:'home', name:'Масло для домашнего ухода', sku:'PR-004', unit:'piece', low_stock_threshold:5, active:true },
  { id:'spray', name:'Антисептик', sku:'RS-015', unit:'ml', low_stock_threshold:300, active:true },
  { id:'long', name:'Материал с очень длинным названием для проверки переноса строк в мобильном каталоге', sku:'LONG-006', unit:'piece', low_stock_threshold:1, active:false }
];
async function capture(page, name) {
  if (!process.env.MINUTA_INVENTORY_SOFT_SCREENSHOT_DIR) return;
  mkdirSync(process.env.MINUTA_INVENTORY_SOFT_SCREENSHOT_DIR, { recursive:true });
  const openDialog = page.locator('dialog.is-editor[open]');
  await (await openDialog.count() ? openDialog : page.locator('#inventoryPanel')).screenshot({ path:join(process.env.MINUTA_INVENTORY_SOFT_SCREENSHOT_DIR, name) });
  if (await openDialog.count()) {
    const measured = await page.evaluate(() => {
      const selectors = ['body', '#inventoryItemDialog', '#inventoryItemForm', '#inventoryItemForm>.is-name-field', '#inventoryItemName', '#inventoryItemName:placeholder-shown'];
      return selectors.map(selector => {
        const node = document.querySelector(selector);
        if (!node) return { selector };
        const css = getComputedStyle(node), rect = node.getBoundingClientRect();
        return { selector, css:Object.fromEntries(['font-family','gap','padding','margin','width','box-sizing','display','position','transform','border-radius'].map(key => [key, css.getPropertyValue(key)])), rect:rect.toJSON() };
      });
    });
    writeFileSync(join(process.env.MINUTA_INVENTORY_SOFT_SCREENSHOT_DIR, `${name}.json`), JSON.stringify(measured, null, 2));
  }
}
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>');
    await page.evaluate(markup => {
      const panel = new DOMParser().parseFromString(markup, 'text/html').querySelector('#inventoryPanel');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerLayout = 'soft';
      document.body.dataset.providerPorcelainCharacter = 'pearl';
      const main = document.createElement('main');
      main.style.cssText = 'width:100%;padding:16px;box-sizing:border-box';
      main.append(document.importNode(panel, true));
      document.body.append(main);
    }, html);
    for (const content of layers) await page.addStyleTag({ content });
    await page.addStyleTag({ content:uiCss });
    await page.addScriptTag({ content:uiSource });
    await page.addScriptTag({ content:controllerSource });
    await page.addScriptTag({ content:readFileSync(new URL('provider-selects.js', root), 'utf8') });
    await page.evaluate(({ org, warehouse, samples }) => {
      window.testWrites = true;
      window.rpcCalls = [];
      window.rejectSave = false;
      window.workspace = { organization_id:org, current_role:'owner', enabled:true, auto_deduct_completed_visits:true,
        transfer_version:130, transfers_enabled:false, transfers_initialized_at:null,
        locations:[{ id:org, name:'Основной филиал', active:true }], services:[],
        items:samples,
        warehouses:[{ id:warehouse, name:'Склад — Центр', location_id:org, active:true }],
        balances:samples.map((item, index) => ({ inventory_item_id:item.id, warehouse_id:warehouse, quantity:[1200,8,36,12,750,0][index] })),
        usage:[{ inventory_item_id:'gloves', service_id:'massage', quantity:1 }], movements:[], audit:[], transfer_documents:[] };
      window.controller = window.MinutaInventory.createController({
        db:{ rpc:async (name, parameters) => {
          window.rpcCalls.push({ name, parameters });
          if (name === 'get_minuta_inventory_workspace_v130') return { data:structuredClone(window.workspace) };
          if (name === 'upsert_minuta_inventory_item') {
            if (window.rejectSave) return { error:{ message:'inventory_unit_locked_by_ledger' } };
            const item = window.workspace.items.find(row => row.id === parameters.p_item);
            Object.assign(item, { name:parameters.p_name, sku:parameters.p_sku, unit:parameters.p_unit,
              low_stock_threshold:parameters.p_low_stock, active:parameters.p_active });
            return { data:{ organization_id:org } };
          }
          throw new Error(`Unexpected RPC ${name}`);
        } },
        escapeHtml:value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]),
        notify:() => {}, requireWrites:() => window.testWrites,
        getCurrentUser:() => ({ id:org }), getSessionGeneration:() => 1, sessionIsCurrent:() => true,
        applyWriteAvailability:() => document.querySelectorAll('[data-inventory-write]').forEach(control => {
          if (!window.testWrites) control.disabled = true;
        })
      });
      window.controller.bind();
      document.querySelectorAll('[data-inventory-section]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-inventory-pane]').forEach(pane => pane.hidden = pane.dataset.inventoryPane !== button.dataset.inventorySection);
        document.querySelectorAll('[data-inventory-section]').forEach(current => {
          current.classList.toggle('active', current === button);
          current.setAttribute('aria-pressed', String(current === button));
        });
      }));
    }, { org, warehouse, samples });
    await page.evaluate(org => window.controller.setOrganization({ id:org, current_role:'owner' }), org);
    await page.getByRole('button', { name:'Каталог и склады', exact:true }).click();
    assert.equal(await page.locator('#inventorySettingsDetails').evaluate(node => node.open), false);
    assert.match(await page.locator('#inventorySettingsDetails>summary').textContent(), /Учёт включён.*Автосписание включено.*Перемещения выключены/);
    assert.equal(await page.locator('#inventoryItemsList .is-item-row').count(), samples.length);
    assert.doesNotMatch(await page.locator('#inventoryItemsList').textContent(), /MS-001|RS-012|Артикул/);
    assert.equal(await page.locator('#inventoryItemsList .is-low-stock').count(), 1);
    assert.match(await page.locator('#inventoryItemsList').textContent(), /Для услуг · расход по нормам/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}px catalog overflow`);
    assert.equal(await page.locator('#inventoryWarehousesDetails').evaluate(node => node.open), width > 760);
    assert.match(await page.locator('#inventoryWarehousesDetails>summary').textContent(), /1 активный/);
    await capture(page, `catalog-filled-${width}.png`);
    await page.locator('[data-inventory-edit-item="gloves"].is-item-name').click();
    await page.locator('#inventoryItemDialog').waitFor({ state:'visible' });
    // Navigation hides a provider-view ancestor, not necessarily the panel itself.
    await page.locator('#inventoryItemDialog .pro-select-trigger').click();
    await page.locator('.pro-select-dialog').waitFor({ state:'visible' });
    await page.evaluate(() => { document.querySelector('main').hidden = true; });
    await page.waitForFunction(() => !document.querySelector('#inventoryItemDialog').open);
    await page.locator('.pro-select-dialog').waitFor({ state:'hidden' });
    await page.evaluate(() => { document.querySelector('main').hidden = false; });
    await page.locator('[data-inventory-edit-item="gloves"].is-item-name').click();
    await page.locator('#inventoryItemDialog').waitFor({ state:'visible' });
    assert.equal(await page.locator('#inventoryItemSku').inputValue(), 'RS-012');
    assert.equal(await page.locator('#inventoryItemUnit').inputValue(), 'pack');
    assert.equal(await page.locator('#inventoryItemExtra').evaluate(node => node.open), true);
    assert.equal(await page.locator('#inventoryIconPreview svg path').count(), 2);
    assert.equal(await page.locator('[data-code-scan-target="inventoryItemSku"]').count(), 1);
    assert.equal(await page.locator('#inventoryItemDialog').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `${width}px editor overflow`);
    await capture(page, `catalog-editor-${width}.png`);
    await page.locator('#inventoryItemName').fill('Перчатки нитриловые — новые');
    await page.locator('#inventoryItemSku').fill('RS-012-N');
    await page.locator('#inventoryItemLow').fill('12');
    await page.locator('#inventoryItemForm button[type="submit"]').click();
    await page.locator('#inventoryItemDialog').waitFor({ state:'hidden' });
    const mutation = await page.evaluate(() => window.rpcCalls.find(call => call.name === 'upsert_minuta_inventory_item'));
    assert.deepEqual(mutation.parameters, { p_organization:org, p_item:'gloves', p_name:'Перчатки нитриловые — новые',
      p_sku:'RS-012-N', p_unit:'pack', p_low_stock:12, p_active:true });

    // Server rejection stays visible in the same editor, with the draft intact.
    await page.locator('[data-inventory-edit-item="gloves"].is-item-name').click();
    await page.evaluate(() => window.rejectSave = true);
    await page.locator('#inventoryItemDialog .pro-select-trigger').click();
    await page.getByRole('option', { name:'шт.', exact:true }).click();
    assert.equal(await page.locator('#inventoryItemDialog').evaluate(node => node.open), true);
    await page.locator('#inventoryItemForm button[type="submit"]').click();
    await page.getByText('Нельзя изменить единицу материала после первой операции. Создайте новую позицию.', { exact:true }).waitFor({ state:'visible' });
    assert.equal(await page.locator('#inventoryItemDialog').evaluate(node => node.open), true);
    assert.equal(await page.locator('#inventoryItemUnit').inputValue(), 'piece');
    await page.keyboard.press('Escape');
    await page.locator('#inventoryItemDialog').waitFor({ state:'hidden' });

    await page.locator('#inventoryItemCreator>summary').click();
    assert.equal(await page.locator('#inventoryItemName').inputValue(), '');
    assert.equal(await page.locator('#inventoryItemExtra').evaluate(node => node.open), false);
    await page.locator('#inventoryItemName').fill('Антисептик');
    assert.equal(await page.evaluate(() => window.MinutaInventorySoftUI.iconName({ name:document.querySelector('#inventoryItemName').value })), 'spray');
    await page.keyboard.press('Escape');
    if (width <= 760) await page.locator('#inventoryWarehousesDetails>summary').click();
    await page.locator('[data-inventory-edit-warehouse]').click();
    await page.locator('#inventoryWarehouseDialog').waitFor({ state:'visible' });
    assert.equal(await page.locator('#inventoryWarehouseName').inputValue(), 'Склад — Центр');
    await page.locator('#inventoryWarehouseDialog .pro-select-trigger').click();
    await page.getByRole('option', { name:'Основной филиал', exact:true }).click();
    assert.equal(await page.locator('#inventoryWarehouseDialog').evaluate(node => node.open), true);
    await page.keyboard.press('Escape');

    // Manual disclosure state survives reads; changing organizations clears editors.
    await page.locator('#inventorySettingsDetails>summary').click();
    await page.evaluate(() => window.controller.load());
    assert.equal(await page.locator('#inventorySettingsDetails').evaluate(node => node.open), true);
    await page.locator('#inventoryItemCreator>summary').click();
    await page.evaluate(org => window.controller.setOrganization({ id:`${org}-other`, current_role:'owner' }), org);
    assert.equal(await page.locator('#inventoryItemDialog').evaluate(node => node.open), false);
    assert.equal(await page.locator('#inventoryItemId').inputValue(), '');
    assert.equal(await page.locator('#inventoryItemName').inputValue(), '');
    assert.equal(await page.locator('#inventoryItemSku').inputValue(), '');
    assert.equal(await page.locator('#inventoryWarehouseId').inputValue(), '');
    await page.evaluate(org => window.controller.setOrganization({ id:org, current_role:'owner' }), org);
    await page.evaluate(() => {
      window.workspace.current_role = 'admin';
      return window.controller.load();
    });
    assert.equal(await page.locator('#inventoryEnabled').isDisabled(), true);
    assert.equal(await page.locator('#inventoryAutoDeduct').isDisabled(), true);
    await page.evaluate(() => { window.testWrites = false; return window.controller.load(); });
    assert.equal(await page.locator('.is-item-name').first().isDisabled(), true);
    const writesBefore = await page.evaluate(() => window.rpcCalls.filter(call => call.name === 'upsert_minuta_inventory_item').length);
    await page.locator('#inventoryItemCreator>summary').click();
    await page.evaluate(() => document.querySelector('#inventoryItemForm').dispatchEvent(new Event('submit', { bubbles:true, cancelable:true })));
    assert.equal(await page.evaluate(() => window.rpcCalls.filter(call => call.name === 'upsert_minuta_inventory_item').length), writesBefore);
    await page.keyboard.press('Escape');

    // Keep first-run instructions and account-disabled recovery available.
    await page.evaluate(() => {
      window.workspace.items = []; window.workspace.warehouses = []; window.workspace.balances = []; window.workspace.usage = [];
      window.workspace.current_role = 'owner'; window.testWrites = true;
      return window.controller.load();
    });
    assert.equal(await page.locator('#inventoryFirstRun').isVisible(), true);
    assert.equal(await page.locator('#inventoryFirstRun ol li').count(), 2);
    await capture(page, `catalog-empty-${width}.png`);
    await page.evaluate(() => { window.workspace.enabled = false; window.MinutaInventorySoftUI.reset(); return window.controller.load(); });
    assert.equal(await page.locator('#inventorySettingsDetails').evaluate(node => node.open), true);
    assert.equal(await page.locator('#inventoryControls').isVisible(), false);
    assert.deepEqual(errors, [], `${width}px script errors`);
    await page.close();
  }
} finally { await browser.close(); }
console.log('inventory soft UI: 390/760/1440, mocked writes, failure/editor scope, settings and first run PASS');
