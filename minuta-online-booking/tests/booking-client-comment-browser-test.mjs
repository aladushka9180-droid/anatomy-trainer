import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { themes } from './theme-card-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(join(root, 'provider.js'), 'utf8');
assert.match(source, /function bookingVisitComment\(item\)/u);
assert.match(source, /visitComment \? `<section class="booking-sheet-disclosure booking-visit-comment"/u);
assert.match(source, /escapeHtml\(visitComment\)/u);
assert.match(source, /booking_source,provider_note,created_by_user_id/u);
const commentFunction = source.match(/function bookingVisitComment\(item\) \{[\s\S]*?\n\}/u)?.[0];
assert.ok(commentFunction);
const bookingVisitComment = new Function('isScheduleBlock', 'bookingNotes', `return (${commentFunction})`)(
  () => false,
  new Map(),
);
assert.equal(bookingVisitComment({ id: 'empty', provider_note: '' }), '');
assert.equal(bookingVisitComment({ id: 'filled', provider_note: 'Нужен пандус' }), 'Нужен пандус');
const styles = [
  'styles.css', 'provider-theme-loft-modern.css', 'provider-themes-signature.css',
  'provider-themes-calm.css', 'provider-layout-responsive.css',
  'provider-ux.css', 'provider-theme-families.css',
  'provider-themes-wildlife.css', 'provider-theme-noir-safari.css',
].map(name => readFileSync(join(root, name), 'utf8')).join('\n');
const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href
  : 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
const output = process.env.SCREENSHOT_DIR;
if (output) mkdirSync(output, { recursive: true });
try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><body class="provider-body" data-provider-theme="warm" data-provider-layout="linear"><div class="booking-sheet booking-sheet-detail" id="bookingSheet"><div class="booking-sheet-backdrop"></div><section class="booking-sheet-panel" role="dialog" aria-label="Запись"><div id="bookingSheetContent"><h2>Запись клиента</h2><section class="booking-sheet-disclosure booking-visit-comment"><small>При записи</small><strong>Комментарий клиента</strong><p>${'Нужен свободный проход к кабинету. '.repeat(14)}</p></section></div></section></div></body></html>`);
    for (const theme of themes) {
      const geometry = await page.evaluate(name => {
        document.body.dataset.providerTheme = name;
        const comment = document.querySelector('.booking-visit-comment');
        const box = comment.getBoundingClientRect();
        const style = getComputedStyle(comment);
        return { left: box.left, right: box.right, width: box.width, scroll: document.documentElement.scrollWidth, viewport: innerWidth, background: style.backgroundColor, panelBackground: getComputedStyle(comment.closest('.booking-sheet-panel')).backgroundColor, color: style.color };
      }, theme);
      assert.ok(geometry.left >= 0 && geometry.right <= width + 1, `${theme}/${width}: comment outside viewport`);
      assert.ok(geometry.scroll <= geometry.viewport + 1, `${theme}/${width}: horizontal overflow`);
      assert.ok(geometry.width > 100, `${theme}/${width}: collapsed comment`);
      assert.notEqual(geometry.color, 'rgba(0, 0, 0, 0)', `${theme}/${width}: invisible text`);
    }
    if (output) await page.screenshot({ path: join(output, `booking-client-comment-${width}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log('booking client comment: 40 themes × 390/760/1440 PASS');
