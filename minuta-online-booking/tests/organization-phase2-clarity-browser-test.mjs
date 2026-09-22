import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'provider.html'), 'utf8')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/gi, '');
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright';
const playwright = await import(modulePath);
const chromium = playwright.chromium || playwright.default?.chromium;
const screenshots = process.env.ORGANIZATION_PHASE2_SCREENSHOTS ? resolve(process.env.ORGANIZATION_PHASE2_SCREENSHOTS) : '';
if (screenshots) mkdirSync(screenshots, { recursive:true });

const targets = [
  { name:'people', panel:'organizationPeopleSection', focus:'#copyMemberInviteLink', prepare:() => {
    document.querySelector('#memberInviteShare').hidden = false;
  }, text:'Организация → Люди и филиалы' },
  { name:'integrations', panel:'paymentProviderPanel', focus:'[data-provider-integration-form="dikidi"] button', prepare:() => {
    document.querySelector('#providerIntegrationsDisclosure').open = true;
    document.querySelector('#providerIntegrationsWorkspace').hidden = false;
  }, text:'обмен данными не начнётся' },
  { name:'sale', panel:'commercePanel', focus:'#commercePaymentMethod', prepare:() => {
    document.querySelector('#commerceWorkspace').hidden = false;
    document.querySelector('#commerceSaleCreator').open = true;
    document.querySelector('#commerceSaleOptions').open = true;
    document.querySelector('#commercePaymentMethod').value = 'manual';
    document.querySelector('#commercePaymentMethodHint').hidden = false;
  }, text:'Оплата подтверждена вручную. Деньги в банке не проверяются' },
  { name:'loyalty', panel:'loyaltyPanel', focus:'#loyaltyAdjustmentPoints', prepare:() => {
    document.querySelector('#loyaltyWorkspace').hidden = false;
    document.querySelector('.loyalty-operation').open = true;
    document.querySelector('#loyaltyAdjustmentClient').innerHTML = '<option>Ирина Орлова</option>';
    document.querySelector('#loyaltyAdjustmentPoints').value = '2';
    document.querySelector('#loyaltyAdjustmentPreview').textContent = 'Было 6 → станет 8 визитов.';
  }, text:'Было 6 → станет 8 визитов' },
  { name:'inventory', panel:'inventoryPanel', focus:'#inventoryMovementScan', prepare:() => {
    document.querySelector('#inventoryWorkspace').hidden = false;
    document.querySelector('#inventoryControls').hidden = false;
    document.querySelectorAll('[data-inventory-pane]').forEach(node => { node.hidden = node.dataset.inventoryPane !== 'operations'; });
  }, text:'Сканировать товар' }
];

const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [], results = [];
try {
  for (const width of [390, 760, 1440]) for (const theme of ['warm','graphite','lavender','warm-beige']) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:1100 } });
    page.on('pageerror', error => errors.push(`${width}/${theme}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${width}/${theme}: ${message.text()}`); });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://organization-phase2.test' || route.request().method() !== 'GET') return route.abort();
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try { return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) }); }
      catch { return route.abort(); }
    });
    await page.goto('https://organization-phase2.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(({ theme }) => {
      document.documentElement.classList.remove('provider-booting', 'requires-top-level');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.body.dataset.providerTheme = theme;
      document.body.dataset.providerLayout = 'linear';
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'organization';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#organizationLoading').hidden = true;
      document.querySelector('#organizationWorkspace').hidden = false;
      document.querySelectorAll('#organizationWorkspace > section[id]').forEach(section => { section.hidden = true; });
    }, { theme });

    for (const target of targets) {
      await page.evaluate(({ panel, prepare }) => {
        document.querySelectorAll('#organizationWorkspace > section[id]').forEach(section => { section.hidden = section.id !== panel; });
        (0, eval)(`(${prepare})`)();
      }, { panel:target.panel, prepare:String(target.prepare) });
      const state = await page.evaluate(({ panel, text, focus }) => {
        const section = document.querySelector(`#${panel}`);
        const control = document.querySelector(focus);
        control.focus();
        const style = getComputedStyle(control);
        const box = control.getBoundingClientRect();
        return {
          visible:section.checkVisibility() && control.checkVisibility(),
          text:section.textContent.includes(text),
          width:box.width,
          focusVisible:control.matches(':focus-visible'),
          outlineStyle:style.outlineStyle,
          outlineWidth:parseFloat(style.outlineWidth) || 0,
          overflow:Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)
        };
      }, { panel:target.panel, text:target.text, focus:target.focus });
      assert.equal(state.visible, true, `${width}/${theme}/${target.name}: target is not visible`);
      assert.equal(state.text, true, `${width}/${theme}/${target.name}: clarified text is missing`);
      assert.ok(state.width > 0 && state.width <= width, `${width}/${theme}/${target.name}: control width ${state.width}`);
      assert.equal(state.focusVisible, true, `${width}/${theme}/${target.name}: keyboard focus classification is missing`);
      assert.notEqual(state.outlineStyle, 'none', `${width}/${theme}/${target.name}: focus outline is missing`);
      assert.ok(state.outlineWidth >= 2, `${width}/${theme}/${target.name}: focus outline is too thin`);
      assert.ok(state.overflow <= 1, `${width}/${theme}/${target.name}: overflow ${state.overflow}`);
      results.push({ width, theme, target:target.name, overflow:state.overflow });
      if (screenshots && theme === 'warm') await page.screenshot({ path:resolve(screenshots, `${target.name}-${width}.png`), fullPage:true });
    }
    await page.close();
  }
} finally { await browser.close(); }

assert.deepEqual(errors, []);
console.log(JSON.stringify({ cases:results.length, widths:[390,760,1440], themes:['warm','graphite','lavender','warm-beige'], targets:targets.map(item => item.name), maxOverflow:Math.max(...results.map(item => item.overflow)) }));
