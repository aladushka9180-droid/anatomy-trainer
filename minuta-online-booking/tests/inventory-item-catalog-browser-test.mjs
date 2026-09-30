import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.env.MINUTA_INVENTORY_CATALOG_SCREENSHOTS || join(app, '..', 'outputs', 'inventory-catalog-preview');
mkdirSync(output, { recursive:true });
const original = readFileSync(join(app, 'provider.html'), 'utf8')
  .replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const oldController = execFileSync('git', ['show', '6a4120dd:minuta-online-booking/inventory-management.js'], { cwd:join(app, '..'), encoding:'utf8' });
const newController = readFileSync(join(app, 'inventory-management.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await playwright.chromium.launch({ headless:true, channel:process.env.BROWSER_CHANNEL || 'chrome' });
const org = '00000000-0000-4000-8000-000000000100';
const items = [
  { id:'00000000-0000-4000-8000-000000000101', name:'Масло', sku:'', unit:'ml', low_stock_threshold:5, active:true, category:null, icon:null },
  { id:'00000000-0000-4000-8000-000000000102', name:'Массажное масло', sku:'OIL-1', unit:'l', low_stock_threshold:3, active:true, category:'Расходники', icon:'bottle' }
];
const workspace = { organization_id:org, current_role:'owner', enabled:true, auto_deduct_completed_visits:false,
  transfer_version:0, catalog_version:1, locations:[{ id:org, name:'Центр', active:true }],
  items, warehouses:[{ id:org, location_id:org, name:'Склад Центр', active:true }],
  balances:[{ warehouse_id:org, inventory_item_id:items[0].id, quantity:6 }],
  services:[], usage:[], movements:[], audit:[], transfer_documents:[] };
const originalRowHeights=new Map();

try {
  for (const width of [390, 760, 1440]) for (const variant of ['before','after']) {
    const page = await browser.newPage({ viewport:{ width, height:900 }, serviceWorkers:'block', deviceScaleFactor:1 });
    await page.route('**/*', route => route.abort());
    await page.route('https://inventory-preview.test/**', route => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname).slice(1);
      if (name === 'provider.html') return route.fulfill({ contentType:'text/html', body:variant === 'after' ? original.replace('</body>', '<link rel="stylesheet" href="inventory-item-catalog.css?v=1"></body>') : original });
      const file = join(app, name);
      if (!name.includes('..') && existsSync(file)) {
        const type = extname(file) === '.css' ? 'text/css' : extname(file) === '.svg' ? 'image/svg+xml' : undefined;
        return route.fulfill({ path:file, ...(type ? { contentType:type } : {}) });
      }
      return route.abort();
    });
    await page.goto('https://inventory-preview.test/provider.html', { waitUntil:'load' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting','requires-top-level');
      document.body.dataset.providerTheme='pink-porcelain';
      document.body.dataset.providerLayout='soft';
      document.body.dataset.providerPorcelainCharacter='pearl';
      document.querySelector('#providerBoot').hidden=true;
      document.querySelector('#dashboard').hidden=false;
      document.querySelector('#dashboard').dataset.activeView='organization';
      document.querySelectorAll('.provider-view').forEach(node => { node.hidden=node.dataset.providerPanel!=='organization'; });
      document.querySelector('#organizationLoading').hidden=true;
      document.querySelector('#organizationWorkspace').hidden=false;
      document.querySelector('#organizationRoleBadge').textContent='Владелец';
      document.querySelector('#todayLabel').textContent='Среда, 30 Сентября';
      document.querySelector('#syncState').hidden=true;
      document.querySelectorAll('#organizationWorkspace > .organization-section, #organizationOverviewSection, #organizationPeopleSection').forEach(node => { node.hidden=true; });
      document.querySelector('#organizationSectionSelect').value='inventoryPanel';
      document.querySelectorAll('#organizationSectionNav button').forEach(node => node.classList.toggle('active',node.dataset.sectionTarget==='inventoryPanel'));
      document.querySelectorAll('.provider-nav button').forEach(node => node.classList.toggle('active',node.dataset.providerView==='organization'));
    });
    await page.addScriptTag({ content:variant === 'after' ? newController : oldController });
    await page.evaluate(({ workspace, variant }) => {
      const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
      window.calls=[];
      window.catalogMissing=false;
      window.controller=MinutaInventory.createController({
        $:selector => document.querySelector(selector), escapeHtml, notify() {}, requireWrites:() => true,
        getCurrentUser:() => ({ id:'synthetic-owner' }), getSessionGeneration:() => 1,
        sessionIsCurrent:() => true, applyWriteAvailability() {}, inventoryCatalog:variant==='after',
        db:{ rpc:async (name,params) => { calls.push({ name,params });
          if (name==='get_minuta_inventory_workspace_catalog') return catalogMissing
            ? { data:null,error:{ code:'PGRST202',message:'Could not find the function public.get_minuta_inventory_workspace_catalog' } }
            : { data:workspace,error:null };
          if (name==='get_minuta_inventory_workspace_v130') { const { catalog_version,...legacy }=workspace; return { data:legacy,error:null }; }
          if (name==='upsert_minuta_inventory_item_catalog' || name==='upsert_minuta_inventory_item') return { data:{ organization_id:workspace.organization_id,id:params.p_item },error:null };
          throw Error(`Unexpected RPC: ${name}`);
        } }
      });
      controller.bind();
    }, { workspace,variant });
    assert.equal((await page.evaluate(org => controller.setOrganization({ id:org,current_role:'owner' }),org)).ok,true);
    await page.evaluate(() => {
      document.querySelector('#inventoryFirstRun').hidden=true;
      document.querySelectorAll('#inventoryWorkspace [data-inventory-pane]').forEach(node => { node.hidden=node.dataset.inventoryPane!=='catalog'; });
      document.querySelectorAll('#inventoryControls [data-inventory-section]').forEach(node => { const active=node.dataset.inventorySection==='catalog'; node.classList.toggle('active',active); node.setAttribute('aria-pressed',String(active)); });
      document.querySelector('#inventoryControls').hidden=false;
    });
    assert.equal(await page.locator('#inventoryItemsList .organization-row').count(),2);
    const rowHeight=(await page.locator('#inventoryItemsList .organization-row').nth(1).boundingBox()).height;
    if (variant==='before') originalRowHeights.set(width,rowHeight);
    else assert.ok(rowHeight <= originalRowHeights.get(width) + 2,`catalog row expanded at ${width}: ${originalRowHeights.get(width)} → ${rowHeight}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    const box = await page.locator('#inventoryPanel').boundingBox();
    assert.ok(box.x >= -1 && box.x + box.width <= width + 1,`clipped inventory ${variant} ${width}: ${JSON.stringify(box)}`);
    if (variant==='after') {
      assert.equal(await page.locator('#inventoryItemsList .inventory-item-icon').count(),1);
      assert.equal(await page.locator('#inventoryItemsList .inventory-item-category').count(),1);
      assert.equal(await page.locator('#inventoryItemsList .organization-row').first().locator('.inventory-item-icon').count(),0);
      await page.locator(`[data-inventory-edit-item="${items[1].id}"]`).click();
      assert.equal(await page.locator('#inventoryItemCategory').inputValue(),'Расходники');
      assert.equal(await page.locator('#inventoryItemIcon').inputValue(),'bottle');
      const controls=await page.locator('#inventoryItemCategory, #inventoryItemIcon').evaluateAll(nodes => nodes.map(node => ({ w:node.getBoundingClientRect().width,h:node.getBoundingClientRect().height })));
      assert.ok(controls.every(rect => rect.w>=44 && rect.h>=44),`catalog controls too small at ${width}: ${JSON.stringify(controls)}`);
    } else await page.locator(`[data-inventory-edit-item="${items[1].id}"]`).click();
    await page.locator('#inventoryItemsList').scrollIntoViewIfNeeded();
    await page.screenshot({ path:join(output,`inventory-${variant}-${width}-list.png`) });
    await page.locator('#inventoryItemCreator').scrollIntoViewIfNeeded();
    await page.screenshot({ path:join(output,`inventory-${variant}-${width}-edit.png`) });
    if (variant==='after') {
      await page.locator('#inventoryItemCategory').fill('Масла');
      await page.locator('#inventoryItemIcon').selectOption('box');
      await page.locator('#inventoryItemForm button[type="submit"]').click();
      const write=await page.evaluate(() => calls.find(call => call.name==='upsert_minuta_inventory_item_catalog'));
      assert.equal(write.params.p_category,'Масла');
      assert.equal(write.params.p_icon,'box');
      assert.equal(write.params.p_item,items[1].id);
      assert.equal(await page.locator('#inventoryItemForm').count(),1);
      if (width===390) {
        await page.evaluate(() => { catalogMissing=true; });
        assert.equal((await page.evaluate(() => controller.load())).ok,true);
        assert.equal(await page.locator('#inventoryItemCatalogFields').isVisible(),false);
        await page.locator(`[data-inventory-edit-item="${items[0].id}"]`).click();
        await page.locator('#inventoryItemForm button[type="submit"]').click();
        const oldWrite=await page.evaluate(() => calls.find(call => call.name==='upsert_minuta_inventory_item'));
        assert.equal(oldWrite.params.p_item,items[0].id);
        assert.equal(Object.hasOwn(oldWrite.params,'p_category'),false);
      }
    }
    await page.close();
  }
  console.log('O24 themed synthetic browser PASS: before/after Pink Porcelain 390/760/1440, optional fields and scoped RPC');
} finally { await browser.close(); }
