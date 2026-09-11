import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '.tmp-provider-transfer-v144');
mkdirSync(output, { recursive:true });
const html = readFileSync(resolve(root, 'provider.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const source = readFileSync(resolve(root, 'client-import.js'), 'utf8');
const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
const errors = [];
const unexpected = [];
const mime = { '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webp':'image/webp', '.woff2':'font/woff2' };
const organizationId = '11111111-1111-4111-8111-111111111111';
const batchId = '22222222-2222-4222-8222-222222222222';

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ bypassCSP:true, serviceWorkers:'block', viewport:{ width, height:900 }, acceptDownloads:false });
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://provider-transfer.test' || route.request().method() !== 'GET') {
        unexpected.push(`${route.request().method()} ${url.href}`);
        return route.abort();
      }
      if (url.pathname.endsWith('/provider.html')) return route.fulfill({ contentType:'text/html', body:html });
      const relative = decodeURIComponent(url.pathname.replace('/minuta-online-booking/', ''));
      if (relative.includes('..')) return route.abort();
      try {
        return route.fulfill({ contentType:mime[extname(relative)] || 'application/octet-stream', body:readFileSync(resolve(root, relative)) });
      } catch { return route.abort(); }
    });
    await page.goto('https://provider-transfer.test/minuta-online-booking/provider.html', { waitUntil:'networkidle' });
    await page.evaluate(() => {
      document.documentElement.classList.remove('provider-booting');
      document.documentElement.classList.add('top-level');
      document.querySelector('#providerBoot')?.remove();
      document.body.dataset.providerTheme = 'midnight';
      document.body.dataset.providerLayout = 'bento';
      document.querySelector('#authCard').hidden = true;
      document.querySelector('#dashboard').hidden = false;
      document.querySelectorAll('[data-provider-panel]').forEach(panel => {
        panel.hidden = panel.dataset.providerPanel !== 'clients';
        panel.classList.toggle('active', !panel.hidden);
      });
      document.querySelector('#clientImportPanel').open = true;
    });
    await page.addScriptTag({ content:source });
    await page.evaluate(async ({ organizationId, batchId }) => {
      window.transferCalls = [];
      window.transferNotices = [];
      window.transferDownloads = [];
      window.transferBatchStatus = 'applied';
      window.confirm = () => true;
      URL.createObjectURL = () => 'blob:provider-transfer-test';
      URL.revokeObjectURL = () => {};
      HTMLAnchorElement.prototype.click = function click() {
        transferDownloads.push({ filename:this.download, href:this.href });
      };
      const db = { rpc:async (name, args) => {
        transferCalls.push({ name, args:structuredClone(args) });
        if (name === 'get_minuta_imported_clients') return { data:{
          organization_id:organizationId, current_role:'owner', can_import:true,
          clients:[{ name:'Ирина', display_phone:'+7 900 000-00-00', phone:'79000000000' }],
          recent_batches:[], has_more:false
        }, error:null };
        if (name === 'get_minuta_imported_booking_history') return { data:{ rows:[],has_more:false,summary:null },error:null };
        if (name === 'get_minuta_provider_transfer_journal_v144') return { data:{ batches:[{
          batch_id:batchId, transfer_kind:'clients', input_count:3, status:transferBatchStatus,
          created_at:'2026-09-11T10:00:00Z'
        }] },error:null };
        if (name === 'export_minuta_provider_transfer_data_v144') return { data:{
          kind:'clients', exported_at:'2026-09-11T10:00:00Z', dataset_revision:'a'.repeat(64), has_more:false, next_offset:null,
          rows:[{ name:'Ирина',display_phone:'+7 900 000-00-00',email:'',birthday:null,note:'',source_system:'other',external_id:'',visit_count:1,total_spent_rub:1200,last_visit_on:'2026-09-10',marketing_consent:false,personal_data_consent:true }]
        },error:null };
        if (name === 'rollback_minuta_provider_transfer_v144') {
          transferBatchStatus = 'rolled_back';
          return { data:{ batch_id:batchId,status:'rolled_back',idempotent:false },error:null };
        }
        return { data:null,error:{ code:'PGRST202' } };
      } };
      window.clientImportController = MinutaClientImport.createController({
        db,
        $:selector => document.querySelector(selector),
        escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
        notify:value => transferNotices.push(value),
        requireWrites:() => true,
        onLoaded:() => {},
        getExistingPhones:() => []
      });
      clientImportController.bind();
      clientImportController.setOrganization({ id:organizationId,current_role:'owner' });
    }, { organizationId, batchId });

    await page.locator('#clientTransferTools').waitFor({ state:'visible' });
    await page.locator('#clientTransferTools').evaluate(element => { element.open = true; });
    assert.match(await page.locator('#clientTransferRollbackTitle').innerText(), /3 строк/);
    assert.equal(await page.locator('#clientTransferExport').isVisible(), true);
    if (width === 390) {
      const directExport = await page.evaluate(async () => {
        try { await clientImportController.exportData('csv', 'clients'); return { ok:true }; }
        catch (error) { return { ok:false,message:error?.message,stack:error?.stack }; }
      });
      assert.equal(directExport.ok, true, JSON.stringify(directExport));
      await page.waitForTimeout(100);
      const transferDebug = await page.evaluate(() => ({ downloads:transferDownloads, notices:transferNotices }));
      assert.equal(transferDebug.downloads.length, 1, JSON.stringify(transferDebug));
      const download = await page.evaluate(() => transferDownloads[0]);
      assert.match(download.filename, /^primetime-pro-clients-2026-09-11\.csv$/);
      assert.equal(await page.evaluate(() => transferCalls.filter(item => item.name === 'export_minuta_provider_transfer_data_v144').length), 1);
      await page.evaluate(() => { transferDownloads.length = 0; });
      await page.locator('#clientTransferExportButton').click();
      await page.waitForFunction(() => transferDownloads.length === 1);
      assert.equal(await page.evaluate(() => transferCalls.filter(item => item.name === 'export_minuta_provider_transfer_data_v144').length), 2);
      await page.locator('#clientTransferRollbackButton').click();
      await page.waitForFunction(() => transferBatchStatus === 'rolled_back');
      await page.waitForFunction(() => document.querySelector('#clientTransferRollback')?.hidden === true);
      assert.match(await page.locator('#clientTransferState').innerText(), /отменён/i);
    }
    const layout = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth - document.documentElement.clientWidth,
      buttonHeights:[...document.querySelectorAll('#clientTransferTools button')]
        .map(item => item.getBoundingClientRect()).filter(rect => rect.width > 0).map(rect => rect.height)
    }));
    assert.ok(layout.overflow <= 1, `${width}: horizontal overflow ${layout.overflow}`);
    if (width <= 760) assert.ok(layout.buttonHeights.every(height => height >= 44), `${width}: transfer buttons must be at least 44px`);
    await page.screenshot({ path:resolve(output, `${width}.png`), fullPage:true });
    await page.close();
  }
} finally {
  await browser.close();
}

assert.deepEqual(errors, []);
assert.deepEqual(unexpected, []);
console.log('PrimeTime Pro data transfer browser checks passed at 390, 760 and 1440');
