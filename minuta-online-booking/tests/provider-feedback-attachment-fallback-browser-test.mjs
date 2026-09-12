import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
assert.ok(chromium, 'Playwright Chromium is available');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../provider-feedback.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const dialogStart = html.indexOf('<dialog class="product-feedback-dialog"');
const dialogEnd = html.indexOf('</dialog>', dialogStart) + '</dialog>'.length;
assert.ok(dialogStart >= 0 && dialogEnd > dialogStart, 'feedback dialog fixture');
const dialog = html.slice(dialogStart, dialogEnd);

const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:390, height:844 } });

async function setup(mode) {
  await page.setContent(`<!doctype html><html lang="ru"><head><link href="https://fixture.invalid/styles.css?v=test"></head><body><button id="open" data-open-product-feedback hidden>Обратная связь</button>${dialog}</body></html>`);
  await page.addStyleTag({ content:styles });
  await page.addScriptTag({ content:source });
  await page.evaluate(testMode => {
    window.MINUTA_CONFIG = { supabaseUrl:'https://fixture.invalid', supabaseKey:'fixture' };
    window.effects = { uploads:[], removes:[], creates:[], notices:[] };
    const storage = {
      from:() => ({
        upload:async (path, blob, options) => {
          effects.uploads.push({ path, size:blob.size, type:blob.type, options });
          return testMode === 'upload-fails'
            ? { data:null, error:{ statusCode:'403', message:'bucket unavailable' } }
            : { data:{ path }, error:null };
        },
        remove:async paths => { effects.removes.push(paths); return { data:paths, error:null }; }
      })
    };
    const db = {
      storage,
      rpc:async (name, payload) => {
        if (name === 'get_minuta_feedback_capability') return { data:true, error:null };
        effects.creates.push(payload);
        if (testMode === 'create-rejects') return { data:null, error:{ code:'22023', message:'invalid_feedback' } };
        if (testMode === 'unconfirmed') return { data:null, error:null };
        if (testMode === 'slow') return new Promise(resolve => { window.finishFeedback = () => resolve({ data:{ request_number:22 }, error:null }); });
        return { data:{ request_number:21 }, error:null };
      }
    };
    window.controller = MinutaProviderFeedback.createController({
      db,
      $:selector => document.querySelector(selector),
      notify:message => effects.notices.push(message),
      requireWrites:() => true,
      getCurrentUser:() => ({ id:'00000000-0000-4000-8000-000000000001' }),
      getOrganization:() => ({ id:'00000000-0000-4000-8000-000000000002' })
    });
    controller.bind();
    return controller.refreshAvailability();
  }, mode);
  await page.locator('#open').click();
  await page.locator('#productFeedbackMessage').fill('Проверка отправки обращения с изображением.');
}

async function attachAndSubmit() {
  await page.locator('#productFeedbackScreenshot').setInputFiles(fileURLToPath(new URL('../provider-icon-192.png', import.meta.url)));
  await page.locator('#productFeedbackForm').evaluate(form => form.requestSubmit());
}

try {
  await setup('upload-fails');
  await attachAndSubmit();
  await page.locator('#productFeedbackSuccess').waitFor({ state:'visible' });
  let effects = await page.evaluate(() => window.effects);
  assert.equal(effects.uploads.length, 1);
  assert.equal(effects.creates.length, 1);
  assert.equal(effects.creates[0].p_screenshot_path, null);
  assert.deepEqual(effects.removes, []);
  assert.deepEqual(effects.notices, ['Сообщение отправлено без снимка']);
  assert.match(await page.locator('#productFeedbackAttachmentNotice').innerText(), /текст обращения уже получен/i);
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    const geometry = await page.locator('#productFeedbackDialog').evaluate(node => ({
      left:node.getBoundingClientRect().left,
      right:node.getBoundingClientRect().right,
      viewport:innerWidth,
      overflow:document.documentElement.scrollWidth > innerWidth + 2
    }));
    assert.equal(geometry.overflow, false, `${width}px page must not overflow`);
    assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewport + 1, `${width}px dialog must stay in viewport`);
    if (process.env.MINUTA_FEEDBACK_SCREENSHOT) await page.screenshot({ path:`${process.env.MINUTA_FEEDBACK_SCREENSHOT}-${width}.png`, fullPage:true });
  }

  await setup('create-rejects');
  await attachAndSubmit();
  await page.locator('#productFeedbackError').waitFor({ state:'visible' });
  effects = await page.evaluate(() => window.effects);
  assert.equal(effects.creates.length, 1);
  assert.equal(effects.removes.length, 1, 'definitive rejection cleans the uploaded image');
  assert.match(await page.locator('#productFeedbackError').innerText(), /сервер отклонил данные/i);

  await setup('unconfirmed');
  await attachAndSubmit();
  await page.locator('#productFeedbackError').waitFor({ state:'visible' });
  effects = await page.evaluate(() => window.effects);
  assert.equal(effects.removes.length, 0, 'unknown create result must not delete a possibly linked image');
  assert.equal(await page.locator('#productFeedbackSubmit').isDisabled(), true);
  assert.match(await page.locator('#productFeedbackError').innerText(), /не отправляйте сообщение повторно/i);

  await setup('slow');
  await page.locator('#productFeedbackForm').evaluate(form => {
    form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
    form.dispatchEvent(new Event('submit', { bubbles:true, cancelable:true }));
  });
  await page.waitForTimeout(20);
  effects = await page.evaluate(() => window.effects);
  assert.equal(effects.creates.length, 1, 'double submit must create one request');
  await page.evaluate(() => window.finishFeedback());
  await page.locator('#productFeedbackSuccess').waitFor({ state:'visible' });
  assert.equal(await page.locator('#productFeedbackRequestNumber').innerText(), '22');

  console.log('Provider feedback attachment fallback, acknowledgement and responsive checks passed.');
} finally {
  await browser.close();
}
