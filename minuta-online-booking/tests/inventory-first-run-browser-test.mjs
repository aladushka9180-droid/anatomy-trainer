import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const themeCss = ['provider-themes-signature.css', 'provider-layout-responsive.css', 'provider-ux.css', 'provider-porcelain-detail.css', 'provider-reference-screens.css']
  .map(name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const source = readFileSync(new URL('../inventory-management.js', import.meta.url), 'utf8');
const provider = readFileSync(new URL('../provider.js', import.meta.url), 'utf8');
assert.match(provider, /inventorySectionButton\.dataset\.inventorySection/);
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const browser = await chromium.launch({ headless:true });
const id = '00000000-0000-4000-8000-000000000001';
function contrast(foreground, background) {
  const channels = color => color.match(/[\d.]+/g).slice(0, 3).map(value => {
    const s = Number(value) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lightness = color => channels(color).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = lightness(foreground), b = lightness(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const cases = [
  { name:'empty', items:[], warehouses:[], balances:[], movements:[], section:'catalog', hint:'добавьте материал' },
  { name:'disabled', items:[], warehouses:[], balances:[], movements:[], enabled:false, section:'catalog', hint:'включите складской учёт', actionVisible:false },
  { name:'warehouse', items:[{ id, name:'Масло', unit:'ml', active:true }], warehouses:[], balances:[], movements:[], section:'catalog', hint:'создайте склад' },
  { name:'receipt', items:[{ id, name:'Масло', unit:'ml', active:true }], warehouses:[{ id, name:'Склад', location_id:id, active:true }], balances:[], movements:[], section:'operations', hint:'оформите приход' },
  { name:'used', items:[{ id, name:'Масло', unit:'ml', active:true }], warehouses:[{ id, name:'Склад', location_id:id, active:true }], balances:[{ warehouse_id:id, inventory_item_id:id, quantity:1 }], movements:[], section:null },
  { name:'depleted', items:[{ id, name:'Масло', unit:'ml', active:true }], warehouses:[{ id, name:'Склад', location_id:id, active:true }], balances:[{ warehouse_id:id, inventory_item_id:id, quantity:0 }], movements:[{ inventory_item_id:id, warehouse_id:id, quantity_delta:-1, quantity_after:0, movement_type:'write_off', created_at:'2026-09-25T12:00:00Z' }], section:null },
];
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('about:blank');
    await page.evaluate(markup => {
      const panel = new DOMParser().parseFromString(markup, 'text/html').querySelector('#inventoryPanel');
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'pink-porcelain';
      document.body.dataset.providerPorcelainCharacter = 'pearl';
      document.body.append(document.importNode(panel, true));
      window.inventoryRows = null;
    }, html);
    await page.addStyleTag({ content:css });
    for (const layer of themeCss) await page.addStyleTag({ content:layer });
    await page.addScriptTag({ content:source });
    await page.evaluate(org => {
      window.inventoryController = window.MinutaInventory.createController({
        db:{ rpc:async name => {
          if (name !== 'get_minuta_inventory_workspace_v130') throw Error(`Unexpected RPC: ${name}`);
          return { data:{ organization_id:org, current_role:'owner', enabled:window.inventoryRows.enabled ?? true,
            auto_deduct_completed_visits:false, transfer_version:0,
            locations:[{ id:org, name:'Филиал', active:true }], services:[], usage:[], audit:[], transfer_documents:[],
            ...window.inventoryRows }, error:null };
        } },
        escapeHtml:value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]),
        notify:() => {}, requireWrites:() => false, getCurrentUser:() => ({ id:org }),
        getSessionGeneration:() => 1, sessionIsCurrent:() => true, applyWriteAvailability:() => {},
      });
      window.inventoryController.bind();
      window.inventoryForwarded = [];
      document.querySelectorAll('.inventory-section-nav [data-inventory-section]').forEach(button =>
        button.addEventListener('click', () => window.inventoryForwarded.push(button.dataset.inventorySection)));
    }, id);
    for (const sample of cases) {
      await page.evaluate(async ({ org, sample }) => {
        window.inventoryRows = sample;
        if (window.inventoryController.availability === null) await window.inventoryController.setOrganization({ id:org, current_role:'owner' });
        else await window.inventoryController.load();
      }, { org:id, sample });
      const state = await page.evaluate(() => {
        const guide = document.querySelector('#inventoryFirstRun');
        const action = document.querySelector('#inventoryFirstRunAction');
        const guideStyle = getComputedStyle(guide);
        const actionStyle = getComputedStyle(action);
        return { visible:!guide.hidden, steps:guide.querySelectorAll('li').length,
          section:action.dataset.inventoryTarget, actionVisible:!action.hidden,
          hint:document.querySelector('#inventoryFirstRunHint').textContent,
          guideColors:[guideStyle.color, guideStyle.backgroundColor],
          actionColors:[actionStyle.color, actionStyle.backgroundColor],
          overflow:document.documentElement.scrollWidth > innerWidth + 1,
          targetExists:!!document.querySelector(`[data-inventory-pane="${action.dataset.inventoryTarget}"]`),
          tabRole:action.hasAttribute('aria-pressed') };
      });
      assert.equal(state.visible, !!sample.section, `${width}px ${sample.name}: guide`);
      assert.equal(state.overflow, false, `${width}px ${sample.name}: overflow`);
      if (sample.section) {
        assert.equal(state.steps, 4);
        assert.equal(state.section, sample.section);
        assert.equal(state.actionVisible, sample.actionVisible !== false);
        assert.equal(state.targetExists, true);
        assert.equal(state.tabRole, false);
        assert.match(state.hint, new RegExp(sample.hint));
        assert.ok(contrast(...state.guideColors) >= 4.5, `${width}px ${sample.name}: guide contrast`);
        if (state.actionVisible) assert.ok(contrast(...state.actionColors) >= 4.5, `${width}px ${sample.name}: action contrast`);
        if (state.actionVisible) {
          await page.locator('#inventoryFirstRunAction').click();
          assert.equal(await page.evaluate(() => window.inventoryForwarded.pop()), sample.section,
            `${width}px ${sample.name}: forwards to existing section control`);
        }
      }
      if (sample.name === 'empty' && process.env.MINUTA_INVENTORY_SCREENSHOT_DIR) {
        mkdirSync(process.env.MINUTA_INVENTORY_SCREENSHOT_DIR, { recursive:true });
        await page.locator('#inventoryPanel').screenshot({ path:join(process.env.MINUTA_INVENTORY_SCREENSHOT_DIR, `inventory-first-run-${width}.png`) });
      }
    }
    assert.deepEqual(errors, [], `${width}px script errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
