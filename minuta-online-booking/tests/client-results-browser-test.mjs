import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const source = read('client-results.js');
const css = read('client-results.css');
const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright';
const playwright = await import(modulePath);
const chromium = playwright.chromium || playwright.default?.chromium;
assert.ok(chromium, 'Playwright Chromium is unavailable');

assert.match(source, /get_minuta_client_results_v120/);
assert.match(source, /get_minuta_client_result_v120/);
assert.match(source, /save_minuta_client_result_v120/);
assert.match(source, /p_request:\s*pendingSubmit\.request/);
assert.match(source, /create_minuta_client_result_media_v120/);
assert.match(source, /complete_minuta_client_result_media_v120/);
assert.match(source, /maxlength="\$\{MAX_TEXT\}"/);
assert.match(source, /storage\.from\(BUCKET\)\.download/);
assert.match(source, /URL\.revokeObjectURL/);
assert.doesNotMatch(source, /create_minuta_client_record/);
assert.match(css, /repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css, /@media \(max-width:760px\)/);
assert.match(css, /@media \(max-width:520px\)/);
assert.match(css, /data-client-results-visit-active="false"/);

const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const RESULT_ID = '00000000-0120-4000-8000-000000000001';
const BOOKING_ID = '00000000-0120-4000-8000-000000000002';
const MEDIA_ID = '00000000-0120-4000-8000-000000000003';
const ORGANIZATION_ID = '00000000-0120-4000-8000-000000000004';

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.setContent(`<!doctype html><html><body class="provider-body" data-provider-theme="noir">
    <main class="client-profile"><div id="clientProfileContent">
      <section id="clientFavoriteServices"></section>
      <details class="client-disclosure client-preferences-disclosure"><summary><span>Предпочтения и метки</span></summary></details>
    </div></main>
    <form class="booking-outcome-form" id="bookingOutcomeForm" data-booking-id="${BOOKING_ID}">
      <label>Результат визита<select><option>Состоялся</option></select></label>
      <button class="primary" type="submit">Сохранить результат</button>
    </form>
  </body></html>`);
  await page.addStyleTag({ content: `
    *{box-sizing:border-box}html,body{margin:0;max-width:100%;background:#0f1e2f;color:#f4f7fb;--theme-surface:#0f1e2f;--theme-surface-alt:#182a40;--theme-ink:#f4f7fb;--theme-muted:#aeb9c8;--theme-line:#5e7189;--theme-accent:#4c91c2;--theme-accent-contrast:#fff}
    .client-profile{width:min(720px,100%);margin:0 auto;padding:16px;min-width:0}.client-disclosure{border-top:1px solid var(--theme-line)}.client-disclosure>summary{min-height:56px;padding:12px 0;cursor:pointer}.booking-outcome-form{width:min(680px,100%);margin:20px auto;padding:16px;min-width:0}.booking-outcome-form>.primary{width:100%;min-height:44px;margin-top:14px}
  ${css}` });
  await page.addScriptTag({ content: source });
  await page.evaluate(({ resultId, bookingId, mediaId, organizationId }) => {
    const privateResult = {
      id: resultId,
      booking_id: bookingId,
      visit_at: '2026-09-04T10:00:00+04:00',
      service_label: 'Очень длинное название услуги без риска горизонтального переполнения',
      before_session: 'Напряжение перед началом',
      work_done: 'Мягкая работа со спиной и плечевым поясом',
      after_session: 'Стало легче',
      recommendations: `ДлиннаяРекомендацияБезПробелов_${'очень'.repeat(70)}`,
      private_storage_consent: true,
      external_share_consent: false,
      media: []
    };
    const privateMedia = { result_id: resultId, id: mediaId, purpose: 'before', mime_type: 'image/webp', byte_size: 12, object_path: `${organizationId}/${mediaId}.webp` };
    window.__privateResult = privateResult;
    window.__rpcCalls = [];
    window.__storageDownloads = 0;
    window.__storageUploads = 0;
    window.__revoked = [];
    window.__failNextSave = false;
    let uuidCounter = 100;
    Object.defineProperty(window.crypto, 'randomUUID', { configurable: true, value: () => `00000000-0120-4000-8000-${String(++uuidCounter).padStart(12, '0')}` });
    URL.createObjectURL = () => 'blob:private-result-preview';
    URL.revokeObjectURL = value => window.__revoked.push(value);
    window.createImageBitmap = async () => ({ width: 20, height: 20, close() {} });
    HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    HTMLCanvasElement.prototype.toBlob = function(callback) { callback(new Blob(['private-photo'], { type: 'image/webp' })); };
    const db = {
      rpc: async (name, payload) => {
        window.__rpcCalls.push({ name, payload });
        if (name === 'get_minuta_client_results_v120') return { data: { enabled: true, can_enable: true, entries: [privateResult], media: [privateMedia] }, error: null };
        if (name === 'get_minuta_client_result_v120') return { data: { enabled: true, can_enable: true, entry: privateResult, media: [privateMedia] }, error: null };
        if (name === 'save_minuta_client_result_v120') {
          if (window.__failNextSave) {
            window.__failNextSave = false;
            return { data: null, error: { message: 'temporary_failure' } };
          }
          return { data: { id: payload.p_id, saved: true, private_storage_consent: true,
            external_share_consent: payload.p_external_share_consent }, error: null };
        }
        if (name === 'create_minuta_client_result_media_v120') return { data: { id: payload.p_id, purpose: payload.p_purpose, object_path: `${organizationId}/${payload.p_id}.webp`, ready: false }, error: null };
        if (name === 'complete_minuta_client_result_media_v120') return { data: { id: payload.p_id, ready: true }, error: null };
        if (name === 'set_minuta_client_records_enabled') return { data: { enabled: true }, error: null };
        return { data: null, error: { code: 'PGRST202', message: `unknown rpc ${name}` } };
      },
      storage: { from: bucket => {
        if (bucket !== 'minuta-client-records') throw new Error(`wrong bucket ${bucket}`);
        return {
          download: async () => { window.__storageDownloads += 1; return { data: new Blob(['private-photo'], { type: 'image/webp' }), error: null }; },
          upload: async () => { window.__storageUploads += 1; return { data: {}, error: null }; }
        };
      } }
    };
    window.__controller = window.MinutaClientResults.createController({
      db,
      getContext: () => ({ userId: 'user-1', sessionGeneration: 1 }),
      requireWrites: () => true,
      notify: value => { window.__notice = value; },
      openBooking: value => { window.__openedBooking = value; }
    });
    window.__controller.setOrganization({ id: organizationId });
    window.__controller.setClient({ phone: '+7 999 000-00-00' });
    window.__controller.mount({
      form: document.querySelector('#bookingOutcomeForm'),
      booking: { id: bookingId, client_phone: '+7 999 000-00-00' },
      result: privateResult
    });
  }, { resultId: RESULT_ID, bookingId: BOOKING_ID, mediaId: MEDIA_ID, organizationId: ORGANIZATION_ID });

  await page.waitForFunction(() => document.querySelector('#clientResultsSummary')?.textContent.includes('Последний'));
  assert.equal(await page.locator('#clientResultsList').innerText(), '', 'Private text is not rendered while profile block is collapsed');
  assert.equal(await page.evaluate(() => window.__storageDownloads), 0, 'Private media is not downloaded during profile load');
  assert.equal(await page.locator('[name="client_result_external_consent"]').isChecked(), false, 'External sharing is opt-in');
  assert.equal(await page.locator('[name="client_result_private_consent"]').isChecked(), true, 'Existing private consent is restored');
  await page.locator('#bookingOutcomeForm').evaluate(form => { form.dataset.clientResultsVisitActive = 'false'; });
  assert.equal(await page.locator('#bookingVisitResultFields').evaluate(element => getComputedStyle(element).display), 'none', 'Editor stays hidden for a non-visit outcome');
  await page.locator('#bookingOutcomeForm').evaluate(form => { form.dataset.clientResultsVisitActive = 'true'; });

  const disabledMarkup = await page.evaluate(() => window.MinutaClientResults.bookingFieldsMarkup({ enabled: false, can_enable: true }));
  assert.match(disabledMarkup, /Подключить/);
  assert.doesNotMatch(disabledMarkup, /client_result_before_session/);
  const missingAfterMarkup = await page.evaluate(mediaId => window.MinutaClientResults.bookingFieldsMarkup({ enabled: true, result: {
    id: '00000000-0120-4000-8000-000000000010', private_storage_consent: true,
    media: [{ id: mediaId, purpose: 'before', object_path: `org/${mediaId}.webp` }]
  } }), MEDIA_ID);
  assert.match(missingAfterMarkup, /data-visit-result-media-input="after"/);
  assert.match(missingAfterMarkup, /Добавить фото после/);
  assert.doesNotMatch(missingAfterMarkup, /data-visit-result-media-input="before"/);
  assert.doesNotMatch(missingAfterMarkup, /Заменить/);

  await page.locator('#clientResultsDisclosure>summary').click();
  await page.waitForFunction(() => document.querySelector('#clientResultsList')?.textContent.includes('Напряжение перед началом'));
  assert.equal(await page.evaluate(() => window.__storageDownloads), 0, 'Opening text results still does not download photos');

  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const metrics = await page.evaluate(() => {
      const selectors = ['#clientResultsDisclosure', '.client-result-card', '.client-result-grid', '.client-result-field', '#bookingVisitResultFields', '.booking-visit-result-grid', '.booking-visit-result-field', '.booking-visit-result-field textarea'];
      const boxes = selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => {
        const box = element.getBoundingClientRect();
        return { selector, left: box.left, right: box.right, width: box.width };
      }));
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        boxes,
        resultColumns: getComputedStyle(document.querySelector('.client-result-grid')).gridTemplateColumns,
        editorColumns: getComputedStyle(document.querySelector('.booking-visit-result-grid')).gridTemplateColumns
      };
    });
    assert.ok(metrics.scrollWidth <= metrics.clientWidth, `${width}px has no document-level horizontal overflow`);
    metrics.boxes.forEach(box => {
      assert.ok(box.left >= -0.5 && box.right <= metrics.clientWidth + 0.5, `${box.selector} stays inside ${width}px`);
    });
    if (width <= 760) {
      assert.equal(metrics.resultColumns.split(' ').length, 1, `${width}px result fields use one column`);
      assert.equal(metrics.editorColumns.split(' ').length, 1, `${width}px editor uses one column`);
    } else {
      assert.equal(metrics.resultColumns.split(' ').length, 2, 'Desktop result fields use two columns');
      assert.equal(metrics.editorColumns.split(' ').length, 2, 'Desktop editor uses two columns');
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-client-result-preview]').first().click();
  await page.waitForFunction(() => document.querySelector('#clientResultPreviewDialog img')?.src.startsWith('blob:'));
  assert.equal(await page.evaluate(() => window.__storageDownloads), 1, 'Private preview downloads only after explicit click');
  const dialogBox = await page.locator('#clientResultPreviewDialog').evaluate(element => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, width: box.width, viewport: document.documentElement.clientWidth };
  });
  assert.ok(dialogBox.left >= -0.5 && dialogBox.right <= dialogBox.viewport + 0.5, 'Private preview fits 390px');
  await page.locator('[data-client-result-preview-close]').click();
  await page.waitForFunction(() => window.__revoked.length === 1);
  assert.deepEqual(await page.evaluate(() => window.__revoked), ['blob:private-result-preview'], 'Blob URL is revoked on preview close');
  await page.locator('#clientResultsDisclosure>summary').click();
  assert.equal(await page.locator('#clientResultsList').innerText(), '', 'Private result markup is cleared on collapse');

  await page.locator('#bookingVisitResultFields').evaluate(element => { element.open = true; });
  await page.locator('[name="client_result_before_session"]').fill('Обновлённое состояние до сеанса');
  await page.locator('[name="client_result_private_consent"]').uncheck();
  const denied = await page.evaluate(() => window.__controller.save());
  assert.equal(denied.reason, 'private_consent_required', 'Private-storage consent is mandatory when data exists');
  const savesBeforeConsent = await page.evaluate(() => window.__rpcCalls.filter(call => call.name === 'save_minuta_client_result_v120').length);
  assert.equal(savesBeforeConsent, 0, 'No save RPC runs without private-storage consent');

  await page.locator('[name="client_result_private_consent"]').check();
  await page.evaluate(() => { window.__failNextSave = true; });
  const firstSave = await page.evaluate(() => window.__controller.save());
  assert.equal(firstSave.ok, false);
  const secondSave = await page.evaluate(() => window.__controller.save());
  assert.equal(secondSave.ok, true);
  const requests = await page.evaluate(() => window.__rpcCalls.filter(call => call.name === 'save_minuta_client_result_v120').slice(-2).map(call => call.payload.p_request));
  assert.equal(requests[0], requests[1], 'Lost/failed save retries reuse the same request UUID');

  await page.locator('#bookingVisitResultFields>summary').click();
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 1]);
  await page.locator('[data-visit-result-media-input="after"]').setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => document.querySelector('[data-client-result-save-status]')?.textContent.includes('подготовлено'));
  const uploadSave = await page.evaluate(() => window.__controller.save());
  assert.equal(uploadSave.ok, true, 'A missing after photo can be added later');
  assert.equal(await page.evaluate(() => window.__storageUploads), 1, 'Prepared photo uploads to the private v112 bucket once');
  const mediaRpcNames = await page.evaluate(() => window.__rpcCalls.map(call => call.name));
  assert.ok(mediaRpcNames.includes('create_minuta_client_result_media_v120'));
  assert.ok(mediaRpcNames.includes('complete_minuta_client_result_media_v120'));
  const createPayload = await page.evaluate(() => window.__rpcCalls.findLast(call => call.name === 'create_minuta_client_result_media_v120').payload);
  assert.equal(createPayload.p_booking, undefined, 'Media RPC receives no unsupported p_booking parameter');

  await page.evaluate(() => window.__controller.setClient({ phone: '+7 999 111-22-33' }));
  assert.ok((await page.evaluate(() => window.__revoked.length)) >= 1, 'Changing client clears any private preview URL');

  console.log('Client results: private profile/editor/media 390/760/1440 PASS (browser fixture)');
} finally {
  await browser.close();
}
