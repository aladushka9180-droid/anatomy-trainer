import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const playwright = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const chromium = playwright.chromium || playwright.default?.chromium;
assert.ok(chromium, 'Playwright Chromium is available');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../provider-feedback-inbox.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const panelStart = html.indexOf('<section class="provider-view feedback-inbox-view"');
const panelEnd = html.indexOf('</section>', panelStart) + '</section>'.length;
assert.ok(panelStart >= 0 && panelEnd > panelStart, 'feedback inbox panel fixture');
const panel = html.slice(panelStart, panelEnd).replace(' hidden>', '>');

const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({ viewport:{ width:390, height:844 } });
try {
  await page.setContent(`<!doctype html><html lang="ru"><body class="provider-body"><main id="dashboard" data-active-view="feedback-inbox">${panel}</main></body></html>`);
  await page.addStyleTag({ content:styles });
  await page.addScriptTag({ content:source });
  await page.evaluate(async () => {
    window.effects = { calls:[], notices:[] };
    const rows = [
      { id:'00000000-0000-4000-8000-000000000001',request_number:2,kind:'problem',message:'Не отправляется сообщение со снимком экрана.',expected_result:'Сообщение должно отправиться.',page_path:'/provider.html',client_version:'704',device_summary:'mobile; Android; 390x844',has_screenshot:false,status:'new',created_at:'2026-09-12T03:22:00Z',updated_at:'2026-09-12T03:22:00Z' },
      { id:'00000000-0000-4000-8000-000000000002',request_number:1,kind:'suggestion',message:'Добавить быстрый просмотр обращений.',expected_result:null,page_path:'/provider.html',client_version:'703',device_summary:'desktop; Win32; 1440x900',has_screenshot:true,status:'resolved',created_at:'2026-09-11T12:00:00Z',updated_at:'2026-09-12T02:00:00Z' }
    ];
    const db = { rpc:async (name, payload) => {
      effects.calls.push({ name, payload });
      if (name === 'get_minuta_feedback_inbox_v146') return { data:{ can_manage:true,items:rows },error:null };
      const row = rows.find(item => item.id === payload.p_feedback);
      row.status = payload.p_status;
      return { data:{ request_number:row.request_number,status:row.status,updated_at:new Date().toISOString() },error:null };
    } };
    window.controller = MinutaFeedbackInbox.createController({
      db,
      $:selector => document.querySelector(selector),
      notify:message => effects.notices.push(message),
      getCurrentUser:() => ({ id:'user' }),
      getOrganization:() => ({ id:'00000000-0000-4000-8000-000000000010' })
    });
    controller.bind();
    await controller.load();
  });

  assert.equal(await page.locator('.feedback-inbox-card').count(), 2);
  assert.match(await page.locator('.feedback-inbox-card').first().innerText(), /№2/);
  assert.match(await page.locator('.feedback-inbox-card').first().innerText(), /Не отправляется сообщение/);
  await page.locator('[data-feedback-inbox-filter="active"]').click();
  assert.equal(await page.locator('.feedback-inbox-card').count(), 1);
  await page.locator('[data-feedback-status]').selectOption('in_review');
  await page.waitForFunction(() => effects.calls.some(call => call.name === 'set_minuta_feedback_status_v146'));
  assert.deepEqual(await page.evaluate(() => effects.notices), ['Статус обращения обновлён']);

  await page.locator('[data-feedback-inbox-filter="all"]').click();
  for (const width of [390, 760, 1440]) {
    await page.setViewportSize({ width, height:900 });
    const geometry = await page.evaluate(() => ({
      overflow:document.documentElement.scrollWidth > innerWidth + 2,
      cards:[...document.querySelectorAll('.feedback-inbox-card')].map(card => ({ left:card.getBoundingClientRect().left,right:card.getBoundingClientRect().right }))
    }));
    assert.equal(geometry.overflow, false, `${width}px page must not overflow`);
    assert.ok(geometry.cards.every(card => card.left >= -1 && card.right <= width + 1), `${width}px cards stay in viewport`);
    if (process.env.MINUTA_FEEDBACK_INBOX_SCREENSHOT) {
      await page.screenshot({ path:`${process.env.MINUTA_FEEDBACK_INBOX_SCREENSHOT}-${width}.png`, fullPage:true });
    }
  }

  assert.deepEqual(await page.evaluate(() => effects.calls.map(call => call.name)), [
    'get_minuta_feedback_inbox_v146',
    'set_minuta_feedback_status_v146'
  ]);
  console.log('Feedback inbox v146 rendering, filters, status update and responsive checks passed.');
} finally {
  await browser.close();
}
