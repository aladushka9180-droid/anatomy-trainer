import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFixture as startDetailFixture } from './booking-detail-card-fixture.mjs';
import { startFixture as startNewFixture } from './new-booking-card-fixture.mjs';

const { chromium } = await import(process.env.MINUTA_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.MINUTA_PLAYWRIGHT_MODULE).href : 'playwright');
const matrix = readFileSync(new URL('../provider-porcelain-matrix.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true });
const outputDir = process.env.MINUTA_X15_BOOKING_SCREENSHOTS;
if (outputDir) mkdirSync(outputDir, { recursive:true });
const rgb = hex => `rgb(${hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16)).join(', ')})`;
const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
  channel /= 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const contrast = (a, b) => { const pair = [luminance(a), luminance(b)].sort((x, y) => y - x); return (pair[0] + .05) / (pair[1] + .05); };
const servers = [];

try {
  for (const [kind, start] of [['detail', startDetailFixture], ['new', startNewFixture]]) {
    const { server, url } = await start();
    servers.push(server);
    for (const width of [390, 760, 1440]) {
      const page = await browser.newPage({ viewport:{ width, height:950 }, reducedMotion:'reduce' });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
      await page.goto(url);
      await page.addStyleTag({ content:'*,*::before,*::after{animation:none!important;transition:none!important}' });
      if (kind === 'detail') {
        await page.locator('#bookingSheet.booking-sheet-reference [data-repeat-booking]').waitFor();
        assert.ok((await page.locator('[data-repeat-booking]').getAttribute('class')).includes('primary'), 'real detail renderer promotes repeat action');
      } else {
        await page.waitForFunction(() => window.fixtureReady || window.fixtureError);
        assert.equal(await page.evaluate(() => window.fixtureError), undefined);
        await page.locator('#newBookingName').fill('Ан');
        await page.locator('[data-new-booking-client]').click();
        await page.locator('[data-new-booking-time="10:30"]').click();
        await page.locator('#newBookingServiceOpen').click();
        await page.locator('[data-pick-new-booking-service="s2"]').click();
        await page.locator('[data-new-booking-time="11:00"]').click();
        assert.equal(await page.locator('#newBookingSubmit').isEnabled(), true, 'selection enables submit without creating a booking');
      }
      await page.addScriptTag({ content:matrix });
      const selectors = kind === 'detail'
        ? ['#bookingSheet .booking-repeat-actions [data-repeat-booking]']
        : ['#bookingSheet.new-booking-card #newBookingSubmit', '#bookingSheet.new-booking-card .booking-time-slots button.active'];
      for (const character of ['pearl', 'petal', 'silk']) {
        for (const shade of ['pearl-white', 'porcelain-white', 'gentle-pink', 'petal-pink', 'pink-accent']) {
          const palette = await page.evaluate(({ character, shade }) => {
            const palette = MinutaProviderPorcelainMatrix.paletteFor(character, shade);
            document.body.dataset.providerTheme = 'pink-porcelain';
            document.body.dataset.providerPorcelainCharacter = character;
            for (const [name, value] of Object.entries({
              '--theme-accent':palette.accent, '--theme-line':palette.line, '--theme-accent-soft':palette.accentSoft,
              '--theme-surface':palette.surface, '--theme-surface-alt':palette.surfaceAlt,
              '--porcelain-action-bg':palette.actionBg, '--porcelain-action-ink':palette.actionInk
            })) document.body.style.setProperty(name, value);
            return palette;
          }, { character, shade });
          for (const selector of selectors) {
            const actual = await page.locator(selector).evaluate(element => ({
              background:getComputedStyle(element).backgroundColor, color:getComputedStyle(element).color,
              width:element.getBoundingClientRect().width, height:element.getBoundingClientRect().height
            }));
            assert.equal(actual.background, rgb(palette.actionBg), `${kind} ${width} ${character}/${shade} ${selector} fill`);
            assert.equal(actual.color, rgb(palette.actionInk), `${kind} ${width} ${character}/${shade} ${selector} ink`);
            assert.ok(contrast(actual.color, actual.background) >= 4.5 && actual.width >= 44 && actual.height >= 44, `${selector} contrast and target`);
          }
          if (kind === 'new') {
            const marker = await page.locator('#bookingSheet.new-booking-card .new-booking-mode-toggle button.active').evaluate(element => getComputedStyle(element, '::after').backgroundColor);
            assert.notEqual(marker, rgb(palette.accent), 'selected mode line uses a quiet mark');
            assert.ok(contrast(marker, rgb(palette.surface)) >= 2.5, 'selected mode line remains visible');
          }
          if (outputDir && character === 'petal' && shade === 'gentle-pink') {
            await page.locator('#bookingSheet .booking-sheet-panel').screenshot({ path:path.join(outputDir, `${kind}-${width}.png`) });
          }
        }
      }
      assert.ok(await page.locator('#bookingSheet .booking-sheet-panel').evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${kind} ${width} horizontal overflow`);
      assert.deepEqual(errors, [], `${kind} ${width} browser errors`);
      console.log(`X15 ${kind} ${width}px: real renderer/CSS, 15 palettes, no business submit PASS`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
}
