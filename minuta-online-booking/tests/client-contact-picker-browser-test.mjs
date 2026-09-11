import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const source = readFileSync(new URL('../client-import.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<!doctype html><html lang="ru"><body>
    <section id="clientImportPanel" hidden>
      <button id="clientContactsImport" type="button">Из телефонной книги</button>
      <span id="clientImportHistory"></span>
      <input id="clientImportFile" type="file">
      <div id="clientImportMapping" hidden><select id="clientImportNameColumn"></select><select id="clientImportPhoneColumn"></select><button id="clientImportApplyMapping" type="button"></button></div>
      <form id="clientImportForm"><div id="clientImportPreview" hidden><p id="clientImportPreviewSummary"></p><ul id="clientImportPreviewList"></ul><button id="clientImportSubmit" type="submit">Импортировать</button></div></form>
    </section>
  </body></html>`);
  await page.evaluate(() => {
    window.contactState = { pickerCalls:0, rpcCalls:[], notices:[] };
    Object.defineProperty(navigator, 'contacts', { configurable:true, value:{
      getProperties:async () => ['name','tel'],
      select:async (properties, options) => {
        contactState.pickerCalls += 1;
        contactState.properties = properties;
        contactState.options = options;
        return [
          { name:['Уже импортирован'], tel:['+7 900 000-00-01'] },
          { name:['Уже в журнале'], tel:['8 (900) 000-00-02'] },
          { name:['Новый клиент'], tel:['без номера', '+7 900 000-00-03'] },
          { name:[], tel:['+7 900 000-00-04'] }
        ];
      }
    } });
  });
  await page.addScriptTag({ content:source });
  await page.evaluate(async () => {
    const db = { rpc:async (name, args) => {
      contactState.rpcCalls.push({ name, args });
      if (name === 'get_minuta_imported_clients') return { data:{ can_import:true, clients:[{ phone:'79000000001' }], recent_batches:[], has_more:false }, error:null };
      if (name === 'get_minuta_imported_booking_history') return { data:{ rows:[], summary:null, has_more:false }, error:null };
      if (name === 'get_minuta_provider_transfer_journal_v144') return { data:null, error:{ code:'PGRST202',message:'not installed' } };
      if (name === 'preview_minuta_provider_transfer_v144') return { data:null, error:{ code:'PGRST202',message:'not installed' } };
      if (name === 'import_minuta_clients') return { data:{ created_count:1, updated_count:0 }, error:null };
      throw new Error(`Unexpected RPC: ${name}`);
    } };
    window.controller = MinutaClientImport.createController({
      db,
      $:selector => document.querySelector(selector),
      escapeHtml:value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]),
      notify:message => contactState.notices.push(message), requireWrites:() => true,
      getExistingPhones:() => ['79000000002'], onLoaded:() => {}
    });
    controller.bind();
    controller.setOrganization({ id:'organization-a' });
  });
  await page.waitForFunction(() => document.querySelector('#clientImportPanel').hidden === false);
  assert.equal(await page.evaluate(() => contactState.pickerCalls), 0, 'Picker must not open before a user click');
  await page.click('#clientContactsImport');
  await page.waitForFunction(() => document.querySelector('#clientImportPreview').hidden === false);
  assert.equal(await page.evaluate(() => contactState.pickerCalls), 1);
  assert.deepEqual(await page.evaluate(() => contactState.properties), ['name','tel']);
  assert.equal(await page.evaluate(() => contactState.options.multiple), true);
  assert.match(await page.locator('#clientImportPreviewSummary').innerText(), /1 клиентов готово · пропущено контактов: 3/);
  assert.match(await page.locator('#clientImportPreviewList').innerText(), /Новый клиент/);
  assert.match(await page.locator('#clientImportPreviewList').innerText(), /\+7 900 000-00-03/);
  assert.equal(await page.evaluate(() => contactState.rpcCalls.filter(call => call.name === 'import_minuta_clients').length), 0, 'Preview must require a separate confirmation');
  await page.click('#clientImportSubmit');
  await page.waitForFunction(() => contactState.rpcCalls.some(call => call.name === 'import_minuta_clients'));
  const write = await page.evaluate(() => contactState.rpcCalls.find(call => call.name === 'import_minuta_clients'));
  assert.equal(write.args.p_organization, 'organization-a');
  assert.equal(write.args.p_rows.length, 1);
  assert.equal(write.args.p_rows[0].phone, '79000000003');
  assert.equal(write.args.p_rows[0].marketing_consent, null);
  assert.equal(write.args.p_rows[0].personal_data_consent, null);
  assert.deepEqual(errors, []);
  await page.close();
  console.log('Contact Picker: explicit click, preview, full CRM dedupe, consent safety and confirmed import PASS');
} finally {
  await browser.close();
}
