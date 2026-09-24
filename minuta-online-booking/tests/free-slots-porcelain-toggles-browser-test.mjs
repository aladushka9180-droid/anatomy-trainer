import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const html = readFileSync(new URL('../provider.html', import.meta.url), 'utf8');
const start = html.indexOf('<dialog class="free-slots-dialog"');
const dialog = html.slice(start, html.indexOf('</dialog>', start) + 9);
const styles = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const compact = readFileSync(new URL('../free-slots-compact.css', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless:true });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.setContent(`<body class="provider-body" data-provider-theme="pink-porcelain" style="--theme-surface:#fff;--theme-accent:#c43372">${dialog}</body>`);
    await page.addStyleTag({ content:styles });
    await page.addStyleTag({ content:compact });
    await page.evaluate(() => document.querySelector('#freeSlotsDialog').showModal());
    for (const value of ['range', 'general', 'hourly', 'compact']) {
      await page.locator(`#freeSlotsDialog input[value="${value}"]+span`).click();
    }
    const colors = await page.evaluate(() => {
      const style = value => {
        const input = document.querySelector(`#freeSlotsDialog input[value="${value}"]`);
        const css = getComputedStyle(input.nextElementSibling);
        return [css.color, css.fontWeight, css.backgroundColor];
      };
      const panel = document.querySelector('#freeSlotsDialog');
      return {
        unselected:['day', 'service', 'intervals', 'detailed'].map(style),
        selected:['range', 'general', 'hourly', 'compact'].map(style),
        overflow:panel.scrollWidth - panel.clientWidth
      };
    });
    assert.ok(colors.unselected.every(([color, weight]) => color === 'rgb(116, 88, 102)' && weight === '600'), `${width}px porcelain toggles`);
    assert.ok(colors.selected.every(([color, weight, background]) => color === 'rgb(196, 51, 114)' && weight === '850' && background === 'rgb(255, 255, 255)'), `${width}px selected toggles changed`);
    assert.equal(colors.overflow, 0, `${width}px dialog overflow`);
    await page.locator('body').evaluate(element => { element.dataset.providerTheme = 'sage'; });
    const other = await page.locator('#freeSlotsDialog input[value="service"]+span').evaluate(element => {
      const css = getComputedStyle(element);
      return [css.color, css.fontWeight];
    });
    assert.deepEqual(other, ['rgb(102, 121, 111)', '850'], `${width}px other theme changed`);
    await page.close();
  }
  console.log('Free slots porcelain toggle colors: PASS (390/760/1440, selected and other themes)');
} finally {
  await browser.close();
}
