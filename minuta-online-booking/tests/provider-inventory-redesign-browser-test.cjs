const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = process.env.MINUTA_INVENTORY_OUTPUT;
if (output) fs.mkdirSync(output, { recursive:true });

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp' };
const server = http.createServer((request, response) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
  let content = fs.readFileSync(file);
  if (file.endsWith('.html')) content = content.toString().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
  response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  response.end(content);
});

const ids = { org:'org-1', locationA:'location-a', locationB:'location-b', warehouseA:'warehouse-a', warehouseB:'warehouse-b' };
const items = [
  { id:'oil', name:'Масло массажное', sku:'OIL-500', unit:'ml', low_stock_threshold:500, active:true },
  { id:'cream', name:'Крем для лица', sku:'CR-02', unit:'piece', low_stock_threshold:2, active:true },
  { id:'disinfectant', name:'Средство для дезинфекции', sku:'DS-05', unit:'piece', low_stock_threshold:5, active:true },
  { id:'towel', name:'Полотенце одноразовое', sku:'TW-10', unit:'piece', low_stock_threshold:10, active:true },
  { id:'archived', name:'Архивная позиция', sku:'OLD-1', unit:'pack', low_stock_threshold:1, active:false }
];
const workspace = {
  organization_id:ids.org,current_role:'owner',enabled:true,auto_deduct_completed_visits:true,
  transfer_version:130,transfers_enabled:true,transfers_initialized_at:'2026-09-20T00:00:00Z',transfers_suspended_at:null,
  locations:[{ id:ids.locationA,name:'Основной филиал',active:true },{ id:ids.locationB,name:'Филиал 2',active:true }],
  services:[{ id:'service-1',name:'Классический массаж',active:true }],usage:[],audit:[],transfer_documents:[],movements:[],items,
  warehouses:[{ id:ids.warehouseA,location_id:ids.locationA,name:'Основной склад',active:true },{ id:ids.warehouseB,location_id:ids.locationB,name:'Дополнительный склад',active:true }],
  balances:[
    { warehouse_id:ids.warehouseA,inventory_item_id:'oil',quantity:850 },{ warehouse_id:ids.warehouseA,inventory_item_id:'cream',quantity:4 },
    { warehouse_id:ids.warehouseA,inventory_item_id:'disinfectant',quantity:2 },{ warehouse_id:ids.warehouseA,inventory_item_id:'towel',quantity:12 },
    { warehouse_id:ids.warehouseB,inventory_item_id:'oil',quantity:150 },{ warehouse_id:ids.warehouseB,inventory_item_id:'towel',quantity:2 }
  ]
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless:true, ...(process.env.MINUTA_CHROME_PATH ? { executablePath:process.env.MINUTA_CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin + '/provider.html');
    await page.addScriptTag({ url:origin + '/inventory-management.js' });
    await page.addStyleTag({ content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' });
    await page.evaluate(async ({ workspace }) => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.body.dataset.providerLayout = 'bento';
      document.body.dataset.providerTheme = 'carbon-crimson';
      document.querySelectorAll('.provider-view').forEach(element => { element.hidden = element.dataset.providerPanel !== 'organization'; });
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelectorAll('#organizationWorkspace .organization-section').forEach(element => { element.hidden = true; });
      document.querySelector('#inventoryPanel').hidden = false;
      document.querySelector('#sidebarName').textContent = 'Рамиль';
      document.querySelector('#accountEmail').textContent = 'Кабинет исполнителя';
      const controller = window.MinutaInventory.createController({
        $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[character]),
        notify() {},requireWrites:() => true,getCurrentUser:() => ({ id:'owner-1' }),getSessionGeneration:() => 1,
        sessionIsCurrent:() => true,applyWriteAvailability() {},db:{ rpc:async name => {
          if (!['get_minuta_inventory_workspace_v130','get_minuta_inventory_workspace'].includes(name)) throw new Error(`Unexpected mutation: ${name}`);
          return { data:workspace,error:null };
        } }
      });
      controller.bind();
      await controller.setOrganization({ id:workspace.organization_id,current_role:'owner' });
      document.addEventListener('click', event => {
        const button = event.target.closest('[data-inventory-section]');
        if (!button) return;
        document.querySelectorAll('[data-inventory-section]').forEach(entry => { const active = entry === button; entry.classList.toggle('active', active); entry.setAttribute('aria-pressed', String(active)); });
        document.querySelectorAll('[data-inventory-pane]').forEach(pane => { pane.hidden = pane.dataset.inventoryPane !== button.dataset.inventorySection; });
      });
    }, { workspace });

    await page.getByRole('button', { name:'Каталог и склады' }).click();
    assert.equal(await page.locator('[data-inventory-pane="catalog"]').isVisible(), true, 'Каталог должен открываться безопасным кликом');
    assert.deepEqual(await page.locator('.inventory-summary strong').allTextContents(), ['5','4','1','2']);
    assert.equal(await page.locator('.inventory-catalog-row').count(), 5);
    assert.match(await page.locator('.inventory-catalog-row').nth(2).innerText(), /Остаток|2[\s\S]*Минимум|5[\s\S]*Мало/);

    for (const width of [390,760,1440]) {
      await page.setViewportSize({ width, height:1000 });
      const result = await page.evaluate(() => {
        const panel = document.querySelector('#inventoryPanel');
        const panelRect = panel.getBoundingClientRect();
        return ({
        overflow:panel.scrollWidth > panel.clientWidth + 2,
        overflowElements:[...panel.querySelectorAll('*')].filter(element => element.checkVisibility()).map(element => ({
          selector:element.id ? `#${element.id}` : String(element.className || element.tagName),right:Math.round(element.getBoundingClientRect().right)
        })).filter(entry => entry.right > panelRect.right + 2).slice(0,8),
        summaryVisible:[...document.querySelectorAll('.inventory-summary article')].every(element => element.checkVisibility()),
        catalogVisible:document.querySelector('#inventoryItemsList').checkVisibility(),
        warehousesVisible:document.querySelector('#inventoryWarehousesList').checkVisibility(),
        actionHeight:document.querySelector('#inventoryItemCreator>summary').getBoundingClientRect().height,
        columnsVisible:getComputedStyle(document.querySelector('.inventory-list-head')).display !== 'none'
      }); });
      if (result.overflow) console.error(`${width}px overflow`, result.overflowElements);
      assert.equal(result.overflow, false, `${width}px: горизонтальное переполнение`);
      assert.equal(result.summaryVisible && result.catalogVisible && result.warehousesVisible, true, `${width}px: основные области склада скрыты`);
      assert.ok(result.actionHeight >= 40, `${width}px: основное действие слишком маленькое`);
      assert.equal(result.columnsVisible, width > 560, `${width}px: неверный режим колонок`);
      if (output) await page.screenshot({ path:path.join(output, `inventory-carbon-crimson-${width}.png`), fullPage:true });
    }

    await page.setViewportSize({ width:1440, height:1000 });
    await page.getByText('Добавить позицию', { exact:true }).click();
    assert.equal(await page.locator('#inventoryItemForm').isVisible(), true, 'Форма позиции должна открываться без записи данных');
    assert.equal(await page.locator('#inventoryItemName').isEnabled(), true, 'Поле новой позиции должно оставаться доступным с клавиатуры');
    console.log('provider inventory redesign browser test passed: carbon-crimson/bento 390/760/1440px');
  } finally {
    await browser?.close();
    server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
