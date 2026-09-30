import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const modulePath = process.env.MINUTA_PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const html = read('provider.html');
const styles = ['styles.css', 'provider-ux.css', 'statistics-audit-ui.css'].map(read);
const script = read('statistics-audit-ui.js');
const screenshotDir = process.env.REPORT_HEATMAP_SCREENSHOT_DIR ? resolve(process.env.REPORT_HEATMAP_SCREENSHOT_DIR) : '';
if (screenshotDir) mkdirSync(screenshotDir, { recursive:true });
const browser = await chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });

try {
  for (const width of [390, 760, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:900 } });
    await page.goto('about:blank');
    await page.evaluate(source => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      const panel = document.importNode(parsed.querySelector('#analyticsView'), true);
      document.body.className = 'provider-body';
      document.body.dataset.providerTheme = 'sage-studio';
      document.body.dataset.providerLayout = 'soft';
      document.body.style.cssText = 'margin:0;--theme-ink:#173128;--theme-muted:#60746a;--theme-accent:#296b4b;--theme-line:#d9e5de;--theme-surface:#fff;--theme-surface-alt:#f4f7f5;background:#edf2ef';
      document.body.append(panel);
      panel.hidden = false;
      panel.dataset.reportSource = 'demo';
      panel.dataset.reportLoadState = 'ready'; // The synthetic heatmap below is already loaded.
      panel.dataset.reportTab = 'overview';
      panel.querySelector('.report-analytics-details').open = true;
      const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
      panel.querySelector('#reportHeatmap').innerHTML = '<span class="report-heatmap-corner"></span>'
        + days.map(day => `<b>${day}</b>`).join('')
        + '<strong>10:00</strong>' + days.map((day, index) => `<button type="button" class="report-heatmap-cell" aria-label="${day}, 10:00"><i>${index + 1}</i></button>`).join('');
    }, html);
    for (const style of styles) await page.addStyleTag({ content:style });
    await page.addScriptTag({ content:script });
    await page.evaluate(() => {
      window.heatmapAudit = MinutaStatisticsAuditUI.create({
        document,
        getScope:() => ({ status:'ready', source:'demo', start:'2026-09-01', end:'2026-09-30' }),
        getSegments:() => ({ all:[], new:[], returning:[] }),
        download:() => { throw new Error('download must not run'); }
      });
      heatmapAudit.mount();
    });

    const map = page.locator('#reportHeatmap');
    const hint = page.locator('#reportHeatmapScrollHint');
    assert.equal(await hint.count(), 1, `${width}: one hint mounted`);
    await map.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), `${width}: no external overflow`);
    if (width === 390) {
      assert.equal(await hint.isVisible(), true, '390: hint initially visible');
      assert.ok(await map.evaluate(element => element.scrollWidth > element.clientWidth + 1), '390: heatmap has internal horizontal scroll');
      assert.equal(await map.locator('strong').first().evaluate(element => getComputedStyle(element).position), 'sticky', '390: time column is sticky');
      const timeLeft = await map.locator('strong').first().evaluate(element => element.getBoundingClientRect().left);
      if (screenshotDir) await page.screenshot({ path:join(screenshotDir, 'heatmap-390-before.png') });
      await map.hover();
      await page.mouse.wheel(180, 0);
      await page.waitForFunction(() => document.querySelector('#reportHeatmap').scrollLeft > 0);
      assert.ok(Math.abs(await map.locator('strong').first().evaluate(element => element.getBoundingClientRect().left) - timeLeft) <= 1, '390: time column remains fixed after scroll');
      assert.equal(await hint.isVisible(), false, '390: hint hides after actual horizontal scroll');
      await page.evaluate(() => {
        const map = document.querySelector('#reportHeatmap');
        map.innerHTML = map.innerHTML;
        heatmapAudit.refresh();
        heatmapAudit.mount();
      });
      assert.equal(await hint.count(), 1, '390: rerender does not duplicate hint');
      assert.equal(await hint.isVisible(), false, '390: hint remains hidden after rerender');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth <= 1), '390: no external overflow after scroll');
      if (screenshotDir) await page.screenshot({ path:join(screenshotDir, 'heatmap-390-after.png') });
    } else {
      assert.equal(await hint.isVisible(), false, `${width}: mobile-only hint is not shown`);
      if (screenshotDir) await page.screenshot({ path:join(screenshotDir, `heatmap-${width}.png`) });
    }
    await page.close();
  }
} finally {
  await browser.close();
}
